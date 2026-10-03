import unittest

from api.app.ingest_real_exchange import build_real_exchange_rows


class RealExchangeTests(unittest.TestCase):
    def test_uses_period_average_and_latest_ended_us_cpi_then_rebases_to_100(self):
        iran = [
            {"date": "2022-01-20", "jalali": "14001030", "value": 100},
            {"date": "2022-02-20", "jalali": "14001130", "value": 110},
            {"date": "2022-03-20", "jalali": "14001229", "value": 121},
        ]
        us = [
            {"date": "2021-12-31", "value": 200},
            {"date": "2022-01-31", "value": 210},
            {"date": "2022-02-28", "value": 220},
        ]
        fx = [
            {"date": "2022-01-25", "value": 100},
            {"date": "2022-02-10", "value": 110},
            {"date": "2022-02-25", "value": 120},
        ]

        rows = build_real_exchange_rows(iran, us, fx)

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["value"], 100)
        self.assertAlmostEqual(rows[1]["value"], (120 * 220 / 121) / ((105 * 210 / 110)) * 100)
        self.assertIn("CPI آمریکا 2022-01-31", rows[0]["symbol"])
        self.assertEqual(rows[-1]["date"], "2022-03-20")

    def test_does_not_extrapolate_beyond_observed_iran_cpi(self):
        iran = [
            {"date": "2022-01-20", "value": 100},
            {"date": "2022-02-20", "value": 110},
        ]
        us = [{"date": "2022-01-31", "value": 210}]
        fx = [{"date": "2022-01-25", "value": 100}, {"date": "2022-02-10", "value": 110}]

        rows = build_real_exchange_rows(iran, us, fx)

        self.assertEqual([row["date"] for row in rows], ["2022-02-20"])


if __name__ == "__main__":
    unittest.main()
