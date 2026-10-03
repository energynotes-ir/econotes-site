"""Import quarterly liquidity and its components from CBI's public time-series API."""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone

import requests
from persiantools.jdatetime import JalaliDate

from .db import database

BASE = "https://tsdview.cis.cbi.ir/backend/api/"
SOURCE_ID = "cbi-tsd"
UNIT = "هزار میلیارد ریال"
# IDs are the category IDs returned by the CBI catalog on 2026-09-30.
CATEGORIES = {
    "liquidity": ("3505fc25-6097-8f09-e063-4ceaa8c0b336", "نقدینگی · اجزای تشکیل‌دهنده"),
    "liquidity-supply": ("3505fc25-5fec-8f09-e063-4ceaa8c0b336", "نقدینگی · عوامل عرضه"),
    "money": ("3505fc25-6098-8f09-e063-4ceaa8c0b336", "پول"),
    "quasi": ("3505fc25-6031-8f09-e063-4ceaa8c0b336", "شبه‌پول"),
    "foreign-assets": ("3505fc25-5fed-8f09-e063-4ceaa8c0b336", "خالص دارایی‌های خارجی سیستم بانکی"),
    "government-debt": ("3505fc25-5ff4-8f09-e063-4ceaa8c0b336", "خالص بدهی بخش دولتی"),
    "private-debt": ("3505fc25-6094-8f09-e063-4ceaa8c0b336", "بدهی بخش غیردولتی"),
    "other-liquidity": ("3505fc25-6096-8f09-e063-4ceaa8c0b336", "خالص سایر اقلام نقدینگی"),
}
BY_CATEGORY = {category: (series_id, title) for series_id, (category, title) in CATEGORIES.items()}


def post(session: requests.Session, path: str, payload: dict) -> object:
    response = session.post(BASE + path, json=payload, timeout=35)
    response.raise_for_status()
    return response.json()


def fetch_rows() -> list[dict]:
    session = requests.Session()
    session.headers.update({"User-Agent": "EcoNotes/0.2 (local economic data research)", "Accept-Language": "fa"})
    frequencies = post(session, "sub-frequency/", {})
    if not isinstance(frequencies, list):
        raise ValueError("CBI frequency catalog has unexpected shape")
    quarterly = next((item["id"] for item in frequencies if item.get("code") == "3"), None)
    if not quarterly:
        raise ValueError("CBI quarterly frequency is unavailable")
    data = post(session, "value/graph", {
        "fromDate": "13520101", "toDateDate": "14101230",
        "categoryIds": list(BY_CATEGORY), "calender": "FA", "subFrequencyId": quarterly,
    })
    if not isinstance(data, list) or not data:
        raise ValueError("CBI graph response has no rows")
    return data


def parse_rows(data: list[dict]) -> dict[str, list[dict]]:
    result: dict[str, dict[str, dict]] = {series_id: {} for series_id in CATEGORIES}
    for entry in data:
        if not isinstance(entry, dict) or entry.get("amount") is None:
            continue
        category = entry.get("CATEGORYID")
        if category not in BY_CATEGORY:
            continue
        jalali = str(entry.get("khDate", ""))
        if len(jalali) != 8 or not jalali.isascii() or not jalali.isdigit():
            raise ValueError("CBI row has an invalid Jalali date")
        observed = JalaliDate(int(jalali[:4]), int(jalali[4:6]), int(jalali[6:])).to_gregorian().isoformat()
        value = float(entry["amount"])
        if not math.isfinite(value):
            raise ValueError("CBI row has a nonfinite value")
        series_id = BY_CATEGORY[category][0]
        existing = result[series_id].get(observed)
        if existing and existing["value"] != value:
            raise ValueError(f"Conflicting CBI values for {series_id} on {observed}")
        result[series_id][observed] = {
            "date": observed, "jalali": jalali, "value": value,
            "source_record_id": str(entry.get("id") or ""),
            "raw_payload": json.dumps(entry, ensure_ascii=False, separators=(",", ":")),
        }
    parsed = {key: [values[d] for d in sorted(values)] for key, values in result.items()}
    if any(not values for values in parsed.values()):
        raise ValueError("At least one CBI liquidity component has no numeric rows")
    return parsed


def import_liquidity() -> dict:
    started = datetime.now(timezone.utc).isoformat()
    with database() as connection:
        connection.execute(
            """INSERT INTO sources (id, name, homepage, retrieval_method) VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO NOTHING""",
            (SOURCE_ID, "بانک مرکزی · سامانه سری‌های زمانی", "https://tsdview.cis.cbi.ir/single-data", "Quarterly category values"),
        )
        run_id = connection.execute(
            "INSERT INTO ingestion_runs (source_id, started_at, status) VALUES (?, ?, 'running')",
            (SOURCE_ID, started),
        ).lastrowid
    try:
        parsed = parse_rows(fetch_rows())
        fetched = datetime.now(timezone.utc).isoformat()
        with database() as connection:
            for series_id, values in parsed.items():
                category_id, title = CATEGORIES[series_id]
                parent = "liquidity" if series_id not in ("liquidity", "liquidity-supply") else None
                connection.execute(
                    """INSERT INTO series (id, title, description, group_id, unit, frequency,
                                            source_id, status, parent_id, last_checked_at)
                       VALUES (?, ?, ?, 'money', ?, 'quarterly', ?, 'active', ?, ?)
                       ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
                          status='active', last_checked_at=excluded.last_checked_at""",
                    (series_id, title, f"CBI category {category_id}", UNIT, SOURCE_ID, parent, fetched),
                )
                for row in values:
                    connection.execute(
                        """INSERT INTO macro_observations (series_id, observed_on, jalali_date, value,
                                    source_record_id, raw_payload, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)
                           ON CONFLICT(series_id, observed_on) DO UPDATE SET value=excluded.value,
                             source_record_id=excluded.source_record_id, raw_payload=excluded.raw_payload,
                             fetched_at=excluded.fetched_at""",
                        (series_id, row["date"], row["jalali"], row["value"],
                         row["source_record_id"], row["raw_payload"], fetched),
                    )
                    connection.execute(
                        """INSERT INTO observations (series_id, observed_on, value, symbol,
                                    source_record_id, published_at) VALUES (?, ?, ?, NULL, ?, ?)
                           ON CONFLICT(series_id, observed_on) DO UPDATE SET value=excluded.value,
                             source_record_id=excluded.source_record_id, published_at=excluded.published_at""",
                        (series_id, row["date"], row["value"], row["source_record_id"], fetched),
                    )
            connection.execute("UPDATE sources SET last_success_at=? WHERE id=?", (fetched, SOURCE_ID))
            count = sum(map(len, parsed.values()))
            connection.execute(
                """UPDATE ingestion_runs SET status='success', finished_at=?,
                    rows_received=?, rows_accepted=? WHERE id=?""",
                (fetched, count, count, run_id),
            )
        return {"series": {key: len(values) for key, values in parsed.items()}, "last_observation": parsed["liquidity"][-1]["date"], "fetched_at": fetched}
    except Exception as exc:
        with database() as connection:
            connection.execute(
                "UPDATE ingestion_runs SET status='failed', finished_at=?, error_message=? WHERE id=?",
                (datetime.now(timezone.utc).isoformat(), str(exc)[:1000], run_id),
            )
        raise


if __name__ == "__main__":
    print(json.dumps(import_liquidity(), ensure_ascii=False, indent=2))
