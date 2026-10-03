"""Import CBI quarterly monetary-base series and their sources and uses."""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone

import requests
from persiantools.jdatetime import JalaliDate

from .db import database
from .ingest_cbi import BASE

SOURCE_ID = "cbi-tsd-base-money"
UNIT = "هزار میلیارد ریال"
BASE_MONEY_SERIES: dict[str, dict[str, str | None]] = {
    "base-money": {
        "category_id": "3505fc25-6014-8f09-e063-4ceaa8c0b336",
        "title": "پایه پولی · بر حسب منابع",
        "description": "سری فصلی کل پایه پولی بانک مرکزی بر حسب منابع. نمای بر حسب مصارف به‌صورت سری جداگانه نگهداری می‌شود.",
        "parent_id": None,
    },
    "base-net-foreign-assets": {
        "category_id": "3505fc25-5fdd-8f09-e063-4ceaa8c0b336",
        "title": "پایه پولی · خالص دارایی‌های خارجی بانک مرکزی",
        "description": "عامل پایه پولی در نما بر حسب منابع.", "parent_id": "base-money",
    },
    "base-gross-foreign-assets": {
        "category_id": "3505fc25-5fde-8f09-e063-4ceaa8c0b336",
        "title": "پایه پولی · دارایی‌های خارجی بانک مرکزی",
        "description": "جزء ناخالص دارایی‌های خارجی بانک مرکزی.", "parent_id": "base-net-foreign-assets",
    },
    "base-foreign-liabilities": {
        "category_id": "3505fc25-5fdf-8f09-e063-4ceaa8c0b336",
        "title": "پایه پولی · بدهی‌های خارجی بانک مرکزی",
        "description": "جزء بدهی‌های خارجی بانک مرکزی در محاسبه خالص دارایی خارجی.", "parent_id": "base-net-foreign-assets",
    },
    "base-net-government-liabilities": {
        "category_id": "3505fc25-5fe0-8f09-e063-4ceaa8c0b336",
        "title": "پایه پولی · خالص بدهی دولت به بانک مرکزی",
        "description": "عامل پایه پولی در نما بر حسب منابع.", "parent_id": "base-money",
    },
    "base-government-debt": {
        "category_id": "3505fc25-5fe1-8f09-e063-4ceaa8c0b336",
        "title": "پایه پولی · بدهی دولت به بانک مرکزی",
        "description": "جزء بدهی دولت در محاسبه خالص بدهی دولت.", "parent_id": "base-net-government-liabilities",
    },
    "base-government-deposits": {
        "category_id": "3505fc25-5fe2-8f09-e063-4ceaa8c0b336",
        "title": "پایه پولی · سپرده دولت نزد بانک مرکزی",
        "description": "سپرده‌های دولت نزد بانک مرکزی در محاسبه خالص بدهی دولت.", "parent_id": "base-net-government-liabilities",
    },
    "base-bank-debt": {
        "category_id": "3505fc25-5fe3-8f09-e063-4ceaa8c0b336",
        "title": "پایه پولی · بدهی بانک‌ها به بانک مرکزی",
        "description": "عامل پایه پولی در نما بر حسب منابع.", "parent_id": "base-money",
    },
    "base-other-items": {
        "category_id": "3505fc25-5fe4-8f09-e063-4ceaa8c0b336",
        "title": "پایه پولی · خالص سایر اقلام",
        "description": "عامل خالص سایر اقلام در نما بر حسب منابع.", "parent_id": "base-money",
    },
    "base-money-uses": {
        "category_id": "3505fc25-5fe5-8f09-e063-4ceaa8c0b336",
        "title": "پایه پولی · بر حسب مصارف",
        "description": "سری فصلی کل پایه پولی بانک مرکزی بر حسب مصارف؛ نمای جایگزینِ سری بر حسب منابع.", "parent_id": None,
    },
    "base-legal-reserves": {
        "category_id": "3505fc25-5fe6-8f09-e063-4ceaa8c0b336",
        "title": "پایه پولی · سپرده قانونی بانک‌ها",
        "description": "جزء پایه پولی در نما بر حسب مصارف.", "parent_id": "base-money-uses",
    },
    "base-bank-demand-deposits": {
        "category_id": "3505fc25-5fe7-8f09-e063-4ceaa8c0b336",
        "title": "پایه پولی · سپرده دیداری بانک‌ها",
        "description": "سپرده دیداری بانک‌ها نزد بانک مرکزی.", "parent_id": "base-money-uses",
    },
    "base-currency-circulation": {
        "category_id": "3505fc25-5fe8-8f09-e063-4ceaa8c0b336",
        "title": "پایه پولی · اسکناس و مسکوک در جریان",
        "description": "جزء پایه پولی در نما بر حسب مصارف.", "parent_id": "base-money-uses",
    },
    "base-currency-public": {
        "category_id": "3505fc25-5fe9-8f09-e063-4ceaa8c0b336",
        "title": "پایه پولی · اسکناس و مسکوک دست اشخاص",
        "description": "جزء اسکناس و مسکوک در جریان.", "parent_id": "base-currency-circulation",
    },
    "base-currency-banks": {
        "category_id": "3505fc25-5fea-8f09-e063-4ceaa8c0b336",
        "title": "پایه پولی · اسکناس و مسکوک نزد بانک‌ها",
        "description": "جزء اسکناس و مسکوک در جریان نزد بانک‌ها و مؤسسات اعتباری غیربانکی.",
        "parent_id": "base-currency-circulation",
    },
}
BY_CATEGORY = {item["category_id"]: series_id for series_id, item in BASE_MONEY_SERIES.items()}


def fetch_base_money_rows() -> dict[str, list[dict]]:
    session = requests.Session()
    session.headers.update({"User-Agent": "EcoNotes/0.3 (local economic data research)", "Accept-Language": "fa"})
    frequencies_response = session.post(BASE + "sub-frequency/", json={}, timeout=25)
    frequencies_response.raise_for_status()
    frequencies = frequencies_response.json()
    quarterly_id = next((row["id"] for row in frequencies if row.get("code") == "3"), None)
    if not quarterly_id:
        raise ValueError("CBI quarterly frequency is unavailable")

    categories = list(BY_CATEGORY)
    fetched: list[dict] = []
    for offset in range(0, len(categories), 4):
        response = session.post(BASE + "value/graph", json={
            "fromDate": "13520101", "toDateDate": "14101230",
            "categoryIds": categories[offset:offset + 4], "calender": "FA",
            "subFrequencyId": quarterly_id,
        }, timeout=60)
        response.raise_for_status()
        rows = response.json()
        if not isinstance(rows, list):
            raise ValueError("CBI base-money response has an unexpected shape")
        fetched.extend(row for row in rows if isinstance(row, dict))

    parsed: dict[str, dict[str, dict]] = {series_id: {} for series_id in BASE_MONEY_SERIES}
    for entry in fetched:
        if entry.get("amount") is None:
            continue
        series_id = BY_CATEGORY.get(entry.get("CATEGORYID"))
        if series_id is None:
            continue
        jalali = str(entry.get("khDate", ""))
        if len(jalali) != 8 or not jalali.isascii() or not jalali.isdigit():
            raise ValueError("CBI base-money row has an invalid Jalali date")
        observed = JalaliDate(int(jalali[:4]), int(jalali[4:6]), int(jalali[6:])).to_gregorian().isoformat()
        value = float(entry["amount"])
        if not math.isfinite(value):
            raise ValueError("CBI base-money row has a nonfinite value")
        current = parsed[series_id].get(observed)
        if current and current["value"] != value:
            raise ValueError(f"Conflicting CBI base-money values for {series_id} on {observed}")
        parsed[series_id][observed] = {
            "date": observed, "jalali": jalali, "value": value,
            "source_record_id": str(entry.get("id") or ""),
            "raw_payload": json.dumps(entry, ensure_ascii=False, separators=(",", ":")),
        }

    result = {key: [values[date] for date in sorted(values)] for key, values in parsed.items()}
    empty = [series_id for series_id, values in result.items() if not values]
    if empty:
        raise ValueError("CBI returned no numeric rows for base-money series: " + ", ".join(empty))
    return result


def import_base_money() -> dict:
    started_at = datetime.now(timezone.utc).isoformat()
    with database() as connection:
        connection.execute(
            """INSERT INTO sources (id, name, homepage, retrieval_method) VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET name=excluded.name, homepage=excluded.homepage,
                 retrieval_method=excluded.retrieval_method""",
            (SOURCE_ID, "بانک مرکزی · پایه پولی", "https://tsdview.cis.cbi.ir/single-data",
             "Public CBI TSD quarterly category graph API"),
        )
        run_id = connection.execute(
            "INSERT INTO ingestion_runs (source_id, started_at, status) VALUES (?, ?, 'running')",
            (SOURCE_ID, started_at),
        ).lastrowid
    try:
        parsed = fetch_base_money_rows()
        fetched_at = datetime.now(timezone.utc).isoformat()
        with database() as connection:
            for series_id, values in parsed.items():
                definition = BASE_MONEY_SERIES[series_id]
                connection.execute(
                    """INSERT INTO series (id, title, description, group_id, unit, frequency,
                                            source_id, status, parent_id, last_checked_at)
                       VALUES (?, ?, ?, 'money', ?, 'quarterly', ?, 'active', ?, ?)
                       ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
                         group_id='money', unit=excluded.unit, frequency='quarterly',
                         source_id=excluded.source_id, status='active', parent_id=excluded.parent_id,
                         last_checked_at=excluded.last_checked_at""",
                    (series_id, definition["title"], definition["description"], UNIT, SOURCE_ID,
                     definition["parent_id"], fetched_at),
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
            count = sum(map(len, parsed.values()))
            connection.execute(
                """UPDATE ingestion_runs SET status='success', finished_at=?,
                    rows_received=?, rows_accepted=? WHERE id=?""",
                (fetched_at, count, count, run_id),
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
    print(json.dumps(import_base_money(), ensure_ascii=False, indent=2))
