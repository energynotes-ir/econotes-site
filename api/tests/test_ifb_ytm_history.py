import unittest

from api.app.ingest_ifb_ytm_history import (
    _is_treasury_record,
    _maturity_from_security_title,
    calculate_treasury_ytm,
)


class TreasuryYtmHistoryTests(unittest.TestCase):
    def test_effective_annualized_yield_matches_four_live_ifb_examples(self):
        examples = [
            (932870, "2026-09-30", "2026-12-14", 40.24),
            (962000, "2026-09-30", "2026-11-09", 42.41),
            (988250, "2026-09-30", "2026-10-12", 43.26),
            (506000, "2026-09-30", "2028-09-04", 42.29),
        ]
        for price, observed_on, maturity_on, expected in examples:
            with self.subTest(price=price, maturity=maturity_on):
                self.assertAlmostEqual(
                    calculate_treasury_ytm(price, observed_on, maturity_on), expected, places=2,
                )

    def test_rejects_nonpositive_price_and_expired_security(self):
        with self.assertRaises(ValueError):
            calculate_treasury_ytm(0, "2026-09-30", "2026-10-12")
        with self.assertRaises(ValueError):
            calculate_treasury_ytm(990000, "2026-09-30", "2026-09-30")

    def test_parses_current_and_legacy_jalali_maturity_suffixes(self):
        current_iso, current_jalali = _maturity_from_security_title("اسنادخزانه-م2بودجه02-050923")
        old_iso, old_jalali = _maturity_from_security_title("اسناد خزانه اسلامي 950821")
        self.assertEqual(current_jalali, "1405-09-23")
        self.assertEqual(current_iso, "2026-12-14")
        self.assertEqual(old_jalali, "1395-08-21")
        self.assertEqual(old_iso, "2016-11-11")

    def test_excludes_derivative_contract_duplicates(self):
        cash = {
            "lVal18AFC": "اخزا816", "lVal30": "اسنادخزانه-م16بودجه98-010503",
            "insCode": "45353549301778828", "flowTitle": "بازار فرابورس",
        }
        derivative = {**cash, "insCode": "25188497994257224", "flowTitle": "بازار مشتقه"}
        self.assertTrue(_is_treasury_record(cash))
        self.assertFalse(_is_treasury_record(derivative))


if __name__ == "__main__":
    unittest.main()
