"""Import completed daily USDT/IRT candles from Nobitex's public UDF API."""

from __future__ import annotations

import json
import logging
import math
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import requests
from persiantools.jdatetime import JalaliDate

from .db import database

SOURCE_ID = "nobitex-usdt"
HISTORY_URL = "https://apiv2.nobitex.ir/market/udf/history"
TEHRAN = ZoneInfo("Asia/Tehran")
MAX_PAGES = 20


def fetch_daily_closes() -> list[dict]:
    session = requests.Session()
    session.headers.update({
        "User-Agent": "EcoNotes/0.2 (local economic data research)",
        "Accept": "application/json",
    })
    now = int(datetime.now(timezone.utc).timestamp())
    first_epoch = 1_523_424_600  # Lower bound chosen before the oldest available candle.
    today_tehran = datetime.now(TEHRAN).date()
    rows: dict[str, dict] = {}

    for page in range(1, MAX_PAGES + 1):
        response = session.get(HISTORY_URL, params={
            "symbol": "USDTIRT", "resolution": "D", "from": first_epoch,
            "to": now, "page": page,
        }, timeout=35)
        response.raise_for_status()
        payload = response.json()
        if isinstance(payload, dict) and payload.get("s") == "no_data":
            break
        if not isinstance(payload, dict) or payload.get("s") != "ok":
            raise ValueError(f"Nobitex UDF returned an error on page {page}: {payload!r}"[:600])

        timestamps = payload.get("t")
        closes = payload.get("c")
        opens, highs, lows, volumes = (payload.get(key) for key in ("o", "h", "l", "v"))
        arrays = (timestamps, opens, highs, lows, closes, volumes)
        if not all(isinstance(values, list) for values in arrays):
            raise ValueError(f"Nobitex UDF candle arrays are missing on page {page}")
        if len({len(values) for values in arrays}) != 1:
            raise ValueError(f"Nobitex UDF candle arrays have inconsistent lengths on page {page}")
        if not timestamps:
            break

        for i, epoch in enumerate(timestamps):
            observed_dt = datetime.fromtimestamp(int(epoch), timezone.utc).astimezone(TEHRAN)
            observed = observed_dt.date()
            # UDF includes the current day's still-open candle; store finalized days only.
            if observed >= today_tehran:
                continue
            close = float(closes[i])
            if not math.isfinite(close) or close <= 0:
                raise ValueError(f"Nobitex UDF has an invalid close on {observed}")
            jalali = JalaliDate.to_jalali(observed.year, observed.month, observed.day)
            rows[observed.isoformat()] = {
                "date": observed.isoformat(),
                "jalali": f"{jalali.year:04d}{jalali.month:02d}{jalali.day:02d}",
                "value": close,
                "source_record_id": str(epoch),
                "raw_payload": json.dumps({
                    "symbol": "USDTIRT", "resolution": "D", "timestamp": int(epoch),
                    "open": opens[i], "high": highs[i], "low": lows[i],
                    "close": closes[i], "volume": volumes[i],
                }, ensure_ascii=False, separators=(",", ":")),
            }

        if page == MAX_PAGES:
            raise ValueError(f"Nobitex UDF exceeded the {MAX_PAGES}-page safety limit; refusing partial import")
        time.sleep(0.2)

    result = [rows[day] for day in sorted(rows)]
    if not result:
        raise ValueError("Nobitex UDF returned no completed USDT/IRT daily closes")
    return result


def import_usdt() -> dict:
    started = datetime.now(timezone.utc).isoformat()
    with database() as connection:
        connection.execute(
            """INSERT INTO sources (id, name, homepage, retrieval_method) VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET name=excluded.name, homepage=excluded.homepage,
                 retrieval_method=excluded.retrieval_method""",
            (SOURCE_ID, "نوبیتکس · بازار تتر به ریال", "https://apidocs.nobitex.ir/",
             "Public UDF daily OHLC endpoint; completed candle close, stored in Toman"),
        )
        run_id = connection.execute(
            "INSERT INTO ingestion_runs (source_id, started_at, status) VALUES (?, ?, 'running')",
            (SOURCE_ID, started),
        ).lastrowid
    try:
        parsed = fetch_daily_closes()
        fetched = datetime.now(timezone.utc).isoformat()
        with database() as connection:
            connection.execute(
                """INSERT INTO series (id, title, description, group_id, unit, frequency,
                                        source_id, status, parent_id, last_checked_at)
                   VALUES ('usd-free', ?, ?, 'currency', 'تومان', 'daily', ?, 'active', NULL, ?)
                   ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
                     group_id=excluded.group_id, unit=excluded.unit, frequency='daily',
                     source_id=excluded.source_id, status='active', last_checked_at=excluded.last_checked_at""",
                ("دلار آزاد · تتر (USDT/IRT)",
                 "بسته‌شدن روزانه بازار USDT/IRT نوبیتکس؛ واحد قیمت در کندل‌های UDF تومان است. نرخ تتر نماینده بازار رمزارز است و با نرخ اسکناس نقدی یکسان نیست.",
                 SOURCE_ID, fetched),
            )
            for row in parsed:
                connection.execute(
                    """INSERT INTO macro_observations (series_id, observed_on, jalali_date, value,
                                source_record_id, raw_payload, fetched_at) VALUES ('usd-free', ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(series_id, observed_on) DO UPDATE SET value=excluded.value,
                         jalali_date=excluded.jalali_date, source_record_id=excluded.source_record_id,
                         raw_payload=excluded.raw_payload, fetched_at=excluded.fetched_at""",
                    (row["date"], row["jalali"], row["value"], row["source_record_id"], row["raw_payload"], fetched),
                )
                connection.execute(
                    """INSERT INTO observations (series_id, observed_on, value, symbol,
                                source_record_id, published_at) VALUES ('usd-free', ?, ?, NULL, ?, ?)
                       ON CONFLICT(series_id, observed_on) DO UPDATE SET value=excluded.value,
                         source_record_id=excluded.source_record_id, published_at=excluded.published_at""",
                    (row["date"], row["value"], row["source_record_id"], fetched),
                )
            connection.execute("UPDATE sources SET last_success_at=? WHERE id=?", (fetched, SOURCE_ID))
            connection.execute(
                """UPDATE ingestion_runs SET status='success', finished_at=?,
                    rows_received=?, rows_accepted=? WHERE id=?""",
                (fetched, len(parsed), len(parsed), run_id),
            )
        return {"observations": len(parsed), "first": parsed[0]["date"],
                "latest": {"date": parsed[-1]["date"], "toman": parsed[-1]["value"]},
                "fetched_at": fetched}
    except Exception as exc:
        with database() as connection:
            connection.execute(
                "UPDATE ingestion_runs SET status='failed', finished_at=?, error_message=? WHERE id=?",
                (datetime.now(timezone.utc).isoformat(), str(exc)[:1000], run_id),
            )
        raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    print(json.dumps(import_usdt(), ensure_ascii=False, indent=2))
