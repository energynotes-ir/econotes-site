"""Calculate a monthly real USDT/Toman index from stored CPI and FX inputs."""

from __future__ import annotations

import json
import math
from datetime import date, datetime, timezone

from persiantools.jdatetime import JalaliDate

from .db import database

SOURCE_ID = "derived-real-fx"


def build_real_exchange_rows(
    iran_cpi_rows: list[dict], us_cpi_rows: list[dict], fx_rows: list[dict],
) -> list[dict]:
    """Use Iranian CPI periods, monthly-average FX and only already-ended U.S. CPI months."""
    iran = sorted(iran_cpi_rows, key=lambda row: row["date"])
    us = sorted(us_cpi_rows, key=lambda row: row["date"])
    fx = sorted(fx_rows, key=lambda row: row["date"])
    if len(iran) < 2 or not us or not fx:
        raise ValueError("Not enough verified CPI and FX observations to calculate real exchange rate")
    if any(not math.isfinite(float(row["value"])) or float(row["value"]) <= 0 for row in iran + us + fx):
        raise ValueError("Real-exchange inputs must be finite and positive")

    unscaled: list[dict] = []
    us_dates = [row["date"] for row in us]
    fx_index = 0
    for previous, current in zip(iran, iran[1:]):
        while fx_index < len(fx) and fx[fx_index]["date"] <= previous["date"]:
            fx_index += 1
        period_fx = []
        cursor = fx_index
        while cursor < len(fx) and fx[cursor]["date"] <= current["date"]:
            period_fx.append(fx[cursor])
            cursor += 1
        if not period_fx:
            continue
        fx_index = cursor

        us_position = -1
        for index, observed in enumerate(us_dates):
            if observed >= current["date"]:
                break
            us_position = index
        if us_position < 0:
            continue
        us_point = us[us_position]
        average_fx = sum(float(row["value"]) for row in period_fx) / len(period_fx)
        real_level = average_fx * float(us_point["value"]) / float(current["value"])
        if not math.isfinite(real_level) or real_level <= 0:
            raise ValueError(f"Calculated real exchange value is invalid on {current['date']}")
        unscaled.append({
            "date": current["date"], "value": real_level,
            "iran_cpi": current, "us_cpi": us_point, "average_fx": average_fx,
            "fx_count": len(period_fx), "fx_start": period_fx[0]["date"],
            "fx_end": period_fx[-1]["date"],
        })
    if not unscaled:
        raise ValueError("No common monthly real-exchange observations are available")

    base = unscaled[0]["value"]
    result = []
    for row in unscaled:
        jalali = JalaliDate.to_jalali(date.fromisoformat(row["date"])).strftime("%Y%m%d")
        source_jalali = str(row["iran_cpi"].get("jalali") or "")
        if len(source_jalali) == 8 and source_jalali.isdigit():
            source_jalali = f"{source_jalali[:4]}/{source_jalali[4:6]}/{source_jalali[6:]}"
        else:
            source_jalali = row["iran_cpi"]["date"]
        symbol = (
            f"میانگین والکس {row['fx_count']} روز · CPI ایران {source_jalali}"
            f" · CPI آمریکا {row['us_cpi']['date']}"
        )
        raw_payload = {
            "formula": "100 * (period_average_USDT_TMN * latest_ended_US_CPI / Iran_CPI) / first_common_ratio",
            "iran_cpi_date": row["iran_cpi"]["date"],
            "iran_cpi_value": row["iran_cpi"]["value"],
            "iran_cpi_source": row["iran_cpi"].get("source_record_id"),
            "us_cpi_date": row["us_cpi"]["date"],
            "us_cpi_value": row["us_cpi"]["value"],
            "us_cpi_source": row["us_cpi"].get("source_record_id"),
            "nominal_fx_start": row["fx_start"],
            "nominal_fx_end": row["fx_end"],
            "nominal_fx_daily_observations": row["fx_count"],
            "nominal_fx_period_average": row["average_fx"],
            "nominal_fx_source": "usd-free-wallex",
            "base_ratio": base,
            "iran_cpi_extension": "none; only directly observed CBI CPI index rows are used",
        }
        result.append({
            "date": row["date"], "jalali": jalali,
            "value": row["value"] / base * 100.0,
            "symbol": symbol,
            "source_record_id": f"econotes-real-fx:{row['date']}",
            "raw_payload": json.dumps(raw_payload, ensure_ascii=False, separators=(",", ":")),
        })
    return result


def _read_inputs() -> list[dict]:
    with database() as connection:
        iran = [dict(row) for row in connection.execute(
            """SELECT m.observed_on AS date, m.jalali_date AS jalali, m.value, m.source_record_id
               FROM macro_observations m WHERE m.series_id='cpi-ir-cbi' ORDER BY m.observed_on"""
        )]
        us = [dict(row) for row in connection.execute(
            "SELECT observed_on AS date, value, source_record_id FROM observations WHERE series_id='cpi-us' ORDER BY observed_on"
        )]
        fx = [dict(row) for row in connection.execute(
            "SELECT observed_on AS date, value, source_record_id FROM observations WHERE series_id='usd-free-wallex' ORDER BY observed_on"
        )]
    return build_real_exchange_rows(iran, us, fx)


def import_real_exchange_rate() -> dict:
    started = datetime.now(timezone.utc).isoformat()
    with database() as connection:
        connection.execute(
            """INSERT INTO sources (id, name, homepage, retrieval_method) VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET name=excluded.name, homepage=excluded.homepage,
                 retrieval_method=excluded.retrieval_method""",
            (SOURCE_ID, "محاسبه EcoNotes · نرخ ارز حقیقی", "https://tsdview.cis.cbi.ir/single-data",
             "Monthly period-average Wallex USDT/Toman rebased by directly observed CBI CPI and lagged OECD U.S. CPI"),
        )
        run_id = connection.execute(
            "INSERT INTO ingestion_runs (source_id, started_at, status) VALUES (?, ?, 'running')",
            (SOURCE_ID, started),
        ).lastrowid
    try:
        rows = _read_inputs()
        fetched_at = datetime.now(timezone.utc).isoformat()
        with database() as connection:
            connection.execute(
                """INSERT INTO series (id, title, description, group_id, unit, frequency,
                                        source_id, status, parent_id, display_order, last_checked_at)
                   VALUES ('usd-real', ?, ?, 'currency', ?, 'monthly', ?, 'active', 'usd-free', 6, ?)
                   ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
                     group_id='currency', unit=excluded.unit, frequency='monthly',
                     source_id=excluded.source_id, status='active', parent_id='usd-free',
                     display_order=excluded.display_order, last_checked_at=excluded.last_checked_at""",
                ("دلار حقیقی دوجانبه · شاخص ماهانه",
                 "میانگین دوره‌ای USDT/تومانِ والکس با CPI مستقیم بانک مرکزی و CPI ملی آمریکا از OECD؛ پایه ۱۰۰ در نخستین ماه مشترک. فقط شاخص خام CPI ایران وارد می‌شود؛ بنابراین تاریخچه فعلاً تا آخرین انتشار شاخص خام ادامه دارد. CPI آمریکا برای هر دوره از آخرین ماه مشاهده‌شده پیش از پایان دوره گرفته می‌شود.",
                 "شاخص؛ ماه اول=۱۰۰", SOURCE_ID, fetched_at),
            )
            for row in rows:
                connection.execute(
                    """INSERT INTO macro_observations (series_id, observed_on, jalali_date, value,
                                source_record_id, raw_payload, fetched_at) VALUES ('usd-real', ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(series_id, observed_on) DO UPDATE SET value=excluded.value,
                         jalali_date=excluded.jalali_date, source_record_id=excluded.source_record_id,
                         raw_payload=excluded.raw_payload, fetched_at=excluded.fetched_at""",
                    (row["date"], row["jalali"], row["value"], row["source_record_id"],
                     row["raw_payload"], fetched_at),
                )
                connection.execute(
                    """INSERT INTO observations (series_id, observed_on, value, symbol,
                                source_record_id, published_at) VALUES ('usd-real', ?, ?, ?, ?, ?)
                       ON CONFLICT(series_id, observed_on) DO UPDATE SET value=excluded.value,
                         symbol=excluded.symbol, source_record_id=excluded.source_record_id,
                         published_at=excluded.published_at""",
                    (row["date"], row["value"], row["symbol"], row["source_record_id"], fetched_at),
                )
            connection.execute("UPDATE sources SET last_success_at=? WHERE id=?", (fetched_at, SOURCE_ID))
            connection.execute(
                """UPDATE ingestion_runs SET status='success', finished_at=?,
                   rows_received=?, rows_accepted=? WHERE id=?""",
                (fetched_at, len(rows), len(rows), run_id),
            )
        return {"observations": len(rows), "first": rows[0]["date"], "latest": rows[-1]["date"], "fetched_at": fetched_at}
    except Exception as exc:
        with database() as connection:
            connection.execute(
                "UPDATE ingestion_runs SET status='failed', finished_at=?, error_message=? WHERE id=?",
                (datetime.now(timezone.utc).isoformat(), str(exc)[:1000], run_id),
            )
        raise


if __name__ == "__main__":
    print(json.dumps(import_real_exchange_rate(), ensure_ascii=False, indent=2))
