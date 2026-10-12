"use client";

import { useState, useSyncExternalStore } from "react";
import { Activity, ArrowLeft, BarChart3, CircleHelp, Database, Download, GitCompareArrows, Landmark, LayoutDashboard, Menu, RefreshCw, Search, Star, X } from "lucide-react";
import Chart from "./chart";
import MacroAnalysis, { type MacroAnalysisSubview } from "./macro-analysis";
import StockMarket from "./stock-market";
import BondMarket from "./bond-market";
import RiskDesk from "./risk-desk";
import { change, downloadCsv, featuredIds, formatDate, formatNumber, frequencyLabel, groups, last, periodPoints, type Group, type Series } from "@/lib/data";
import { returns, rollingVariance } from "@/lib/analytics";
import { useSeries } from "@/lib/use-series";
import { staticDataMode } from "@/lib/api";

type View = "overview" | "series" | "analysis" | "catalog" | "method" | "stock" | "bonds";
const categories = [
  { id: "overview" as View, label: "دیدبان اقتصاد", icon: LayoutDashboard },
  { id: "stock" as View, label: "شاخص‌های بورس", icon: BarChart3 },
  { id: "bonds" as View, label: "اوراق بدهی", icon: Landmark },
  { id: "analysis" as View, label: "تحلیل کلان", icon: GitCompareArrows },
  { id: "catalog" as View, label: "کتابخانه داده", icon: Database },
  { id: "method" as View, label: "روش و کیفیت داده", icon: CircleHelp },
];
const watchlistKey = "econotes.watchlist.v1";
const subscribeWatchlist = (notify: () => void) => {
  window.addEventListener("storage", notify);
  window.addEventListener("econotes-watchlist", notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener("econotes-watchlist", notify); };
};
const readWatchlist = () => { try { return window.localStorage.getItem(watchlistKey) ?? "[]"; } catch { return "[]"; } };
const initialWatchlist = () => "[]";

function Delta({ item }: { item: Series }) {
  const isRate = item.unit.includes("درصد");
  const value = isRate ? last(item) - (item.points.at(-2)?.value ?? NaN) : change(item);
  return <span className={`trend ${value >= 0 ? "positive" : "negative"}`}>{value > 0 ? "+" : ""}{formatNumber(value, 2)}{isRate ? " واحد درصد" : "٪"}</span>;
}

function Card({ item, open, wide = false }: { item: Series; open: () => void; wide?: boolean }) {
  return <button className={`market-card ${wide ? "market-card-wide" : ""}`} onClick={open}>
    <div className="card-head"><span className="nav-dot" style={{ background: item.color }} /><span>{item.shortTitle}</span><span className="card-live">{frequencyLabel(item.frequency)}</span><ArrowLeft size={15} className="card-arrow" /></div>
    <div className="card-figure"><strong>{formatNumber(last(item), item.unit.includes("درصد") ? 2 : 0)}</strong><small>{item.unit}</small></div>
    <div className="card-bottom"><Delta item={item} /><span>نسبت به مشاهده قبل</span></div>
    <Chart points={item.points.slice(-70)} color={item.color} mini type={item.points.length < 8 ? "scatter" : "line"} height={wide ? 84 : 62} />
    <small className="card-observed">{formatDate(item.points.at(-1)!.date)} · {item.source}</small>
  </button>;
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
  return <section><div className="detail-heading"><div><div className="eyebrow"><span className="eyebrow-line" />{groups[item.group]}</div><h1>{item.title}</h1><p>{item.description}</p></div><div className="detail-value"><span>آخرین مشاهده · {formatDate(item.points.at(-1)!.date)}</span><strong>{formatNumber(last(item), item.unit.includes("درصد") ? 2 : 1)}</strong><div><small>{item.unit}</small><Delta item={item} /></div></div></div>
    <div className="detail-toolbar"><div className="period-tabs" aria-label="بازه زمانی">{[3, 12, null].map((n) => <button key={String(n)} className={months === n ? "selected" : ""} onClick={() => setMonths(n)}>{n === null ? "تمام دوره" : n === 12 ? "۱ سال" : "۳ ماه"}</button>)}</div><div className="toolbar-right"><button className={`outline-button ${favorite ? "favorite-active" : ""}`} onClick={toggleFavorite}><Star size={15} fill={favorite ? "currentColor" : "none"} />{favorite ? "در دیدبان من" : "افزودن به دیدبان"}</button><button className="outline-button" onClick={exportSeries}><Download size={15} /> دریافت CSV</button></div></div>
    <div className="detail-grid"><article className="panel chart-main"><div className="panel-header"><div><span className="panel-kicker">روند تاریخی</span><h3>{item.shortTitle}</h3></div><span className="badge badge-accent">{frequencyLabel(item.frequency)}</span></div><Chart points={visible} color={item.color} step={item.frequency !== "daily"} type={item.points.length < 8 ? "scatter" : "line"} height={340} unit={item.unit} /><div className="chart-footer">برای جزئیات روی نمودار حرکت کنید؛ برای بررسی یک بازه، نوار پایین را جابه‌جا کنید.</div></article>
    <aside className="panel insight-panel"><div className="panel-header"><h3>شناسنامه داده</h3><Database size={18} /></div><div className="fact-row"><span>منبع</span><strong>{item.source}</strong></div><div className="fact-row"><span>واحد / تواتر</span><strong>{item.unit} · {frequencyLabel(item.frequency)}</strong></div><div className="fact-row"><span>شروع تاریخچه</span><strong>{formatDate(item.points[0].date)}</strong></div><div className="fact-row"><span>تعداد مشاهدات</span><strong>{formatNumber(item.points.length)}</strong></div>{item.retrievedAt && <div className="fact-row"><span>زمان دریافت</span><strong>{new Date(item.retrievedAt).toLocaleString("fa-IR")}</strong></div>}<div className="insight-callout"><p>زمان دریافت با زمان انتشار منبع متفاوت است. برای داده ماهانه و فصلی، مقدار بین دو مشاهده به‌صورت پله‌ای نمایش داده می‌شود؛ مشاهده روزانه تازه‌ای ساخته نمی‌شود.</p></div></aside>
    {variances.map((points, index) => <article className="panel small-chart" key={index}><div className="panel-header"><div><span className="panel-kicker">{index ? "شتاب تغییرات" : "ریسک تغییرات"}</span><h3>{index ? "واریانس تغییر بازده" : rate ? "واریانس تغییر نرخ" : "واریانس بازده درصدی"}</h3></div><span className="badge">{formatNumber(window)} مشاهده</span></div><Chart points={points} color={index ? "#ebcb8b" : "#81a1c1"} height={240} unit={rate ? "واحد درصد²" : "درصد²"} /><p>واریانس نمونه‌ای با پنجره کامل؛ {rate ? "بر پایه تغییر نرخ در واحد درصد" : "بر پایه بازده لگاریتمی درصدی"}. {points.some((p) => Number.isFinite(p.value)) ? "" : "هنوز داده کافی برای پنجره کامل وجود ندارد."}</p></article>)}</div>
    {relatives.length > 0 && <div className="panel related-panel"><div className="panel-header"><h3>{item.group === "money" ? "اجزا و عوامل مرتبط" : "سری‌های مرتبط"}</h3><span className="badge">{formatNumber(relatives.length)} سری</span></div><div className="related-grid">{relatives.map((s) => <button key={s.id} onClick={() => open(s.id)}><span>{s.shortTitle}</span><strong>{formatNumber(last(s), s.unit.includes("درصد") ? 2 : 0)}</strong><small>{s.unit} · {formatDate(s.points.at(-1)!.date)}</small></button>)}</div></div>}
  </section>;
}

function Method({ series }: { series: Series[] }) {
  return <><div className="page-intro compact"><div><div className="eyebrow"><span className="eyebrow-line" /> روش و کیفیت داده</div><h1>هر عدد،<br /><em>یک مسیر قابل پیگیری.</em></h1><p>منبع، تواتر، تاریخ مشاهده و روش محاسبه را پیش از استفاده از تحلیل بررسی کنید.</p></div></div><div className="method-grid"><article className="panel method-card"><Database size={24} /><h3>یک منبع برای هر تعریف</h3><p>نمای دلار آزاد فقط قیمت پایانی تتر والکس به تومان است. نرخ خرید و فروش حواله ETS و آرشیو ماهانه رسمی بانک مرکزی سری‌های مستقل‌اند. انس جهانی قیمت spot در TGJU است و fixing لندن نیست. پوشش بورس شامل شاخص کل و هم‌وزن TSETMC است.</p></article><article className="panel method-card"><Activity size={24} /><h3>محاسبات قابل بازتولید</h3><p>همبستگی از بازده لگاریتمی هم‌دوره، نوسان از انحراف معیار نمونه‌ای و افت از بیشترین سطح گذشته محاسبه می‌شوند. OLS سناریو فقط حساسیت تاریخی هم‌زمان و یک‌دوره‌ای را توصیف می‌کند؛ مسیر شوک پایا فعلاً فقط ورودی محرک را نشان می‌دهد. پاسخ چنددوره‌ای و باند عدم‌قطعیت تا انتشار artifact افق‌دارِ تأیید و اعتبارسنجی‌شده در دسترس نیستند. خروجی CSV سری‌ها، ریسک و سناریو ارائه می‌شود.</p></article><article className="panel method-card"><CircleHelp size={24} /><h3>محدودیت‌های پوشش</h3><p>ETS روزانه تاریخچه کوتاهی دارد. CPI خام ایران از نرخ‌های انتشار اخیر عقب‌تر است؛ دلار حقیقی فقط تا آخرین CPI خام ادامه دارد. تاریخچه بازده اخزا برای اوراق فعال دریافت شده و ممکن است سوگیری بقا داشته باشد. به‌روزرسانی خودکار تضمین انتشار منبع نیست.</p></article></div>
    <div className="panel risk-table-panel"><div className="panel-header"><div><span className="panel-kicker">پوشش واقعی داده‌های دریافت‌شده</span><h3>گزارش پوشش و تازگی</h3></div><span className="badge">{formatNumber(series.length)} سری</span></div><div className="table-scroll"><table className="risk-table coverage-table"><thead><tr><th>سری</th><th>تواتر</th><th>مشاهده</th><th>شروع</th><th>آخرین مشاهده</th><th>منبع</th></tr></thead><tbody>{series.map((s) => <tr key={s.id}><th scope="row">{s.shortTitle}</th><td>{frequencyLabel(s.frequency)}</td><td>{formatNumber(s.points.length)}</td><td>{formatDate(s.points[0].date)}</td><td>{formatDate(s.points.at(-1)!.date)}</td><td>{s.source}</td></tr>)}</tbody></table></div></div><div className="panel method-strip">بازده اخزا: [(ارزش اسمی ÷ قیمت معامله)^(۳۶۵ ÷ روز تا سررسید) − ۱] × ۱۰۰. ارزش اسمی یک‌میلیون ریال است؛ این برآورد از YTM منتشرشده فرابورس جداست. هیچ سری با داده فرضی تکمیل نمی‌شود.</div></>;
}

export default function Dashboard() {
  const { series, loading, error, missing, refresh, snapshotAt } = useSeries();
  const [view, setView] = useState<View>("overview");
  const [analysisStartSubview, setAnalysisStartSubview] = useState<MacroAnalysisSubview>("risk");
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
  const open = (id: string) => { setSelectedId(id); selectView("series"); };
  const current = series.find((item) => item.id === selectedId) ?? series[0];
  const featured = (onlyFavorites ? favorites : featuredIds).map((id) => series.find((s) => s.id === id)).filter((s): s is Series => Boolean(s));
  const filtered = series.filter((s) => `${s.title} ${s.shortTitle} ${s.source} ${groups[s.group]}`.includes(search.trim()));
  const heading = view === "series" ? current?.shortTitle ?? "سری داده" : categories.find((c) => c.id === view)?.label;
  return <div className="app-shell"><a className="skip-link" href="#main-content">رفتن به محتوای اصلی</a>
    <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}><div className="brand"><div className="brand-mark"><Activity size={25} /></div><div><strong>اکونوتس</strong><span>ECONOTES / RESEARCH DESK</span></div><button className="mobile-close icon-button" onClick={() => setMobileOpen(false)} aria-label="بستن منو"><X size={20} /></button></div><div className="side-caption">میز تحلیل</div><nav aria-label="ناوبری اصلی">{categories.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${view === id ? "active" : ""}`} aria-current={view === id ? "page" : undefined} onClick={() => selectView(id)}><Icon size={18} /><span>{label}</span>{id === "catalog" && <small>{formatNumber(series.length)}</small>}</button>)}</nav><div className="side-caption side-caption-spaced">دسترسی سریع</div><nav aria-label="متغیرهای منتخب">{["usd-free", "usd-official-remittance-cbi", "liquidity", "base-money", "gold", "cpi-mom-cbi", "yield", "omo-repo"].map((id) => series.find((s) => s.id === id)).filter((s): s is Series => Boolean(s)).map((s) => <button key={s.id} className={`nav-item nav-data ${view === "series" && selectedId === s.id ? "active" : ""}`} onClick={() => open(s.id)}><span className="nav-dot" style={{ background: s.color }} /><span>{s.shortTitle}</span></button>)}</nav><div className="sidebar-bottom"><span className={`status-pulse ${error ? "status-error" : ""}`} /><div><strong>{loading ? "در حال دریافت داده" : error ? "اتصال نیاز به بررسی دارد" : "داده‌های منبع‌دار"}</strong><span>تاریخ مشاهده کنار هر سری</span></div></div></aside>
    {mobileOpen && <button className="mobile-scrim" aria-label="بستن منو" onClick={() => setMobileOpen(false)} />}
    <main id="main-content" className="main-area" tabIndex={-1}><header className="topbar"><div className="topbar-start"><button className="mobile-menu icon-button" onClick={() => setMobileOpen(true)} aria-label="باز کردن منو" aria-expanded={mobileOpen}><Menu size={21} /></button><span className="breadcrumb">میز پژوهش</span><span className="breadcrumb-separator">/</span><strong>{heading}</strong></div><div className="topbar-end"><span className="top-clock">اقتصاد ایران · بازارهای مالی</span><button className="icon-button" onClick={refresh} aria-label="دریافت دوباره داده‌ها" title="دریافت دوباره داده‌ها"><RefreshCw size={17} /></button><span className="badge badge-accent">ECONOTES</span></div></header>
    <div className="page-content">
      {staticDataMode && snapshotAt && <div className="panel method-strip">نسخه استاتیک داده · بستهٔ داده در {formatDate(snapshotAt.slice(0, 10))} ساخته شده است؛ برای تازه‌شدن داده‌ها باید snapshot جدید منتشر شود.</div>}
      {error && <div className="data-alert" role="alert"><span>{error}</span><button className="outline-button" onClick={refresh}>تلاش دوباره</button></div>}
      {missing.length > 0 && <div className="data-alert" role="status">{formatNumber(missing.length)} سری دریافت نشد: {missing.join("، ")}. تحلیل فقط از سری‌های در دسترس استفاده می‌کند.</div>}
      {storageMessage && <div className="data-alert" role="status">{storageMessage}</div>}
      {loading && !series.length ? <div className="loading-state" role="status"><div className="eyebrow">در حال دریافت سری‌های منبع‌دار…</div><div className="skeleton-title" /><div className="market-grid">{Array.from({ length: 8 }, (_, i) => <div className="skeleton-card" key={i} />)}</div></div> : !series.length ? <div className="panel empty-state"><Database size={32} /><h1>داده در دسترس نیست</h1><p>پس از برقراری اتصال، سری‌ها و ابزارهای تحلیل نمایش داده می‌شوند.</p><button className="outline-button" onClick={refresh}>دریافت دوباره</button></div> : <>
      {view === "overview" && <><div className="page-intro"><div><div className="eyebrow"><span className="eyebrow-line" /> داده، ریسک و حساسیت بازار</div><h1>اقتصاد را ببینید.<br /><em>تصمیم را دقیق‌تر کنید.</em></h1><p>از تغییر یک متغیر تا ریسک چند بازار؛ سری‌های منبع‌دار و ابزارهای قابل بازتولید، در یک میز پژوهش.</p><div className="intro-actions"><button className="primary-button" onClick={() => openAnalysis("risk")}>بررسی ریسک بازار <ArrowLeft size={16} /></button><button className="text-action" onClick={() => openAnalysis("scenario")}>ساخت سناریو <ArrowLeft size={16} /></button></div></div><div className="intro-aside"><span>کتابخانه پژوهش</span><strong>{formatNumber(series.length)}</strong><small>سری دارای مشاهده<br />روزانه، هفتگی، ماهانه و فصلی</small><button className="text-action" onClick={() => selectView("method")}>بررسی پوشش <ArrowLeft size={14} /></button></div></div>
        <div className="section-title"><div><span className="section-index">01</span><h2>{onlyFavorites ? "دیدبان من" : "متغیرهای کلیدی"}</h2><span className="section-sub">آخرین مشاهده · تغییر از مشاهده قبل</span></div><div className="period-tabs"><button className={!onlyFavorites ? "selected" : ""} onClick={() => setOnlyFavorites(false)}>منتخب‌ها</button><button className={onlyFavorites ? "selected" : ""} onClick={() => setOnlyFavorites(true)}><Star size={12} /> دیدبان من</button></div></div><div className="market-grid">{featured.map((s, index) => <Card key={s.id} item={s} wide={index === 0} open={() => open(s.id)} />)}</div>{!featured.length && <div className="panel empty-state"><Star size={25} /><p>یک سری را باز کنید و «افزودن به دیدبان» را بزنید. انتخاب‌ها در همین مرورگر ذخیره می‌شوند.</p><button className="outline-button" onClick={() => selectView("catalog")}>انتخاب از کتابخانه</button></div>}
        <div className="section-title spaced-title"><div><span className="section-index">02</span><h2>نبض ریسک</h2><span className="section-sub">نوسان و افت در پنج بازار منتخب</span></div><button className="text-action" onClick={() => openAnalysis("risk")}>گزارش کامل <ArrowLeft size={16} /></button></div><RiskDesk series={series} compact />
        <div className="workspace-tools"><article className="panel tool-feature"><span className="panel-kicker">از مشاهده به سناریو</span><h3>بازار در برابر یک شوک ارزی</h3><p>حساسیت تاریخی بورس یا طلا را بسنجید؛ قدرت توضیح مدل و دامنه خطا را کنار نتیجه ببینید.</p><button className="text-action" onClick={() => openAnalysis("scenario")}>باز کردن آزمایش سناریو <ArrowLeft size={16} /></button></article><article className="panel tool-feature"><span className="panel-kicker">روابط متغیرها</span><h3>چه زمانی بازارها هم‌جهت‌اند؟</h3><p>همبستگی متحرک، عملکرد نسبی و شکاف نرخ ارز و طلا را روی تاریخ‌های هم‌دوره بررسی کنید.</p><button className="text-action" onClick={() => openAnalysis("relationships")}>تحلیل بین‌بازاری <ArrowLeft size={16} /></button></article></div>
      </>}
      {view === "series" && current && <SeriesDetail key={current.id} item={current} series={series} open={open} toggleFavorite={() => toggleFavorite(current.id)} favorite={favorites.includes(current.id)} />}
      {view === "stock" && <StockMarket series={series} />}
      {view === "bonds" && <BondMarket />}
      {view === "analysis" && <MacroAnalysis series={series} initialSubview={analysisStartSubview} />}
      {view === "catalog" && <><div className="page-intro compact"><div><div className="eyebrow"><span className="eyebrow-line" /> کتابخانه پژوهش</div><h1>از متغیر کلان،<br /><em>تا جزئیات منبع.</em></h1><p>هر سری را برای روند تاریخی، سنجش تغییرات، اجزای مرتبط و خروجی داده باز کنید.</p></div></div><div className="catalog-toolbar"><div className="search-box"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="نام متغیر، گروه یا منبع…" aria-label="جست‌وجوی سری" /></div><span>{formatNumber(filtered.length)} سری</span></div><div className="catalog-groups">{(Object.keys(groups) as Group[]).map((group) => { const items = filtered.filter((s) => s.group === group); return items.length ? <section className="panel catalog-section" key={group}><div className="catalog-group-head"><h2>{groups[group]}</h2><span>{formatNumber(items.length)} سری</span></div>{items.map((s) => <button className="catalog-row" key={s.id} onClick={() => open(s.id)}><span className="catalog-dot" style={{ background: s.color }} /><span className="catalog-name"><strong>{s.title}</strong><small>{s.source} · آخرین مشاهده {formatDate(s.points.at(-1)!.date)}</small></span><span className="catalog-source">{formatNumber(s.points.length)} مشاهده</span><span className="badge">{frequencyLabel(s.frequency)}</span><ArrowLeft size={16} /></button>)}</section> : null; })}</div>{!filtered.length && <div className="empty-state">سری مطابق جست‌وجو پیدا نشد.</div>}</>}
      {view === "method" && <Method series={series} />}
      </>}
    </div><footer className="footer"><span>EcoNotes © 2026 · میز پژوهش اقتصاد و بازار</span><span>تحلیل آماری برای پژوهش؛ تاریخ و پوشش داده را بررسی کنید.</span><div><a href="/privacy">حریم خصوصی</a><a href="/terms">شرایط استفاده</a></div></footer></main>
  </div>;
}
