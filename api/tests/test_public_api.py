import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from api.app.db import database
from api.app.main import dashboard_data, get_series, published_events


class PublicSeriesApiTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"ECONOTES_DB": str(Path(self.directory.name) / "test.db")})
        self.env.start()
        with database() as connection:
            connection.executemany(
                """INSERT INTO series (id, title, group_id, unit, frequency)
                   VALUES (?, ?, ?, ?, ?)""",
                [
                    ("tedpix", "شاخص کل بورس تهران", "markets", "index", "daily"),
                    ("hidden-stock", "نماد داخلی", "stocks", "IRR", "daily"),
                    ("usd-official", "دلار حواله · ETS فروش", "currency", "تومان", "daily"),
                    ("usd-official-buy", "دلار حواله · ETS خرید", "currency", "تومان", "daily"),
                    ("usd-official-remittance-cbi", "دلار رسمی قدیمی", "currency", "تومان", "monthly"),
                    ("usd-official-cash-cbi", "دلار اسکناس قدیمی", "currency", "تومان", "monthly"),
                    ("usd-official-weighted-cbi", "دلار موزون قدیمی", "currency", "تومان", "monthly"),
                    ("usd-official-preferential-cbi", "دلار ترجیحی قدیمی", "currency", "تومان", "monthly"),
                ],
            )
            connection.executemany(
                """INSERT INTO observations (series_id, observed_on, value, published_at)
                   VALUES (?, ?, ?, ?)""",
                [
                    ("tedpix", "2026-09-29", 7_594_957.3, "2026-09-30T00:00:00Z"),
                    ("hidden-stock", "2026-09-29", 13_330, "2026-09-30T00:00:00Z"),
                    ("usd-official", "2026-10-19", 72_000, "2026-10-20T00:00:00Z"),
                    ("usd-official-buy", "2026-10-19", 71_500, "2026-10-20T00:00:00Z"),
                    ("usd-official-remittance-cbi", "2026-09-21", 68_000, "2026-09-22T00:00:00Z"),
                    ("usd-official-cash-cbi", "2026-09-21", 68_500, "2026-09-22T00:00:00Z"),
                    ("usd-official-weighted-cbi", "2026-09-21", 68_250, "2026-09-22T00:00:00Z"),
                    ("usd-official-preferential-cbi", "2026-09-21", 42_000, "2026-09-22T00:00:00Z"),
                ],
            )
            connection.executemany(
                """INSERT INTO events (title, starts_on, ends_on, event_type, source_url, evidence, status, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                [
                    ("رویداد منتشرشدهٔ آزمون", "2026-05-04", None, "policy", "https://example.test/event", "fixture", "published", "2026-05-05T00:00:00Z"),
                    ("رویداد پیشنهادی آزمون", "2026-05-06", None, "policy", None, "fixture", "proposed", "2026-05-05T00:00:00Z"),
                ],
            )

    def tearDown(self):
        self.env.stop()
        self.directory.cleanup()

    def test_public_index_series_remains_available(self):
        result = get_series("tedpix", limit=2000)
        self.assertEqual(result["series"]["id"], "tedpix")
        self.assertEqual(result["points"][0]["value"], 7_594_957.3)

    def test_unpublished_stock_series_is_not_readable_by_id(self):
        with self.assertRaises(HTTPException) as error:
            get_series("hidden-stock")
        self.assertEqual(error.exception.status_code, 404)

    def test_dashboard_uses_ets_usd_and_hides_legacy_official_rates(self):
        result = dashboard_data(limit=20_000)
        items = {item["series"]["id"]: item for item in result["items"]}

        self.assertIn("usd-official", items)
        self.assertIn("usd-official-buy", items)
        for series_id in (
            "usd-official-remittance-cbi",
            "usd-official-cash-cbi",
            "usd-official-weighted-cbi",
            "usd-official-preferential-cbi",
        ):
            self.assertNotIn(series_id, items)
            with self.assertRaises(HTTPException) as error:
                get_series(series_id)
            self.assertEqual(error.exception.status_code, 404)

        self.assertEqual(items["usd-official"]["points"][0]["value"], 72_000)

    def test_events_api_exposes_only_published_rows_with_source_metadata(self):
        result = published_events()
        self.assertEqual(result["items"], [{
            "id": 1,
            "title": "رویداد منتشرشدهٔ آزمون",
            "starts_on": "2026-05-04",
            "ends_on": None,
            "source_url": "https://example.test/event",
            "event_type": "policy",
            "status": "published",
        }])


if __name__ == "__main__":
    unittest.main()
