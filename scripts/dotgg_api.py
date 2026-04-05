from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlencode
from urllib.request import Request, urlopen


GAME_ID = "riftbound"
CATALOG_API_BASE = "https://api.dotgg.gg/cgfw/getcards"
PRICE_API_BASE = "https://api.dotgg.gg/cgfw/getcardprices"
VERSION_API_BASE = "https://butterfly.dotgg.gg/"
WEBSITE_CARD_BASE = "https://riftbound.gg/cards"
DEFAULT_TIMEPATTERN = "6m"
USER_AGENT = "szhou-riftbound-price-collector/1.0"


def fetch_json(url: str) -> Any:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def build_catalog_url(cache_token: Optional[str] = None) -> str:
    query = {"game": GAME_ID, "mode": "indexed"}
    if cache_token:
        query["cache"] = cache_token
    return f"{CATALOG_API_BASE}?{urlencode(query)}"


def build_price_history_url(card_id: str, timepattern: str = DEFAULT_TIMEPATTERN) -> str:
    query = urlencode(
        {
            "game": GAME_ID,
            "cardid": card_id,
            "timepattern": timepattern,
        }
    )
    return f"{PRICE_API_BASE}?{query}"


def get_catalog_cache_token() -> str:
    try:
        payload = fetch_json(f"{VERSION_API_BASE}?{urlencode({'game': GAME_ID})}")
    except Exception:
        return datetime.now(tz=timezone.utc).strftime("%Y%m%d")

    return str(payload).strip() or datetime.now(tz=timezone.utc).strftime("%Y%m%d")


def decode_indexed_cards(payload: dict) -> list[dict]:
    names = payload.get("names", [])
    rows = payload.get("data", [])
    if not isinstance(names, list) or not isinstance(rows, list):
        return []

    return [dict(zip(names, row)) for row in rows if isinstance(row, list)]


def is_riftbound_catalog_card(card: dict) -> bool:
    image_url = str(card.get("image", ""))
    cm_url = str(card.get("cmurl", ""))

    if "/riftbound/cards/" in image_url.lower():
        return True

    return "/en/riftbound/" in cm_url.lower()


def parse_number(value: Any) -> Optional[float]:
    if value in (None, "", "null"):
        return None

    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_colors(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(entry) for entry in value if entry]
    if isinstance(value, str) and value:
        return [value]
    return []


def infer_price_field(card: dict) -> str:
    normal_price = parse_number(card.get("price"))
    if normal_price and normal_price > 0:
        return "Normal"
    return "Foil"


def build_card_source_url(card: dict) -> str:
    slug = str(card.get("slug", "")).strip()
    if not slug:
        return ""
    return f"{WEBSITE_CARD_BASE}/{slug}"


def build_card_summary(card: dict) -> dict:
    price_field = infer_price_field(card)
    normal_price = parse_number(card.get("price"))
    foil_price = parse_number(card.get("foilPrice"))
    current_price = normal_price if price_field == "Normal" else foil_price

    return {
        "id": str(card.get("id", "")),
        "dotggCardId": str(card.get("id", "")),
        "slug": str(card.get("slug", "")),
        "name": str(card.get("name", "")),
        "setName": str(card.get("set_name", "")),
        "rarity": str(card.get("rarity", "")),
        "type": str(card.get("type", "")),
        "supertype": str(card.get("supertype", "")),
        "colors": normalize_colors(card.get("color")),
        "imageUrl": str(card.get("image", "")),
        "sourceUrl": build_card_source_url(card),
        "priceField": price_field,
        "currentPrice": current_price,
        "normalPrice": normal_price,
        "foilPrice": foil_price,
    }


def fetch_card_catalog() -> list[dict]:
    payload = fetch_json(build_catalog_url(get_catalog_cache_token()))
    return [
        build_card_summary(card)
        for card in decode_indexed_cards(payload)
        if is_riftbound_catalog_card(card)
    ]


def parse_search_terms(query: str) -> list[str]:
    return [term for term in re.split(r"\s+", query.strip().lower()) if term]


def score_card_match(card: dict, query: str) -> int:
    normalized_query = query.strip().lower()
    if not normalized_query:
        return 0

    tokens = parse_search_terms(normalized_query)
    name = str(card.get("name", "")).lower()
    slug = str(card.get("slug", "")).lower()
    set_name = str(card.get("setName", "")).lower()
    rarity = str(card.get("rarity", "")).lower()
    card_type = str(card.get("type", "")).lower()
    colors = " ".join(card.get("colors", [])).lower()
    haystack = " ".join([name, slug, set_name, rarity, card_type, colors])

    if not all(token in haystack for token in tokens):
        return 0

    score = 100

    if name == normalized_query:
        score += 400
    elif name.startswith(normalized_query):
        score += 260
    elif normalized_query in name:
        score += 210

    if slug == normalized_query:
        score += 220
    elif slug.startswith(normalized_query):
        score += 150
    elif normalized_query in slug:
        score += 110

    if set_name == normalized_query:
        score += 50
    if rarity == normalized_query:
        score += 45
    if card_type == normalized_query:
        score += 35

    score += sum(25 for token in tokens if token in name)
    score += sum(10 for token in tokens if token in slug)
    score += sum(6 for token in tokens if token in colors)

    return score


def search_cards(cards: list[dict], query: str, limit: int = 12) -> list[dict]:
    limit = max(1, min(limit, 20))
    scored_cards = []

    for card in cards:
        score = score_card_match(card, query)
        if score <= 0:
            continue
        scored_cards.append((score, card))

    scored_cards.sort(
        key=lambda entry: (
            -entry[0],
            -(entry[1].get("currentPrice") or 0),
            entry[1].get("name", ""),
            entry[1].get("dotggCardId", ""),
        )
    )

    return [card for _, card in scored_cards[:limit]]


def pick_price(line: dict, price_field: str) -> Optional[float]:
    preferred = parse_number(line.get(price_field))
    if preferred and preferred > 0:
        return preferred

    close_value = parse_number(line.get("closePrice"))
    if close_value and close_value > 0:
        return close_value

    for fallback_field in ("Foil", "Normal", "openPrice", "highPrice", "lowPrice"):
        fallback_value = parse_number(line.get(fallback_field))
        if fallback_value and fallback_value > 0:
            return fallback_value

    return None


def normalize_price_lines(lines: list[dict], price_field: str) -> list[dict]:
    rows = []
    for line in lines:
        timestamp = int(line["date"])
        iso_date = datetime.fromtimestamp(timestamp, tz=timezone.utc).date().isoformat()
        price = pick_price(line, price_field)
        if price is None:
            continue

        rows.append({"date": iso_date, "price": round(price, 2)})

    deduped = {}
    for row in rows:
        deduped[row["date"]] = row

    return [deduped[key] for key in sorted(deduped)]
