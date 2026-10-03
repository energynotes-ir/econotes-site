import unittest

from api.app.ingest_omo import parse_article


def article(body, title="گزارش عملیات اجرایی سیاست پولی"):
    import json

    payload = {
        "@type": "NewsArticle",
        "headline": title,
        "datePublished": "2026-09-21T15:44:23+03:30",
        "articleBody": body,
    }
    return f'<html><script type="application/ld+json">{json.dumps(payload, ensure_ascii=False)}</script></html>'


class OmoParserTests(unittest.TestCase):
    def test_parses_repo_and_outright_amounts_and_operation_date(self):
        document = article(
            "توافق بازخرید به مبلغ ۷۰۰.۰ هزار میلیارد ریال و خرید قطعی به مبلغ ۲۰.۶ هزار میلیارد ریال اقدام کرد. "
            "گزارش عملیات اجرایی سیاست پولی (۳۰ شهریور ماه ۱۴۰۵) به شرح زیر است:"
        )

        result = parse_article(document, "https://www.ibena.ir/fa/news/186911/report")

        self.assertEqual(result["date"], "2026-09-21")
        self.assertEqual(result["metrics"]["omo-repo"], 70.0)
        self.assertEqual(result["metrics"]["omo-outright"], 2.06)
        self.assertEqual(result["article_id"], "186911")

    def test_missing_amount_is_not_fabricated_as_zero(self):
        document = article(
            "توافق بازخرید به مبلغ ۷۰۰.۰ هزار میلیارد ریال و خرید قطعی اقدام کرد. "
            "گزارش عملیات اجرایی سیاست پولی (۶ مهر ماه ۱۴۰۵) به شرح زیر است:",
            "گزارش عملیات اجرایی سیاست پولی (۶ مهر ماه ۱۴۰۵)",
        )

        result = parse_article(document, "https://www.ibena.ir/fa/news/187061/report")

        self.assertEqual(result["date"], "2026-09-28")
        self.assertEqual(result["metrics"]["omo-repo"], 70.0)
        self.assertNotIn("omo-outright", result["metrics"])

    def test_reverse_repo_toman_values_are_normalized_to_hemats(self):
        document = article(
            "بانک مرکزی در قالب توافق بازخرید معکوس به مبلغ ۶۶.۸ هزار میلیارد ریال اقدام کرد. "
            "گزارش عملیات اجرایی سیاست پولی (۲ شهریور ماه ۱۴۰۵) به شرح زیر است:"
        )

        result = parse_article(document, "https://www.ibena.ir/fa/news/186121/report")

        self.assertEqual(result["metrics"]["omo-reverse-repo"], 6.68)


if __name__ == "__main__":
    unittest.main()
