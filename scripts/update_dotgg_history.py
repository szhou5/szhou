#!/usr/bin/env python3
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import List


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.dotgg_api import (  # noqa: E402
    DEFAULT_TIMEPATTERN,
    build_price_history_url,
    fetch_json,
    normalize_price_lines,
)


WATCHLIST_PATH = ROOT / "data" / "watchlist.json"
CARDS_PATH = ROOT / "data" / "cards.json"


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
        payload = fetch_json(build_price_history_url(config["dotggCardId"], args.timepattern))
        normalized_prices = normalize_price_lines(payload.get("lines", []), config["priceField"])
        if len(normalized_prices) < 15:
            raise SystemExit(f"Not enough usable price rows returned for {config['id']}")

        card_payload = build_card_payload(config, normalized_prices, generated_at)
        manifest_cards.append(card_payload)

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
