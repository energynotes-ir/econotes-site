"""Import current IFB fixed-income YTM tables and keep a local daily history."""

from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime, timezone
from html.parser import HTMLParser

import requests
from persiantools.jdatetime import JalaliDate

from .db import database

URL = "https://ifb.ir/YTM.aspx"
SOURCE_ID = "ifb-ytm"
TABLES = {
    "ContentPlaceHolder1_grdytmforkhazaneh": "treasury",
    "ContentPlaceHolder1_grdytm": "coupon",
}
PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


class _IFBTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.table_id: str | None = None
        self.rows: dict[str, list[list[dict[str, str | None]]]] = {key: [] for key in TABLES}
        self.row: list[dict[str, str | None]] | None = None
        self.cell: dict[str, str | None] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "table" and attributes.get("id") in TABLES:
            self.table_id = str(attributes["id"])
        elif self.table_id and tag == "tr":
            self.row = []
        elif self.table_id and self.row is not None and tag in ("td", "th"):
            self.cell = {"text": "", "instrument_id": None, "security_title": None}
        elif self.table_id and self.cell is not None and tag == "a":
            # HTMLParser normalizes attribute names to lowercase.
            self.cell["instrument_id"] = attributes.get("symid")
            self.cell["security_title"] = attributes.get("title")

    def handle_data(self, data: str) -> None:
        if self.cell is not None:
            self.cell["text"] = str(self.cell["text"]) + data

    def handle_endtag(self, tag: str) -> None:
        if self.table_id and self.cell is not None and tag in ("td", "th"):
            self.cell["text"] = re.sub(r"\s+", " ", str(self.cell["text"])).strip()
            assert self.row is not None
            self.row.append(self.cell)
            self.cell = None
        elif self.table_id and tag == "tr" and self.row is not None:
            self.rows[self.table_id].append(self.row)
            self.row = None
        elif self.table_id and tag == "table":
            self.table_id = None


def _parse_number(value: str, *, percent: bool = False) -> float:
    normalized = value.translate(PERSIAN_DIGITS).replace(",", "").replace("٬", "").replace("٪", "%")
    normalized = normalized.strip().replace("%", "").replace("/", ".")
    number = float(normalized)
    if not math.isfinite(number):
        raise ValueError("IFB returned a nonfinite numeric value")
    return number


def _parse_date(value: str) -> tuple[str, str]:
    normalized = value.translate(PERSIAN_DIGITS).strip().replace("/", "-")
    parts = normalized.split("-")
    if len(parts) != 3:
        raise ValueError("IFB returned an invalid Jalali date")
    jalali = JalaliDate(*(int(part) for part in parts))
    return jalali.to_gregorian().isoformat(), jalali.strftime("%Y-%m-%d")


def parse_tables(html: str) -> list[dict]:
    parser = _IFBTableParser()
    parser.feed(html)
    result: list[dict] = []
    for table_id, bond_type in TABLES.items():
        rows = parser.rows[table_id]
        if len(rows) < 2:
            raise ValueError(f"IFB YTM table {table_id} is missing or empty")
        headers = [str(cell["text"]) for cell in rows[0]]
        expected = ("نماد", "قیمت معامله شده هر ورقه", "تاریخ آخرین روز معاملاتی", "تاریخ سررسید", "YTM")
        if not all(any(term in heading for heading in headers) for term in expected):
            raise ValueError(f"IFB YTM table {table_id} has an unexpected header")
        for row in rows[1:]:
            if len(row) < 6:
                continue
            symbol_cell = row[1]
            ticker = str(symbol_cell["text"] or "").strip()
            instrument_id = str(symbol_cell["instrument_id"] or "").strip()
            ytm_text = str(row[5]["text"] or "").strip()
            if not ticker or not instrument_id.isascii() or not instrument_id.isdigit():
                continue
            if not ytm_text or "سررسید شده" in ytm_text:
                continue
            if bond_type == "treasury" and len(row) < 7:
                continue
            last_traded_on, jalali_last_traded_on = _parse_date(str(row[3]["text"] or ""))
            maturity_on, jalali_maturity_on = _parse_date(str(row[4]["text"] or ""))
            ytm = _parse_number(ytm_text, percent=True)
            if ytm <= 0 or maturity_on < last_traded_on:
                continue
            price = _parse_number(str(row[2]["text"] or ""))
            simple_text = str(row[6]["text"] or "").strip() if bond_type == "treasury" else ""
            simple_return = _parse_number(simple_text, percent=True) if simple_text and "سررسید شده" not in simple_text else None
            result.append({
                "instrument_id": instrument_id,
                "ticker": ticker,
                "security_title": str(symbol_cell["security_title"] or ticker),
                "bond_type": bond_type,
                "last_traded_on": last_traded_on,
                "jalali_last_traded_on": jalali_last_traded_on,
                "maturity_on": maturity_on,
                "jalali_maturity_on": jalali_maturity_on,
                "last_traded_price": price,
                "ytm": ytm,
                "simple_return": simple_return,
                "raw_payload": json.dumps({
                    "ticker": ticker, "security_title": symbol_cell["security_title"],
                    "last_traded_price": row[2]["text"], "last_traded_on": row[3]["text"],
                    "maturity_on": row[4]["text"], "ytm": ytm_text,
                    "simple_return": simple_text or None,
                }, ensure_ascii=False, separators=(",", ":")),
            })
    if not any(row["bond_type"] == "treasury" for row in result):
        raise ValueError("IFB YTM page returned no active Treasury bills")
    if not any(row["bond_type"] == "coupon" for row in result):
        raise ValueError("IFB YTM page returned no active coupon bonds")
    return result


def fetch_bonds() -> list[dict]:
    response = requests.get(URL, headers={"User-Agent": "Mozilla/5.0 (compatible; EcoNotes/0.2)"}, timeout=45)
    response.raise_for_status()
    return parse_tables(response.text)


def import_yields() -> dict:
    started_at = datetime.now(timezone.utc).isoformat()
    with database() as connection:
        connection.execute(
            """INSERT INTO sources (id, name, homepage, retrieval_method) VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET name=excluded.name, homepage=excluded.homepage,
                 retrieval_method=excluded.retrieval_method""",
            (SOURCE_ID, "فرابورس ایران · بازده تا سررسید اوراق", URL, "Public IFB YTM tables"),
        )
        run_id = connection.execute(
            "INSERT INTO ingestion_runs (source_id, started_at, status) VALUES (?, ?, 'running')",
            (SOURCE_ID, started_at),
        ).lastrowid
    try:
        bonds = fetch_bonds()
        treasury = [row for row in bonds if row["bond_type"] == "treasury" and re.search(r"اخزا|سخاب", row["ticker"])]
        latest_date = max(row["last_traded_on"] for row in treasury)
        same_day = [row for row in treasury if row["last_traded_on"] == latest_date]
        average_ytm = sum(row["ytm"] for row in same_day) / len(same_day)
        simple_values = [row["simple_return"] for row in same_day if row["simple_return"] is not None]
        average_simple = sum(simple_values) / len(simple_values) if simple_values else None
        jalali_date = next(row["jalali_last_traded_on"] for row in same_day)
        record_hash = hashlib.sha256("|".join(sorted(row["instrument_id"] for row in same_day)).encode()).hexdigest()
        fetched_at = datetime.now(timezone.utc).isoformat()
        with database() as connection:
            for row in bonds:
                connection.execute(
                    """INSERT INTO bond_instruments (source_instrument_id, ticker, security_title, bond_type, last_seen_at)
                       VALUES (?, ?, ?, ?, ?) ON CONFLICT(source_instrument_id) DO UPDATE SET
                         ticker=excluded.ticker, security_title=excluded.security_title,
                         bond_type=excluded.bond_type, last_seen_at=excluded.last_seen_at""",
                    (row["instrument_id"], row["ticker"], row["security_title"], row["bond_type"], fetched_at),
                )
                connection.execute(
                    """INSERT INTO bond_yield_observations (source_instrument_id, observed_on, jalali_observed_on,
                           last_traded_price, maturity_on, jalali_maturity_on, ytm, simple_return, raw_payload, fetched_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(source_instrument_id, observed_on) DO UPDATE SET
                         jalali_observed_on=excluded.jalali_observed_on, last_traded_price=excluded.last_traded_price,
                         maturity_on=excluded.maturity_on, jalali_maturity_on=excluded.jalali_maturity_on,
                         ytm=excluded.ytm, simple_return=excluded.simple_return,
                         raw_payload=excluded.raw_payload, fetched_at=excluded.fetched_at""",
                    (row["instrument_id"], row["last_traded_on"], row["jalali_last_traded_on"],
                     row["last_traded_price"], row["maturity_on"], row["jalali_maturity_on"], row["ytm"],
                     row["simple_return"], row["raw_payload"], fetched_at),
                )
            connection.execute(
                """INSERT INTO series (id, title, description, group_id, unit, frequency, source_id,
                                        status, last_checked_at)
                   VALUES ('yield', 'بازده تا سررسید اخزا و سخاب',
                           'میانگین YTM اوراق بدون کوپن اخزا/سخاب که در آخرین تاریخ مشترک معامله شده‌اند.',
                           'rates', 'درصد سالانه', 'daily', ?, 'active', ?)
                   ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
                     group_id=excluded.group_id, unit=excluded.unit, frequency=excluded.frequency,
                     source_id=excluded.source_id, status='active', last_checked_at=excluded.last_checked_at""",
                (SOURCE_ID, fetched_at),
            )
            connection.execute(
                """INSERT INTO observations (series_id, observed_on, value, symbol, source_record_id, published_at)
                   VALUES ('yield', ?, ?, ?, ?, ?)
                   ON CONFLICT(series_id, observed_on) DO UPDATE SET value=excluded.value, symbol=excluded.symbol,
                     source_record_id=excluded.source_record_id, published_at=excluded.published_at""",
                (latest_date, average_ytm, f"میانگین {len(same_day)} نماد اخزا/سخاب", record_hash, fetched_at),
            )
            connection.execute("UPDATE sources SET last_success_at=? WHERE id=?", (fetched_at, SOURCE_ID))
            connection.execute(
                """UPDATE ingestion_runs SET status='success', finished_at=?, rows_received=?, rows_accepted=? WHERE id=?""",
                (fetched_at, len(bonds), len(bonds), run_id),
            )
        return {
            "bonds": len(bonds), "treasury_bonds": len(treasury), "last_trade_date": latest_date,
            "jalali_last_trade_date": jalali_date, "average_ytm": average_ytm,
            "average_simple_return": average_simple, "snapshot_at": fetched_at,
        }
    except Exception as exc:
        with database() as connection:
            connection.execute(
                "UPDATE ingestion_runs SET status='failed', finished_at=?, error_message=? WHERE id=?",
                (datetime.now(timezone.utc).isoformat(), str(exc)[:1000], run_id),
            )
        raise


if __name__ == "__main__":
    print(json.dumps(import_yields(), ensure_ascii=False, indent=2))
