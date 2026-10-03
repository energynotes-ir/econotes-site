import json
import sqlite3
import unittest
from decimal import Decimal

from api.app.ingest_mefa_monetary import _parse_amount, _quarter_end, _remove_misaligned_mefa_rows


class MefaMonetaryTests(unittest.TestCase):
    def test_quarter_end_uses_the_actual_jalali_calendar_year_end(self):
        self.assertEqual(_quarter_end("۱۴۰۴ زمستان"), ("2026-03-20", "14041229"))
        self.assertEqual(_quarter_end("1403 زمستان"), ("2025-03-20", "14031230"))

    def test_quarter_end_prefers_the_cbi_published_date_for_historical_periods(self):
        cbi_dates = {"1354 زمستان": ("1976-03-19", "13541229")}
        self.assertEqual(_quarter_end("۱۳۵۴ زمستان", cbi_dates), ("1976-03-19", "13541229"))

    def test_misaligned_mefa_rows_are_removed_without_deleting_aligned_observations(self):
        connection = sqlite3.connect(":memory:")
        connection.row_factory = sqlite3.Row
        connection.executescript("""
            CREATE TABLE macro_observations (
                series_id TEXT, observed_on TEXT, source_record_id TEXT, raw_payload TEXT
            );
            CREATE TABLE observations (
                series_id TEXT, observed_on TEXT, source_record_id TEXT
            );
        """)
        for observed_on, source_id in (
            ("1976-03-20", "mefa-3809-1354-زمستان"),
            ("1976-03-19", "cbi-quarter-13541229"),
        ):
            payload = json.dumps({"period": "1354 زمستان"})
            connection.execute(
                "INSERT INTO macro_observations VALUES (?, ?, ?, ?)",
                ("liquidity", observed_on, source_id, payload),
            )
            connection.execute(
                "INSERT INTO observations VALUES (?, ?, ?)",
                ("liquidity", observed_on, source_id),
            )

        removed = _remove_misaligned_mefa_rows(
            connection, {"1354 زمستان": ("1976-03-19", "13541229")}
        )

        self.assertEqual(removed, 1)
        self.assertEqual(
            [tuple(row) for row in connection.execute(
                "SELECT observed_on, source_record_id FROM macro_observations ORDER BY observed_on"
            )],
            [("1976-03-19", "cbi-quarter-13541229")],
        )
        self.assertEqual(
            [tuple(row) for row in connection.execute(
                "SELECT observed_on, source_record_id FROM observations ORDER BY observed_on"
            )],
            [("1976-03-19", "cbi-quarter-13541229")],
        )
        connection.close()

    def test_source_amount_removes_persian_thousands_separators(self):
        self.assertEqual(_parse_amount("۱۵۵٬۸۱۲٬۲۰۰"), Decimal("155812200"))
        self.assertEqual(_parse_amount("-"), None)


if __name__ == "__main__":
    unittest.main()
