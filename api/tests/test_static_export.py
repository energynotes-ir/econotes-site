import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from api.app.db import database
from scripts.export_static_data import export_static_data


class StaticExportTests(unittest.TestCase):
    def test_export_writes_public_api_snapshot_without_database_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db_file = root / "econotes.db"
            output = root / "public" / "data"
            with patch.dict(os.environ, {"ECONOTES_DB": str(db_file)}):
                with database() as connection:
                    connection.executemany(
                        "INSERT INTO sources (id, name) VALUES (?, ?)",
                        [
                            ("tsetmc", "TSETMC"),
                            ("ifb-ytm", "فرابورس"),
                            ("ifb-ytm-history", "آرشیو فرابورس"),
                        ],
                    )
                    connection.executemany(
                        """INSERT INTO series (id, title, description, group_id, unit, frequency, source_id)
                           VALUES (?, ?, ?, ?, ?, ?, ?)""",
                        [
                            ("tedpix", "شاخص کل", "", "markets", "شاخص", "daily", "tsetmc"),
                            ("yield", "بازده اخزا", "", "rates", "%", "daily", "ifb-ytm"),
                            ("yield-history", "آرشیو بازده اخزا", "", "rates", "%", "daily", "ifb-ytm-history"),
                        ],
                    )
                    connection.execute(
                        """INSERT INTO observations
                           (series_id, observed_on, value, symbol, source_record_id, published_at)
                           VALUES ('tedpix', '2026-09-29', 7594957.3, 'شاخص کل', 'a', '2026-09-30T00:00:00Z')"""
                    )
                    connection.execute(
                        """INSERT INTO events
                           (title, starts_on, event_type, source_url, evidence, status, created_at)
                           VALUES ('رویداد منتشرشدهٔ آزمون', '2026-05-04', 'policy', 'https://example.test/event', 'fixture', 'published', '2026-05-05T00:00:00Z')"""
                    )
                    connection.execute(
                        """INSERT INTO events
                           (title, starts_on, event_type, evidence, status, created_at)
                           VALUES ('رویداد پیشنهادی آزمون', '2026-05-06', 'policy', 'fixture', 'proposed', '2026-05-05T00:00:00Z')"""
                    )
                summary = export_static_data(output)

            payload = json.loads((output / "api/v1/dashboard-data.json").read_text(encoding="utf-8"))
            events = json.loads((output / "api/v1/events.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["series"], 1)
            self.assertEqual(summary["events"], 1)
            self.assertEqual(payload["items"][0]["points"][0]["value"], 7_594_957.3)
            self.assertTrue(payload["static_snapshot_at"].endswith("Z"))
            self.assertEqual(events, {"items": [{
                "id": 1,
                "title": "رویداد منتشرشدهٔ آزمون",
                "starts_on": "2026-05-04",
                "ends_on": None,
                "source_url": "https://example.test/event",
                "event_type": "policy",
                "status": "published",
            }]})
            self.assertTrue((output / "api/v1/bonds.json").is_file())
            self.assertFalse((output / "econotes.db").exists())


if __name__ == "__main__":
    unittest.main()
