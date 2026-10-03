"""Import reported weekly open-market operations from IBENA's public archive."""

from __future__ import annotations

import json
import logging
import re
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from decimal import Decimal
from html.parser import HTMLParser
from urllib.parse import unquote
from zoneinfo import ZoneInfo

import requests
from persiantools.jdatetime import JalaliDate

from .db import database

SOURCE_ID = "ibena-omo"
SITEMAP_INDEX = "https://www.ibena.ir/fa-sitemap-newsarchive"
BASE_URL = "https://www.ibena.ir"
ARCHIVE_START_YEAR = 1398
TEHRAN = ZoneInfo("Asia/Tehran")
log = logging.getLogger("econotes.omo")

MONTHS = {
    "فروردین": 1, "اردیبهشت": 2, "خرداد": 3, "تیر": 4, "مرداد": 5,
    "شهریور": 6, "مهر": 7, "آبان": 8, "آذر": 9,
    "دی": 10, "بهمن": 11, "اسفند": 12,
}
METRICS = {
    "omo-repo": {
        "title": "OMO · توافق بازخرید",
        "description": "مبلغ توافق بازخرید اعلام‌شده در گزارش هفتگی عملیات بازار باز؛ متن منبع به هزار میلیارد ریال/تومان گزارش شده و اینجا به همت تبدیل شده است.",
    },
    "omo-reverse-repo": {
        "title": "OMO · توافق بازخرید معکوس",
        "description": "مبلغ توافق بازخرید معکوس اعلام‌شده در گزارش هفتگی عملیات بازار باز؛ به همت تبدیل شده است.",
    },
    "omo-outright": {
        "title": "OMO · خرید قطعی اوراق",
        "description": "مبلغ خرید قطعی اوراق اعلام‌شده در گزارش هفتگی عملیات بازار باز؛ به همت تبدیل شده است. مقدار ثبت‌نشده در گزارش خالی می‌ماند.",
    },
}

_DIGIT_TRANSLATION = str.maketrans(
    "۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"
)
_AMOUNT = re.compile(
    r"(?P<value>\d+(?:[ ,]\d{3})*(?:\.\d+)?)\s*(?P<unit>"
    r"هزار\s*میلیارد\s*(?:ریال|تومان)|میلیارد\s*(?:ریال|تومان)|همت)"
)
_DATE = re.compile(
    r"(?P<day>\d{1,2})\s*(?P<month>فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|شهرريور|مهر|آبان|آذر|دی|بهمن|اسفند)"
    r"\s*(?:ماه)?\s*(?P<year>14\d{2})"
)


class _JsonLdParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._inside = False
        self._parts: list[str] = []
        self.documents: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag == "script" and dict(attrs).get("type", "").lower() == "application/ld+json":
            self._inside = True
            self._parts = []

    def handle_data(self, data: str) -> None:
        if self._inside:
            self._parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._inside:
            self.documents.append("".join(self._parts))
            self._parts = []
            self._inside = False


def _normalize_text(value: str) -> str:
    return (
        value.translate(_DIGIT_TRANSLATION)
        .replace("ي", "ی").replace("ك", "ک")
        .replace("٫", ".").replace("٬", ",").replace("،", ",")
        .replace("\u200c", " ").replace("\xa0", " ")
    )


def _news_articles(value: object) -> list[dict]:
    if isinstance(value, list):
        return [article for item in value for article in _news_articles(item)]
    if not isinstance(value, dict):
        return []
    if "@graph" in value:
        return _news_articles(value["@graph"])
    article_type = value.get("@type")
    if article_type == "NewsArticle" or (isinstance(article_type, list) and "NewsArticle" in article_type):
        return [value]
    return []


def extract_news_article(document: str) -> dict:
    parser = _JsonLdParser()
    parser.feed(document)
    for script in parser.documents:
        try:
            parsed = json.loads(script)
        except (json.JSONDecodeError, TypeError):
            continue
        articles = _news_articles(parsed)
        if articles:
            article = articles[0]
            if article.get("articleBody"):
                return article
    raise ValueError("IBENA page has no NewsArticle JSON-LD body")


def _operation_date(body: str, title: str, published_at: str) -> tuple[str, str]:
    for text in (body, title):
        normalized = _normalize_text(text)
        for match in _DATE.finditer(normalized):
            context = normalized[max(0, match.start() - 110):match.start()]
            if "عملیات اجرایی سیاست پولی" not in context and "گزارش عملیات" not in context:
                continue
            year = int(match.group("year"))
            month = MONTHS[match.group("month")]
            day = int(match.group("day"))
            return JalaliDate(year, month, day).to_gregorian().isoformat(), "reported-operation-date"
    try:
        published = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
        if published.tzinfo is None:
            published = published.replace(tzinfo=timezone.utc)
        return published.date().isoformat(), "publication-date-fallback"
    except (TypeError, ValueError):
        raise ValueError("IBENA article has no usable report or publication date") from None


def _metric_for_amount(text: str, start: int, end: int) -> str | None:
    context = text[max(0, start - 180):start]
    if "سررسید" in context:
        return None
    reverse = max(context.rfind("توافق بازخرید معکوس"), context.rfind("ریپوی معکوس"))
    repo = context.rfind("توافق بازخرید")
    outright = context.rfind("خرید قطعی")
    nearest = max(reverse, repo, outright)
    if nearest < 0:
        return None
    if nearest == reverse:
        return "omo-reverse-repo"
    if nearest == outright:
        return "omo-outright"
    return "omo-repo"


def _to_hemats(value: str, unit: str) -> float:
    amount = Decimal(value.replace(" ", "").replace(",", ""))
    if unit == "همت":
        scale = Decimal("1")
    elif unit.startswith("هزار") and unit.endswith("تومان"):
        scale = Decimal("1")
    elif unit.startswith("هزار") and unit.endswith("ریال"):
        scale = Decimal("0.1")
    elif unit.startswith("میلیارد") and unit.endswith("تومان"):
        scale = Decimal("0.001")
    else:
        scale = Decimal("0.0001")
    return float(amount * scale)


def _explicit_zero_metrics(text: str, metrics: dict[str, float]) -> None:
    outright_not_received = re.search(
        r"پیشنهادی.{0,140}خرید\s*قطعی.{0,140}(?:دریافت\s*نشد|ارسال\s*نشد|ثبت\s*نشد)",
        text,
    )
    if outright_not_received:
        metrics.setdefault("omo-outright", 0.0)


def parse_article(document: str, url: str) -> dict:
    article = extract_news_article(document)
    body = _normalize_text(str(article["articleBody"]))
    title = _normalize_text(str(article.get("headline") or ""))
    published_at = str(article.get("datePublished") or "")
    observed_on, date_basis = _operation_date(body, title, published_at)
    metrics: dict[str, float] = {}
    for match in _AMOUNT.finditer(body):
        metric = _metric_for_amount(body, match.start(), match.end())
        if metric:
            metrics[metric] = _to_hemats(match.group("value"), match.group("unit"))
    _explicit_zero_metrics(body, metrics)
    article_id_match = re.search(r"/news/(\d+)(?:/|$)", url)
    if not article_id_match:
        raise ValueError("IBENA article URL has no numeric article id")
    if published_at:
        try:
            published_at = datetime.fromisoformat(published_at.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
        except ValueError:
            published_at = ""
    return {
        "article_id": article_id_match.group(1),
        "url": url,
        "title": title,
        "date": observed_on,
        "date_basis": date_basis,
        "published_at": published_at,
        "metrics": metrics,
    }


def _xml_locs(payload: bytes) -> list[str]:
    root = ET.fromstring(payload)
    return [element.text.strip() for element in root.iter() if element.tag.endswith("loc") and element.text]


def _jalali_month_keys(today: datetime) -> set[str]:
    jalali = JalaliDate.to_jalali(today.year, today.month, today.day)
    month_number = jalali.year * 12 + jalali.month - 1
    keys = set()
    for offset in range(3):
        year, month_zero = divmod(month_number - offset, 12)
        keys.add(f"-{year}-{month_zero + 1}-")
    return keys


def _is_report_url(url: str) -> bool:
    path = unquote(url)
    return "عملیات-اجرایی-سیاست-پولی" in path and "گزارش" in path


def discover_report_urls(*, bootstrap: bool, now: datetime | None = None) -> list[str]:
    response = requests.get(SITEMAP_INDEX, timeout=30, headers={
        "User-Agent": "EcoNotes/0.2 (local macroeconomic data research)"
    })
    response.raise_for_status()
    sitemap_urls = _xml_locs(response.content)
    if bootstrap:
        sitemap_urls = [
            url for url in sitemap_urls
            if "fa-sitemap-newsarchive-" in url
            and re.search(r"fa-sitemap-newsarchive-14\d{2}-", url)
            and int(re.search(r"fa-sitemap-newsarchive-(\d{4})-", url).group(1)) >= ARCHIVE_START_YEAR
        ]
    else:
        month_keys = _jalali_month_keys(now or datetime.now(TEHRAN))
        sitemap_urls = [
            url for url in sitemap_urls
            if "fa-sitemap-newsarchive-" in url and any(key in url for key in month_keys)
        ]
    if not sitemap_urls:
        raise ValueError("IBENA sitemap has no relevant news archive pages")

    def fetch_sitemap(url: str) -> list[str]:
        archive = requests.get(url, timeout=30, headers={
            "User-Agent": "EcoNotes/0.2 (local macroeconomic data research)"
        })
        archive.raise_for_status()
        return _xml_locs(archive.content)

    with ThreadPoolExecutor(max_workers=8) as pool:
        articles = [url for page in pool.map(fetch_sitemap, sitemap_urls) for url in page]
    return sorted({url for url in articles if _is_report_url(url)})


def fetch_article(url: str) -> dict:
    response = requests.get(url, timeout=30, headers={
        "User-Agent": "EcoNotes/0.2 (local macroeconomic data research)"
    })
    response.raise_for_status()
    return parse_article(response.text, url)


def _as_sortable_timestamp(value: str) -> str:
    if not value:
        return ""
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def import_omo() -> dict:
    started = datetime.now(timezone.utc).isoformat()
    with database() as connection:
        connection.execute(
            """INSERT INTO sources (id, name, homepage, retrieval_method) VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET name=excluded.name, homepage=excluded.homepage,
                 retrieval_method=excluded.retrieval_method""",
            (SOURCE_ID, "ایبنا · گزارش‌های عملیات اجرایی سیاست پولی", BASE_URL,
             "Public IBENA news-archive sitemaps and NewsArticle JSON-LD"),
        )
        run_id = connection.execute(
            "INSERT INTO ingestion_runs (source_id, started_at, status) VALUES (?, ?, 'running')",
            (SOURCE_ID, started),
        ).lastrowid
        existing_rows = connection.execute(
            "SELECT COUNT(*) FROM observations WHERE series_id IN (?, ?, ?)", tuple(METRICS)
        ).fetchone()[0]
        known_urls = {
            row[0] for row in connection.execute(
                "SELECT DISTINCT source_record_id FROM observations WHERE series_id IN (?, ?, ?)",
                tuple(METRICS),
            ) if row[0]
        }
    try:
        urls = discover_report_urls(bootstrap=existing_rows == 0)
        new_urls = [url for url in urls if url not in known_urls]
        with ThreadPoolExecutor(max_workers=8) as pool:
            parsed_articles = list(pool.map(fetch_article, new_urls))

        # If multiple reports cover the same operation date, keep the latest
        # published report for each metric rather than adding potentially
        # overlapping tender amounts together.
        latest_by_key: dict[tuple[str, str], dict] = {}
        for article in parsed_articles:
            for series_id, value in article["metrics"].items():
                key = (series_id, article["date"])
                current = latest_by_key.get(key)
                if current is None or _as_sortable_timestamp(article["published_at"]) >= _as_sortable_timestamp(current["published_at"]):
                    latest_by_key[key] = {"article": article, "value": value}

        fetched_at = datetime.now(timezone.utc).isoformat()
        with database() as connection:
            for series_id, definition in METRICS.items():
                connection.execute(
                    """INSERT INTO series (id, title, description, group_id, unit, frequency,
                                            source_id, status, last_checked_at)
                       VALUES (?, ?, ?, 'money', 'همت', 'weekly', ?, 'active', ?)
                       ON CONFLICT(id) DO UPDATE SET title=excluded.title,
                         description=excluded.description, group_id='money', unit='همت',
                         frequency='weekly', source_id=excluded.source_id,
                         status='active', last_checked_at=excluded.last_checked_at""",
                    (series_id, definition["title"], definition["description"], SOURCE_ID, fetched_at),
                )
            accepted = 0
            latest_dates: dict[str, str] = {}
            for (series_id, observed_on), item in sorted(latest_by_key.items()):
                article = item["article"]
                connection.execute(
                    """INSERT INTO observations (series_id, observed_on, value, symbol,
                               source_record_id, published_at) VALUES (?, ?, ?, NULL, ?, ?)
                       ON CONFLICT(series_id, observed_on) DO UPDATE SET value=excluded.value,
                         source_record_id=excluded.source_record_id, published_at=excluded.published_at""",
                    (series_id, observed_on, item["value"], article["url"], article["published_at"] or fetched_at),
                )
                accepted += 1
                latest_dates[series_id] = max(latest_dates.get(series_id, observed_on), observed_on)
            connection.execute("UPDATE sources SET last_success_at=? WHERE id=?", (fetched_at, SOURCE_ID))
            connection.execute(
                """UPDATE ingestion_runs SET status='success', finished_at=?,
                       rows_received=?, rows_accepted=? WHERE id=?""",
                (fetched_at, len(parsed_articles), accepted, run_id),
            )
        log.info("Scanned %s IBENA reports; added %s OMO observations", len(new_urls), accepted)
        return {
            "reports_scanned": len(new_urls), "observations": accepted,
            "latest": latest_dates, "fetched_at": fetched_at,
        }
    except Exception as exc:
        with database() as connection:
            connection.execute(
                "UPDATE ingestion_runs SET status='failed', finished_at=?, error_message=? WHERE id=?",
                (datetime.now(timezone.utc).isoformat(), str(exc)[:1000], run_id),
            )
        raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    print(json.dumps(import_omo(), ensure_ascii=False, indent=2))
