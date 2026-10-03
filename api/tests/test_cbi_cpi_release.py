import unittest
from importlib import import_module
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

from api.app.db import database
from persiantools.jdatetime import JalaliDate


class CbiCpiReleaseTests(unittest.TestCase):
    def _index_rows(self):
        rows = []
        for month in range(1, 14):
            year, jalali_month = (1400, month) if month <= 12 else (1401, 1)
            last_day = (
                31 if jalali_month <= 6 else 30 if jalali_month <= 11
                else 30 if JalaliDate.is_leap(year) else 29
            )
            end = JalaliDate(year, jalali_month, last_day)
            rows.append({
                "date": end.to_gregorian().isoformat(),
                "value": 100.0 + 5.0 * (month - 1) if month <= 12 else 210.0,
                "source_record_id": f"index-{year}-{jalali_month:02d}",
                "published_at": "2026-09-30T00:00:00+00:00",
            })
        return rows

    def test_full_history_rates_are_derived_from_monthly_cpi_indices(self):
        from api.app.ingest_cbi_cpi_release import calculate_index_rates

        rows = calculate_index_rates(self._index_rows())
        monthly = {row["date"]: row["value"] for row in rows["cpi-mom-cbi"]}
        yoy = {row["date"]: row["value"] for row in rows["cpi-yoy-cbi"]}
        self.assertEqual(len(monthly), 12)
        self.assertEqual(len(yoy), 1)
        self.assertEqual(monthly["2021-05-21"], 5.0)
        self.assertEqual(yoy[JalaliDate(1401, 1, 31).to_gregorian().isoformat()], 110.0)

    def test_recent_release_rows_keep_monthly_and_yoy_measures_separate(self):
        try:
            module = import_module("api.app.ingest_cbi_cpi_release")
        except ModuleNotFoundError:
            module = None
        self.assertIsNotNone(module, "CBI CPI headline importer is not implemented")
        rows = getattr(module, "release_observations", lambda *_: None)(self._index_rows())
        self.assertIsNotNone(rows, "CBI CPI headline release series are not implemented")
        monthly = {row["date"]: row["value"] for row in rows["cpi-mom-cbi"]}
        yoy = {row["date"]: row["value"] for row in rows["cpi-yoy-cbi"]}
        self.assertEqual(monthly["2026-08-22"], 3.7)
        self.assertEqual(monthly["2026-09-22"], 3.9)
        self.assertEqual(yoy["2026-08-22"], 84.4)
        self.assertEqual(yoy["2026-09-22"], 83.8)
        self.assertEqual(monthly["2026-04-20"], 7.0)
        self.assertEqual(yoy["2026-04-20"], 67.0)

    def test_release_import_persists_monthly_observations(self):
        try:
            module = import_module("api.app.ingest_cbi_cpi_release")
        except ModuleNotFoundError:
            module = None
        self.assertIsNotNone(module, "CBI CPI headline importer is not implemented")
        directory = tempfile.TemporaryDirectory()
        try:
            with patch.dict(os.environ, {"ECONOTES_DB": str(Path(directory.name) / "test.db")}):
                with database() as connection:
                    connection.execute("INSERT INTO sources (id, name) VALUES ('cbi-tsd-monthly', 'CBI')")
                    connection.execute(
                        "INSERT INTO series (id, title, group_id, unit, frequency, source_id) "
                        "VALUES ('cpi-ir-cbi', 'CPI', 'prices', 'index', 'monthly', 'cbi-tsd-monthly')"
                    )
                    for row in self._index_rows():
                        connection.execute(
                            "INSERT INTO observations (series_id, observed_on, value, source_record_id, published_at) "
                            "VALUES ('cpi-ir-cbi', ?, ?, ?, ?)",
                            (row["date"], row["value"], row["source_record_id"], row["published_at"]),
                        )
                result = module.import_cpi_release()
                self.assertEqual(result["observations"], 25)
                with database() as connection:
                    items = connection.execute(
                        "SELECT id, frequency, unit FROM series WHERE id LIKE 'cpi-%-cbi' ORDER BY id"
                    ).fetchall()
                    self.assertEqual({item["id"] for item in items}, {"cpi-ir-cbi", "cpi-mom-cbi", "cpi-yoy-cbi"})
                    self.assertTrue(all(item["frequency"] == "monthly" for item in items))
                    rows = connection.execute(
                        "SELECT series_id, observed_on, value FROM observations "
                        "WHERE series_id IN ('cpi-mom-cbi', 'cpi-yoy-cbi') ORDER BY series_id, observed_on"
                    ).fetchall()
                    self.assertEqual(len(rows), 25)
                    self.assertEqual(sum(row["series_id"] == "cpi-mom-cbi" for row in rows), 18)
                    self.assertEqual(sum(row["series_id"] == "cpi-yoy-cbi" for row in rows), 7)
        finally:
            directory.cleanup()


if __name__ == "__main__":
    unittest.main()
