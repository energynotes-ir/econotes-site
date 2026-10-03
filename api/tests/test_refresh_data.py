import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from api.app import refresh_data
from api.app.refresh_data import task_is_due


class RefreshScheduleTests(unittest.TestCase):
    def test_due_check_compares_offsets_as_instants(self):
        now = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)
        self.assertTrue(task_is_due(
            timedelta(hours=2), now,
            last_success="2026-09-30T13:00:00+03:30",
        ))

    def test_recent_success_is_not_due(self):
        now = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)
        self.assertFalse(task_is_due(
            timedelta(hours=2), now,
            last_success="2026-09-30T11:00:00+00:00",
        ))

    def test_failed_task_uses_bounded_retry_backoff(self):
        now = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)
        self.assertFalse(task_is_due(
            timedelta(hours=12), now,
            last_success="2026-09-29T12:00:00+00:00",
            last_attempt="2026-09-30T11:58:00+00:00",
            latest_status="failed",
            consecutive_failures=4,
        ))
        self.assertTrue(task_is_due(
            timedelta(hours=12), now,
            last_success="2026-09-29T12:00:00+00:00",
            last_attempt="2026-09-30T11:00:00+00:00",
            latest_status="failed",
            consecutive_failures=4,
        ))

    def test_wallex_usdt_refresh_uses_its_own_source_schedule(self):
        now = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)
        with patch.object(refresh_data, "_source_due", return_value=True) as due:
            with patch.object(refresh_data, "import_wallex_usdt") as importer:
                refresh_data._run("Wallex USDT", importer, now, timedelta(hours=2))

        due.assert_called_once_with("wallex-usdt", timedelta(hours=2), now)
        importer.assert_called_once_with()

    def test_daily_ifb_ytm_history_importer_is_scheduled(self):
        now = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)
        with patch.object(refresh_data, "_refresh_indices"):
            with patch.object(refresh_data, "_seed_cbi_ets"):
                with patch.object(refresh_data, "_run") as run:
                    refresh_data.refresh_once(now)

        self.assertIn(
            unittest.mock.call("IFB YTM history", refresh_data.import_yield_history, now, timedelta(hours=24)),
            run.call_args_list,
        )
        self.assertIn(
            unittest.mock.call("OECD U.S. CPI", refresh_data.import_us_cpi, now, timedelta(hours=24)),
            run.call_args_list,
        )
        self.assertIn(
            unittest.mock.call("Real exchange rate", refresh_data.import_real_exchange_rate, now, timedelta(hours=24)),
            run.call_args_list,
        )


if __name__ == "__main__":
    unittest.main()
