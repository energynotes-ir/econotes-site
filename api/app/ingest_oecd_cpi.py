"""Import the US national all-items CPI index from OECD's public SDMX API."""

from __future__ import annotations

import csv
import io
import json
import math
from calendar import monthrange
from datetime import date, datetime, timezone

import requests
from persiantools.jdatetime import JalaliDate

from .db import database

SOURCE_ID = "oecd-us-cpi"
DATA_URL = (
    "https://sdmx.oecd.org/public/rest/data/"
    "OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,/USA.M.N.CPI.._T.N._Z"
)
MIN_INDEX_ROWS = 120
MAX_LAG_MONTHS = 4


def _month_end(period: str) -> str:
    try:
        year_text, month_text = period.split("-", 1)
        year, month = int(year_text), int(month_text)
        if len(year_text) != 4 or not 1 <= month <= 12:
            raise ValueError
        return date(year, month, monthrange(year, month)[1]).isoformat()
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid OECD monthly period: {period!r}") from exc


def parse_oecd_cpi_csv(text: str) -> dict[str, list[dict]]:
    """Validate national CPI levels and derive monthly and annual inflation rates."""
    reader = csv.DictReader(io.StringIO(text))
    required = {"REF_AREA", "FREQ", "METHODOLOGY", "MEASURE", "UNIT_MEASURE",
                "EXPENDITURE", "ADJUSTMENT", "TRANSFORMATION", "TIME_PERIOD", "OBS_VALUE"}
    if not reader.fieldnames or not required.issubset(reader.fieldnames):
        raise ValueError("OECD CPI response is missing expected SDMX columns")

    by_month: dict[str, dict] = {}
    for row in reader:
        if row.get("REF_AREA") != "USA":
            continue
        if (row.get("FREQ"), row.get("METHODOLOGY"), row.get("MEASURE"),
            row.get("UNIT_MEASURE"), row.get("EXPENDITURE"), row.get("ADJUSTMENT"),
            row.get("TRANSFORMATION")) != ("M", "N", "CPI", "IX", "_T", "N", "_Z"):
            continue
        if not row.get("OBS_VALUE"):
            continue
        period = str(row.get("TIME_PERIOD") or "")
        observed = _month_end(period)
        value = float(row["OBS_VALUE"])
        if not math.isfinite(value) or value <= 0:
            raise ValueError(f"OECD CPI index is invalid for {period}")
        entry = {
            "date": observed, "period": period, "value": value,
            "source_record_id": f"OECD.DSD_PRICES@DF_PRICES_ALL.USA.M.N.CPI.IX._T.N._Z.{period}",
            "raw_payload": json.dumps(row, ensure_ascii=False, separators=(",", ":")),
        }
        previous = by_month.get(period)
        if previous and previous["value"] != value:
            raise ValueError(f"Conflicting OECD CPI values for {period}")
        by_month[period] = entry

    levels = [by_month[period] for period in sorted(by_month)]
    if len(levels) < MIN_INDEX_ROWS:
        raise ValueError(f"OECD CPI history is unexpectedly short ({len(levels)} monthly rows)")

    level_by_period = {row["period"]: row for row in levels}
    mom: list[dict] = []
    yoy: list[dict] = []
    for current in levels:
        year, month = map(int, current["period"].split("-"))
        ordinal = year * 12 + month - 1
        for offset, target, label in ((1, mom, "mom"), (12, yoy, "yoy")):
            prior_year, prior_month0 = divmod(ordinal - offset, 12)
            prior_period = f"{prior_year:04d}-{prior_month0 + 1:02d}"
            prior = level_by_period.get(prior_period)
            if prior is None:
                continue
            rate = (current["value"] / prior["value"] - 1.0) * 100.0
            target.append({
                "date": current["date"], "period": current["period"], "value": rate,
                "source_record_id": f"{current['source_record_id']}:{label}",
                "raw_payload": json.dumps({
                    "source": json.loads(current["raw_payload"]),
                    "prior_period": prior["period"], "prior_index": prior["value"],
                    "formula": "(current_cpi / prior_cpi - 1) * 100",
                    "rate": label,
                }, ensure_ascii=False, separators=(",", ":")),
            })
    return {"cpi-us": levels, "cpi-us-mom": mom, "cpi-us-yoy": yoy}


def fetch_us_cpi() -> dict[str, list[dict]]:
    session = requests.Session()
    session.headers.update({
        "User-Agent": "EcoNotes/0.3 (local economic data research)",
        "Accept": "text/csv",
    })
    response = session.get(DATA_URL, params={"format": "csvfilewithlabels"}, timeout=45)
    response.raise_for_status()
    parsed = parse_oecd_cpi_csv(response.text)
    now = datetime.now(timezone.utc).date()
    minimum_ordinal = now.year * 12 + now.month - 1 - MAX_LAG_MONTHS
    minimum_year, minimum_month0 = divmod(minimum_ordinal, 12)
    minimum_date = date(minimum_year, minimum_month0 + 1, 1)
    latest_date = date.fromisoformat(parsed["cpi-us"][-1]["date"])
    if latest_date < minimum_date:
        raise ValueError(f"OECD U.S. CPI is stale: latest observation is {latest_date}")
    return parsed


def import_us_cpi() -> dict:
    started = datetime.now(timezone.utc).isoformat()
    with database() as connection:
        connection.execute(
            """INSERT INTO sources (id, name, homepage, retrieval_method) VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET name=excluded.name, homepage=excluded.homepage,
                 retrieval_method=excluded.retrieval_method""",
            (SOURCE_ID, "OECD · شاخص قیمت مصرف‌کننده آمریکا",
             "https://data-explorer.oecd.org/", "Public OECD SDMX CSV · U.S. national all-items CPI, not seasonally adjusted"),
        )
        run_id = connection.execute(
            "INSERT INTO ingestion_runs (source_id, started_at, status) VALUES (?, ?, 'running')",
            (SOURCE_ID, started),
        ).lastrowid
    try:
        parsed = fetch_us_cpi()
        fetched_at = datetime.now(timezone.utc).isoformat()
        definitions = {
            "cpi-us": (
                "شاخص قیمت مصرف‌کننده آمریکا · CPI ملی",
                "شاخص · پایه ۲۰۱۵=۱۰۰",
                "شاخص ملی CPI آمریکا برای همه اقلام، بدون تعدیل فصلی، بازپایه‌شده به ۲۰۱۵=۱۰۰؛ منبع OECD SDMX.",
                None, 40,
            ),
            "cpi-us-mom": (
                "تورم ماهانه آمریکا · از شاخص CPI",
                "درصد ماهانه",
                "تغییر ماه‌به‌ماه شاخص ملی CPI آمریکا از نسبت شاخص ماه جاری به ماه قبل محاسبه شده است؛ سری بدون تعدیل فصلی است.",
                "cpi-us", 41,
            ),
            "cpi-us-yoy": (
                "تورم نقطه‌به‌نقطه آمریکا · از شاخص CPI",
                "درصد نقطه‌به‌نقطه",
                "تغییر CPI ملی آمریکا نسبت به ماه مشابه سال قبل، از نسبت شاخص محاسبه شده است؛ سری بدون تعدیل فصلی است.",
                "cpi-us", 42,
            ),
        }
        accepted = 0
        with database() as connection:
            for series_id, rows in parsed.items():
                title, unit, description, parent_id, display_order = definitions[series_id]
                connection.execute(
                    """INSERT INTO series (id, title, description, group_id, unit, frequency,
                                            source_id, status, parent_id, display_order, last_checked_at)
                       VALUES (?, ?, ?, 'prices', ?, 'monthly', ?, 'active', ?, ?, ?)
                       ON CONFLICT(id) DO UPDATE SET title=excluded.title,
                         description=excluded.description, group_id='prices', unit=excluded.unit,
                         frequency='monthly', source_id=excluded.source_id, status='active',
                         parent_id=excluded.parent_id, display_order=excluded.display_order,
                         last_checked_at=excluded.last_checked_at""",
                    (series_id, title, description, unit, SOURCE_ID, parent_id, display_order, fetched_at),
                )
                for row in rows:
                    jalali_date = JalaliDate.to_jalali(date.fromisoformat(row["date"])).strftime("%Y%m%d")
                    connection.execute(
                        """INSERT INTO macro_observations (series_id, observed_on, jalali_date, value,
                                    source_record_id, raw_payload, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)
                           ON CONFLICT(series_id, observed_on) DO UPDATE SET value=excluded.value,
                             jalali_date=excluded.jalali_date, source_record_id=excluded.source_record_id,
                             raw_payload=excluded.raw_payload, fetched_at=excluded.fetched_at""",
                        (series_id, row["date"], jalali_date, row["value"], row["source_record_id"],
                         row["raw_payload"], fetched_at),
                    )
                    connection.execute(
                        """INSERT INTO observations (series_id, observed_on, value, symbol,
                                    source_record_id, published_at) VALUES (?, ?, ?, NULL, ?, ?)
                           ON CONFLICT(series_id, observed_on) DO UPDATE SET value=excluded.value,
                             source_record_id=excluded.source_record_id, published_at=excluded.published_at""",
                        (series_id, row["date"], row["value"], row["source_record_id"], fetched_at),
                    )
                    accepted += 1
            connection.execute("UPDATE sources SET last_success_at=? WHERE id=?", (fetched_at, SOURCE_ID))
            connection.execute(
                """UPDATE ingestion_runs SET status='success', finished_at=?,
                   rows_received=?, rows_accepted=? WHERE id=?""",
                (fetched_at, len(parsed["cpi-us"]), accepted, run_id),
            )
        return {
            "series": {key: len(rows) for key, rows in parsed.items()},
            "latest": {key: rows[-1]["date"] for key, rows in parsed.items()},
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
    print(json.dumps(import_us_cpi(), ensure_ascii=False, indent=2))
