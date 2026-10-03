import json
import unittest

from api.app.ingest_cbi_monthly import MONTHLY_SERIES, parse_monthly_rows


class CbiMonthlyParsingTests(unittest.TestCase):
    def test_rial_exchange_rate_is_converted_to_toman_and_raw_payload_is_preserved(self):
        row = {
            "id": 17,
            "CATEGORYID": MONTHLY_SERIES["usd-official-remittance-cbi"]["category_id"],
            "khDate": "14040131",
            "amount": 680000,
        }

        parsed = parse_monthly_rows([row])["usd-official-remittance-cbi"][0]

        self.assertEqual(parsed["value"], 68000)
        self.assertEqual(parsed["date"], "2025-04-20")
        self.assertEqual(json.loads(parsed["raw_payload"])["amount"], 680000)

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
