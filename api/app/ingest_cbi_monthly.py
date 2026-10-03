"""Import selected monthly CPI and exchange-rate series from CBI TSD."""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone

import requests
from persiantools.jdatetime import JalaliDate

from .db import database
from .ingest_cbi import BASE

SOURCE_ID = "cbi-tsd-monthly"
MONTHLY_SERIES: dict[str, dict[str, str | float | None]] = {
    "usd-free-cbi-recent": {
        "category_id": "3505fc25-6694-8f09-e063-4ceaa8c0b336",
        "title": "دلار بازار غیررسمی · سری جدید بانک مرکزی",
        "description": "میانگین ماهانه سری جدید بازار غیررسمی بانک مرکزی؛ مقدار منبع ریال به تومان تبدیل شده است.",
        "group_id": "currency", "unit": "تومان", "parent_id": "usd-free", "from_date": "14000101", "multiplier": 0.1,
    },
    "usd-free-cbi-history": {
        "category_id": "3505fc25-62f3-8f09-e063-4ceaa8c0b336",
        "title": "دلار بازار آزاد · آرشیو تاریخی بانک مرکزی",
        "description": "سری قدیمی بازار غیررسمی؛ مقدار منبع ریال به تومان تبدیل شده است. بانک مرکزی روش برآورد را نمونه‌گیری ساعت ۱۱ اعلام کرده است.",
        "group_id": "currency", "unit": "تومان", "parent_id": "usd-free", "from_date": "13380101", "multiplier": 0.1,
    },
    "usd-official-remittance-cbi": {
        "category_id": "3505fc25-6687-8f09-e063-4ceaa8c0b336",
        "title": "دلار رسمی · حواله (تاریخچه ماهانه بانک مرکزی)",
        "description": "میانگین ماهانه نرخ رسمی حواله دلار در سری زمانی بانک مرکزی؛ مقدار منبع ریال به تومان تبدیل شده است.",
        "group_id": "currency", "unit": "تومان", "parent_id": "usd-official", "from_date": "13970101", "multiplier": 0.1,
    },
    "usd-official-cash-cbi": {
        "category_id": "3505fc25-668e-8f09-e063-4ceaa8c0b336",
        "title": "دلار رسمی · اسکناس (تاریخچه ماهانه بانک مرکزی)",
        "description": "میانگین ماهانه نرخ رسمی اسکناس دلار در سری زمانی بانک مرکزی؛ مقدار منبع ریال به تومان تبدیل شده است.",
        "group_id": "currency", "unit": "تومان", "parent_id": "usd-official", "from_date": "13970101", "multiplier": 0.1,
    },
    "usd-official-weighted-cbi": {
        "category_id": "3505fc25-6691-8f09-e063-4ceaa8c0b336",
        "title": "دلار رسمی · میانگین موزون (بانک مرکزی)",
        "description": "میانگین ماهانه نرخ موزون دلار در سری رسمی بانک مرکزی؛ مقدار منبع ریال به تومان تبدیل شده است.",
        "group_id": "currency", "unit": "تومان", "parent_id": "usd-official", "from_date": "13970101", "multiplier": 0.1,
    },
    "usd-official-preferential-cbi": {
        "category_id": "3505fc25-6684-8f09-e063-4ceaa8c0b336",
        "title": "دلار ترجیحی · آرشیو بانک مرکزی",
        "description": "سری تاریخی نرخ ترجیحی دلار؛ این نرخ تاریخی است و نرخ جاری بازار توافقی محسوب نمی‌شود. مقدار منبع ریال به تومان تبدیل شده است.",
        "group_id": "currency", "unit": "تومان", "parent_id": "usd-official", "from_date": "13970101", "multiplier": 0.1,
    },
    "cpi-ir-cbi": {
        "category_id": "3505fc25-6651-8f09-e063-4ceaa8c0b336",
        "title": "شاخص کل بهای کالاها و خدمات مصرفی · پایه ۱۴۰۰",
        "description": "شاخص کل ماهانه قیمت مصرف‌کننده بانک مرکزی با پایه ۱۴۰۰=۱۰۰.",
        "group_id": "prices", "unit": "شاخص · پایه ۱۴۰۰=۱۰۰", "parent_id": None, "from_date": "14000101",
    },
    "cpi-food": {
        "category_id": "3505fc25-6652-8f09-e063-4ceaa8c0b336",
        "title": "CPI · خوراکی‌ها و آشامیدنی‌ها", "description": "شاخص بهای خوراکی‌ها و آشامیدنی‌ها، پایه ۱۴۰۰=۱۰۰.",
        "group_id": "prices", "unit": "شاخص · پایه ۱۴۰۰=۱۰۰", "parent_id": "cpi-ir-cbi", "from_date": "14000101",
    },
    "cpi-tobacco": {
        "category_id": "3505fc25-6665-8f09-e063-4ceaa8c0b336",
        "title": "CPI · دخانیات", "description": "شاخص بهای دخانیات، پایه ۱۴۰۰=۱۰۰.",
        "group_id": "prices", "unit": "شاخص · پایه ۱۴۰۰=۱۰۰", "parent_id": "cpi-ir-cbi", "from_date": "14000101",
    },
    "cpi-clothing": {
        "category_id": "3505fc25-6653-8f09-e063-4ceaa8c0b336",
        "title": "CPI · پوشاک و کفش", "description": "شاخص بهای پوشاک و کفش، پایه ۱۴۰۰=۱۰۰.",
        "group_id": "prices", "unit": "شاخص · پایه ۱۴۰۰=۱۰۰", "parent_id": "cpi-ir-cbi", "from_date": "14000101",
    },
    "cpi-housing": {
        "category_id": "3505fc25-6666-8f09-e063-4ceaa8c0b336",
        "title": "CPI · مسکن، آب، برق، گاز و سوخت", "description": "شاخص بهای مسکن و انرژی، پایه ۱۴۰۰=۱۰۰.",
        "group_id": "prices", "unit": "شاخص · پایه ۱۴۰۰=۱۰۰", "parent_id": "cpi-ir-cbi", "from_date": "14000101",
    },
    "cpi-household": {
        "category_id": "3505fc25-6676-8f09-e063-4ceaa8c0b336",
        "title": "CPI · اثاث و خدمات خانه", "description": "شاخص اثاث، لوازم و خدمات مورد استفاده در خانه، پایه ۱۴۰۰=۱۰۰.",
        "group_id": "prices", "unit": "شاخص · پایه ۱۴۰۰=۱۰۰", "parent_id": "cpi-ir-cbi", "from_date": "14000101",
    },
    "cpi-health": {
        "category_id": "3505fc25-6667-8f09-e063-4ceaa8c0b336",
        "title": "CPI · بهداشت و درمان", "description": "شاخص بهای بهداشت و درمان، پایه ۱۴۰۰=۱۰۰.",
        "group_id": "prices", "unit": "شاخص · پایه ۱۴۰۰=۱۰۰", "parent_id": "cpi-ir-cbi", "from_date": "14000101",
    },
    "cpi-transport": {
        "category_id": "3505fc25-6654-8f09-e063-4ceaa8c0b336",
        "title": "CPI · حمل‌ونقل", "description": "شاخص بهای حمل‌ونقل، پایه ۱۴۰۰=۱۰۰.",
        "group_id": "prices", "unit": "شاخص · پایه ۱۴۰۰=۱۰۰", "parent_id": "cpi-ir-cbi", "from_date": "14000101",
    },
    "cpi-communications": {
        "category_id": "3505fc25-6668-8f09-e063-4ceaa8c0b336",
        "title": "CPI · ارتباطات", "description": "شاخص بهای ارتباطات، پایه ۱۴۰۰=۱۰۰.",
        "group_id": "prices", "unit": "شاخص · پایه ۱۴۰۰=۱۰۰", "parent_id": "cpi-ir-cbi", "from_date": "14000101",
    },
    "cpi-recreation": {
        "category_id": "3505fc25-6655-8f09-e063-4ceaa8c0b336",
        "title": "CPI · تفریح و امور فرهنگی", "description": "شاخص بهای تفریح و امور فرهنگی، پایه ۱۴۰۰=۱۰۰.",
        "group_id": "prices", "unit": "شاخص · پایه ۱۴۰۰=۱۰۰", "parent_id": "cpi-ir-cbi", "from_date": "14000101",
    },
    "cpi-education": {
        "category_id": "3505fc25-6669-8f09-e063-4ceaa8c0b336",
        "title": "CPI · تحصیل", "description": "شاخص بهای تحصیل، پایه ۱۴۰۰=۱۰۰.",
        "group_id": "prices", "unit": "شاخص · پایه ۱۴۰۰=۱۰۰", "parent_id": "cpi-ir-cbi", "from_date": "14000101",
    },
    "cpi-restaurants": {
        "category_id": "3505fc25-6656-8f09-e063-4ceaa8c0b336",
        "title": "CPI · رستوران و هتل", "description": "شاخص بهای رستوران و هتل، پایه ۱۴۰۰=۱۰۰.",
        "group_id": "prices", "unit": "شاخص · پایه ۱۴۰۰=۱۰۰", "parent_id": "cpi-ir-cbi", "from_date": "14000101",
    },
    "cpi-misc": {
        "category_id": "3505fc25-666a-8f09-e063-4ceaa8c0b336",
        "title": "CPI · کالاها و خدمات متفرقه", "description": "شاخص بهای کالاها و خدمات متفرقه، پایه ۱۴۰۰=۱۰۰.",
        "group_id": "prices", "unit": "شاخص · پایه ۱۴۰۰=۱۰۰", "parent_id": "cpi-ir-cbi", "from_date": "14000101",
    },
    "cpi-goods": {
        "category_id": "3505fc25-666b-8f09-e063-4ceaa8c0b336",
        "title": "CPI · کالا", "description": "شاخص بهای کالا، پایه ۱۴۰۰=۱۰۰.",
        "group_id": "prices", "unit": "شاخص · پایه ۱۴۰۰=۱۰۰", "parent_id": "cpi-ir-cbi", "from_date": "14000101",
    },
    "cpi-services": {
        "category_id": "3505fc25-6658-8f09-e063-4ceaa8c0b336",
        "title": "CPI · خدمات", "description": "شاخص بهای خدمات، پایه ۱۴۰۰=۱۰۰.",
        "group_id": "prices", "unit": "شاخص · پایه ۱۴۰۰=۱۰۰", "parent_id": "cpi-ir-cbi", "from_date": "14000101",
    },
}
BY_CATEGORY = {item["category_id"]: (series_id, item) for series_id, item in MONTHLY_SERIES.items()}


def parse_monthly_rows(fetched: list[dict]) -> dict[str, list[dict]]:
    """Normalize source rows while retaining the unmodified CBI payload."""
    parsed: dict[str, dict[str, dict]] = {series_id: {} for series_id in MONTHLY_SERIES}
    for entry in fetched:
        if entry.get("amount") is None:
            continue
        definition = BY_CATEGORY.get(str(entry.get("CATEGORYID") or ""))
        if definition is None:
            continue
        series_id, metadata = definition
        jalali = str(entry.get("khDate", ""))
        if len(jalali) != 8 or not jalali.isascii() or not jalali.isdigit():
            raise ValueError("CBI monthly row has an invalid Jalali date")
        observed = JalaliDate(int(jalali[:4]), int(jalali[4:6]), int(jalali[6:])).to_gregorian().isoformat()
        source_value = float(entry["amount"])
        multiplier = float(metadata.get("multiplier") or 1.0)
        value = source_value * multiplier
        if not math.isfinite(source_value) or not math.isfinite(value):
            raise ValueError("CBI monthly row has a nonfinite value")
        current = parsed[series_id].get(observed)
        if current and current["value"] != value:
            raise ValueError(f"Conflicting CBI values for {series_id} on {observed}")
        parsed[series_id][observed] = {
            "date": observed, "jalali": jalali, "value": value,
            "source_record_id": str(entry.get("id") or ""),
            "raw_payload": json.dumps(entry, ensure_ascii=False, separators=(",", ":")),
        }
    return {key: [values[d] for d in sorted(values)] for key, values in parsed.items()}


def fetch_monthly_rows() -> dict[str, list[dict]]:
    session = requests.Session()
    session.headers.update({"User-Agent": "EcoNotes/0.2 (local economic data research)", "Accept-Language": "fa"})
    frequencies = session.post(BASE + "sub-frequency/", json={}, timeout=35)
    frequencies.raise_for_status()
    frequency_rows = frequencies.json()
    monthly_id = next((row["id"] for row in frequency_rows if row.get("code") == "2"), None)
    if not monthly_id:
        raise ValueError("CBI monthly frequency is unavailable")

    grouped: dict[str, list[str]] = {}
    for item in MONTHLY_SERIES.values():
        grouped.setdefault(str(item["from_date"]), []).append(str(item["category_id"]))
    fetched: list[dict] = []
    for from_date, category_ids in grouped.items():
        for offset in range(0, len(category_ids), 4):
            batch = category_ids[offset:offset + 4]
            response = session.post(BASE + "value/graph", json={
                "fromDate": from_date, "toDateDate": "14101230", "categoryIds": batch,
                "calender": "FA", "subFrequencyId": monthly_id,
            }, timeout=60)
            response.raise_for_status()
            rows = response.json()
            if not isinstance(rows, list):
                raise ValueError("CBI monthly response has an unexpected shape")
            fetched.extend(row for row in rows if isinstance(row, dict))

    result = parse_monthly_rows(fetched)
    missing = [series_id for series_id, rows in result.items() if not rows]
    if missing:
        raise ValueError("CBI monthly categories returned no numeric rows: " + ", ".join(missing))
    return result


def import_monthly_series() -> dict:
    started = datetime.now(timezone.utc).isoformat()
    with database() as connection:
        connection.execute(
            """INSERT INTO sources (id, name, homepage, retrieval_method) VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET name=excluded.name, homepage=excluded.homepage,
                 retrieval_method=excluded.retrieval_method""",
            (SOURCE_ID, "بانک مرکزی · سامانه سری‌های زمانی (ماهانه)",
             "https://tsdview.cis.cbi.ir/single-data", "Public TSD monthly category graph API"),
        )
        run_id = connection.execute(
            "INSERT INTO ingestion_runs (source_id, started_at, status) VALUES (?, ?, 'running')",
            (SOURCE_ID, started),
        ).lastrowid
    try:
        parsed = fetch_monthly_rows()
        fetched_at = datetime.now(timezone.utc).isoformat()
        with database() as connection:
            for series_id, values in parsed.items():
                item = MONTHLY_SERIES[series_id]
                connection.execute(
                    """INSERT INTO series (id, title, description, group_id, unit, frequency,
                                            source_id, status, parent_id, last_checked_at)
                       VALUES (?, ?, ?, ?, ?, 'monthly', ?, 'active', ?, ?)
                       ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
                         group_id=excluded.group_id, unit=excluded.unit, frequency='monthly',
                         source_id=excluded.source_id, status='active', parent_id=excluded.parent_id,
                         last_checked_at=excluded.last_checked_at""",
                    (series_id, item["title"], item["description"], item["group_id"], item["unit"],
                     SOURCE_ID, item["parent_id"], fetched_at),
                )
                for row in values:
                    connection.execute(
                        """INSERT INTO macro_observations (series_id, observed_on, jalali_date, value,
                                    source_record_id, raw_payload, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)
                           ON CONFLICT(series_id, observed_on) DO UPDATE SET value=excluded.value,
                             jalali_date=excluded.jalali_date, source_record_id=excluded.source_record_id,
                             raw_payload=excluded.raw_payload, fetched_at=excluded.fetched_at""",
                        (series_id, row["date"], row["jalali"], row["value"], row["source_record_id"],
                         row["raw_payload"], fetched_at),
                    )
                    connection.execute(
                        """INSERT INTO observations (series_id, observed_on, value, symbol,
                                    source_record_id, published_at) VALUES (?, ?, ?, NULL, ?, ?)
                           ON CONFLICT(series_id, observed_on) DO UPDATE SET value=excluded.value,
                             source_record_id=excluded.source_record_id, published_at=excluded.published_at""",
                        (series_id, row["date"], row["value"], row["source_record_id"], fetched_at),
                    )
            connection.execute("UPDATE sources SET last_success_at=? WHERE id=?", (fetched_at, SOURCE_ID))
            accepted = sum(len(rows) for rows in parsed.values())
            connection.execute(
                """UPDATE ingestion_runs SET status='success', finished_at=?,
                    rows_received=?, rows_accepted=? WHERE id=?""",
                (fetched_at, accepted, accepted, run_id),
            )
        return {
            "series": {key: len(values) for key, values in parsed.items()},
            "latest": {key: values[-1]["date"] for key, values in parsed.items()},
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
    print(json.dumps(import_monthly_series(), ensure_ascii=False, indent=2))
