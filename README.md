# szhou

A lightweight Riftbound card tracker with live DotGG search, local API endpoints, Simple Moving Averages, and RSI-based buy signals.

## What this app does

- Searches the Riftbound catalog through a local API backed by DotGG
- Loads live price history for the selected card
- Overlays 20-day and 50-day Simple Moving Averages
- Calculates a 14-day RSI
- Flags potential buy zones when price is below key averages and RSI is relatively weak

## Current state

This repo now has a live-search-first workflow:

- [server.py](/Users/sunnyzhou/szhou/server.py) serves the app and exposes local `/api/*` endpoints for live search and live card history
- [cards.json](/Users/sunnyzhou/szhou/data/cards.json) is currently an empty stored-history manifest
- [watchlist.json](/Users/sunnyzhou/szhou/data/watchlist.json) is currently an empty collector config
- the browser app starts with no selected card and waits for you to choose a tracked card or search DotGG

## Source notes

The live collector currently uses the DotGG public API for Riftbound history. I did not wire up direct TCGplayer scraping because:

- TCGplayer's official API access is not generally available for new integrations
- automated scraping of live marketplace pages is brittle and not a good long-term foundation

The app now supports live loading for any searchable Riftbound card in DotGG. Stored history is optional and currently ships empty in this repo.

## Run it

Use the local API server when possible, because the app fetches stored history from `data/cards.json` and live search/history data from DotGG through local `/api/*` endpoints. Opening `index.html` with `file://` will not support that flow.

You can run the app in either of these ways:

1. In VS Code, run the `Launch Riftbound App` debug configuration from [launch.json](/Users/sunnyzhou/szhou/.vscode/launch.json). That will start a local server using [tasks.json](/Users/sunnyzhou/szhou/.vscode/tasks.json) and open `http://127.0.0.1:8080`.
2. In PowerShell, run:

```powershell
.\.venv\Scripts\python.exe .\server.py --port 8080 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8080`.

### Live card search

The controls panel includes a DotGG-backed search box. Search by card name, slug, rarity, type, or color, then press Enter, click Search, or click a result to load live price history for that card into the dashboard.

### Current dashboard layout

The app currently renders four main areas:

- a controls sidebar with tracked card selection, DotGG search, reference URL, source status, and source metadata
- a card details panel with the selected card's art and metadata
- a recommendation panel that summarizes the SMA/RSI signal
- a price chart panel with price, SMA KPI cards, and RSI/trend KPI cards
- a separate RSI panel below the price chart

## Collector workflow

If you want to rebuild a stored-history manifest later, first add cards to [watchlist.json](/Users/sunnyzhou/szhou/data/watchlist.json), then run:

```powershell
.\.venv\Scripts\python.exe .\scripts\update_dotgg_history.py
```

That command updates:

- [cards.json](/Users/sunnyzhou/szhou/data/cards.json)

## Project structure

- [index.html](/Users/sunnyzhou/szhou/index.html): app shell
- [styles.css](/Users/sunnyzhou/szhou/styles.css): dashboard layout and chart styling
- [app.js](/Users/sunnyzhou/szhou/app.js): loads stored/live history, calculates indicators, and renders the dashboard
- [server.py](/Users/sunnyzhou/szhou/server.py): local web server and API endpoints for search/history
- [dotgg_api.py](/Users/sunnyzhou/szhou/scripts/dotgg_api.py): shared DotGG catalog/history helpers
- [watchlist.json](/Users/sunnyzhou/szhou/data/watchlist.json): optional tracked card config for the collector
- [cards.json](/Users/sunnyzhou/szhou/data/cards.json): stored history manifest used as a fallback when populated
- [update_dotgg_history.py](/Users/sunnyzhou/szhou/scripts/update_dotgg_history.py): live history collector
- [test_server.py](/Users/sunnyzhou/szhou/test_server.py): tests for the local API server
