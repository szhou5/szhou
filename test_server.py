import unittest

from scripts.dotgg_api import (
    build_card_summary,
    is_riftbound_catalog_card,
    normalize_price_lines,
    search_cards,
)


class DotggApiTests(unittest.TestCase):
    def test_search_prefers_exact_name_match(self) -> None:
        cards = [
            build_card_summary(
                {
                    "id": "OGN-001",
                    "slug": "ogn-001-ahri-alluring",
                    "name": "Ahri - Alluring",
                    "set_name": "Origins",
                    "rarity": "Rare",
                    "type": "Unit",
                    "color": ["Calm"],
                    "image": "https://example.com/ahri.webp",
                    "price": "0.000000",
                    "foilPrice": "1.190000",
                }
            ),
            build_card_summary(
                {
                    "id": "OGN-002",
                    "slug": "ogn-002-alluring-trick",
                    "name": "Alluring Trick",
                    "set_name": "Origins",
                    "rarity": "Common",
                    "type": "Spell",
                    "color": ["Calm"],
                    "image": "https://example.com/trick.webp",
                    "price": "0.000000",
                    "foilPrice": "0.210000",
                }
            ),
        ]

        results = search_cards(cards, "Ahri - Alluring", limit=5)

        self.assertEqual(results[0]["dotggCardId"], "OGN-001")

    def test_normalize_price_lines_prefers_requested_field(self) -> None:
        lines = [
            {
                "date": "1762128000",
                "closePrice": "0",
                "Normal": "1.25",
                "Foil": "8.50",
            },
            {
                "date": "1762214400",
                "closePrice": "0",
                "Normal": "1.5",
                "Foil": "8.75",
            },
        ]

        normalized = normalize_price_lines(lines, "Normal")

        self.assertEqual(
            normalized,
            [{"date": "2025-11-03", "price": 1.25}, {"date": "2025-11-04", "price": 1.5}],
        )

    def test_riftbound_catalog_filter_uses_riftbound_urls(self) -> None:
        self.assertTrue(
            is_riftbound_catalog_card(
                {
                    "image": "https://static.dotgg.gg/riftbound/cards/SFD-113A.webp",
                    "cmurl": "https://www.cardmarket.com/en/Riftbound/Products/Singles/Spiritforged/Lucian-Merciless",
                }
            )
        )
        self.assertFalse(
            is_riftbound_catalog_card(
                {
                    "image": "https://static.dotgg.gg/lor/cards/01DE001.webp",
                    "cmurl": "https://www.cardmarket.com/en/OtherGame/Products/Singles/Set/Card",
                }
            )
        )


if __name__ == "__main__":
    unittest.main()
