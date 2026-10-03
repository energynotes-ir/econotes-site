import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from api.app.db import database
from api.app.ingest_tse import import_instrument, parse_adjusted, parse_raw


RAW = {"closingPriceDaily": [
    {"dEven": 20260928, "priceFirst": 13000, "priceMax": 13080, "priceMin": 12880,
     "pClosing": 13060, "pDrCotVal": 13080, "priceYesterday": 12700,
     "qTotTran5J": 406863299, "qTotCap": 5315638283910, "zTotTran": 14303},
    {"dEven": 20260929, "priceFirst": 13380, "priceMax": 13450, "priceMin": 12860,
     "pClosing": 13330, "pDrCotVal": 13300, "priceYesterday": 13060,
     "qTotTran5J": 495015524, "qTotCap": 6598783346420, "zTotTran": 24811},
]}
ADJUSTED = "20260928,13080,12880,13000,13080,406863299,13060;20260929,13450,12860,13380,13300,495015524,13330;"


class TseImportTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"ECONOTES_DB": str(Path(self.directory.name) / "test.db")})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.directory.cleanup()

    def test_notebook_field_mapping(self):
        raw = parse_raw(RAW)
        adjusted = parse_adjusted(ADJUSTED)
        self.assertEqual(raw[-1]["close"], 13330)
        self.assertEqual(raw[-1]["volume"], 495015524)
        self.assertEqual(raw[-1]["trades"], 24811)
        self.assertEqual(adjusted[-1]["close"], 13330)
        self.assertIsNone(adjusted[-1]["traded_value"])

    def test_repeat_import_updates_without_duplicate_dates(self):
        with patch("api.app.ingest_tse.fetch_history", return_value=(parse_raw(RAW), parse_adjusted(ADJUSTED))):
            import_instrument("7745894403636165", "شپنا", "پالایش نفت اصفهان")
            import_instrument("7745894403636165", "شپنا", "پالایش نفت اصفهان")
        with database() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM market_prices").fetchone()[0], 4)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM observations").fetchone()[0], 4)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM ingestion_runs WHERE status='success'").fetchone()[0], 2)

    def test_failure_keeps_previous_prices_and_records_error(self):
        with patch("api.app.ingest_tse.fetch_history", return_value=(parse_raw(RAW), parse_adjusted(ADJUSTED))):
            import_instrument("7745894403636165", "شپنا", "پالایش نفت اصفهان")
        with patch("api.app.ingest_tse.fetch_history", side_effect=ValueError("Bad source response")):
            with self.assertRaises(ValueError):
                import_instrument("7745894403636165", "شپنا", "پالایش نفت اصفهان")
        with database() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM market_prices").fetchone()[0], 4)
            self.assertEqual(connection.execute("SELECT status FROM ingestion_runs ORDER BY id DESC LIMIT 1").fetchone()[0], "failed")


if __name__ == "__main__":
    unittest.main()
