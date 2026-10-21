"use client";

import { useState, useSyncExternalStore } from "react";
import { Activity, ArrowLeft, BarChart3, CircleHelp, Database, Download, GitCompareArrows, LayoutDashboard, Menu, RefreshCw, Search, Star, X } from "lucide-react";
import Chart from "./chart";
import MacroAnalysis, { type MacroAnalysisSubview } from "./macro-analysis";
import StockMarket from "./stock-market";
import BondMarket from "./bond-market";
import { catalogDomains, catalogSubgroupFor, change, downloadCsv, formatDate, formatNumber, frequencyLabel, groups, last, periodPoints, type Series } from "@/lib/data";
import { returns, rollingVariance } from "@/lib/analytics";
import { useSeries } from "@/lib/use-series";
import { staticDataMode } from "@/lib/api";
import { themeColors } from "@/lib/theme";

type View = "overview" | "series" | "analysis" | "catalog" | "method" | "markets";
type MarketSubview = "indices" | "bonds";
const categories = [
  { id: "overview" as View, label: "نمای کلی", icon: LayoutDashboard },
  { id: "analysis" as View, label: "تحلیل کلان", icon: GitCompareArrows },
  { id: "markets" as View, label: "بازارهای مالی", icon: BarChart3 },
  { id: "catalog" as View, label: "داده‌ها", icon: Database },
  { id: "method" as View, label: "روش‌شناسی", icon: CircleHelp },
];
const watchlistKey = "econotes.watchlist.v1";
const subscribeWatchlist = (notify: () => void) => {
  window.addEventListener("storage", notify);
  window.addEventListener("econotes-watchlist", notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener("econotes-watchlist", notify); };
};
const readWatchlist = () => { try { return window.localStorage.getItem(watchlistKey) ?? "[]"; } catch { return "[]"; } };
const initialWatchlist = () => "[]";
const overviewSections = [
  { id: "currency", title: "ارز", description: "بازار آزاد و نرخ توافقی حواله", seriesIds: ["usd-free", "usd-official", "usd-real"] },
  { id: "inflation", title: "تورم و قیمت‌ها", description: "تورم ماهانه و نقطه‌به‌نقطه", seriesIds: ["cpi-mom-cbi", "cpi-yoy-cbi"] },
  { id: "money", title: "شرایط پولی", description: "نقدینگی، پایه پولی و عملیات بازار باز", seriesIds: ["liquidity", "base-money", "omo-repo"] },
  { id: "rates", title: "نرخ بهره و اوراق", description: "بازده اوراق بدهی دولت", seriesIds: ["yield", "yield-history"] },
  { id: "assets", title: "بازار دارایی‌ها و کالاها", description: "شاخص کل، طلای داخل و اونس جهانی", seriesIds: ["tedpix", "gold", "gold-world"], wide: true },
];

function Delta({ item }: { item: Series }) {
  const isRate = item.unit.includes("درصد");
  const value = isRate ? last(item) - (item.points.at(-2)?.value ?? NaN) : change(item);
  return <span className={`trend ${value >= 0 ? "positive" : "negative"}`}>{value > 0 ? "+" : ""}{formatNumber(value, 2)}{isRate ? " واحد درصد" : "٪"}</span>;
}

function Card({ item, open, wide = false }: { item: Series; open: () => void; wide?: boolean }) {
  return <button className={`market-card ${wide ? "market-card-wide" : ""}`} onClick={open}>
    <div className="card-head"><span className="nav-dot" style={{ background: item.color }} /><span>{item.shortTitle}</span><span className="card-live">{frequencyLabel(item.frequency)}</span><ArrowLeft size={15} className="card-arrow" /></div>
    <div className="card-figure"><strong>{formatNumber(last(item), item.unit.includes("درصد") ? 2 : 0)}</strong><small>{item.unit}</small></div>
    <div className="card-bottom"><Delta item={item} /><span>در مقایسه با مقدار قبل</span></div>
    <Chart points={item.points.slice(-70)} color={item.color} mini type={item.points.length < 8 ? "scatter" : "line"} height={wide ? 84 : 62} />
    <small className="card-observed">آخرین مقدار · {formatDate(item.points.at(-1)!.date)}</small>
  </button>;
}

function OverviewSection({ title, description, items, open, wide = false }: { title: string; description: string; items: Series[]; open: (id: string) => void; wide?: boolean }) {
  if (!items.length) return null;
  return <section className={`panel overview-card ${wide ? "overview-card-wide" : ""}`} aria-label={title}>
    <div className="overview-card-heading"><div><h3>{title}</h3><p>{description}</p></div><span className="overview-card-count">{formatNumber(items.length)} شاخص</span></div>
    <div className="overview-metrics">{items.map((item) => <article className="overview-metric" key={item.id}>
      <button className="overview-metric-open" onClick={() => open(item.id)} aria-label={`نمایش نمودار ${item.shortTitle}`}>
        <span className="overview-metric-name"><span className="nav-dot" style={{ background: item.color }} />{item.shortTitle}</span>
        <span className="overview-metric-value">{formatNumber(last(item), item.unit.includes("درصد") ? 2 : 0)} <small>{item.unit}</small></span>
        <span className="overview-metric-meta">{frequencyLabel(item.frequency)} · {formatDate(item.points.at(-1)!.date)}</span>
        <span className="overview-metric-delta"><Delta item={item} /> <small>نسبت به مشاهدهٔ قبل</small></span>
      </button>
      <div className="overview-sparkline" aria-hidden="true"><Chart points={item.points.slice(-50)} color={item.color} mini type={item.points.length < 8 ? "scatter" : "line"} height={58} /></div>
    </article>)}</div>
  </section>;
}

function SeriesDetail({ item, series, open, toggleFavorite, favorite }: { item: Series; series: Series[]; open: (id: string) => void; toggleFavorite: () => void; favorite: boolean }) {
  const [months, setMonths] = useState<number | null>(12);
  const visible = periodPoints(item.points, months);
  const rate = item.unit.includes("درصد");
  const changes = rate ? item.points.slice(1).map((p, i) => ({ date: p.date, value: p.value - item.points[i].value })) : returns(item.points);
  const acceleration = changes.slice(1).map((p, i) => ({ date: p.date, value: p.value - changes[i].value }));
  const window = item.frequency === "daily" ? 30 : item.frequency === "weekly" ? 13 : item.frequency === "monthly" ? 6 : 4;
  const variances = [rollingVariance(changes, window), rollingVariance(acceleration, window)].map((points) => points.filter((p) => !visible[0] || p.date >= visible[0].date));
  const relatives = series.filter((s) => s.id !== item.id && (s.parent === item.id || (item.parent && s.parent === item.parent) ||
    (item.group === "money" && s.group === "money" && (item.id.startsWith("base-") ? s.id.startsWith("base-") : item.id.startsWith("omo-") ? s.id.startsWith("omo-") : !s.id.startsWith("base-") && !s.id.startsWith("omo-"))) ||
    (item.group === "currency" && s.group === "currency") || (item.group === "metals" && s.group === "metals") || (item.group === "prices" && s.group === "prices")));
  const exportSeries = () => downloadCsv(item.id, [["date", "value", "unit", "symbol", "source"], ...item.points.map((p) => [p.date, p.value, item.unit, p.symbol ?? "", item.source])]);
  return <section><div className="detail-heading"><div><div className="eyebrow"><span className="eyebrow-line" />{groups[item.group]}</div><h1>{item.title}</h1><p>{item.description}</p></div><div className="detail-value"><span>آخرین مقدار · {formatDate(item.points.at(-1)!.date)}</span><strong>{formatNumber(last(item), item.unit.includes("درصد") ? 2 : 1)}</strong><div><small>{item.unit}</small><Delta item={item} /></div></div></div>
    <div className="detail-toolbar"><div className="toolbar-right"><button className={`outline-button ${favorite ? "favorite-active" : ""}`} onClick={toggleFavorite}><Star size={15} fill={favorite ? "currentColor" : "none"} />{favorite ? "در دیدبان من" : "افزودن به دیدبان"}</button><button className="outline-button" onClick={exportSeries}><Download size={15} /> دریافت CSV</button></div><div className="detail-period-control" role="group" aria-label="بازهٔ تحلیلی"><span>بازهٔ تحلیل</span><div className="period-tabs">{[3, 12, null].map((n) => { const label = n === null ? "تمام دوره" : n === 12 ? "۱ سال" : "۳ ماه"; return <button key={String(n)} type="button" className={months === n ? "selected" : ""} aria-pressed={months === n} onClick={() => setMonths(n)}>{label}</button>; })}</div></div></div>
    <div className="detail-grid"><article className="panel chart-main"><div className="panel-header"><div><span className="panel-kicker">روند تاریخی</span><h3>{item.shortTitle}</h3></div><span className="badge badge-accent">{frequencyLabel(item.frequency)}</span></div><Chart points={visible} color={item.color} step={item.frequency !== "daily"} type={item.points.length < 8 ? "scatter" : "line"} height={340} unit={item.unit} /><div className="chart-footer">برای بزرگ‌نمایی یک بازه، دستگیره‌های نوار پایین نمودار را بکشید. بازهٔ تحلیل، نمودارهای تغییرات را هم به‌روز می‌کند.</div></article>
    <aside className="panel insight-panel"><div className="panel-header"><h3>مشخصات شاخص</h3><Database size={18} /></div><div className="fact-row"><span>منبع</span><strong>{item.source}</strong></div><div className="fact-row"><span>واحد / تواتر</span><strong>{item.unit} · {frequencyLabel(item.frequency)}</strong></div><div className="fact-row"><span>شروع تاریخچه</span><strong>{formatDate(item.points[0].date)}</strong></div><div className="fact-row"><span>تعداد مشاهدات</span><strong>{formatNumber(item.points.length)}</strong></div>{item.retrievedAt && <div className="fact-row"><span>زمان دریافت</span><strong>{new Date(item.retrievedAt).toLocaleString("fa-IR")}</strong></div>}<div className="insight-callout"><p>تاریخ نمودار، زمان انتشار مقدار در منبع است. برای داده‌های ماهانه و فصلی، مقدار قبلی تا انتشار بعدی حفظ می‌شود؛ مقدار روزانهٔ تازه‌ای ساخته نمی‌شود.</p></div></aside>
    {variances.map((points, index) => <article className="panel small-chart" key={index}><div className="panel-header"><div><span className="panel-kicker">{index ? "تغییرات ریسک" : "ریسک تغییرات"}</span><h3>{index ? "واریانس تغییر بازده" : rate ? "واریانس تغییر نرخ" : "واریانس بازده درصدی"}</h3></div><span className="badge">پنجره {formatNumber(window)} مشاهده</span></div><Chart points={points} color={index ? themeColors.accent : themeColors.secondary} height={240} unit={rate ? "واحد درصد²" : "درصد²"} /><p>واریانس نمونه‌ای با پنجره کامل؛ {rate ? "بر پایه تغییر نرخ در واحد درصد" : "بر پایه بازده لگاریتمی درصدی"}. {points.some((p) => Number.isFinite(p.value)) ? "" : "برای این بازه هنوز مشاهده کافی نداریم."}</p></article>)}</div>
    {relatives.length > 0 && <div className="panel related-panel"><div className="panel-header"><h3>{item.group === "money" ? "اجزا و عوامل مرتبط" : "سری‌های مرتبط"}</h3><span className="badge">{formatNumber(relatives.length)} سری</span></div><div className="related-grid">{relatives.map((s) => <button key={s.id} onClick={() => open(s.id)}><span>{s.shortTitle}</span><strong>{formatNumber(last(s), s.unit.includes("درصد") ? 2 : 0)}</strong><small>{s.unit} · {formatDate(s.points.at(-1)!.date)}</small></button>)}</div></div>}
  </section>;
}

function Method({ series }: { series: Series[] }) {
  return <><div className="page-intro compact"><div><div className="eyebrow"><span className="eyebrow-line" /> روش‌شناسی</div><h1>تعریف شاخص‌ها و داده‌ها</h1><p>تعریف، منبع و روش محاسبهٔ هر شاخص را بخوانید.</p></div></div><div className="method-grid"><article className="panel method-card"><Database size={24} /><h3>تعریف و منبع شاخص‌ها</h3><p>سری دلار آزاد از قیمت پایانی USDT/TMN در والکس می‌آید. نرخ خرید و فروش حوالهٔ دلار از ETS است. قیمت طلای داخلی و اونس جهانی را از آرشیو TGJU می‌گیریم؛ اونس در این داشبورد قیمت spot است، نه نرخ تثبیت لندن. شاخص کل و هم‌وزن هم از TSETMC هستند.</p></article><article className="panel method-card"><Activity size={24} /><h3>روش محاسبه</h3><p>همبستگی از بازده‌های هم‌زمان به‌دست می‌آید. نوسان با انحراف معیار نمونه‌ای سنجیده می‌شود و افت را از بالاترین مقدار پیشین حساب می‌کنیم. VaR و ES بر پایهٔ بخش پایینی بازده‌های تاریخی‌اند. سناریوی ارز رابطهٔ یک‌دوره‌ای گذشته را توصیف می‌کند.</p></article><article className="panel method-card"><CircleHelp size={24} /><h3>محدودیت داده‌ها</h3><p>تاریخچهٔ روزانهٔ ETS هنوز پیوسته نیست و فقط تاریخ‌های تأییدشده را دارد. شاخص خام قیمت مصرف‌کننده هم با تأخیر منتشر می‌شود؛ به همین دلیل، سری دلار حقیقی تا آخرین انتشار CPI ادامه دارد. آرشیو اخزا ممکن است بعضی اوراق سررسیدشده را نداشته باشد.</p></article></div>
    <div className="panel risk-table-panel"><div className="panel-header"><div><span className="panel-kicker">دوره، تعداد داده و منبع</span><h3>مشخصات شاخص‌ها</h3></div><span className="badge">{formatNumber(series.length)} شاخص</span></div><div className="table-scroll"><table className="risk-table coverage-table"><thead><tr><th>شاخص</th><th>تواتر</th><th>تعداد داده</th><th>شروع</th><th>آخرین مقدار</th><th>منبع</th></tr></thead><tbody>{series.map((s) => <tr key={s.id}><th scope="row">{s.shortTitle}</th><td>{frequencyLabel(s.frequency)}</td><td>{formatNumber(s.points.length)}</td><td>{formatDate(s.points[0].date)}</td><td>{formatDate(s.points.at(-1)!.date)}</td><td>{s.source}</td></tr>)}</tbody></table></div></div><div className="panel method-strip"><strong>برآورد بازده اخزا:</strong> [(ارزش اسمی ÷ قیمت معامله)^(۳۶۵ ÷ روز تا سررسید) − ۱] × ۱۰۰. این برآورد با YTM اعلام‌شدهٔ فرابورس یکی نیست.</div></>;
}

export default function Dashboard() {
  const { series, loading, error, missing, refresh, snapshotAt } = useSeries();
  const [view, setView] = useState<View>("overview");
  const [analysisStartSubview, setAnalysisStartSubview] = useState<MacroAnalysisSubview>("risk");
  const [marketSubview, setMarketSubview] = useState<MarketSubview>("indices");
  const [selectedId, setSelectedId] = useState("tedpix");
  const [search, setSearch] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const savedFavorites = useSyncExternalStore(subscribeWatchlist, readWatchlist, initialWatchlist);
  const favorites: string[] = (() => { try { const data: unknown = JSON.parse(savedFavorites); return Array.isArray(data) ? data.filter((item): item is string => typeof item === "string") : []; } catch { return []; } })();
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [storageMessage, setStorageMessage] = useState("");
  function toggleFavorite(id: string) {
    const next = favorites.includes(id) ? favorites.filter((item) => item !== id) : [...favorites, id];
    try { localStorage.setItem(watchlistKey, JSON.stringify(next)); window.dispatchEvent(new Event("econotes-watchlist")); setStorageMessage(""); }
    catch { setStorageMessage("دیدبان برای این جلسه تغییر کرد؛ مرورگر ذخیره‌سازی دائمی را اجازه نداد."); }
  }
  const selectView = (next: View) => { setView(next); setMobileOpen(false); };
  const openAnalysis = (subview: MacroAnalysisSubview) => { setAnalysisStartSubview(subview); selectView("analysis"); };
  const openMarket = (subview: MarketSubview) => { setMarketSubview(subview); selectView("markets"); };
  const openWatchlist = () => { setOnlyFavorites(true); selectView("overview"); };
  const open = (id: string) => { setSelectedId(id); selectView("series"); };
  const current = series.find((item) => item.id === selectedId) ?? series[0];
  const favoriteSeries = favorites.map((id) => series.find((s) => s.id === id)).filter((s): s is Series => Boolean(s));
  const featured = onlyFavorites ? favoriteSeries : [];
  const query = search.trim().toLocaleLowerCase();
  const filtered = series.filter((s) => {
    const domain = catalogDomains.find((item) => item.groups.includes(s.group));
    return `${s.title} ${s.shortTitle} ${s.source} ${groups[s.group]} ${domain?.title ?? ""} ${catalogSubgroupFor(s)}`
      .toLocaleLowerCase().includes(query);
  });
  const catalogView = catalogDomains.map((domain) => {
    const items = filtered.filter((s) => domain.groups.includes(s.group));
    const subgroupNames = [...new Set(items.map(catalogSubgroupFor))];
    return { ...domain, count: items.length, subgroups: subgroupNames.map((name) => ({ name, items: items.filter((s) => catalogSubgroupFor(s) === name) })) };
  }).filter((domain) => domain.count > 0);
  const heading = view === "series" ? current?.shortTitle ?? "شاخص" : view === "markets" ? marketSubview === "indices" ? "شاخص‌های بورس" : "اوراق بدهی" : categories.find((c) => c.id === view)?.label;
  return <div className="app-shell"><a className="skip-link" href="#main-content">رفتن به محتوای اصلی</a>
    <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}><div className="brand"><div className="brand-mark"><Activity size={25} /></div><div><strong>اکونوتس</strong><span>اقتصاد کلان و بازارها</span></div><button className="mobile-close icon-button" onClick={() => setMobileOpen(false)} aria-label="بستن منو"><X size={20} /></button></div><div className="side-caption">بازار ایران</div><nav aria-label="ناوبری اصلی">{categories.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${view === id ? "active" : ""}`} aria-current={view === id ? "page" : undefined} onClick={() => selectView(id)}><Icon size={18} /><span>{label}</span></button>)}</nav><div className="side-caption side-caption-spaced">دیدبان من</div><nav aria-label="دیدبان من"><button className={`nav-item nav-data ${view === "overview" && onlyFavorites ? "active" : ""}`} aria-current={view === "overview" && onlyFavorites ? "page" : undefined} onClick={openWatchlist}><Star size={16} /><span>همهٔ شاخص‌های من</span></button>{favoriteSeries.slice(0, 4).map((s) => <button key={s.id} className={`nav-item nav-data ${view === "series" && selectedId === s.id ? "active" : ""}`} onClick={() => open(s.id)}><span className="nav-dot" style={{ background: s.color }} /><span>{s.shortTitle}</span></button>)}{favoriteSeries.length > 4 && <button className="nav-item nav-data" onClick={openWatchlist}><span>و {formatNumber(favoriteSeries.length - 4)} شاخص دیگر</span></button>}{!favoriteSeries.length && <p className="watchlist-empty">برای افزودن، یک شاخص را باز کنید.</p>}</nav><div className="sidebar-bottom"><span className={`status-pulse ${error ? "status-error" : missing.length ? "status-warning" : ""}`} /><div><strong>{loading ? "در حال دریافت داده‌ها" : error ? "داده‌ها بارگذاری نشدند" : missing.length ? "بعضی شاخص‌ها در دسترس نیستند" : "داده‌ها در دسترس‌اند"}</strong><span>{error ? "برای بارگیری دوباره، دکمهٔ بالای صفحه را بزنید" : missing.length ? "ممکن است بعضی بخش‌ها کامل نباشند" : "تاریخ هر مقدار کنار آن آمده است"}</span></div></div></aside>
    {mobileOpen && <button className="mobile-scrim" aria-label="بستن منو" onClick={() => setMobileOpen(false)} />}
    <main id="main-content" className="main-area" tabIndex={-1}><header className="topbar"><div className="topbar-start"><button className="mobile-menu icon-button" onClick={() => setMobileOpen(true)} aria-label="باز کردن منو" aria-expanded={mobileOpen}><Menu size={21} /></button><span className="breadcrumb">بازار ایران</span><span className="breadcrumb-separator">/</span><strong>{heading}</strong></div><div className="topbar-end">{staticDataMode && snapshotAt && <span className="snapshot-status" title="تاریخ ساخت بستهٔ داده؛ آخرین مقدار هر شاخص روی همان کارت آمده است.">نسخه داده · {formatDate(snapshotAt.slice(0, 10))}</span>}<button className="icon-button" onClick={refresh} aria-label="دریافت دوباره داده‌ها" title="بارگذاری دوباره"><RefreshCw size={17} /></button></div></header>
    <div className="page-content">
      {error && <div className="data-alert" role="alert"><span>{error}</span><button className="outline-button" onClick={refresh}>تلاش دوباره</button></div>}
      {missing.length > 0 && <div className="data-alert" role="status">{formatNumber(missing.length)} شاخص بارگذاری نشد: {missing.join("، ")}. بخش‌های دیگر با داده‌های موجود نمایش داده می‌شوند.</div>}
      {storageMessage && <div className="data-alert" role="status">{storageMessage}</div>}
      {loading && !series.length ? <div className="loading-state" role="status"><div className="eyebrow">در حال دریافت داده‌ها…</div><div className="skeleton-title" /><div className="market-grid">{Array.from({ length: 8 }, (_, i) => <div className="skeleton-card" key={i} />)}</div></div> : !series.length ? <div className="panel empty-state"><Database size={32} /><h1>داده‌ای برای نمایش نیست</h1><p>داده‌ها دریافت نشدند. اتصال را بررسی کنید و دوباره تلاش کنید.</p><button className="outline-button" onClick={refresh}>دریافت دوباره</button></div> : <>
      {view === "overview" && <><div className="page-intro overview-intro"><div><div className="eyebrow"><span className="eyebrow-line" /> اقتصاد کلان و بازارهای ایران</div><h1>نمای کلی</h1><p>نمای فشرده‌ای از متغیرهای کلیدی اقتصاد و بازارهای دارایی ایران.</p><div className="intro-actions"><button className="primary-button" onClick={() => openAnalysis("risk")}>تحلیل کلان <ArrowLeft size={16} /></button><button className="text-action" onClick={() => selectView("catalog")}>فهرست داده‌ها <ArrowLeft size={16} /></button></div></div></div>
        <div className="section-title"><div><h2>{onlyFavorites ? "دیدبان من" : "پایش اقتصاد کلان"}</h2><span className="section-sub">{onlyFavorites ? "شاخص‌هایی که برای پیگیری ذخیره کرده‌اید." : "آخرین مقدار و روند هر شاخص را یک‌جا ببینید."}</span></div><div className="period-tabs" role="group" aria-label="نمای کلی"><button type="button" className={!onlyFavorites ? "selected" : ""} aria-pressed={!onlyFavorites} onClick={() => setOnlyFavorites(false)}>نمای کلان</button><button type="button" className={onlyFavorites ? "selected" : ""} aria-pressed={onlyFavorites} onClick={() => setOnlyFavorites(true)}><Star size={12} /> دیدبان من</button></div></div>
        {onlyFavorites ? <><div className="market-grid">{featured.map((s) => <Card key={s.id} item={s} open={() => open(s.id)} />)}</div>{!featured.length && <div className="panel empty-state"><Star size={25} /><p>هنوز شاخصی در دیدبان نیست. برای افزودن، یک شاخص را باز کنید و «افزودن به دیدبان» را انتخاب کنید.</p><button className="outline-button" onClick={() => selectView("catalog")}>پیدا کردن شاخص</button></div>}</> : <div className="overview-grid">{overviewSections.map((section) => <OverviewSection key={section.id} title={section.title} description={section.description} wide={section.wide} items={section.seriesIds.map((id) => series.find((item) => item.id === id)).filter((item): item is Series => Boolean(item))} open={open} />)}</div>}
      </>}
      {view === "series" && current && <SeriesDetail key={current.id} item={current} series={series} open={open} toggleFavorite={() => toggleFavorite(current.id)} favorite={favorites.includes(current.id)} />}
      {view === "markets" && <><div className="market-switcher" role="group" aria-label="بخش‌های بازارهای مالی"><button type="button" aria-pressed={marketSubview === "indices"} className={marketSubview === "indices" ? "selected" : ""} onClick={() => openMarket("indices")}>شاخص‌های بورس</button><button type="button" aria-pressed={marketSubview === "bonds"} className={marketSubview === "bonds" ? "selected" : ""} onClick={() => openMarket("bonds")}>اوراق بدهی</button></div>{marketSubview === "indices" ? <StockMarket series={series} /> : <BondMarket />}</>}
      {view === "analysis" && <MacroAnalysis series={series} initialSubview={analysisStartSubview} />}
      {view === "catalog" && <><div className="page-intro compact"><div><div className="eyebrow"><span className="eyebrow-line" /> داده‌ها</div><h1>شاخص‌ها و متغیرها</h1><p>شاخص‌ها را بر پایهٔ موضوع پیدا کنید. برای دیدن نمودار و دریافت CSV، یک شاخص را باز کنید.</p></div></div><div className="catalog-toolbar"><div className="search-box"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جست‌وجوی شاخص، موضوع یا منبع…" aria-label="جست‌وجوی شاخص" /></div><span>{formatNumber(filtered.length)} شاخص</span></div><div className="catalog-groups">{catalogView.map((domain) => <section className="panel catalog-section" key={domain.id}><div className="catalog-group-head"><div className="catalog-domain-copy"><h2>{domain.title}</h2><p>{domain.description}</p></div><span>{formatNumber(domain.count)} شاخص</span></div>{domain.subgroups.map((subgroup) => <div className="catalog-subgroup" key={subgroup.name}><div className="catalog-subgroup-head"><h3>{subgroup.name}</h3><span>{formatNumber(subgroup.items.length)}</span></div>{subgroup.items.map((s) => <button className="catalog-row" key={s.id} onClick={() => open(s.id)}><span className="catalog-dot" style={{ background: s.color }} /><span className="catalog-name"><strong>{s.title}</strong><small>{s.source} · {formatDate(s.points.at(-1)!.date)}</small></span><span className="catalog-source">{formatNumber(s.points.length)} مشاهده</span><span className="badge">{frequencyLabel(s.frequency)}</span><ArrowLeft size={16} /></button>)}</div>)}</section>)}</div>{!filtered.length && <div className="empty-state">شاخصی با این عبارت پیدا نشد.</div>}{!query && <p className="catalog-roadmap">حوزه‌های بعدی برای افزودن: حساب‌های ملی و رشد، تجارت خارجی، مالیهٔ عمومی و کار و دستمزد.</p>}</>}
      {view === "method" && <Method series={series} />}
      </>}
    </div><footer className="footer"><span>اکونوتس © ۲۰۲۶ · اقتصاد کلان و بازارهای ایران</span><div><a href="/privacy">حریم خصوصی</a><a href="/terms">شرایط استفاده</a></div></footer></main>
  </div>;
}
