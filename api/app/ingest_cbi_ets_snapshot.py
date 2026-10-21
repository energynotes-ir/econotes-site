"""Load verified CBI ETS page lookups; sparse snapshots are labeled as such."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from persiantools.jdatetime import JalaliDate

from .db import database

SOURCE_ID = "cbi-ets"
SOURCE_URL = "https://fxmarketrate.cbi.ir/"
# Exact values captured from the CBI date-lookup page. Source values are Rial per USD;
# the dashboard series use Toman so they are comparable with the Tether series.
VERIFIED_QUOTES = [
    {"jalali": "1404/01/05", "buy_rial": 681_203, "sell_rial": 687_390},
    {"jalali": "1404/01/06", "buy_rial": 681_203, "sell_rial": 687_390},
    {"jalali": "1405/07/07", "buy_rial": 1_720_980, "sell_rial": 1_736_609},
    {"jalali": "1405/07/08", "buy_rial": 1_726_143, "sell_rial": 1_741_819},
]
SERIES = {
    "usd-official": {
        "title": "دلار حواله · نرخ توافقی ETS (فروش)",
        "description": "نرخ فروش حوالهٔ دلار در سامانه ETS بانک مرکزی، تبدیل‌شده از ریال به تومان. فقط تاریخ‌های تأییدشده ثبت شده‌اند؛ دادهٔ فعلی تاریخچهٔ روزانهٔ پیوسته نیست.",
        "short_title": "دلار ETS · فروش حواله",
    },
    "usd-official-buy": {
        "title": "دلار حواله · نرخ توافقی ETS (خرید)",
        "description": "نرخ خرید حوالهٔ دلار در سامانه ETS بانک مرکزی، تبدیل‌شده از ریال به تومان. فقط تاریخ‌های تأییدشده ثبت شده‌اند؛ دادهٔ فعلی تاریخچهٔ روزانهٔ پیوسته نیست.",
        "short_title": "دلار ETS · خرید حواله",
    },
}


def import_snapshot() -> dict:
    started = datetime.now(timezone.utc).isoformat()
    with database() as connection:
        connection.execute(
            """INSERT INTO sources (id, name, homepage, retrieval_method) VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET name=excluded.name, homepage=excluded.homepage,
                 retrieval_method=excluded.retrieval_method""",
            (SOURCE_ID, "بانک مرکزی · نرخ ارز ETS", SOURCE_URL,
             "Read-only date lookups on the public CBI page; verified snapshot import"),
        )
        run_id = connection.execute(
            "INSERT INTO ingestion_runs (source_id, started_at, status) VALUES (?, ?, 'running')",
            (SOURCE_ID, started),
        ).lastrowid
    try:
        fetched = datetime.now(timezone.utc).isoformat()
        counts = {series_id: 0 for series_id in SERIES}
        with database() as connection:
            for quote in VERIFIED_QUOTES:
                jalali_text = quote["jalali"]
                jy, jm, jd = (int(value) for value in jalali_text.split("/"))
                jalali_date = JalaliDate(jy, jm, jd)
                observed = jalali_date.to_gregorian().isoformat()
                jalali_compact = f"{jy:04d}{jm:02d}{jd:02d}"
                for series_id, value_key in (("usd-official", "sell_rial"), ("usd-official-buy", "buy_rial")):
                    value_toman = quote[value_key] / 10
                    raw = json.dumps({
                        "source": SOURCE_URL, "currency": "USD", "field": value_key,
                        "value_rial": quote[value_key], "value_toman": value_toman,
                        "selected_jalali_date": jalali_text,
                    }, ensure_ascii=False, separators=(",", ":"))
                    record_id = f"{SOURCE_ID}-usd-{value_key}-{jalali_compact}"
                    connection.execute(
                        """INSERT INTO series (id, title, description, group_id, unit, frequency,
                                                source_id, status, parent_id, last_checked_at)
                           VALUES (?, ?, ?, 'currency', 'تومان', 'daily', ?, 'active', NULL, ?)
                           ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
                             group_id=excluded.group_id, unit=excluded.unit, frequency='daily',
                             source_id=excluded.source_id, status='active', last_checked_at=excluded.last_checked_at""",
                        (series_id, SERIES[series_id]["title"], SERIES[series_id]["description"], SOURCE_ID, fetched),
                    )
                    connection.execute(
                        """INSERT INTO macro_observations (series_id, observed_on, jalali_date, value,
                                    source_record_id, raw_payload, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)
                           ON CONFLICT(series_id, observed_on) DO UPDATE SET value=excluded.value,
                             jalali_date=excluded.jalali_date, source_record_id=excluded.source_record_id,
                             raw_payload=excluded.raw_payload, fetched_at=excluded.fetched_at""",
                        (series_id, observed, jalali_compact, value_toman, record_id, raw, fetched),
                    )
                    connection.execute(
                        """INSERT INTO observations (series_id, observed_on, value, symbol,
                                    source_record_id, published_at) VALUES (?, ?, ?, NULL, ?, ?)
                           ON CONFLICT(series_id, observed_on) DO UPDATE SET value=excluded.value,
                             source_record_id=excluded.source_record_id, published_at=excluded.published_at""",
                        (series_id, observed, value_toman, record_id, fetched),
                    )
                    counts[series_id] += 1
            connection.execute("UPDATE sources SET last_success_at=? WHERE id=?", (fetched, SOURCE_ID))
            accepted = sum(counts.values())
            connection.execute(
                """UPDATE ingestion_runs SET status='success', finished_at=?,
                    rows_received=?, rows_accepted=? WHERE id=?""",
                (fetched, accepted, accepted, run_id),
            )
        return {"observations": counts, "latest_quote_date": VERIFIED_QUOTES[-1]["jalali"], "fetched_at": fetched}
    except Exception as exc:
        with database() as connection:
            connection.execute(
                "UPDATE ingestion_runs SET status='failed', finished_at=?, error_message=? WHERE id=?",
                (datetime.now(timezone.utc).isoformat(), str(exc)[:1000], run_id),
            )
        raise


if __name__ == "__main__":
    print(json.dumps(import_snapshot(), ensure_ascii=False, indent=2))
