"""Import local 18K gold and global gold-ounce daily history for the local dashboard."""

from __future__ import annotations

import json
import math
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from html.parser import HTMLParser
from zoneinfo import ZoneInfo

import requests

from .db import database

SOURCE_ID = "tgju-metals"
LOCAL_SYMBOL = "geram18"
LOCAL_API = f"https://api.tgju.org/v1/market/indicator/summary-table-data/{LOCAL_SYMBOL}"
GLOBAL_API = "https://api.tgju.org/v1/market/indicator/summary-table-data/ons"
GLOBAL_HISTORY = "https://tgju.live/profile/ons/history"
PAGE_SIZE = 500
GLOBAL_PAGE_SIZE = 5000
MIN_LOCAL_HISTORY_ROWS = 3000
MIN_LOCAL_HISTORY_DATE = "2014-01-01"
MIN_GLOBAL_HISTORY_ROWS = 10000
MIN_GLOBAL_HISTORY_DATE = "1980-01-01"
TEHRAN = ZoneInfo("Asia/Tehran")


class _HistoryTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._tables = 0
        self._in_table = False
        self._in_row = False
        self._in_cell = False
        self._text = ""
        self._row: list[str] = []
        self.rows: list[list[str]] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag == "table":
            self._tables += 1
            if self._tables == 1:
                self._in_table = True
        elif self._in_table and tag == "tr":
            self._in_row = True
            self._row = []
        elif self._in_row and tag in {"th", "td"}:
            self._in_cell = True
            self._text = ""

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            self._text += data

    def handle_endtag(self, tag: str) -> None:
        if self._in_cell and tag in {"th", "td"}:
            self._row.append(" ".join(self._text.split()))
            self._in_cell = False
        elif self._in_row and tag == "tr":
            if self._row:
                self.rows.append(self._row)
            self._in_row = False
        elif tag == "table" and self._in_table:
            self._in_table = False


def _ascii_digits(value: str) -> str:
    return value.translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"))


def _number(value: object) -> float:
    text = _ascii_digits(str(value)).replace(",", "").replace("٬", "").strip()
    text = re.sub(r"[^0-9.+-]", "", text)
    parsed = float(text)
    if not math.isfinite(parsed):
        raise ValueError("Non-finite TGJU value")
    return parsed


def _iso_date(value: object) -> str:
    text = _ascii_digits(str(value)).strip().replace("/", "-")
    return datetime.strptime(text, "%Y-%m-%d").date().isoformat()


def parse_local_gold_payload(payload: dict) -> list[dict]:
    data = payload.get("data")
    if not isinstance(data, list) or not data:
        raise ValueError("TGJU local-gold response has no data rows")
    rows = {}
    for entry in data:
        if not isinstance(entry, list) or len(entry) < 8:
            raise ValueError("Invalid TGJU local-gold row")
        # The public history table is Rial per gram; EcoNotes stores Toman.
        date = _iso_date(entry[6])
        value = _number(entry[3]) / 10
        if value <= 0:
            raise ValueError("TGJU local-gold quote must be positive")
        rows[date] = {"date": date, "value": value}
    return [rows[date] for date in sorted(rows)]


def validate_local_gold_history(rows: list[dict]) -> list[dict]:
    """Fail closed if the standard TGJU archive unexpectedly becomes truncated."""
    if (
        len(rows) < MIN_LOCAL_HISTORY_ROWS
        or not rows
        or rows[0]["date"] > MIN_LOCAL_HISTORY_DATE
    ):
        raise ValueError("TGJU local-gold history is unexpectedly short")
    return rows


def parse_global_gold_html(document: str) -> list[dict]:
    parser = _HistoryTableParser()
    parser.feed(document)
    if len(parser.rows) < 2:
        raise ValueError("TGJU global-gold history table has no data rows")
    rows = {}
    for cells in parser.rows[1:]:
        if len(cells) == 1 and cells[0] == "موردی یافت نشد.":
            continue
        if len(cells) < 6:
            raise ValueError("Invalid TGJU global-gold table row")
        date = _iso_date(cells[1])
        value = _number(cells[5])
        if value <= 0:
            raise ValueError("TGJU global-gold quote must be positive")
        rows[date] = {"date": date, "value": value}
    return [rows[date] for date in sorted(rows)]


def parse_global_gold_payload(payload: dict) -> list[dict]:
    data = payload.get("data")
    if not isinstance(data, list):
        raise ValueError("TGJU global-gold response has no data rows")
    rows = {}
    for entry in data:
        if not isinstance(entry, list) or len(entry) < 8:
            raise ValueError("Invalid TGJU global-gold API row")
        # TGJU's summary endpoint uses OHLC fields followed by the Gregorian date.
        date = _iso_date(entry[6])
        value = _number(entry[3])
        if value <= 0:
            raise ValueError("TGJU global-gold quote must be positive")
        rows[date] = {"date": date, "value": value}
    return [rows[date] for date in sorted(rows)]


def validate_global_gold_history(rows: list[dict]) -> list[dict]:
    """Fail closed if the archive unexpectedly shrinks to only recent observations."""
    if (
        len(rows) < MIN_GLOBAL_HISTORY_ROWS
        or not rows
        or rows[0]["date"] > MIN_GLOBAL_HISTORY_DATE
    ):
        raise ValueError("TGJU global-gold history is unexpectedly short")
    return rows


def fetch_local_gold() -> list[dict]:
    session = requests.Session()
    session.headers.update({"User-Agent": "EcoNotes/0.2 (local historical market research)"})
    rows: dict[str, dict] = {}
    start = 0
    draw = 1
    while True:
        response = session.get(LOCAL_API, params={
            "lang": "fa", "order_dir": "asc", "draw": draw,
            "start": start, "length": PAGE_SIZE,
        }, timeout=30)
        response.raise_for_status()
        payload = response.json()
        page = parse_local_gold_payload(payload)
        rows.update({row["date"]: row for row in page})
        if len(page) < PAGE_SIZE or start + len(page) >= int(payload.get("recordsFiltered", len(page))):
            break
        start += len(page)
        draw += 1
    return [rows[date] for date in sorted(rows)]


def fetch_global_gold() -> list[dict]:
    session = requests.Session()
    session.headers.update({"User-Agent": "EcoNotes/0.2 (local historical market research)"})
    rows: dict[str, dict] = {}
    start = 0
    draw = 1
    expected_total = None
    while expected_total is None or start < expected_total:
        response = session.get(GLOBAL_API, params={
            "lang": "fa", "order_dir": "asc", "draw": draw,
            "start": start, "length": GLOBAL_PAGE_SIZE,
        }, timeout=30)
        response.raise_for_status()
        payload = response.json()
        page = parse_global_gold_payload(payload)
        if not page:
            raise ValueError("TGJU global-gold archive stopped before its advertised end")
        rows.update({row["date"]: row for row in page})
        if expected_total is None:
            expected_total = int(payload.get("recordsFiltered", 0))
            if expected_total < MIN_GLOBAL_HISTORY_ROWS:
                raise ValueError("TGJU global-gold archive advertises too few observations")
        start += len(page)
        draw += 1
    return [rows[date] for date in sorted(rows)]


def import_metals() -> dict:
    started = datetime.now(TEHRAN).isoformat()
    with database() as connection:
        connection.execute(
            """INSERT INTO sources (id, name, homepage, retrieval_method) VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET name=excluded.name, homepage=excluded.homepage,
                 retrieval_method=excluded.retrieval_method""",
            (SOURCE_ID, "TGJU · آرشیو استاندارد طلای داخلی و انس جهانی", "https://www.tgju.org/",
             "TGJU public daily history; local gold symbol geram18 (IRR/10 to toman); global ounce is an XAU/USD spot proxy, not the LBMA fixing"),
        )
        run_id = connection.execute(
            "INSERT INTO ingestion_runs (source_id, started_at, status) VALUES (?, ?, 'running')",
            (SOURCE_ID, started),
        ).lastrowid
    try:
        local_rows = validate_local_gold_history(fetch_local_gold())
        world_rows = validate_global_gold_history(fetch_global_gold())
        today = datetime.now(TEHRAN).date().isoformat()
        local_rows = [row for row in local_rows if row["date"] < today]
        world_rows = [row for row in world_rows if row["date"] < today]
        if not local_rows or not world_rows:
            raise ValueError("TGJU returned no completed local or global gold observations")
        fetched_at = datetime.now(TEHRAN).isoformat()
        definitions = {
            "gold": {
                "title": "طلای ۱۸ عیار · بازار داخلی",
                "description": "قیمت پایانی هر گرم طلای ۱۸ عیار/۷۵۰ از آرشیو استاندارد TGJU (نماد geram18)؛ قیمت ریالی به تومان تبدیل شده است.",
                "unit": "تومان / گرم", "display_order": 10, "rows": local_rows,
            },
            "gold-world": {
                "title": "انس جهانی طلا · XAU/USD",
                "description": "قیمت پایانی روزانه انس جهانی طلا به دلار از آرشیو کامل TGJU؛ نمای بازار spot است و fixing رسمی LBMA نیست.",
                "unit": "دلار / اونس تروا", "display_order": 11, "rows": world_rows,
            },
        }
        accepted = 0
        latest = {}
        preserved_legacy_observations = {}
        with database() as connection:
            for series_id, definition in definitions.items():
                connection.execute(
                    """INSERT INTO series (id, title, description, group_id, unit, frequency,
                                            source_id, status, display_order, last_checked_at)
                       VALUES (?, ?, ?, 'metals', ?, 'daily', ?, 'active', ?, ?)
                       ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
                         group_id='metals', unit=excluded.unit, frequency='daily', source_id=excluded.source_id,
                         status='active', display_order=excluded.display_order, last_checked_at=excluded.last_checked_at""",
                    (series_id, definition["title"], definition["description"], definition["unit"],
                     SOURCE_ID, definition["display_order"], fetched_at),
                )
                if series_id in {"gold", "gold-world"}:
                    canonical_dates = {row["date"] for row in definition["rows"]}
                    existing_dates = connection.execute(
                        "SELECT observed_on FROM observations WHERE series_id=?", (series_id,)
                    ).fetchall()
                    preserved_legacy_observations[series_id] = sum(
                        row["observed_on"] not in canonical_dates for row in existing_dates
                    )
                for row in definition["rows"]:
                    connection.execute(
                        """INSERT INTO observations (series_id, observed_on, value, symbol,
                                    source_record_id, published_at) VALUES (?, ?, ?, NULL, ?, ?)
                           ON CONFLICT(series_id, observed_on) DO UPDATE SET value=excluded.value,
                             source_record_id=excluded.source_record_id, published_at=excluded.published_at""",
                        (series_id, row["date"], row["value"], row["date"], fetched_at),
                    )
                accepted += len(definition["rows"])
                latest[series_id] = definition["rows"][-1]["date"]
            connection.execute(
                """UPDATE ingestion_runs SET status='success', finished_at=?,
                   rows_received=?, rows_accepted=? WHERE id=?""",
                (fetched_at, accepted, accepted, run_id),
            )
            connection.execute("UPDATE sources SET last_success_at=? WHERE id=?", (fetched_at, SOURCE_ID))
        return {
            "series": len(definitions), "observations": accepted, "latest": latest,
            "preserved_legacy_observations": preserved_legacy_observations,
            "fetched_at": fetched_at,
        }
    except Exception as exc:
        with database() as connection:
            connection.execute(
                "UPDATE ingestion_runs SET status='failed', finished_at=?, error_message=? WHERE id=?",
                (datetime.now(TEHRAN).isoformat(), str(exc)[:1000], run_id),
            )
        raise
