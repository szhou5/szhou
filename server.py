#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import parse_qs, unquote, urlparse

from scripts.dotgg_api import (
    DEFAULT_TIMEPATTERN,
    build_price_history_url,
    fetch_card_catalog,
    fetch_json,
    normalize_price_lines,
    search_cards,
)


ROOT = Path(__file__).resolve().parent
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8080
VALID_TIMEPATTERNS = {"1m", "3m", "6m", "12m"}


class CardCatalogCache:
    def __init__(self, ttl: timedelta) -> None:
        self.ttl = ttl
        self._lock = Lock()
        self._cards: list[dict] = []
        self._expires_at = datetime.min.replace(tzinfo=timezone.utc)

    def get_cards(self) -> list[dict]:
        now = datetime.now(tz=timezone.utc)
        with self._lock:
            if self._cards and now < self._expires_at:
                return list(self._cards)

        cards = fetch_card_catalog()

        with self._lock:
            self._cards = cards
            self._expires_at = now + self.ttl
            return list(self._cards)


CATALOG_CACHE = CardCatalogCache(ttl=timedelta(hours=6))


class RiftboundHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory: str | None = None, **kwargs) -> None:
        super().__init__(*args, directory=directory or str(ROOT), **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_get(parsed)
            return
        super().do_GET()

    def handle_api_get(self, parsed) -> None:
        path_segments = [segment for segment in parsed.path.split("/") if segment]
        query = parse_qs(parsed.query)

        try:
            if path_segments == ["api", "health"]:
                self.write_json({"status": "ok"})
                return

            if path_segments == ["api", "cards", "search"]:
                self.handle_card_search(query)
                return

            is_history_route = (
                len(path_segments) == 4
                and path_segments[:2] == ["api", "cards"]
                and path_segments[3] == "history"
            )
            if is_history_route:
                self.handle_card_history(unquote(path_segments[2]), query)
                return

            self.write_error_json(HTTPStatus.NOT_FOUND, "Endpoint not found.")
        except ValueError as error:
            self.write_error_json(HTTPStatus.BAD_REQUEST, str(error))
        except LookupError as error:
            self.write_error_json(HTTPStatus.NOT_FOUND, str(error))
        except Exception as error:
            self.write_error_json(HTTPStatus.BAD_GATEWAY, f"DotGG request failed: {error}")

    def handle_card_search(self, query_params: dict) -> None:
        query = query_params.get("q", [""])[0].strip()
        if len(query) < 2:
            raise ValueError("Search query must be at least 2 characters.")

        try:
            limit = int(query_params.get("limit", ["8"])[0])
        except ValueError as error:
            raise ValueError("Limit must be an integer.") from error

        cards = CATALOG_CACHE.get_cards()
        results = search_cards(cards, query, limit=limit)
        self.write_json(
            {
                "query": query,
                "count": len(results),
                "cards": results,
            }
        )

    def handle_card_history(self, card_id: str, query_params: dict) -> None:
        timepattern = query_params.get("timepattern", [DEFAULT_TIMEPATTERN])[0]
        if timepattern not in VALID_TIMEPATTERNS:
            raise ValueError(f"timepattern must be one of {', '.join(sorted(VALID_TIMEPATTERNS))}.")

        cards = CATALOG_CACHE.get_cards()
        card = next((entry for entry in cards if entry.get("dotggCardId") == card_id), None)
        if card is None:
            raise LookupError(f"Card '{card_id}' was not found in the DotGG Riftbound catalog.")

        payload = fetch_json(build_price_history_url(card_id, timepattern))
        prices = normalize_price_lines(payload.get("lines", []), card["priceField"])
        if len(prices) < 15:
            raise ValueError(f"DotGG returned only {len(prices)} usable rows for {card['name']}.")

        card_payload = {
            "id": card["dotggCardId"],
            "dotggCardId": card["dotggCardId"],
            "name": card["name"],
            "slug": card["slug"],
            "setName": card["setName"],
            "rarity": card["rarity"],
            "type": card["type"],
            "supertype": card["supertype"],
            "colors": card["colors"],
            "imageUrl": card["imageUrl"],
            "sourceUrl": card["sourceUrl"],
            "sourceName": "DotGG Public API",
            "feedLabel": "Live DotGG",
            "priceField": card["priceField"],
            "currentPrice": card["currentPrice"],
            "normalPrice": card["normalPrice"],
            "foilPrice": card["foilPrice"],
            "fetchedAt": datetime.now(tz=timezone.utc).replace(microsecond=0).isoformat(),
            "prices": prices,
        }
        self.write_json({"card": card_payload})

    def write_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def write_error_json(self, status: HTTPStatus, message: str) -> None:
        self.write_json({"error": message}, status=status)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the Riftbound app and its local API.")
    parser.add_argument("--bind", default=DEFAULT_HOST, help="Address to bind to.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port to bind to.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    server = ThreadingHTTPServer((args.bind, args.port), RiftboundHandler)
    print(f"Serving Riftbound app on http://{args.bind}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
