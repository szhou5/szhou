#!/usr/bin/env python3
import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
WATCHLIST_PATH = ROOT / "data" / "watchlist.json"
CARDS_PATH = ROOT / "data" / "cards.json"
SAMPLE_DATA_DIR = ROOT / "sample-data"
API_BASE = "https://api.dotgg.gg/cgfw/getcardprices"
DEFAULT_TIMEPATTERN = "6m"
USER_AGENT = "szhou-riftbound-price-collector/1.0"


def fetch_json(url: str) -> dict:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def build_url(card_id: str, timepattern: str) -> str:
    query = urlencode(
        {
            "game": "riftbound",
            "cardid": card_id,
            "timepattern": timepattern,
        }
    )
    return f"{API_BASE}?{query}"


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


def parse_number(value) -> Optional[float]:
    if value in (None, "", "null"):
        return None

    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_lines(lines: List[dict], price_field: str) -> List[dict]:
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


def build_card_payload(config: dict, normalized_prices: List[dict], fetched_at: str) -> dict:
    return {
        "id": config["id"],
        "name": config["name"],
        "sourceUrl": config.get("sourceUrl", ""),
        "sourceName": config.get("sourceName", "DotGG Public API"),
        "feedLabel": config.get("feedLabel", "Stored History"),
        "priceField": config["priceField"],
        "dotggCardId": config["dotggCardId"],
        "fetchedAt": fetched_at,
        "prices": normalized_prices,
    }


def write_csv(path: Path, rows: List[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["date", "price"])
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch and store Riftbound card history from DotGG.")
    parser.add_argument("--timepattern", default=DEFAULT_TIMEPATTERN, help="DotGG history window, e.g. 1m, 3m, 6m, 12m")
    parser.add_argument("--card-id", help="Optional local card id from data/watchlist.json")
    args = parser.parse_args()

    watchlist = json.loads(WATCHLIST_PATH.read_text(encoding="utf-8"))
    cards = watchlist.get("cards", [])
    if args.card_id:
        cards = [card for card in cards if card["id"] == args.card_id]

    if not cards:
        raise SystemExit("No matching cards found in data/watchlist.json")

    generated_at = datetime.now(tz=timezone.utc).replace(microsecond=0).isoformat()
    manifest_cards = []

    for config in cards:
        payload = fetch_json(build_url(config["dotggCardId"], args.timepattern))
        normalized_prices = normalize_lines(payload.get("lines", []), config["priceField"])
        if len(normalized_prices) < 15:
            raise SystemExit(f"Not enough usable price rows returned for {config['id']}")

        card_payload = build_card_payload(config, normalized_prices, generated_at)
        manifest_cards.append(card_payload)

        csv_name = f"{config['id']}.csv"
        write_csv(SAMPLE_DATA_DIR / csv_name, normalized_prices)

        if config["id"] == "kaisa-survivor-alt-art":
            write_csv(SAMPLE_DATA_DIR / "kaisa-history.csv", normalized_prices)
            (SAMPLE_DATA_DIR / "kaisa-history.json").write_text(
                json.dumps(normalized_prices, indent=2) + "\n",
                encoding="utf-8",
            )

    CARDS_PATH.write_text(
        json.dumps(
            {
                "generatedAt": generated_at,
                "source": "DotGG Public API",
                "cards": manifest_cards,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"Wrote {len(manifest_cards)} card history payload(s) to {CARDS_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
