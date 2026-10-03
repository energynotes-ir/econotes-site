"""Import the public daily USDT/Toman archive from Wallex."""

from __future__ import annotations

import json
import logging
import math
import time
from datetime import date, datetime, time as datetime_time, timedelta, timezone
from zoneinfo import ZoneInfo

import requests

from .db import database

SOURCE_ID = "wallex-usdt"
HISTORY_URL = "https://api.wallex.ir/v1/udf/history"
ARCHIVE_START = date(2020, 1, 1)
MIN_HISTORY_ROWS = 2300
MIN_HISTORY_DATE = date(2020, 1, 31)
TEHRAN = ZoneInfo("Asia/Tehran")


def _epoch(day: date) -> int:
    return int(datetime.combine(day, datetime_time.min, tzinfo=timezone.utc).timestamp())


def _year_windows(today: date) -> list[tuple[date, date]]:
    end = today + timedelta(days=1)
    windows = []
    start = ARCHIVE_START
    while start < end:
        next_year = date(start.year + 1, 1, 1)
        window_end = min(next_year, end)
        windows.append((start, window_end))
        start = window_end
    return windows


def parse_daily_payload(
    payload: dict,
    *,
    today: date,
    start: date | None = None,
    end: date | None = None,
) -> list[dict]:
    """Parse completed daily TMN closes and exclude the still-open Tehran day."""
    if payload.get("s") == "no_data":
        return []
    if payload.get("s") != "ok":
        raise ValueError(f"Wallex UDF returned an error: {payload!r}"[:600])

    timestamps, opens, highs, lows, closes, volumes = (
        payload.get(key) for key in ("t", "o", "h", "l", "c", "v")
    )
    arrays = (timestamps, opens, highs, lows, closes, volumes)
    if not all(isinstance(values, list) for values in arrays):
        raise ValueError("Wallex UDF candle arrays are missing")
    if len({len(values) for values in arrays}) != 1:
        raise ValueError("Wallex UDF candle arrays have inconsistent lengths")

    rows = {}
    for i, timestamp in enumerate(timestamps):
        observed = datetime.fromtimestamp(int(timestamp), timezone.utc).date()
        if observed >= today or (start and observed < start) or (end and observed >= end):
            continue
        value = float(closes[i])
        if not math.isfinite(value) or value <= 0:
            raise ValueError(f"Wallex UDF has an invalid USDT/TMN close on {observed}")
        rows[observed.isoformat()] = {
            "date": observed.isoformat(),
            "value": value,
            "source_record_id": str(timestamp),
        }
    return [rows[day] for day in sorted(rows)]


def validate_daily_history(rows: list[dict], *, today: date | None = None) -> list[dict]:
    """Reject a truncated public archive before persisting it."""
    current_day = today or datetime.now(TEHRAN).date()
    if (
        len(rows) < MIN_HISTORY_ROWS
        or not rows
        or date.fromisoformat(rows[0]["date"]) > MIN_HISTORY_DATE
        or date.fromisoformat(rows[-1]["date"]) < current_day - timedelta(days=3)
    ):
        raise ValueError("Wallex USDT/TMN history is unexpectedly short or stale")
    return rows


def fetch_daily_closes(*, today: date | None = None) -> list[dict]:
    current_day = today or datetime.now(TEHRAN).date()
    session = requests.Session()
    session.headers.update({
        "User-Agent": "EcoNotes/0.2 (local economic data research)",
        "Accept": "application/json",
    })
    rows: dict[str, dict] = {}
    windows = _year_windows(current_day)
    for index, (start, end) in enumerate(windows):
        response = session.get(HISTORY_URL, params={
            "symbol": "USDTTMN",
            "resolution": "1D",
            "from": _epoch(start),
            "to": _epoch(end),
        }, timeout=35)
        response.raise_for_status()
        page = parse_daily_payload(
            response.json(), today=current_day, start=start, end=end,
        )
        rows.update({row["date"]: row for row in page})
        if index < len(windows) - 1:
            time.sleep(0.1)
    return validate_daily_history([rows[day] for day in sorted(rows)], today=current_day)


def import_wallex_usdt() -> dict:
    started = datetime.now(timezone.utc).isoformat()
    with database() as connection:
        connection.execute(
            """INSERT INTO sources (id, name, homepage, retrieval_method) VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET name=excluded.name, homepage=excluded.homepage,
                 retrieval_method=excluded.retrieval_method""",
            (SOURCE_ID, "والکس · بازار تتر به تومان", "https://api.wallex.ir/",
             "Public Wallex UDF daily candles for USDTTMN; quote asset TMN is stored as Toman; fetched in calendar-year windows"),
        )
        run_id = connection.execute(
            "INSERT INTO ingestion_runs (source_id, started_at, status) VALUES (?, ?, 'running')",
            (SOURCE_ID, started),
        ).lastrowid
    try:
        parsed = fetch_daily_closes()
        fetched_at = datetime.now(timezone.utc).isoformat()
        with database() as connection:
            connection.execute(
                """INSERT INTO series (id, title, description, group_id, unit, frequency,
                                        source_id, status, display_order, last_checked_at)
                   VALUES (?, ?, ?, 'currency', 'تومان', 'daily', ?, 'active', 15, ?)
                   ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
                     group_id='currency', unit='تومان', frequency='daily', source_id=excluded.source_id,
                     status='active', last_checked_at=excluded.last_checked_at""",
                ("usd-free-wallex", "دلار آزاد · تتر والکس (USD/TMN)",
                 "بسته‌شدن روزانه بازار USDTTMN والکس؛ ارز مظنه TMN بر حسب تومان است. این سری جدا از بازار تتر نوبیتکس نگهداری می‌شود و نمای بازار رمزارزی است، نه نرخ معامله اسکناس.",
                 SOURCE_ID, fetched_at),
            )
            for row in parsed:
                connection.execute(
                    """INSERT INTO observations (series_id, observed_on, value, symbol,
                                source_record_id, published_at) VALUES ('usd-free-wallex', ?, ?, NULL, ?, ?)
                       ON CONFLICT(series_id, observed_on) DO UPDATE SET value=excluded.value,
                         source_record_id=excluded.source_record_id, published_at=excluded.published_at""",
                    (row["date"], row["value"], row["source_record_id"], fetched_at),
                )
            connection.execute("UPDATE sources SET last_success_at=? WHERE id=?", (fetched_at, SOURCE_ID))
            connection.execute(
                """UPDATE ingestion_runs SET status='success', finished_at=?,
                   rows_received=?, rows_accepted=? WHERE id=?""",
                (fetched_at, len(parsed), len(parsed), run_id),
            )
        return {
            "observations": len(parsed),
            "first": parsed[0]["date"],
            "latest": {"date": parsed[-1]["date"], "toman": parsed[-1]["value"]},
            "fetched_at": fetched_at,
        }
    except Exception as exc:
        with database() as connection:
            connection.execute(
                "UPDATE ingestion_runs SET status='failed', finished_at=?, error_message=? WHERE id=?",
                (datetime.now(timezone.utc).isoformat(), str(exc)[:1000], run_id),
            )
        raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    print(json.dumps(import_wallex_usdt(), ensure_ascii=False, indent=2))
