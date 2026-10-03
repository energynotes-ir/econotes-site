"""Continuously refresh local market and macro series on source-specific schedules."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone

from .db import database
from .ingest_cbi_cpi_release import import_cpi_release
from .ingest_cbi_ets_snapshot import import_snapshot as import_cbi_ets_snapshot
from .ingest_cbi_monthly import import_monthly_series
from .ingest_mefa_monetary import import_mefa_monetary
from .ingest_ifb_ytm import import_yields
from .ingest_ifb_ytm_history import import_yield_history
from .ingest_oecd_cpi import import_us_cpi
from .ingest_omo import import_omo
from .ingest_real_exchange import import_real_exchange_rate
from .ingest_tgju_metals import import_metals
from .ingest_tse import INDEX_SERIES, import_indices
from .ingest_wallex_usdt import import_wallex_usdt

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("econotes.refresh")

CHECK_INTERVAL = timedelta(minutes=5)
STALE_RUNNING_AFTER = timedelta(minutes=30)
MAX_RETRY_BACKOFF = timedelta(hours=1)


def _aware(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def task_is_due(
    interval: timedelta,
    now: datetime,
    *,
    last_success: str | None,
    last_attempt: str | None = None,
    latest_status: str | None = None,
    consecutive_failures: int = 0,
) -> bool:
    """Compare timestamps as instants and back off transient source failures."""
    now_utc = now.astimezone(timezone.utc) if now.tzinfo else now.replace(tzinfo=timezone.utc)
    success_at = _aware(last_success)
    attempt_at = _aware(last_attempt)
    if latest_status == "running" and attempt_at and now_utc - attempt_at >= STALE_RUNNING_AFTER:
        return True
    if latest_status == "failed" and attempt_at and (success_at is None or attempt_at > success_at):
        failure_number = max(1, consecutive_failures)
        backoff_minutes = min(60, 5 * 2 ** min(failure_number - 1, 4))
        return now_utc - attempt_at >= timedelta(minutes=backoff_minutes)
    return success_at is None or now_utc - success_at >= interval


def _source_schedule_state(source_id: str, ins_code: str | None = None) -> tuple[str | None, str | None, str | None, int]:
    with database() as connection:
        source = connection.execute(
            "SELECT last_success_at FROM sources WHERE id=?", (source_id,)
        ).fetchone()
        if ins_code is None:
            rows = connection.execute(
                "SELECT started_at, status FROM ingestion_runs WHERE source_id=? ORDER BY id DESC LIMIT 32",
                (source_id,),
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT started_at, status FROM ingestion_runs WHERE source_id=? AND ins_code=? ORDER BY id DESC LIMIT 32",
                (source_id, ins_code),
            ).fetchall()
    success_at = source["last_success_at"] if source else None
    last_attempt = rows[0]["started_at"] if rows else None
    latest_status = rows[0]["status"] if rows else None
    failures = 0
    for row in rows:
        if row["status"] != "failed":
            break
        failures += 1
    return success_at, last_attempt, latest_status, failures


def _source_due(source_id: str, interval: timedelta, now: datetime) -> bool:
    success, attempt, status, failures = _source_schedule_state(source_id)
    return task_is_due(
        interval, now, last_success=success, last_attempt=attempt,
        latest_status=status, consecutive_failures=failures,
    )


def _run(name: str, function, now: datetime, interval: timedelta) -> None:
    source_id = {
        "MEFA monetary": "mefa-monetary",
        "CBI monthly series": "cbi-tsd-monthly",
        "CBI CPI rates": "cbi-cpi-release",
        "TGJU metals": "tgju-metals",
        "IBENA OMO": "ibena-omo",
        "IFB yields": "ifb-ytm",
        "IFB YTM history": "ifb-ytm-history",
        "OECD U.S. CPI": "oecd-us-cpi",
        "Real exchange rate": "derived-real-fx",
        "Wallex USDT": "wallex-usdt",
    }[name]
    if not _source_due(source_id, interval, now):
        return
    try:
        result = function()
        log.info("Updated %s: %s", name, result)
    except Exception:
        log.exception("Could not update %s; it will retry with bounded backoff", name)


def _indices_due(now: datetime, interval: timedelta = timedelta(hours=6)) -> bool:
    with database() as connection:
        checked = {
            row["id"]: row["last_checked_at"]
            for row in connection.execute(
                "SELECT id, last_checked_at FROM series WHERE id IN ('tedpix', 'equal')"
            ).fetchall()
        }
    for series_id, definition in INDEX_SERIES.items():
        success = checked.get(series_id)
        _, attempt, status, failures = _source_schedule_state("tsetmc", definition["ins_code"])
        if task_is_due(
            interval, now, last_success=success, last_attempt=attempt,
            latest_status=status, consecutive_failures=failures,
        ):
            return True
    return False


def _refresh_indices(now: datetime) -> None:
    if not _indices_due(now):
        return
    try:
        result = import_indices()
        log.info("Updated TSETMC daily indices: %s", result)
    except Exception:
        log.exception("Could not update TSETMC daily indices; next check will retry")


def _seed_cbi_ets() -> None:
    with database() as connection:
        quote_rows = connection.execute(
            "SELECT COUNT(*) FROM observations WHERE series_id='usd-official'"
        ).fetchone()[0]
    if quote_rows:
        return
    try:
        result = import_cbi_ets_snapshot()
        log.info("Seeded verified CBI ETS quotes: %s", result)
    except Exception:
        log.exception("Could not seed verified CBI ETS quotes; next check will retry")


def refresh_once(now: datetime | None = None) -> None:
    checked_at = now or datetime.now(timezone.utc)
    # Public equity coverage for this release is intentionally limited to the two main indices.
    _refresh_indices(checked_at)
    _run("MEFA monetary", import_mefa_monetary, checked_at, timedelta(hours=12))
    _run("CBI monthly series", import_monthly_series, checked_at, timedelta(hours=12))
    _run("CBI CPI rates", import_cpi_release, checked_at, timedelta(hours=12))
    _run("Wallex USDT", import_wallex_usdt, checked_at, timedelta(hours=2))
    _run("TGJU metals", import_metals, checked_at, timedelta(hours=4))
    _run("IBENA OMO", import_omo, checked_at, timedelta(hours=12))
    _seed_cbi_ets()
    _run("IFB yields", import_yields, checked_at, timedelta(hours=6))
    _run("IFB YTM history", import_yield_history, checked_at, timedelta(hours=24))
    _run("OECD U.S. CPI", import_us_cpi, checked_at, timedelta(hours=24))
    _run("Real exchange rate", import_real_exchange_rate, checked_at, timedelta(hours=24))


if __name__ == "__main__":
    log.info("EcoNotes refresh worker started; supervising due sources every %s minutes", int(CHECK_INTERVAL.total_seconds() / 60))
    while True:
        try:
            refresh_once()
        except Exception:
            log.exception("Unexpected refresh-cycle failure; worker remains alive")
        time.sleep(CHECK_INTERVAL.total_seconds())
