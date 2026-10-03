"""Read-only API for source-attributed market and macroeconomic series."""

from __future__ import annotations

import os
import sqlite3
from datetime import date

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .db import database

app = FastAPI(title="EcoNotes Data API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("WEB_ORIGINS", os.getenv("WEB_ORIGIN", "http://127.0.0.1:3000")).split(",") if origin.strip()] + ["http://localhost:3000"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def encode(row: sqlite3.Row) -> dict:
    return dict(row)


def public_metadata(item: dict) -> dict:
    if item["id"] == "usd-free-wallex":
        item.update(id="usd-free", title="دلار آزاد · نمای تتر والکس",
                    description="قیمت بسته‌شدن روزانه USDT در برابر تومان در والکس؛ تنها منبع نمای دلار آزاد در EcoNotes. این سری نمای تتر است و نرخ نقدی اسکناس نیست.")
    return item


def public_series_filter() -> str:
    return """s.group_id != 'stocks'
        AND s.id NOT IN ('usd-free', 'usd-free-cbi-recent',
                         'usd-free-cbi-history', 'interbank', 'reer')
        AND (s.group_id != 'markets' OR s.id IN ('tedpix', 'equal'))"""


@app.get("/api/v1/health")
def health() -> dict:
    with database() as connection:
        count = connection.execute("SELECT COUNT(*) FROM market_prices").fetchone()[0]
    return {"status": "ok", "database": "sqlite", "market_rows": count}


@app.get("/api/v1/catalog")
def catalog(group: str | None = None) -> dict:
    with database() as connection:
        rows = connection.execute(
            f"""SELECT s.id, s.title, s.description, s.group_id AS "group", s.unit,
                      s.frequency, s.source_id, s.status, s.last_checked_at
               FROM series s WHERE (? IS NULL OR s.group_id = ?) AND {public_series_filter()}
               ORDER BY s.display_order, s.id""",
            (group, group),
        ).fetchall()
    return {"items": [public_metadata(encode(row)) for row in rows]}


@app.get("/api/v1/dashboard-data")
def dashboard_data(limit: int = Query(20000, ge=1, le=20000)) -> dict:
    """Load the consistently curated public dataset in one bounded API response."""
    with database() as connection:
        metadata = connection.execute(
            f"""SELECT s.* FROM series s WHERE {public_series_filter()}
                AND EXISTS (SELECT 1 FROM observations o WHERE o.series_id=s.id)
                ORDER BY s.display_order,s.id"""
        ).fetchall()
        ids = [row["id"] for row in metadata]
        if not ids:
            return {"items": []}
        placeholders = ",".join("?" for _ in ids)
        rows = connection.execute(
            f"""SELECT series_id AS id, observed_on AS date, value, symbol, published_at,
                       source_record_id FROM observations WHERE series_id IN ({placeholders})
                ORDER BY series_id,observed_on DESC""", ids,
        ).fetchall()
    grouped: dict[str, list[dict]] = {series_id: [] for series_id in ids}
    for row in rows:
        group = grouped[row["id"]]
        if len(group) < limit:
            group.append({key: value for key, value in dict(row).items() if key != "id"})
    items = []
    for item in metadata:
        data = encode(item)
        stored_id = data["id"]
        items.append({"series": public_metadata(data), "points": list(reversed(grouped[stored_id]))})
    return {"items": items, "count": len(items)}


@app.get("/api/v1/series/{series_id}")
def get_series(
    series_id: str,
    start: date | None = None,
    end: date | None = None,
    limit: int = Query(2000, ge=1, le=20000),
) -> dict:
    # Keep archived providers intact; the public dollar identifier has one owner.
    stored_id = "usd-free-wallex" if series_id == "usd-free" else series_id
    with database() as connection:
        item = connection.execute(
            f"SELECT s.* FROM series s WHERE s.id = ? AND {public_series_filter()}",
            (stored_id,),
        ).fetchone()
        if item is None:
            raise HTTPException(status_code=404, detail="Series not found")
        rows = connection.execute(
            """SELECT observed_on AS date, value, symbol, published_at, source_record_id
               FROM observations
               WHERE series_id = ? AND (? IS NULL OR observed_on >= ?)
                 AND (? IS NULL OR observed_on <= ?)
               ORDER BY observed_on DESC LIMIT ?""",
            (stored_id, str(start) if start else None, str(start) if start else None,
             str(end) if end else None, str(end) if end else None, limit),
        ).fetchall()
    return {"series": public_metadata(encode(item)), "points": [encode(row) for row in reversed(rows)]}


@app.get("/api/v1/market")
def market_catalog() -> dict:
    with database() as connection:
        rows = connection.execute(
            """SELECT id, title, description, status, last_checked_at
               FROM series WHERE id IN ('tedpix','equal') ORDER BY display_order"""
        ).fetchall()
    return {"items": [encode(row) for row in rows], "coverage": "شاخص کل و شاخص هم‌وزن؛ بدون پوشش انتخابی نمادها"}


@app.get("/api/v1/bonds")
def bond_snapshot() -> dict:
    with database() as connection:
        source = connection.execute(
            "SELECT last_success_at FROM sources WHERE id='ifb-ytm'"
        ).fetchone()
        historical_rows = connection.execute(
            """SELECT i.source_instrument_id AS instrument_id, i.ticker, i.security_title,
                      i.bond_type, h.observed_on AS last_traded_date,
                      h.jalali_observed_on AS jalali_last_traded_date,
                      h.last_traded_price AS price, h.maturity_on AS maturity_date,
                      h.jalali_maturity_on AS jalali_maturity_date, h.ytm,
                      NULL AS simple_return, h.fetched_at AS snapshot_at
               FROM bond_instruments i JOIN bond_market_history h
                 ON h.source_instrument_id=i.source_instrument_id
               WHERE i.bond_type='treasury' AND (i.ticker LIKE 'اخزا%' OR i.ticker LIKE 'سخاب%')
                 AND h.observed_on=(SELECT MAX(h2.observed_on) FROM bond_market_history h2
                                    WHERE h2.source_instrument_id=i.source_instrument_id)
               ORDER BY i.ticker"""
        ).fetchall()
        historical_bonds = [encode(row) for row in historical_rows]
        if source is None or source["last_success_at"] is None:
            return {"snapshot_at": None, "risk_free": None, "bonds": [],
                    "historical_bonds": historical_bonds}
        snapshot_at = source["last_success_at"]
        rows = connection.execute(
            """SELECT i.source_instrument_id AS instrument_id, i.ticker, i.security_title,
                      i.bond_type, o.observed_on AS last_traded_date,
                      o.jalali_observed_on AS jalali_last_traded_date,
                      o.last_traded_price AS price, o.maturity_on AS maturity_date,
                      o.jalali_maturity_on AS jalali_maturity_date, o.ytm,
                      o.simple_return, o.fetched_at AS snapshot_at
               FROM bond_instruments i JOIN bond_yield_observations o
                 ON o.source_instrument_id = i.source_instrument_id
               WHERE i.last_seen_at = ? AND o.fetched_at = ?
               ORDER BY o.maturity_on, i.ticker""",
            (snapshot_at, snapshot_at),
        ).fetchall()
    bonds = [encode(row) for row in rows]
    treasury = [bond for bond in bonds if bond["bond_type"] == "treasury"
                and ("اخزا" in bond["ticker"] or "سخاب" in bond["ticker"])]
    latest_date = max((bond["last_traded_date"] for bond in treasury), default=None)
    latest_treasury = [bond for bond in treasury if bond["last_traded_date"] == latest_date]
    risk_free = None
    if latest_treasury:
        risk_free = {
            "value": sum(bond["ytm"] for bond in latest_treasury) / len(latest_treasury),
            "count": len(latest_treasury),
            "date": latest_date,
            "jalali_date": latest_treasury[0]["jalali_last_traded_date"],
        }
    return {"snapshot_at": snapshot_at, "risk_free": risk_free, "bonds": bonds,
            "historical_bonds": historical_bonds}


@app.get("/api/v1/bonds/{instrument_id}/history")
def bond_history(
    instrument_id: str,
    start: date | None = None,
    end: date | None = None,
    limit: int = Query(5000, ge=1, le=20000),
) -> dict:
    if not (instrument_id.isascii() and instrument_id.isdigit() and 1 <= len(instrument_id) <= 20):
        raise HTTPException(status_code=400, detail="Invalid Treasury instrument id")
    with database() as connection:
        instrument = connection.execute(
            "SELECT source_instrument_id, ticker, security_title FROM bond_instruments WHERE source_instrument_id=?",
            (instrument_id,),
        ).fetchone()
        if instrument is None:
            raise HTTPException(status_code=404, detail="Bond instrument not found")
        rows = connection.execute(
            """SELECT h.observed_on AS date, h.jalali_observed_on,
                      h.last_traded_price AS price, h.maturity_on, h.jalali_maturity_on,
                      h.ytm AS value, h.volume, h.traded_value, h.tsetmc_ins_code, h.fetched_at,
                      i.ticker || ' · قیمت ' || CAST(h.last_traded_price AS INTEGER) || ' ریال' AS symbol
               FROM bond_market_history h JOIN bond_instruments i
                 ON i.source_instrument_id=h.source_instrument_id
               WHERE h.source_instrument_id=?
                 AND (? IS NULL OR h.observed_on >= ?) AND (? IS NULL OR h.observed_on <= ?)
               ORDER BY h.observed_on DESC LIMIT ?""",
            (instrument_id, str(start) if start else None, str(start) if start else None,
             str(end) if end else None, str(end) if end else None, limit),
        ).fetchall()
    return {
        "instrument": encode(instrument),
        "method": "TSETMC transaction close; compound annualized zero-coupon yield, 365-day basis",
        "points": [encode(row) for row in reversed(rows)],
    }


@app.get("/api/v1/market/{ins_code}")
def market_history(ins_code: str, limit: int = Query(2000, ge=1, le=10000)) -> dict:
    del ins_code, limit
    raise HTTPException(status_code=404, detail="This release publishes TEDPIX and equal-weight indices only")


@app.get("/api/v1/events")
def published_events() -> dict:
    with database() as connection:
        rows = connection.execute(
            """SELECT id, title, starts_on, ends_on, source_url, event_type, status
               FROM events WHERE status = 'published' ORDER BY starts_on DESC"""
        ).fetchall()
    return {"items": [encode(row) for row in rows]}
