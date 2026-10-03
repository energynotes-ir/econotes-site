import unittest
from importlib import import_module


LOCAL_PAYLOAD = {"recordsTotal": 1, "data": [[
    "241,231,000", "240,971,000", "253,491,000", "252,181,000",
    "10890000", "4.51%", "2026/09/29", "1405/07/07",
]]}

GLOBAL_HTML = """<html><table><thead><tr><th>تاریخ شمسی</th><th>تاریخ میلادی</th><th>بازگشایی</th><th>کمترین</th><th>بیشترین</th><th>پایانی</th><th>درصد تغییر</th></tr></thead>
<tbody><tr><td>۱۴۰۵/۰۷/۰۷</td><td>2026-09-29</td><td>4,125.62</td><td>4,114.54</td><td>4,187.19</td><td>4,187.19</td><td>1.49%</td></tr></tbody></table></html>"""
GLOBAL_EMPTY_HTML = """<html><table><thead><tr><th>تاریخ شمسی</th><th>تاریخ میلادی</th><th>بازگشایی</th><th>کمترین</th><th>بیشترین</th><th>پایانی</th><th>درصد تغییر</th></tr></thead>
<tbody><tr><td colspan="7">موردی یافت نشد.</td></tr></tbody></table></html>"""
GLOBAL_PAYLOAD = {"recordsFiltered": 1, "data": [[
    "4,125.62", "4,114.54", "4,187.19", "4,174.15",
    "-13.04", "-0.31%", "2026/09/29", "1405/07/07",
]]}


class TgjuMetalsTests(unittest.TestCase):
    def test_local_gold_uses_the_extended_standard_18k_archive(self):
        from api.app.ingest_tgju_metals import LOCAL_API, LOCAL_SYMBOL

        self.assertEqual(LOCAL_SYMBOL, "geram18")
        self.assertTrue(LOCAL_API.endswith("/geram18"))

    def test_local_gold_history_rejects_an_unexpected_truncated_response(self):
        from api.app.ingest_tgju_metals import validate_local_gold_history

        with self.assertRaisesRegex(ValueError, "unexpectedly short"):
            validate_local_gold_history([{"date": "2025-01-01", "value": 1.0}] * 10)

    def test_local_18k_rial_quote_is_normalized_to_toman_per_gram(self):
        try:
            module = import_module("api.app.ingest_tgju_metals")
        except ModuleNotFoundError:
            module = None
        self.assertIsNotNone(module, "TGJU metals importer is not implemented")
        parser = getattr(module, "parse_local_gold_payload", None)
        self.assertTrue(callable(parser), "TGJU local-gold parser is not implemented")
        rows = parser(LOCAL_PAYLOAD)
        self.assertEqual(rows, [{"date": "2026-09-29", "value": 25_218_100.0}])

    def test_global_gold_parser_reads_daily_xau_usd_close(self):
        try:
            module = import_module("api.app.ingest_tgju_metals")
        except ModuleNotFoundError:
            module = None
        self.assertIsNotNone(module, "TGJU metals importer is not implemented")
        parser = getattr(module, "parse_global_gold_html", None)
        self.assertTrue(callable(parser), "TGJU global-gold parser is not implemented")
        rows = parser(GLOBAL_HTML)
        self.assertEqual(rows, [{"date": "2026-09-29", "value": 4_187.19}])

    def test_global_gold_parser_accepts_known_empty_history_page(self):
        from api.app.ingest_tgju_metals import parse_global_gold_html

        self.assertEqual(parse_global_gold_html(GLOBAL_EMPTY_HTML), [])

    def test_global_gold_api_parser_reads_daily_xau_usd_close(self):
        from api.app.ingest_tgju_metals import parse_global_gold_payload

        self.assertEqual(
            parse_global_gold_payload(GLOBAL_PAYLOAD),
            [{"date": "2026-09-29", "value": 4_174.15}],
        )

    def test_global_gold_history_rejects_a_truncated_archive(self):
        from api.app.ingest_tgju_metals import validate_global_gold_history

        with self.assertRaisesRegex(ValueError, "unexpectedly short"):
            validate_global_gold_history([{"date": "2025-01-01", "value": 1.0}] * 50)


if __name__ == "__main__":
    unittest.main()
