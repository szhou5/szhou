# szhou

A lightweight Riftbound price tracker that stores real card history locally and calculates SMA/RSI from that stored data.

## What this app does

- Plots daily price history for a selected card
- Overlays 20-day and 50-day simple moving averages
- Calculates a 14-day RSI
- Flags potential buy zones when price is below key averages and RSI is relatively weak

## Current state

This repo now has a real-data pipeline:

- [watchlist.json](/Users/sunnyzhou/szhou/data/watchlist.json) defines tracked cards
- [update_dotgg_history.py](/Users/sunnyzhou/szhou/scripts/update_dotgg_history.py) fetches live Riftbound price history from the DotGG public API
- [cards.json](/Users/sunnyzhou/szhou/data/cards.json) stores normalized history for the frontend
- the browser app loads that stored history by default

Manual CSV/JSON import still works in the UI and temporarily overrides the stored history for that browser session.

## Source notes

The live collector currently uses the DotGG public API for Riftbound history. I did not wire up direct TCGplayer scraping because:

- TCGplayer’s official API access is not generally available for new integrations
- automated scraping of live marketplace pages is brittle and not a good long-term foundation

The tracked Kai'Sa alternate-art card is configured to use the `Foil` history field returned by DotGG, because that field best matches the alternate-art market variant.

## Run it

You can run the app in either of these ways:

1. Open [index.html](/Users/sunnyzhou/szhou/index.html) directly in a browser.
2. In VS Code, run the `Launch Riftbound App` debug configuration from [launch.json](/Users/sunnyzhou/szhou/.vscode/launch.json). That will start a local server using [tasks.json](/Users/sunnyzhou/szhou/.vscode/tasks.json) and open `http://127.0.0.1:8080`.

## Collector workflow

Refresh the stored history:

```bash
./.venv/bin/python scripts/update_dotgg_history.py
```

That command updates:

- [cards.json](/Users/sunnyzhou/szhou/data/cards.json)
- [kaisa-history.csv](/Users/sunnyzhou/szhou/sample-data/kaisa-history.csv)
- [kaisa-history.json](/Users/sunnyzhou/szhou/sample-data/kaisa-history.json)

Import your own real file into the stored manifest:

```bash
./.venv/bin/python scripts/import_history.py /path/to/history.csv \
  --id my-card \
  --name "My Card" \
  --source-name "Manual Import"
```

## Import format

The app accepts `.csv` or `.json` files with at least 15 rows so it can calculate `RSI(14)`.

CSV example:

```csv
date,price
2026-03-20,88.75
2026-03-21,89.10
2026-03-22,89.50
2026-03-23,89.99
```

JSON example:

```json
[
  { "date": "2026-03-20", "price": 88.75 },
  { "date": "2026-03-21", "price": 89.10 }
]
```

Accepted field names:

- `date`, `day`, or `timestamp`
- `price`, `close`, `marketPrice`, `market_price`, `last_price`

The collector also exports the stored Kai'Sa history to [kaisa-history.csv](/Users/sunnyzhou/szhou/sample-data/kaisa-history.csv) and [kaisa-history.json](/Users/sunnyzhou/szhou/sample-data/kaisa-history.json), which gives you a real example file to import back into the app or inspect directly.

## Project structure

- [index.html](/Users/sunnyzhou/szhou/index.html): app shell
- [styles.css](/Users/sunnyzhou/szhou/styles.css): layout and chart styling
- [app.js](/Users/sunnyzhou/szhou/app.js): loads stored history, parses manual imports, calculates indicators, and renders charts
- [watchlist.json](/Users/sunnyzhou/szhou/data/watchlist.json): tracked card config for the collector
- [cards.json](/Users/sunnyzhou/szhou/data/cards.json): stored normalized card history used by the frontend
- [update_dotgg_history.py](/Users/sunnyzhou/szhou/scripts/update_dotgg_history.py): live history collector
- [import_history.py](/Users/sunnyzhou/szhou/scripts/import_history.py): import helper for your own real CSV/JSON files
- [kaisa-history.csv](/Users/sunnyzhou/szhou/sample-data/kaisa-history.csv): exported real CSV history
- [kaisa-history.json](/Users/sunnyzhou/szhou/sample-data/kaisa-history.json): exported real JSON history
