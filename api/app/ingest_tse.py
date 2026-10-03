"""Import TSETMC raw and adjusted history from the user's notebook endpoints."""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .db import database

RAW_URL = "https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceDailyList/{code}/0"
ADJUSTED_URL = "https://members.tsetmc.com/tsev2/chart/data/Financial.aspx?i={code}&t=ph&a=1"
INDEX_URL = "https://cdn.tsetmc.com/api/Index/GetIndexB2History/{code}"
SOURCE_ID = "tsetmc"
INDEX_SERIES = {
    "tedpix": {
        "ins_code": "32097828799138957",
        "title": "شاخص کل بورس تهران",
        "description": "تاریخچه روزانه شاخص کل از سری تاریخی شاخص TSETMC.",
        "display_order": 1,
    },
    "equal": {
        "ins_code": "67130298613737946",
        "title": "شاخص کل هم‌وزن بورس تهران",
        "description": "تاریخچه روزانه شاخص کل هم‌وزن از سری تاریخی شاخص TSETMC.",
        "display_order": 2,
    },
}


def date_iso(value: object) -> str:
    text = str(value)
    if len(text) != 8 or not text.isascii() or not text.isdigit():
        raise ValueError(f"Invalid TSETMC date: {text[:30]}")
    return datetime.strptime(text, "%Y%m%d").date().isoformat()


def number(value: object, *, required: bool = False) -> float | None:
    if value is None or value == "":
        if required:
            raise ValueError("Missing required price")
        return None
    result = float(value)
    if not math.isfinite(result) or result < 0:
        raise ValueError("Invalid market value")
    return result


def parse_raw(payload: dict) -> list[dict]:
    data = payload.get("closingPriceDaily")
    if not isinstance(data, list) or not data:
        raise ValueError("Raw response has no closingPriceDaily rows")
    rows = {}
    for entry in data:
        if not isinstance(entry, dict):
            raise ValueError("Invalid raw row")
        date = date_iso(entry.get("dEven"))
        rows[date] = {
            "date": date, "open": number(entry.get("priceFirst")),
            "high": number(entry.get("priceMax")), "low": number(entry.get("priceMin")),
            "close": number(entry.get("pClosing"), required=True),
            "final": number(entry.get("pDrCotVal")),
            "previous_close": number(entry.get("priceYesterday")),
            "volume": number(entry.get("qTotTran5J")),
            "traded_value": number(entry.get("qTotCap")),
            "trades": number(entry.get("zTotTran")),
            "raw_payload": json.dumps(entry, ensure_ascii=False, separators=(",", ":")),
        }
    return [rows[date] for date in sorted(rows)]


def parse_adjusted(text: str) -> list[dict]:
    rows = {}
    for record in text.strip().split(";"):
        if not record.strip():
            continue
        cells = record.split(",")
        if len(cells) != 7:
            raise ValueError(f"Adjusted response row has {len(cells)} fields")
        date, high, low, open_price, last_trade, volume, closing = cells
        iso = date_iso(date)
        rows[iso] = {
            "date": iso, "open": number(open_price), "high": number(high),
            "low": number(low), "close": number(closing, required=True),
            "final": number(last_trade), "previous_close": None,
            "volume": number(volume), "traded_value": None, "trades": None,
            "raw_payload": record,
        }
    if not rows:
        raise ValueError("Adjusted response has no history")
    return [rows[date] for date in sorted(rows)]


def fetch_history(ins_code: str) -> tuple[list[dict], list[dict]]:
    session = requests.Session()
    session.headers.update({"User-Agent": "EcoNotes/0.2 (local historical data research)"})
    retry = Retry(total=2, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504], allowed_methods=["GET"])
    session.mount("https://", HTTPAdapter(max_retries=retry))
    raw_response = session.get(RAW_URL.format(code=ins_code), timeout=25)
    raw_response.raise_for_status()
    adjusted_response = session.get(ADJUSTED_URL.format(code=ins_code), timeout=25)
    adjusted_response.raise_for_status()
    return parse_raw(raw_response.json()), parse_adjusted(adjusted_response.text)


def import_instrument(ins_code: str, symbol: str, name: str) -> dict:
    if not (ins_code.isascii() and ins_code.isdigit() and 10 <= len(ins_code) <= 20):
        raise ValueError("Instrument code must be 10–20 ASCII digits")
    if not symbol.strip() or not name.strip():
        raise ValueError("Symbol and instrument name are required")
    started = datetime.now(timezone.utc).isoformat()
    with database() as connection:
        connection.execute(
            """INSERT INTO sources (id, name, homepage, retrieval_method) VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO NOTHING""",
            (SOURCE_ID, "TSETMC", "https://www.tsetmc.com/", "User notebook: raw JSON and adjusted CSV"),
        )
        run_id = connection.execute(
            "INSERT INTO ingestion_runs (source_id, ins_code, started_at, status) VALUES (?, ?, ?, 'running')",
            (SOURCE_ID, ins_code, started),
        ).lastrowid
    try:
        raw, adjusted = fetch_history(ins_code)
        fetched = datetime.now(timezone.utc).isoformat()
        with database() as connection:
            for adjustment, rows in (("raw", raw), ("adjusted", adjusted)):
                series_id = f"tse-{ins_code}-{adjustment}"
                title = f"{symbol} · {'تعدیل‌نشده' if adjustment == 'raw' else 'تعدیل‌شده'}"
                connection.execute(
                    """INSERT INTO series (id, title, description, group_id, unit, frequency,
                                            source_id, status, last_checked_at)
                       VALUES (?, ?, ?, 'stocks', 'ریال', 'daily', ?, 'active', ?)
                       ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
                          status='active', last_checked_at=excluded.last_checked_at""",
                    (series_id, title, name, SOURCE_ID, fetched),
                )
                for row in rows:
                    connection.execute(
                        """INSERT INTO market_prices (ins_code, observed_on, adjustment, open, high, low,
                            close, final, previous_close, volume, traded_value, trades, raw_payload, fetched_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                           ON CONFLICT(ins_code, observed_on, adjustment) DO UPDATE SET
                             open=excluded.open, high=excluded.high, low=excluded.low,
                             close=excluded.close, final=excluded.final,
                             previous_close=excluded.previous_close, volume=excluded.volume,
                             traded_value=excluded.traded_value, trades=excluded.trades,
                             raw_payload=excluded.raw_payload, fetched_at=excluded.fetched_at""",
                        (ins_code, row["date"], adjustment, row["open"], row["high"], row["low"],
                         row["close"], row["final"], row["previous_close"], row["volume"],
                         row["traded_value"], row["trades"], row["raw_payload"], fetched),
                    )
                    connection.execute(
                        """INSERT INTO observations (series_id, observed_on, value, symbol,
                             source_record_id, published_at) VALUES (?, ?, ?, ?, ?, ?)
                           ON CONFLICT(series_id, observed_on) DO UPDATE SET
                             value=excluded.value, symbol=excluded.symbol,
                             source_record_id=excluded.source_record_id,
                             published_at=excluded.published_at""",
                        (series_id, row["date"], row["close"], symbol, ins_code, fetched),
                    )
            connection.execute("UPDATE sources SET last_success_at = ? WHERE id = ?", (fetched, SOURCE_ID))
            connection.execute(
                """UPDATE ingestion_runs SET status='success', finished_at=?,
                   rows_received=?, rows_accepted=? WHERE id=?""",
                (fetched, len(raw) + len(adjusted), len(raw) + len(adjusted), run_id),
            )
        return {"ins_code": ins_code, "symbol": symbol, "raw": len(raw), "adjusted": len(adjusted), "fetched_at": fetched}
    except Exception as exc:
        with database() as connection:
            connection.execute(
                "UPDATE ingestion_runs SET status='failed', finished_at=?, error_message=? WHERE id=?",
                (datetime.now(timezone.utc).isoformat(), str(exc)[:1000], run_id),
            )
        raise


def parse_index_history(payload: dict) -> list[dict]:
    data = payload.get("indexB2")
    if not isinstance(data, list) or not data:
        raise ValueError("TSETMC index response has no indexB2 rows")
    rows = {}
    for entry in data:
        if not isinstance(entry, dict):
            raise ValueError("Invalid TSETMC index row")
        observed = date_iso(entry.get("dEven"))
        value = number(entry.get("xNivInuClMresIbs"), required=True)
        if value <= 0:
            raise ValueError("TSETMC index value must be positive")
        rows[observed] = {
            "date": observed,
            "value": value,
            "raw_payload": json.dumps(entry, ensure_ascii=False, separators=(",", ":")),
        }
    return [rows[date] for date in sorted(rows)]


def fetch_index_history(ins_code: str) -> dict:
    response = requests.get(
        INDEX_URL.format(code=ins_code),
        headers={"User-Agent": "EcoNotes/0.2 (local historical index research)"},
        timeout=25,
    )
    response.raise_for_status()
    payload = response.json()
    parse_index_history(payload)
    return payload


def import_indices() -> dict:
    started = datetime.now(timezone.utc).isoformat()
    with database() as connection:
        connection.execute(
            """INSERT INTO sources (id, name, homepage, retrieval_method) VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET name=excluded.name, homepage=excluded.homepage,
                 retrieval_method=excluded.retrieval_method""",
            (SOURCE_ID, "شرکت مدیریت فناوری بورس تهران · شاخص‌ها", "https://www.tsetmc.com/",
             "Public daily historical index API"),
        )
    imported = 0
    accepted = 0
    latest = {}
    for series_id, definition in INDEX_SERIES.items():
        run_started = datetime.now(timezone.utc).isoformat()
        with database() as connection:
            run_id = connection.execute(
                "INSERT INTO ingestion_runs (source_id, ins_code, started_at, status) VALUES (?, ?, ?, 'running')",
                (SOURCE_ID, definition["ins_code"], run_started),
            ).lastrowid
        try:
            rows = parse_index_history(fetch_index_history(definition["ins_code"]))
            fetched_at = datetime.now(timezone.utc).isoformat()
            with database() as connection:
                connection.execute(
                    """INSERT INTO series (id, title, description, group_id, unit, frequency,
                                            source_id, status, display_order, last_checked_at)
                       VALUES (?, ?, ?, 'markets', 'واحد', 'daily', ?, 'active', ?, ?)
                       ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
                         group_id='markets', unit='واحد', frequency='daily', source_id=excluded.source_id,
                         status='active', display_order=excluded.display_order, last_checked_at=excluded.last_checked_at""",
                    (series_id, definition["title"], definition["description"], SOURCE_ID,
                     definition["display_order"], fetched_at),
                )
                for row in rows:
                    connection.execute(
                        """INSERT INTO observations (series_id, observed_on, value, symbol,
                                    source_record_id, published_at) VALUES (?, ?, ?, NULL, ?, ?)
                           ON CONFLICT(series_id, observed_on) DO UPDATE SET value=excluded.value,
                             source_record_id=excluded.source_record_id, published_at=excluded.published_at""",
                        (series_id, row["date"], row["value"], definition["ins_code"], fetched_at),
                    )
                connection.execute(
                    """UPDATE ingestion_runs SET status='success', finished_at=?,
                       rows_received=?, rows_accepted=? WHERE id=?""",
                    (fetched_at, len(rows), len(rows), run_id),
                )
            imported += 1
            accepted += len(rows)
            latest[series_id] = rows[-1]["date"]
        except Exception as exc:
            with database() as connection:
                connection.execute(
                    "UPDATE ingestion_runs SET status='failed', finished_at=?, error_message=? WHERE id=?",
                    (datetime.now(timezone.utc).isoformat(), str(exc)[:1000], run_id),
                )
            raise
    fetched_at = datetime.now(timezone.utc).isoformat()
    with database() as connection:
        connection.execute("UPDATE sources SET last_success_at=? WHERE id=?", (fetched_at, SOURCE_ID))
    return {"series": imported, "observations": accepted, "latest": latest, "fetched_at": fetched_at}


def main() -> None:
    parser = argparse.ArgumentParser(description="Import one TSETMC instrument into local SQLite")
    parser.add_argument("ins_code", help="TSETMC numeric instrument code")
    parser.add_argument("--symbol", required=True, help="Ticker shown in the dashboard")
    parser.add_argument("--name", required=True, help="Full instrument name")
    args = parser.parse_args()
    print(json.dumps(import_instrument(args.ins_code, args.symbol, args.name), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
