import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from api.app.db import database
from api.app.ingest_cbi import CATEGORIES, import_liquidity, parse_rows


def sample_rows():
    return [
        {"CATEGORYID": category, "khDate": "14040930", "amount": "-25.5" if key == "other-liquidity" else "135344.5",
         "id": f"source-{key}"}
        for key, (category, _) in CATEGORIES.items()
    ] + [{"CATEGORYID": CATEGORIES["liquidity"][0], "khDate": None, "amount": None}]


class CbiImportTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"ECONOTES_DB": str(Path(self.directory.name) / "test.db")})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.directory.cleanup()

    def test_jalali_date_and_negative_factor(self):
        parsed = parse_rows(sample_rows())
        self.assertEqual(parsed["liquidity"][0]["date"], "2025-12-21")
        self.assertEqual(parsed["other-liquidity"][0]["value"], -25.5)

    def test_repeat_import_is_idempotent(self):
        with patch("api.app.ingest_cbi.fetch_rows", return_value=sample_rows()):
            import_liquidity()
            import_liquidity()
        with database() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM macro_observations").fetchone()[0], 8)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM observations").fetchone()[0], 8)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM ingestion_runs WHERE status='success'").fetchone()[0], 2)


if __name__ == "__main__":
    unittest.main()
