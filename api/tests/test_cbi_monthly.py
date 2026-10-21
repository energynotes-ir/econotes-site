import unittest

from api.app.ingest_cbi_monthly import MONTHLY_SERIES, parse_monthly_rows


class CbiMonthlyParsingTests(unittest.TestCase):
    def test_legacy_official_usd_rates_are_not_refreshed(self):
        legacy_ids = {
            "usd-official-remittance-cbi",
            "usd-official-cash-cbi",
            "usd-official-weighted-cbi",
            "usd-official-preferential-cbi",
        }

        self.assertTrue(legacy_ids.isdisjoint(MONTHLY_SERIES))

    def test_price_index_is_not_converted(self):
        row = {
            "id": 18,
            "CATEGORYID": MONTHLY_SERIES["cpi-ir-cbi"]["category_id"],
            "khDate": "14040131",
            "amount": 132.5,
        }

        parsed = parse_monthly_rows([row])["cpi-ir-cbi"][0]

        self.assertEqual(parsed["value"], 132.5)


if __name__ == "__main__":
    unittest.main()
