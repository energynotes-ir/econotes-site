"""Import CBI monetary series republished in MEFA's public data bank."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser

import requests
from persiantools.jdatetime import JalaliDate

from .db import database
from .ingest_cbi import (
    CATEGORIES as LIQUIDITY_SERIES,
    UNIT,
    fetch_rows as fetch_cbi_liquidity_rows,
    parse_rows as parse_cbi_liquidity_rows,
)
from .ingest_cbi_base_money import BASE_MONEY_SERIES

SOURCE_ID = "mefa-monetary"
URL = "https://databank.mefa.ir/data"
SOURCE_UNIT = "میلیارد ریال"
NORMALIZATION_FACTOR = Decimal("1000")

# MEFA indicator IDs and the corresponding row titles in its published table.
# TSD factor rows with no figures on the MEFA page are intentionally retained
# under their prior CBI source rather than replaced with missing or estimated data.
MEFA_ROWS: dict[str, tuple[int, str]] = {
    "liquidity": (3809, "نقدینگی برحسب اجزای تشکیل‌دهنده آن"),
    "liquidity-supply": (3804, "نقدینگی برحسب عوامل موثر بر عرضه آن"),
    "money": (3801, "پول"),
    "quasi": (3796, "شبه پول"),
    "foreign-assets": (3805, "خالص دارایی‌های خارجی سیستم بانکی"),
    "government-debt": (3806, "خالص بدهی‌ بخش دولتی به سیستم بانکی"),
    "private-debt": (3807, "بدهی بخش غیردولتی به سیستم بانکی"),
    "other-liquidity": (3808, "خالص سایر اقلام"),
    "base-money": (3768, "پایه پولی برحسب منابع"),
    "base-net-foreign-assets": (3771, "خالص دارایی‌های خارجی بانک مرکزی"),
    "base-gross-foreign-assets": (3769, "دارایی‌های خارجی بانک مرکزی"),
    "base-foreign-liabilities": (3770, "بدهی‌های خارجی بانک مرکزی"),
    "base-net-government-liabilities": (3776, "خالص بدهی بخش دولتی به بانک مرکزی"),
    "base-government-debt": (3774, "بدهی بخش دولتی به بانک مرکزی"),
    "base-government-deposits": (3775, "سپرده‌های بخش دولتی نزد بانک مرکزی"),
    "base-bank-debt": (3772, "بدهی بانک‌ها به بانک مرکزی"),
    "base-other-items": (3773, "خالص سایر"),
    "base-money-uses": (3777, "پایه پولی برحسب مصارف"),
    "base-legal-reserves": (3778, "سپرده‌های قانونی بانک‌ها نزد بانک مرکزی"),
    "base-bank-demand-deposits": (3779, "سپرده‌های دیداری بانک‌ها نزد بانک مرکزی"),
    "base-currency-circulation": (3780, "اسکناس و مسکوک در جریان"),
}
REQUIRED_SERIES = {
    "liquidity", "liquidity-supply", "money", "quasi", "base-money", "base-money-uses",
}
SEASONS = {"بهار": 1, "تابستان": 2, "پاییز": 3, "زمستان": 4}
PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
ZERO_WIDTH = "\u200b\u200c\u200d\u200e\u200f\ufeff"


class _TableParser(HTMLParser):
    """Collect cell text from HTML tables without an extra parsing dependency."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self.table_depth = 0
        self.active = False
        self.row: list[str] | None = None
        self.cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "table":
            if self.table_depth == 0:
                self.tables.append([])
                self.active = True
            self.table_depth += 1
        elif self.active and tag == "tr" and self.row is None:
            self.row = []
        elif self.active and tag in ("td", "th") and self.row is not None and self.cell is None:
            self.cell = []

    def handle_data(self, data: str) -> None:
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self.active and tag in ("td", "th") and self.cell is not None:
            assert self.row is not None
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        elif self.active and tag == "tr" and self.row is not None:
            if self.row:
                self.tables[-1].append(self.row)
            self.row = None
        elif tag == "table" and self.table_depth:
            self.table_depth -= 1
            if self.table_depth == 0:
                self.active = False


def _normalise_text(value: str) -> str:
    return " ".join(
        value.translate(PERSIAN_DIGITS)
        .replace("ي", "ی").replace("ك", "ک")
        .translate({ord(char): None for char in ZERO_WIDTH})
        .split()
    )


def _quarter_end(period: str, date_overrides: dict[str, tuple[str, str]] | None = None) -> tuple[str, str]:
    normalized = _normalise_text(period)
    match = re.fullmatch(r"(\d{4})\s+(بهار|تابستان|پاییز|زمستان)", normalized)
    if not match:
        raise ValueError(f"MEFA returned an unrecognized quarterly label: {period!r}")
    if date_overrides and normalized in date_overrides:
        return date_overrides[normalized]
    year = int(match.group(1))
    month = SEASONS[match.group(2)] * 3
    for day in (31, 30, 29):
        try:
            jalali = JalaliDate(year, month, day)
            return jalali.to_gregorian().isoformat(), jalali.strftime("%Y%m%d")
        except ValueError:
            continue
    raise ValueError(f"MEFA returned an invalid quarter end: {period!r}")


def _parse_amount(value: str) -> Decimal | None:
    normalized = _normalise_text(value).replace(",", "").replace("٬", "").replace("٫", ".")
    if not normalized or normalized in {"-", "—", "–"}:
        return None
    try:
        amount = Decimal(normalized)
    except InvalidOperation as exc:
        raise ValueError(f"MEFA returned a non-numeric amount: {value!r}") from exc
    if not amount.is_finite():
        raise ValueError("MEFA returned a non-finite amount")
    return amount


def parse_mefa_table(
    html: str,
    date_overrides: dict[str, tuple[str, str]] | None = None,
) -> dict[str, list[dict]]:
    parser = _TableParser()
    parser.feed(html)
    rows = next((table for table in parser.tables if table and _normalise_text(table[0][0]) == "عنوان"), None)
    if rows is None or len(rows[0]) < 20:
        raise ValueError("MEFA monetary response did not contain the expected quarterly data table")

    headers = rows[0][1:]
    definitions: dict[str, list[dict]] = {}
    for series_id, (indicator_id, expected_title) in MEFA_ROWS.items():
        target = _normalise_text(expected_title)
        matches = [row for row in rows[1:] if row and _normalise_text(row[0]).removesuffix(f" ({SOURCE_UNIT})") == target]
        if len(matches) != 1:
            if series_id in REQUIRED_SERIES:
                raise ValueError(f"MEFA row for required series {series_id} was missing or ambiguous")
            continue
        row = matches[0]
        if len(row) != len(headers) + 1:
            raise ValueError(f"MEFA row {series_id} has {len(row)} cells; expected {len(headers) + 1}")

        values: dict[str, dict] = {}
        for label, raw_amount in zip(headers, row[1:], strict=True):
            amount = _parse_amount(raw_amount)
            if amount is None:
                continue
            observed_on, jalali_date = _quarter_end(label, date_overrides)
            normalized = float(amount / NORMALIZATION_FACTOR)
            current = values.get(observed_on)
            if current and current["value"] != normalized:
                raise ValueError(f"Conflicting MEFA values for {series_id} on {observed_on}")
            values[observed_on] = {
                "date": observed_on,
                "jalali": jalali_date,
                "period": _normalise_text(label),
                "value": normalized,
                "source_amount": str(amount),
                "source_record_id": f"mefa-{indicator_id}-{_normalise_text(label).replace(' ', '-')}",
                "raw_payload": json.dumps({
                    "provider": "MEFA economic and financial data bank",
                    "source": "Central Bank of Iran",
                    "indicator_id": indicator_id,
                    "indicator_title": row[0],
                    "period": _normalise_text(label),
                    "source_unit": SOURCE_UNIT,
                    "source_amount": str(amount),
                    "stored_unit": UNIT,
                    "normalization": "source amount in billion rials divided by 1000",
                }, ensure_ascii=False, separators=(",", ":")),
            }
        definitions[series_id] = [values[day] for day in sorted(values)]

    for series_id in REQUIRED_SERIES:
        if len(definitions.get(series_id, [])) < 150:
            raise ValueError(f"MEFA returned too few quarterly observations for {series_id}")

    _validate_recent_identities(definitions)
    return definitions


def _validate_recent_identities(parsed: dict[str, list[dict]]) -> None:
    by_date = {
        series_id: {row["date"]: row["value"] for row in parsed.get(series_id, [])}
        for series_id in MEFA_ROWS
    }
    checks = [
        ("liquidity", ("money", "quasi")),
        ("base-money", ("base-money-uses",)),
    ]
    for total, components in checks:
        common = set(by_date[total]).intersection(*(set(by_date[item]) for item in components))
        if not common:
            raise ValueError(f"MEFA identity could not be checked for {total}")
        latest = max(common)
        component_total = sum(by_date[item][latest] for item in components)
        if abs(by_date[total][latest] - component_total) > 0.05:
            raise ValueError(f"MEFA latest {total} does not reconcile with its components on {latest}")


def fetch_mefa_rows() -> tuple[dict[str, list[dict]], dict[str, tuple[str, str]]]:
    session = requests.Session()
    session.headers.update({"User-Agent": "EcoNotes/0.4 (local macroeconomic research)", "Accept-Language": "fa"})
    direct_liquidity = parse_cbi_liquidity_rows(fetch_cbi_liquidity_rows())
    date_overrides: dict[str, tuple[str, str]] = {}
    for row in direct_liquidity["liquidity"]:
        jalali = row["jalali"]
        year, month = int(jalali[:4]), int(jalali[4:6])
        season = (month - 1) // 3 + 1
        label = f"{year} {('بهار', 'تابستان', 'پاییز', 'زمستان')[season - 1]}"
        date_pair = (row["date"], jalali)
        if label in date_overrides and date_overrides[label] != date_pair:
            raise ValueError(f"CBI supplied conflicting quarterly dates for {label}")
        date_overrides[label] = date_pair
    response = session.get(URL, params={
        "from": "1352001", "to": "1410004", "f": "2", "d": "2",
        "indicators": ",".join(str(value[0]) for value in MEFA_ROWS.values()),
    }, timeout=(10, 60))
    response.raise_for_status()
    return parse_mefa_table(response.text, date_overrides), date_overrides


def _remove_misaligned_mefa_rows(connection, date_overrides: dict[str, tuple[str, str]]) -> int:
    """Remove duplicate MEFA quarter-end rows when direct CBI supplies a canonical date."""
    misaligned: list[tuple[str, str, str]] = []
    rows = connection.execute(
        """SELECT series_id, observed_on, source_record_id, raw_payload
           FROM macro_observations WHERE source_record_id LIKE 'mefa-%'"""
    ).fetchall()
    for row in rows:
        try:
            payload = json.loads(row["raw_payload"])
            period = _normalise_text(str(payload.get("period") or ""))
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        canonical = date_overrides.get(period)
        if canonical and row["observed_on"] != canonical[0]:
            misaligned.append((row["series_id"], row["observed_on"], row["source_record_id"]))
    for series_id, observed_on, source_record_id in misaligned:
        connection.execute(
            """DELETE FROM observations WHERE series_id=? AND observed_on=? AND source_record_id=?""",
            (series_id, observed_on, source_record_id),
        )
        connection.execute(
            """DELETE FROM macro_observations WHERE series_id=? AND observed_on=? AND source_record_id=?""",
            (series_id, observed_on, source_record_id),
        )
    return len(misaligned)


def import_mefa_monetary() -> dict:
    started_at = datetime.now(timezone.utc).isoformat()
    with database() as connection:
        connection.execute(
            """INSERT INTO sources (id, name, homepage, retrieval_method) VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET name=excluded.name, homepage=excluded.homepage,
                 retrieval_method=excluded.retrieval_method""",
            (SOURCE_ID, "بانک داده‌های اقتصادی و مالی وزارت اقتصاد · سری‌های بانک مرکزی",
             URL, "Quarterly CBI monetary series; MEFA table in billion rials normalized to thousand billion rials"),
        )
        run_id = connection.execute(
            "INSERT INTO ingestion_runs (source_id, started_at, status) VALUES (?, ?, 'running')",
            (SOURCE_ID, started_at),
        ).lastrowid

    try:
        parsed, date_overrides = fetch_mefa_rows()
        definitions = {**LIQUIDITY_SERIES, **BASE_MONEY_SERIES}
        fetched_at = datetime.now(timezone.utc).isoformat()
        accepted = 0
        received = sum(len(values) for values in parsed.values())
        skipped_series: list[str] = []
        with database() as connection:
            removed_misaligned = _remove_misaligned_mefa_rows(connection, date_overrides)
            for series_id, values in parsed.items():
                if not values:
                    continue
                definition = definitions[series_id]
                category_title = definition["title"] if isinstance(definition, dict) else definition[1]
                description = definition.get("description", "") if isinstance(definition, dict) else f"بانک مرکزی ج.ا.ا · {category_title}"
                if isinstance(definition, dict):
                    parent_id = definition.get("parent_id")
                else:
                    parent_id = None if series_id in ("liquidity", "liquidity-supply") else "liquidity"
                existing_latest = connection.execute(
                    "SELECT MAX(observed_on) FROM macro_observations WHERE series_id=?", (series_id,)
                ).fetchone()[0]
                # Prefer direct TSD values on overlapping dates; MEFA fills only dates
                # after the latest value already stored for that series.
                new_values = [row for row in values if not existing_latest or row["date"] > existing_latest]
                if not new_values:
                    if existing_latest and existing_latest > values[-1]["date"]:
                        direct_source = "cbi-tsd" if series_id in LIQUIDITY_SERIES else "cbi-tsd-base-money"
                        connection.execute(
                            "UPDATE series SET source_id=? WHERE id=? AND source_id=?",
                            (direct_source, series_id, SOURCE_ID),
                        )
                    elif existing_latest == values[-1]["date"]:
                        latest_source_row = connection.execute(
                            """SELECT source_record_id FROM macro_observations
                               WHERE series_id=? AND observed_on=?""",
                            (series_id, existing_latest),
                        ).fetchone()
                        if latest_source_row and latest_source_row["source_record_id"] == values[-1]["source_record_id"]:
                            connection.execute(
                                "UPDATE series SET source_id=? WHERE id=?",
                                (SOURCE_ID, series_id),
                            )
                    skipped_series.append(series_id)
                    continue
                connection.execute(
                    """INSERT INTO series (id, title, description, group_id, unit, frequency,
                                            source_id, status, parent_id, last_checked_at)
                       VALUES (?, ?, ?, 'money', ?, 'quarterly', ?, 'active', ?, ?)
                       ON CONFLICT(id) DO UPDATE SET source_id=excluded.source_id,
                         unit=excluded.unit, frequency='quarterly', status='active',
                         last_checked_at=excluded.last_checked_at""",
                    (series_id, category_title, description, UNIT, SOURCE_ID, parent_id, fetched_at),
                )
                for row in new_values:
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
                    accepted += 1

            connection.execute("UPDATE sources SET last_success_at=? WHERE id=?", (fetched_at, SOURCE_ID))
            connection.execute(
                """UPDATE ingestion_runs SET status='success', finished_at=?,
                   rows_received=?, rows_accepted=? WHERE id=?""",
                (fetched_at, received, accepted, run_id),
            )

        return {
            "source": SOURCE_ID,
            "observations": {key: len(values) for key, values in parsed.items()},
            "observations_imported": accepted,
            "skipped_series": skipped_series,
            "misaligned_duplicate_rows_removed": removed_misaligned,
            "latest": {key: values[-1]["date"] for key, values in parsed.items() if values},
            "latest_values": {key: values[-1]["value"] for key, values in parsed.items() if values},
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
    print(json.dumps(import_mefa_monetary(), ensure_ascii=False, indent=2))
