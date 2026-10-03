"""Build a daily Treasury-bill YTM archive from TSETMC trade prices."""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import time
from collections import defaultdict
from datetime import date, datetime, timezone
from urllib.parse import quote

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from persiantools.jdatetime import JalaliDate

from .db import database
from .ingest_tse import parse_raw

SOURCE_ID = "ifb-ytm-history"
SOURCE_URL = "https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceDailyList/"
SEARCH_URL = "https://cdn.tsetmc.com/api/Instrument/GetInstrumentSearch/{}"
FACE_VALUE = 1_000_000.0
SEARCH_ROOTS = ("اخزا", "سخاب")
MAX_SEARCH_RESULTS = 40
MAX_SEARCH_REQUESTS = 300
PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
TREASURY_TICKER = re.compile(r"^(اخزا|سخاب)")
log = logging.getLogger(__name__)


def calculate_treasury_ytm(price: float, observed_on: str, maturity_on: str) -> float:
    """Annualize a zero-coupon bill's gross return on a 365-day compound basis."""
    if not math.isfinite(price) or price <= 0:
        raise ValueError("Treasury price must be finite and positive")
    days = (date.fromisoformat(maturity_on) - date.fromisoformat(observed_on)).days
    if days <= 0:
        raise ValueError("Treasury maturity must be after its price date")
    result = ((FACE_VALUE / price) ** (365.0 / days) - 1.0) * 100.0
    if not math.isfinite(result):
        raise ValueError("Treasury YTM calculation is nonfinite")
    return result


def _session() -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "User-Agent": "EcoNotes/0.4 (local historical macro research)",
        "Accept": "application/json",
    })
    session.mount("https://", HTTPAdapter(max_retries=Retry(
        total=2, backoff_factor=0.6, status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
    )))
    return session


def _search_records(session: requests.Session, query: str) -> list[dict]:
    response = session.get(SEARCH_URL.format(quote(query, safe="")), timeout=30)
    response.raise_for_status()
    payload = response.json()
    records = payload.get("instrumentSearch") if isinstance(payload, dict) else None
    if not isinstance(records, list):
        raise ValueError(f"TSETMC search response for {query!r} has an unexpected shape")
    return [row for row in records if isinstance(row, dict)]


def _normalise_title(value: str) -> str:
    return " ".join(value.translate(PERSIAN_DIGITS).replace("ي", "ی").replace("ك", "ک").split())


def _maturity_from_security_title(title: str) -> tuple[str, str]:
    """Read the Jalali YYMMDD or YYYYMMDD maturity suffix in TSETMC's bond title."""
    normalized = _normalise_title(title)
    match = re.search(r"(\d{6}|\d{8})\D*$", normalized)
    if not match:
        raise ValueError(f"Treasury security title has no Jalali maturity suffix: {title!r}")
    raw = match.group(1)
    if len(raw) == 6:
        short_year = int(raw[:2])
        year = (1300 + short_year) if short_year >= 50 else (1400 + short_year)
        month, day_number = int(raw[2:4]), int(raw[4:6])
    else:
        year, month, day_number = int(raw[:4]), int(raw[4:6]), int(raw[6:8])
    jalali = JalaliDate(year, month, day_number)
    return jalali.to_gregorian().isoformat(), jalali.strftime("%Y-%m-%d")


def _is_treasury_record(record: dict) -> bool:
    ticker = str(record.get("lVal18AFC") or "").strip()
    title = _normalise_title(str(record.get("lVal30") or ""))
    market = _normalise_title(str(record.get("flowTitle") or ""))
    code = str(record.get("insCode") or "").strip()
    return bool(
        TREASURY_TICKER.match(ticker)
        and "اسنادخزانه" in title.replace(" ", "")
        and "مشتقه" not in market
        and code.isascii()
        and code.isdigit()
    )


def _discover_treasury_instruments(
    session: requests.Session,
    current_bonds: list[dict],
) -> tuple[list[dict], list[str]]:
    """Search TSETMC recursively where its broad instrument search is capped."""
    queue = list(SEARCH_ROOTS)
    queued = set(queue)
    records_by_ticker: dict[str, dict] = {}
    errors: list[str] = []
    request_count = 0

    # Exact active IFB symbols are queried as well: broad search can omit newer issues.
    for bond in current_bonds:
        ticker = str(bond["ticker"]).strip()
        if TREASURY_TICKER.match(ticker) and ticker not in queued:
            queue.append(ticker)
            queued.add(ticker)

    while queue:
        query = queue.pop(0)
        request_count += 1
        if request_count > MAX_SEARCH_REQUESTS:
            raise ValueError("TSETMC Treasury search exceeded the safety limit")
        try:
            rows = _search_records(session, query)
        except Exception as exc:
            errors.append(f"search {query}: {exc}")
            continue
        time.sleep(0.15)
        for record in rows:
            if not _is_treasury_record(record):
                continue
            ticker = str(record["lVal18AFC"]).strip()
            code = str(record["insCode"]).strip()
            previous = records_by_ticker.get(ticker)
            if previous and str(previous["insCode"]) != code:
                raise ValueError(f"TSETMC returned conflicting instrument codes for {ticker}")
            records_by_ticker[ticker] = record

        # A saturated response is not a complete listing; split the symbol prefix.
        if len(rows) >= MAX_SEARCH_RESULTS and len(query) < 10:
            for digit in "0123456789":
                child = query + digit
                if child not in queued:
                    queue.append(child)
                    queued.add(child)

    if not records_by_ticker:
        raise ValueError("TSETMC returned no Treasury-bill instruments")

    current_by_ticker = {str(row["ticker"]).strip(): row for row in current_bonds}
    instruments: list[dict] = []
    for ticker, record in sorted(records_by_ticker.items()):
        title = str(record.get("lVal30") or ticker).strip()
        try:
            maturity_on, jalali_maturity_on = _maturity_from_security_title(title)
        except ValueError as exc:
            errors.append(f"maturity {ticker}: {exc}")
            continue
        current = current_by_ticker.get(ticker)
        if current:
            if current["maturity_on"] != maturity_on:
                errors.append(
                    f"IFB/TSETMC maturity mismatch for {ticker}: "
                    f"{current['jalali_maturity_on']} vs {jalali_maturity_on}"
                )
                # IFB's live terms are authoritative for a currently listed issue.
                maturity_on = current["maturity_on"]
                jalali_maturity_on = current["jalali_maturity_on"]
            instrument_id = str(current["instrument_id"])
            security_title = str(current["security_title"] or title)
            last_seen_at = str(current["last_seen_at"])
        else:
            instrument_id = str(record["insCode"])
            security_title = title
            last_seen_at = ""
        instruments.append({
            "instrument_id": instrument_id,
            "ticker": ticker,
            "security_title": security_title,
            "bond_type": "treasury",
            "tsetmc_ins_code": str(record["insCode"]),
            "maturity_on": maturity_on,
            "jalali_maturity_on": jalali_maturity_on,
            "last_seen_at": last_seen_at,
        })
    return instruments, errors


def _market_history(session: requests.Session, code: str) -> list[dict]:
    response = session.get(f"{SOURCE_URL}{code}/0", timeout=40)
    response.raise_for_status()
    payload = response.json()
    rows = parse_raw(payload)
    return [row for row in rows if max(row["volume"] or 0, row["traded_value"] or 0, row["trades"] or 0) > 0]


def _jalali_text(iso_date: str) -> str:
    return JalaliDate.to_jalali(date.fromisoformat(iso_date)).strftime("%Y-%m-%d")


def _current_treasury_bonds() -> list[dict]:
    with database() as connection:
        source = connection.execute(
            "SELECT last_success_at FROM sources WHERE id='ifb-ytm'"
        ).fetchone()
        if source is None or source["last_success_at"] is None:
            raise ValueError("Fetch the current IFB YTM table before importing its history")
        rows = connection.execute(
            """SELECT i.source_instrument_id AS instrument_id, i.ticker, i.security_title,
                      i.last_seen_at,
                      o.maturity_on, o.jalali_maturity_on
               FROM bond_instruments i JOIN bond_yield_observations o
                 ON o.source_instrument_id=i.source_instrument_id
               WHERE i.bond_type='treasury' AND (i.ticker LIKE 'اخزا%' OR i.ticker LIKE 'سخاب%')
                 AND i.last_seen_at=? AND o.fetched_at=?
               ORDER BY i.ticker""",
            (source["last_success_at"], source["last_success_at"]),
        ).fetchall()
    return [dict(row) for row in rows]


def import_yield_history() -> dict:
    started_at = datetime.now(timezone.utc).isoformat()
    with database() as connection:
        connection.execute(
            """INSERT INTO sources (id, name, homepage, retrieval_method) VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET name=excluded.name, homepage=excluded.homepage,
                 retrieval_method=excluded.retrieval_method""",
            (SOURCE_ID, "TSETMC · تاریخچهٔ اخزا و سخاب؛ فعال و سررسیدشده", "https://www.tsetmc.com/",
             "TSETMC daily trade prices for discovered Treasury-bill issues; compound annual YTM recalculated to IFB/TSETMC Jalali maturity"),
        )
        run_id = connection.execute(
            "INSERT INTO ingestion_runs (source_id, started_at, status) VALUES (?, ?, 'running')",
            (SOURCE_ID, started_at),
        ).lastrowid

    try:
        current_bonds = _current_treasury_bonds()
        if not current_bonds:
            raise ValueError("IFB page returned no active اخزا/سخاب instruments")
        session = _session()
        instruments, discovery_warnings = _discover_treasury_instruments(session, current_bonds)
        current_tickers = {str(row["ticker"]).strip() for row in current_bonds}
        discovered_tickers = {row["ticker"] for row in instruments}
        unmatched = sorted(current_tickers - discovered_tickers)
        history_rows: list[tuple] = []
        received = 0
        successful_instruments = 0
        history_errors: list[str] = []

        for instrument in instruments:
            try:
                market_rows = _market_history(session, instrument["tsetmc_ins_code"])
                successful_instruments += 1
                received += len(market_rows)
                for market_row in market_rows:
                    observed_on = market_row["date"]
                    if observed_on >= instrument["maturity_on"]:
                        continue
                    price = float(market_row["close"])
                    ytm = calculate_treasury_ytm(price, observed_on, instrument["maturity_on"])
                    raw = json.dumps({
                        "provider": "TSETMC",
                        "ins_code": instrument["tsetmc_ins_code"],
                        "ticker": instrument["ticker"],
                        "security_title": instrument["security_title"],
                        "price_row": json.loads(market_row["raw_payload"]),
                        "calculation": "((1000000 / pClosing) ** (365 / remaining_calendar_days) - 1) * 100",
                    }, ensure_ascii=False, separators=(",", ":"))
                    history_rows.append((
                        instrument["instrument_id"], instrument["tsetmc_ins_code"], observed_on,
                        _jalali_text(observed_on), price, instrument["maturity_on"],
                        instrument["jalali_maturity_on"], ytm, market_row["volume"] or 0,
                        market_row["traded_value"] or 0, raw,
                    ))
            except Exception as exc:
                history_errors.append(f"{instrument['ticker']}: {exc}")
            time.sleep(0.2)

        if not history_rows:
            raise ValueError("No traded daily prices were returned for discovered Treasury instruments")
        fetched_at = datetime.now(timezone.utc).isoformat()
        accepted = len(history_rows)
        warning_messages = discovery_warnings + history_errors
        if unmatched:
            warning_messages.append("Unmatched active IFB symbols: " + ", ".join(unmatched))

        with database() as connection:
            for instrument in instruments:
                connection.execute(
                    """INSERT INTO bond_instruments (source_instrument_id, ticker, security_title,
                               bond_type, last_seen_at) VALUES (?, ?, ?, 'treasury', ?)
                       ON CONFLICT(source_instrument_id) DO UPDATE SET ticker=excluded.ticker,
                         security_title=excluded.security_title, bond_type='treasury',
                         last_seen_at=excluded.last_seen_at""",
                    (instrument["instrument_id"], instrument["ticker"], instrument["security_title"],
                     instrument["last_seen_at"] or fetched_at),
                )
            connection.executemany(
                """INSERT INTO bond_market_history
                   (source_instrument_id, tsetmc_ins_code, observed_on, jalali_observed_on,
                    last_traded_price, maturity_on, jalali_maturity_on, ytm,
                    volume, traded_value, raw_payload, fetched_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(source_instrument_id, observed_on) DO UPDATE SET
                     tsetmc_ins_code=excluded.tsetmc_ins_code,
                     jalali_observed_on=excluded.jalali_observed_on,
                     last_traded_price=excluded.last_traded_price,
                     maturity_on=excluded.maturity_on,
                     jalali_maturity_on=excluded.jalali_maturity_on,
                     ytm=excluded.ytm, volume=excluded.volume,
                     traded_value=excluded.traded_value, raw_payload=excluded.raw_payload,
                     fetched_at=excluded.fetched_at""",
                [(*row, fetched_at) for row in history_rows],
            )

            # Rebuild every day from the full local archive so matured issues remain represented.
            archived_rows = connection.execute(
                """SELECT observed_on, source_instrument_id, ytm
                   FROM bond_market_history ORDER BY observed_on, source_instrument_id"""
            ).fetchall()
            daily_values: dict[str, list[float]] = defaultdict(list)
            daily_ids: dict[str, list[str]] = defaultdict(list)
            for row in archived_rows:
                daily_values[row["observed_on"]].append(float(row["ytm"]))
                daily_ids[row["observed_on"]].append(str(row["source_instrument_id"]))

            connection.execute(
                """INSERT INTO series (id, title, description, group_id, unit, frequency, source_id,
                                        status, parent_id, display_order, last_checked_at)
                   VALUES ('yield-history', 'میانگین تاریخی YTM اخزا و سخاب',
                           'میانگین روزانه YTM برآوردشده از قیمت پایانی همه نمادهای خزانهٔ کشف‌شده در TSETMC، شامل نمادهای سررسیدشده؛ ارزش اسمی ۱٬۰۰۰٬۰۰۰ ریال و سال مرکب ۳۶۵روزه. این برآورد با YTM زنده فرابورس یکی نیست.',
                           'rates', 'درصد سالانه', 'daily', ?, 'active', 'yield', 1, ?)
                   ON CONFLICT(id) DO UPDATE SET title=excluded.title,
                     description=excluded.description, group_id='rates', unit=excluded.unit,
                     frequency='daily', source_id=excluded.source_id, status='active',
                     parent_id='yield', last_checked_at=excluded.last_checked_at""",
                (SOURCE_ID, fetched_at),
            )
            for observed_on, values in sorted(daily_values.items()):
                instrument_ids = daily_ids[observed_on]
                record_hash = hashlib.sha256(
                    (observed_on + "|" + "|".join(instrument_ids)).encode()
                ).hexdigest()
                connection.execute(
                    """INSERT INTO observations (series_id, observed_on, value, symbol,
                             source_record_id, published_at)
                       VALUES ('yield-history', ?, ?, ?, ?, ?)
                       ON CONFLICT(series_id, observed_on) DO UPDATE SET value=excluded.value,
                         symbol=excluded.symbol, source_record_id=excluded.source_record_id,
                         published_at=excluded.published_at""",
                    (observed_on, sum(values) / len(values), f"{len(values)} نماد خزانه",
                     f"tsetmc-ytm-{record_hash}", fetched_at),
                )

            connection.execute("UPDATE sources SET last_success_at=? WHERE id=?", (fetched_at, SOURCE_ID))
            connection.execute(
                """UPDATE ingestion_runs SET status='success', finished_at=?,
                   rows_received=?, rows_accepted=?, error_message=? WHERE id=?""",
                (fetched_at, received, accepted, "; ".join(warning_messages)[:1000] or None, run_id),
            )
        return {
            "instruments_discovered": len(instruments),
            "instruments_with_history_response": successful_instruments,
            "instruments_matched_to_ifb": len(current_tickers.intersection(discovered_tickers)),
            "active_ifb_unmatched": unmatched,
            "warnings": warning_messages[:30],
            "observations_received": received,
            "observations_accepted": accepted,
            "aggregate_days": len(daily_values),
            "date_range": [min(daily_values), max(daily_values)],
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
    print(json.dumps(import_yield_history(), ensure_ascii=False, indent=2))
