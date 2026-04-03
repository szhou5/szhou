#!/usr/bin/env python3
import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import List


ROOT = Path(__file__).resolve().parents[1]
CARDS_PATH = ROOT / "data" / "cards.json"


def parse_csv(path: Path) -> List[dict]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = []
        for index, row in enumerate(reader, start=2):
            date = row.get("date") or row.get("day") or row.get("timestamp")
            price = row.get("price") or row.get("close") or row.get("marketPrice") or row.get("market_price") or row.get("last_price")
            if not date or not price:
                raise SystemExit(f"CSV row {index} is missing date or price")
            rows.append({"date": normalize_date(date), "price": normalize_price(price)})
        return rows


def parse_json(path: Path) -> List[dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = payload if isinstance(payload, list) else payload.get("prices") or payload.get("data") or []
    if not isinstance(rows, list):
        raise SystemExit("JSON must be an array or contain a prices/data array")

    normalized = []
    for index, row in enumerate(rows, start=1):
        date = row.get("date") or row.get("day") or row.get("timestamp")
        price = row.get("price") or row.get("close") or row.get("marketPrice") or row.get("market_price") or row.get("last_price")
        if not date or price in (None, ""):
            raise SystemExit(f"JSON row {index} is missing date or price")
        normalized.append({"date": normalize_date(date), "price": normalize_price(price)})
    return normalized


def normalize_date(value: str) -> str:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00")) if "T" in value else datetime.fromisoformat(value)
    return parsed.date().isoformat()


def normalize_price(value) -> float:
    return round(float(str(value).replace("$", "").replace(",", "").strip()), 2)


def load_rows(path: Path) -> List[dict]:
    rows = parse_json(path) if path.suffix.lower() == ".json" else parse_csv(path)
    rows = sorted(rows, key=lambda row: row["date"])

    deduped = {}
    for row in rows:
        deduped[row["date"]] = row

    normalized = [deduped[key] for key in sorted(deduped)]
    if len(normalized) < 15:
        raise SystemExit("Imported history needs at least 15 rows to calculate RSI(14)")
    return normalized


def main() -> int:
    parser = argparse.ArgumentParser(description="Import a real history CSV/JSON into data/cards.json")
    parser.add_argument("input_path", help="Path to a CSV or JSON file with date and price fields")
    parser.add_argument("--id", required=True, help="Local card id to store in data/cards.json")
    parser.add_argument("--name", required=True, help="Display name for the card")
    parser.add_argument("--source-url", default="", help="Optional reference URL")
    parser.add_argument("--source-name", default="Manual Import", help="Source label shown in the UI")
    parser.add_argument("--feed-label", default="Stored History", help="Feed label shown in the UI")
    args = parser.parse_args()

    input_path = Path(args.input_path).expanduser().resolve()
    rows = load_rows(input_path)

    payload = json.loads(CARDS_PATH.read_text(encoding="utf-8"))
    cards = payload.get("cards", [])

    stored_card = {
        "id": args.id,
        "name": args.name,
        "sourceUrl": args.source_url,
        "sourceName": args.source_name,
        "feedLabel": args.feed_label,
        "priceField": "price",
        "fetchedAt": datetime.now(tz=timezone.utc).replace(microsecond=0).isoformat(),
        "prices": rows,
    }

    cards = [card for card in cards if card.get("id") != args.id]
    cards.insert(0, stored_card)
    payload["generatedAt"] = datetime.now(tz=timezone.utc).replace(microsecond=0).isoformat()
    payload["source"] = "Mixed Stored History"
    payload["cards"] = cards

    CARDS_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Imported {len(rows)} rows into {CARDS_PATH} for {args.id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
