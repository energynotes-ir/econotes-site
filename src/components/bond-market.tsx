"use client";

import { useEffect, useMemo, useState } from "react";
import { Landmark, Search } from "lucide-react";
import Chart from "./chart";
import { formatDate, formatNumber, type Point } from "@/lib/data";
import { apiUrl } from "@/lib/api";

type Bond = {
  instrument_id: string;
  ticker: string;
  security_title: string;
  bond_type: "treasury" | "coupon";
  last_traded_date: string;
  jalali_last_traded_date: string;
  price: number;
  maturity_date: string;
  jalali_maturity_date: string;
  ytm: number;
  simple_return: number | null;
  archived?: boolean;
};

type Snapshot = {
  snapshot_at: string | null;
  risk_free: { value: number; count: number; date: string; jalali_date: string } | null;
  bonds: Bond[];
  historical_bonds: Bond[];
};

function Summary({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="panel bond-summary"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

export default function BondMarket() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<Point[]>([]);
  const [estimatedHistory, setEstimatedHistory] = useState<Point[]>([]);
  const [selectedBond, setSelectedBond] = useState<Bond | null>(null);
  const [selectedBondHistory, setSelectedBondHistory] = useState<Point[]>([]);
  const [bondHistoryLoading, setBondHistoryLoading] = useState(false);
  const [bondHistoryError, setBondHistoryError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<"all" | "treasury" | "coupon">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (selectedBond && !bondHistoryLoading) {
      document.getElementById("bond-selected-history")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [bondHistoryLoading, selectedBond]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(apiUrl("bonds")).then((response) => {
        if (!response.ok) throw new Error("دریافت داده اوراق از API ناموفق بود.");
        return response.json() as Promise<Snapshot>;
      }),
      fetch(apiUrl("series/yield?limit=1000")).then(async (response) => {
        if (!response.ok) return [] as Point[];
      const result = await response.json() as { points: Point[] };
      return result.points;
      }),
      fetch(apiUrl("series/yield-history?limit=5000")).then(async (response) => {
        if (!response.ok) return [] as Point[];
        const result = await response.json() as { points: Point[] };
        return result.points;
      }),
    ]).then(([bondData, points, estimates]) => {
      if (!active) return;
      setSnapshot(bondData);
      setHistory(points);
      setEstimatedHistory(estimates);
      if (!bondData.bonds.length && !bondData.historical_bonds.length) setError("هنوز داده‌ای از فرابورس یا آرشیو TSETMC در پایگاه محلی ثبت نشده است.");
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "دریافت داده ناموفق بود.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const currentBonds = useMemo(() => snapshot?.bonds ?? [], [snapshot]);
  const bonds = useMemo(() => {
    const currentIds = new Set(currentBonds.map((bond) => bond.instrument_id));
    const archive = (snapshot?.historical_bonds ?? [])
      .filter((bond) => !currentIds.has(bond.instrument_id))
      .map((bond) => ({ ...bond, archived: true }));
    return [...currentBonds, ...archive];
  }, [currentBonds, snapshot]);
  const treasury = currentBonds.filter((bond) => bond.bond_type === "treasury" && /اخزا|سخاب/.test(bond.ticker));
  const couponBonds = currentBonds.filter((bond) => bond.bond_type === "coupon");
  const filtered = useMemo(() => bonds.filter((bond) =>
    (kind === "all" || bond.bond_type === kind) &&
    `${bond.ticker} ${bond.security_title}`.toLowerCase().includes(search.trim().toLowerCase())), [bonds, kind, search]);
  const curve = treasury.map((bond) => ({ date: bond.maturity_date, value: bond.ytm, symbol: `${bond.ticker} · معامله ${bond.jalali_last_traded_date}` }));
  const couponCurve = couponBonds.map((bond) => ({ date: bond.maturity_date, value: bond.ytm, symbol: `${bond.ticker} · معامله ${bond.jalali_last_traded_date}` }));
  const simpleReturns = treasury.filter((bond) => bond.simple_return !== null)
    .map((bond) => ({ date: bond.maturity_date, value: bond.simple_return!, symbol: `${bond.ticker} · معامله ${bond.jalali_last_traded_date}` }));

  const showBondHistory = async (bond: Bond) => {
    setSelectedBond(bond);
    setSelectedBondHistory([]);
    setBondHistoryError("");
    setBondHistoryLoading(true);
    try {
      const response = await fetch(apiUrl(`bonds/${bond.instrument_id}/history?limit=5000`));
      if (!response.ok) throw new Error("تاریخچه معاملات این نماد دریافت نشد.");
      const result = await response.json() as { points: Point[] };
      setSelectedBondHistory(result.points);
    } catch (reason) {
      setBondHistoryError(reason instanceof Error ? reason.message : "دریافت تاریخچه ناموفق بود.");
    } finally {
      setBondHistoryLoading(false);
    }
  };

  return <>
    <div className="page-intro compact bond-intro"><div><div className="eyebrow"><span className="eyebrow-line" /> بازار بدهی ایران</div><h1>منحنی بازده،<br /><em>ورقه به ورقه.</em></h1><p>بازده تا سررسید و قیمت آخرین معامله اوراق اخزا، سخاب و اوراق کوپنی را بررسی کنید. روی هر نقطه بروید تا نماد و تاریخ معامله را ببینید.</p></div><div className="bond-source"><Landmark size={20} /><span>منبع: فرابورس ایران · YTM</span></div></div>

    {error && <div className={`panel bond-notice ${bonds.length ? "" : "bond-notice-warning"}`} role="status">{error} {bonds.length === 0 && <span>پس از اجرای API و واردکننده، داده اینجا ظاهر می‌شود.</span>}</div>}

    <div className="bond-summary-grid">
      <Summary label="میانگین بازده اخزا / سخاب" value={snapshot?.risk_free ? `${formatNumber(snapshot.risk_free.value, 2)}٪` : "—"} detail={snapshot?.risk_free ? `${formatNumber(snapshot.risk_free.count)} نماد · معامله ${formatDate(snapshot.risk_free.date)}` : "بدون مشاهده"} />
      <Summary label="اخزا و سخاب فعال" value={formatNumber(treasury.length)} detail={`${formatNumber(bonds.filter((bond) => bond.archived).length)} نماد دیگر در آرشیو معاملات`} />
      <Summary label="اوراق کوپنی فعال" value={formatNumber(bonds.filter((bond) => bond.bond_type === "coupon").length)} detail="آخرین YTM منتشرشده در صفحه منبع" />
      <Summary label="زمان دریافت صفحه" value={snapshot?.snapshot_at ? new Date(snapshot.snapshot_at).toLocaleDateString("fa-IR") : "—"} detail={snapshot?.snapshot_at ? new Date(snapshot.snapshot_at).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }) : loading ? "در حال دریافت" : "API محلی"} />
    </div>

    <div className="bond-chart-grid">
      <section className="panel bond-chart-panel"><div className="panel-header"><div><span className="panel-kicker">منحنی سررسید</span><h3>YTM اوراق اخزا و سخاب</h3></div><span className="badge badge-accent">درصد سالانه</span></div>{curve.length ? <Chart points={curve} color="#46ceb6" type="scatter" area={false} height={315} unit="٪ سالانه" /> : <div className="bond-chart-empty">داده منحنی هنوز دریافت نشده است.</div>}<p className="bond-chart-caption">هر نقطه یک نماد است؛ محور افقی تاریخ سررسید و محور عمودی YTM است. تاریخ آخرین معامله نیز در راهنمای نقطه می‌آید.</p></section>
      <section className="panel bond-chart-panel"><div className="panel-header"><div><span className="panel-kicker">بازده ساده</span><h3>بازده تا سررسید ساده</h3></div><span className="badge">درصد</span></div>{simpleReturns.length ? <Chart points={simpleReturns} color="#e2ae69" type="scatter" area={false} height={315} unit="٪" /> : <div className="bond-chart-empty">منبع برای این اوراق بازده ساده‌ای نداده است.</div>}<p className="bond-chart-caption">فقط برای اوراقی نمایش داده می‌شود که منبع، بازده ساده‌شان را منتشر کرده باشد.</p></section>
      <section className="panel bond-chart-panel"><div className="panel-header"><div><span className="panel-kicker">اوراق کوپنی</span><h3>YTM اوراق اراد و شرکتی</h3></div><span className="badge">{formatNumber(couponBonds.length)} نماد</span></div>{couponCurve.length ? <Chart points={couponCurve} color="#db9b85" type="scatter" area={false} height={315} unit="٪ سالانه" /> : <div className="bond-chart-empty">داده اوراق کوپنی هنوز دریافت نشده است.</div>}<p className="bond-chart-caption">هر نقطه نماینده یک نماد کوپنی است؛ نماد و تاریخ معامله در راهنمای نقطه مشخص‌اند.</p></section>
      <section className="panel bond-chart-panel bond-history-panel"><div className="panel-header"><div><span className="panel-kicker">مشاهدات ذخیره‌شده از صفحه فرابورس</span><h3>YTM رسمی در تاریخ آخرین معامله نمادها</h3></div><span className="badge">{formatNumber(history.length)} مشاهده</span></div>{history.length ? <Chart points={history} color="#83a6ea" area={false} height={240} unit="٪ سالانه" /> : <div className="bond-chart-empty">تاریخچه رسمی پس از اولین واکشی ساخته می‌شود.</div>}<p className="bond-chart-caption">هر مقدار از صفحه زنده فرابورس گرفته شده و به تاریخ آخرین معامله‌ای که خود منبع اعلام کرده متصل است.</p></section>
      <section className="panel bond-chart-panel bond-history-panel"><div className="panel-header"><div><span className="panel-kicker">آرشیو روزانه TSETMC</span><h3>میانگین تاریخی YTM برآوردی اخزا و سخاب</h3></div><span className="badge badge-accent">{formatNumber(estimatedHistory.length)} روز معامله</span></div>{estimatedHistory.length ? <Chart points={estimatedHistory} color="#46ceb6" area={false} height={260} unit="٪ سالانه" /> : <div className="bond-chart-empty">آرشیو معاملات اخزا و سخاب هنوز وارد نشده است.</div>}<p className="bond-chart-caption">از قیمت پایانی روزهای دارای معامله محاسبه شده: ارزش اسمی ۱٬۰۰۰٬۰۰۰ ریال و بازده مرکب سالانه با مبنای ۳۶۵ روز. با YTM رسمی فرابورس یکی نیست.</p></section>
    </div>

    {selectedBond && <section id="bond-selected-history" className="panel bond-chart-panel bond-selected-history"><div className="panel-header"><div><span className="panel-kicker">تاریخچه نماد انتخاب‌شده</span><h3>{selectedBond.ticker} · YTM برآوردی روزانه</h3></div><button className="badge bond-history-clear" onClick={() => { setSelectedBond(null); setSelectedBondHistory([]); }}>بستن نمودار</button></div>{bondHistoryLoading ? <div className="bond-chart-empty">در حال خواندن آرشیو معاملات…</div> : bondHistoryError ? <div className="bond-chart-empty">{bondHistoryError}</div> : selectedBondHistory.length ? <Chart points={selectedBondHistory} color="#e2ae69" area={false} height={270} unit="٪ سالانه" /> : <div className="bond-chart-empty">برای این نماد معامله تاریخی در TSETMC پیدا نشد.</div>}<p className="bond-chart-caption">قیمت، تاریخ معامله و نماد را در راهنمای نمودار ببینید. بازده از قیمت معامله و تاریخ سررسید منتشرشده در فرابورس محاسبه شده است.</p></section>}

    <section className="panel bond-table-panel"><div className="panel-header"><div><span className="panel-kicker">آخرین مشاهدهٔ هر نماد در منبع</span><h3>اوراق فعال و آرشیو سررسیدشده</h3></div><span className="badge">{formatNumber(filtered.length)} ورقه</span></div><div className="bond-controls"><div className="period-tabs">{(["all", "treasury", "coupon"] as const).map((value) => <button key={value} className={kind === value ? "selected" : ""} onClick={() => setKind(value)}>{value === "all" ? "همه" : value === "treasury" ? "اخزا و سخاب" : "کوپنی"}</button>)}</div><label className="search-box bond-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="جست‌وجوی نماد یا عنوان" aria-label="جست‌وجوی اوراق" /></label></div><div className="bond-table-scroll"><table className="bond-table"><thead><tr><th>نماد</th><th>نوع / وضعیت</th><th>آخرین معامله</th><th>سررسید</th><th>قیمت ورقه</th><th>YTM</th><th>بازده ساده</th></tr></thead><tbody>{filtered.map((bond) => <tr key={bond.instrument_id}><td><button className="bond-symbol-button" onClick={() => void showBondHistory(bond)}><strong>{bond.ticker}</strong><small>{bond.security_title}</small><span>نمایش تاریخچه TSETMC</span></button></td><td>{bond.bond_type === "treasury" ? bond.archived ? "بدون کوپن · آرشیو" : "بدون کوپن · فعال" : "کوپنی · فعال"}</td><td>{formatDate(bond.last_traded_date)}</td><td>{formatDate(bond.maturity_date)}</td><td>{formatNumber(bond.price)}</td><td className="bond-ytm">{formatNumber(bond.ytm, 2)}٪</td><td>{bond.simple_return === null ? "—" : `${formatNumber(bond.simple_return, 2)}٪`}</td></tr>)}</tbody></table>{!filtered.length && <div className="bond-chart-empty">نمادی با این جست‌وجو پیدا نشد.</div>}</div><p className="bond-table-note">نمادهای سررسیدشده هم در فهرست هستند. تاریخچه قیمت معامله و YTM برآوردی را با انتخاب نماد ببینید.</p></section>
  </>;
}
