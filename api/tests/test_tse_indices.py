import os
import tempfile
import unittest
from importlib import import_module
from pathlib import Path
from unittest.mock import patch

from api.app.db import database
from api.app import ingest_tse


INDEX_CODE = "32097828799138957"
PAYLOAD = {"indexB2": [
    {"insCode": int(INDEX_CODE), "dEven": 20260928, "xNivInuClMresIbs": 7_540_000.0,
     "xNivInuPbMresIbs": 7_520_000.0, "xNivInuPhMresIbs": 7_560_000.0},
    {"insCode": int(INDEX_CODE), "dEven": 20260929, "xNivInuClMresIbs": 7_594_957.3,
     "xNivInuPbMresIbs": 7_574_830.0, "xNivInuPhMresIbs": 7_613_520.0},
]}


class TseIndexTests(unittest.TestCase):
    def test_index_history_parser_maps_closing_level_and_date(self):
        parser = getattr(ingest_tse, "parse_index_history", None)
        self.assertTrue(callable(parser), "TSETMC index-history parser is not implemented")
        rows = parser(PAYLOAD)
        self.assertEqual(rows[-1]["date"], "2026-09-29")
        self.assertEqual(rows[-1]["value"], 7_594_957.3)

    def test_index_import_persists_daily_tedpix_observations(self):
        directory = tempfile.TemporaryDirectory()
        try:
            with patch.dict(os.environ, {"ECONOTES_DB": str(Path(directory.name) / "test.db")}):
                importer = getattr(ingest_tse, "import_indices", None)
                self.assertTrue(callable(importer), "TSETMC daily index importer is not implemented")
                with patch.object(ingest_tse, "fetch_index_history", return_value=PAYLOAD):
                    result = importer()
                self.assertGreaterEqual(result["series"], 1)
                with database() as connection:
                    item = connection.execute("SELECT frequency, group_id FROM series WHERE id='tedpix'").fetchone()
                    self.assertEqual((item["frequency"], item["group_id"]), ("daily", "markets"))
                    values = connection.execute(
                        "SELECT observed_on, value FROM observations WHERE series_id='tedpix' ORDER BY observed_on"
                    ).fetchall()
                    self.assertEqual([(row["observed_on"], row["value"]) for row in values], [
                        ("2026-09-28", 7_540_000.0), ("2026-09-29", 7_594_957.3),
                    ])
        finally:
            directory.cleanup()


if __name__ == "__main__":
    unittest.main()
