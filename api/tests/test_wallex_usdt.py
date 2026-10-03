import unittest
from datetime import date, datetime, timedelta, timezone


class WallexUsdtParserTests(unittest.TestCase):
    def test_daily_payload_uses_toman_close_and_omits_open_tehran_day(self):
        from api.app.ingest_wallex_usdt import parse_daily_payload

        payload = {
            "s": "ok",
            "t": [
                int(datetime(2026, 9, 29, tzinfo=timezone.utc).timestamp()),
                int(datetime(2026, 9, 30, tzinfo=timezone.utc).timestamp()),
            ],
            "o": [253000, 254000],
            "h": [255000, 260000],
            "l": [252000, 250000],
            "c": [254242, 259000],
            "v": [100, 200],
        }

        self.assertEqual(
            parse_daily_payload(payload, today=date(2026, 9, 30)),
            [{
                "date": "2026-09-29",
                "value": 254242.0,
                "source_record_id": "1790640000",
            }],
        )

    def test_daily_payload_rejects_misaligned_candle_arrays(self):
        from api.app.ingest_wallex_usdt import parse_daily_payload

        payload = {"s": "ok", "t": [1], "o": [], "h": [1], "l": [1], "c": [1], "v": [1]}
        with self.assertRaisesRegex(ValueError, "inconsistent lengths"):
            parse_daily_payload(payload, today=date(2026, 9, 30))

    def test_archive_guard_rejects_a_recent_truncated_response(self):
        from api.app.ingest_wallex_usdt import validate_daily_history

        with self.assertRaisesRegex(ValueError, "unexpectedly short"):
            validate_daily_history([{"date": "2026-09-29", "value": 254242.0}])

    def test_archive_guard_rejects_a_missing_historical_year(self):
        from api.app.ingest_wallex_usdt import validate_daily_history

        start = date(2020, 1, 1)
        rows = [
            {"date": (start + timedelta(days=offset)).isoformat(), "value": 254242.0}
            for offset in range(2100)
        ]
        with self.assertRaisesRegex(ValueError, "unexpectedly short"):
            validate_daily_history(rows, today=date(2025, 10, 1))


if __name__ == "__main__":
    unittest.main()
