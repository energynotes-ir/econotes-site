import csv
import io
import unittest
from datetime import date

from api.app.ingest_oecd_cpi import parse_oecd_cpi_csv


def _fixture_csv() -> str:
    fields = ["REF_AREA", "FREQ", "METHODOLOGY", "MEASURE", "UNIT_MEASURE",
              "EXPENDITURE", "ADJUSTMENT", "TRANSFORMATION", "TIME_PERIOD", "OBS_VALUE"]
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    year, month = 2015, 1
    for index in range(121):
        writer.writerow({
            "REF_AREA": "USA", "FREQ": "M", "METHODOLOGY": "N", "MEASURE": "CPI",
            "UNIT_MEASURE": "IX", "EXPENDITURE": "_T", "ADJUSTMENT": "N",
            "TRANSFORMATION": "_Z", "TIME_PERIOD": f"{year:04d}-{month:02d}",
            "OBS_VALUE": str(100 + index),
        })
        month += 1
        if month == 13:
            month, year = 1, year + 1
    writer.writerow({
        "REF_AREA": "CAN", "FREQ": "M", "METHODOLOGY": "N", "MEASURE": "CPI",
        "UNIT_MEASURE": "IX", "EXPENDITURE": "_T", "ADJUSTMENT": "N",
        "TRANSFORMATION": "_Z", "TIME_PERIOD": "2025-02", "OBS_VALUE": "999",
    })
    return output.getvalue()


class OecdCpiTests(unittest.TestCase):
    def test_parses_month_end_and_derives_mom_and_yoy_from_index(self):
        parsed = parse_oecd_cpi_csv(_fixture_csv())

        self.assertEqual(len(parsed["cpi-us"]), 121)
        self.assertEqual(parsed["cpi-us"][-1]["date"], "2025-01-31")
        self.assertEqual(parsed["cpi-us-mom"][-1]["date"], "2025-01-31")
        self.assertAlmostEqual(parsed["cpi-us-mom"][-1]["value"], (220 / 219 - 1) * 100)
        self.assertEqual(parsed["cpi-us-yoy"][-1]["date"], "2025-01-31")
        self.assertAlmostEqual(parsed["cpi-us-yoy"][-1]["value"], (220 / 208 - 1) * 100)

    def test_month_end_handles_leap_february(self):
        parsed = parse_oecd_cpi_csv(_fixture_csv())
        february_2024 = next(row for row in parsed["cpi-us"] if row["period"] == "2024-02")
        self.assertEqual(february_2024["date"], date(2024, 2, 29).isoformat())


if __name__ == "__main__":
    unittest.main()
