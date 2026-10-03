"""Build complete CBI month-over-month and point-to-point inflation series."""

from __future__ import annotations

import math
from datetime import datetime, timezone

from persiantools.jdatetime import JalaliDate

from .db import database

SOURCE_ID = "cbi-cpi-release"
CBI_HOME = "https://www.cbi.ir/"

# The CBI's public TSD CPI index currently ends at Esfand 1404. For Farvardin
# through Shahrivar 1405, use the bank's separately published headline rates.
# These remain rates only; no post-Esfand index levels are inferred or stored.
_HEADLINES = (
    {"jalali_month": (1405, 1), "m2m": 7.0, "yoy": 67.0,
     "published_on": (1405, 2, 5), "source_record_id": "cbi-release-1405-01"},
    {"jalali_month": (1405, 2), "m2m": 8.5, "yoy": 77.2,
     "published_on": (1405, 3, 11), "source_record_id": "cbi-release-1405-02"},
    {"jalali_month": (1405, 3), "m2m": 7.4, "yoy": 83.1,
     "published_on": (1405, 4, 8), "source_record_id": "cbi-release-35602"},
    {"jalali_month": (1405, 4), "m2m": 3.6, "yoy": 83.9,
     "published_on": (1405, 5, 6), "source_record_id": "cbi-release-35817"},
    {"jalali_month": (1405, 5), "m2m": 3.7, "yoy": 84.4,
     "published_on": (1405, 6, 5), "source_record_id": "cbi-release-1405-05"},
    {"jalali_month": (1405, 6), "m2m": 3.9, "yoy": 83.8,
     "published_on": (1405, 7, 4), "source_record_id": "cbi-release-36185"},
)


def _month_index(year: int, month: int) -> int:
    return year * 12 + month - 1


def _period(row: dict) -> tuple[int, int]:
    date = datetime.strptime(str(row["date"]), "%Y-%m-%d").date()
    jalali = JalaliDate.to_jalali(date)
    return jalali.year, jalali.month


def _month_end(year: int, month: int) -> JalaliDate:
    if month <= 6:
        day = 31
    elif month <= 11:
        day = 30
    else:
        day = 30 if JalaliDate.is_leap(year) else 29
    return JalaliDate(year, month, day)


def _derived_observation(current: dict, previous: dict, value: float, label: str) -> dict:
    current_id = str(current.get("source_record_id") or current["date"])
    previous_id = str(previous.get("source_record_id") or previous["date"])
    return {
        "date": current["date"],
        "value": round(value, 1),
        "source_record_id": f"derived-cbi-cpi-{label}:{previous_id}:{current_id}",
        "published_at": current.get("published_at") or datetime.now(timezone.utc).isoformat(),
    }


def calculate_index_rates(index_rows: list[dict]) -> dict[str, list[dict]]:
    """Calculate m/m and 12-month point-to-point rates from CBI CPI levels."""
    levels: dict[int, dict] = {}
    for raw_row in index_rows:
        row = dict(raw_row)
        value = float(row["value"])
        if not math.isfinite(value) or value <= 0:
            raise ValueError("CBI CPI index values must be finite and positive")
        year, month = _period(row)
        ordinal = _month_index(year, month)
        previous = levels.get(ordinal)
        if previous and (previous["value"] != value or previous["date"] != row["date"]):
            raise ValueError(f"Conflicting CBI CPI index values for {year:04d}/{month:02d}")
        levels[ordinal] = row

    monthly: list[dict] = []
    point_to_point: list[dict] = []
    for ordinal in sorted(levels):
        current = levels[ordinal]
        prior_month = levels.get(ordinal - 1)
        if prior_month:
            monthly.append(_derived_observation(
                current, prior_month, (current["value"] / prior_month["value"] - 1) * 100, "mom",
            ))
        same_month_last_year = levels.get(ordinal - 12)
        if same_month_last_year:
            point_to_point.append(_derived_observation(
                current, same_month_last_year,
                (current["value"] / same_month_last_year["value"] - 1) * 100, "yoy",
            ))
    return {"cpi-mom-cbi": monthly, "cpi-yoy-cbi": point_to_point}


def release_observations(index_rows: list[dict] | None = None) -> dict[str, list[dict]]:
    """Merge index-derived history with the CBI's newer directly reported rates."""
    derived = calculate_index_rates(index_rows or [])
    rows: dict[str, dict[str, dict]] = {
        series_id: {row["date"]: row for row in series_rows}
        for series_id, series_rows in derived.items()
    }
    for item in _HEADLINES:
        year, month = item["jalali_month"]
        period_end = _month_end(year, month)
        observed_on = period_end.to_gregorian().isoformat()
        published_on = JalaliDate(*item["published_on"]).to_gregorian().isoformat()
        for series_id, field in (("cpi-mom-cbi", "m2m"), ("cpi-yoy-cbi", "yoy")):
            rows[series_id][observed_on] = {
                "date": observed_on,
                "value": item[field],
                "source_record_id": item["source_record_id"],
                "published_at": f"{published_on}T12:00:00+03:30",
            }
    return {
        series_id: [series_rows[date] for date in sorted(series_rows)]
        for series_id, series_rows in rows.items()
    }


def import_cpi_release() -> dict:
    started = datetime.now(timezone.utc).isoformat()
    with database() as connection:
        connection.execute(
            """INSERT INTO sources (id, name, homepage, retrieval_method) VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET name=excluded.name, homepage=excluded.homepage,
                 retrieval_method=excluded.retrieval_method""",
            (SOURCE_ID, "بانک مرکزی · شاخص قیمت و نرخ‌های تورم",
             CBI_HOME,
             "Historical m/m and y/y rates derived from the CBI TSD CPI index; newer months use published CBI headline rates"),
        )
        run_id = connection.execute(
            "INSERT INTO ingestion_runs (source_id, started_at, status) VALUES (?, ?, 'running')",
            (SOURCE_ID, started),
        ).lastrowid
    try:
        with database() as connection:
            index_rows = [dict(row) for row in connection.execute(
                """SELECT observed_on AS date, value, source_record_id, published_at
                   FROM observations WHERE series_id='cpi-ir-cbi' ORDER BY observed_on"""
            ).fetchall()]
        data = release_observations(index_rows)
        fetched_at = datetime.now(timezone.utc).isoformat()
        definitions = {
            "cpi-mom-cbi": (
                "تورم ماهانه · شاخص قیمت بانک مرکزی",
                "درصد ماهانه",
                "تغییر ماه‌به‌ماه CPI مناطق شهری CBI؛ تاریخ‌های دارای شاخص خام از نسبت دو شاخص متوالی و با گردکردن یک‌رقمی محاسبه شده‌اند، ماه‌های جدیدتر نرخ رسمی انتشارند.",
                30,
            ),
            "cpi-yoy-cbi": (
                "تورم نقطه‌به‌نقطه · شاخص قیمت بانک مرکزی",
                "درصد نقطه‌به‌نقطه",
                "تغییر CPI نسبت به ماه مشابه سال قبل؛ تاریخ‌های تاریخی از شاخص خام CBI و ماه‌های جدیدتر از نرخ رسمی انتشار. با تورم ۱۲ماهه میانگین یکسان نیست.",
                31,
            ),
        }
        accepted = 0
        with database() as connection:
            for series_id, rows in data.items():
                title, unit, description, display_order = definitions[series_id]
                connection.execute(
                    """INSERT INTO series (id, title, description, group_id, unit, frequency,
                                            source_id, status, display_order, last_checked_at)
                       VALUES (?, ?, ?, 'prices', ?, 'monthly', ?, 'active', ?, ?)
                       ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
                         group_id='prices', unit=excluded.unit, frequency='monthly', source_id=excluded.source_id,
                         status='active', display_order=excluded.display_order, last_checked_at=excluded.last_checked_at""",
                    (series_id, title, description, unit, SOURCE_ID, display_order, fetched_at),
                )
                for row in rows:
                    connection.execute(
                        """INSERT INTO observations (series_id, observed_on, value, symbol,
                                    source_record_id, published_at) VALUES (?, ?, ?, NULL, ?, ?)
                           ON CONFLICT(series_id, observed_on) DO UPDATE SET value=excluded.value,
                             source_record_id=excluded.source_record_id, published_at=excluded.published_at""",
                        (series_id, row["date"], row["value"], row["source_record_id"], row["published_at"]),
                    )
                    accepted += 1
            connection.execute(
                """UPDATE ingestion_runs SET status='success', finished_at=?,
                   rows_received=?, rows_accepted=? WHERE id=?""",
                (fetched_at, accepted, accepted, run_id),
            )
            connection.execute("UPDATE sources SET last_success_at=? WHERE id=?", (fetched_at, SOURCE_ID))
        return {
            "series": len(data),
            "observations": accepted,
            "latest": {series_id: rows[-1]["date"] for series_id, rows in data.items()},
            "counts": {series_id: len(rows) for series_id, rows in data.items()},
            "fetched_at": fetched_at,
        }
    except Exception as exc:
        with database() as connection:
            connection.execute(
                "UPDATE ingestion_runs SET status='failed', finished_at=?, error_message=? WHERE id=?",
                (datetime.now(timezone.utc).isoformat(), str(exc)[:1000], run_id),
            )
        raise
