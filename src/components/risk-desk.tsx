"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import Chart from "./chart";
import { riskSummary } from "@/lib/analytics";
import { downloadCsv, formatDate, formatNumber, riskIds, type Series } from "@/lib/data";

export function stressLabel(percentile: number | null) {
  return percentile === null ? "نمونه ناکافی" : percentile >= 90 ? "تنش بالا" : percentile >= 60 ? "نوسان بالاتر" : "نوسان معمول";
}

export default function RiskDesk({ series, compact = false }: { series: Series[]; compact?: boolean }) {
  const [window, setWindow] = useState(30);
  const [selected, setSelected] = useState("tedpix");
  const items = riskIds.map((id) => series.find((s) => s.id === id)).filter((s): s is Series => Boolean(s));
  const rows = items.map((item) => ({ item, stats: riskSummary(item.points, window) }));
  const active = rows.find((row) => row.item.id === selected) ?? rows[0];
  if (!active) return <div className="empty-state">برای محاسبه ریسک هنوز داده کافی دریافت نشده است.</div>;
  const exportRows = () => downloadCsv("risk", [
    ["series", "observation_date", "window", "volatility_pct", "volatility_percentile", "drawdown_pct", "max_drawdown_pct", "historical_p05_pct", "source"],
    ...rows.map(({ item, stats }) => [item.title, item.points.at(-1)!.date, window, stats.sigma ?? "", stats.percentile ?? "", stats.currentDrawdown ?? "", stats.maxDrawdown ?? "", stats.downside ?? "", item.source] as (string | number)[]),
  ]);
  return <section aria-label="دیدبان ریسک">
    {!compact && <div className="page-intro compact"><div><div className="eyebrow"><span className="eyebrow-line" /> پایش ریسک بازار</div><h1>نوسان را بسنجید.<br /><em>افت را دنبال کنید.</em></h1><p>ریسک هر بازار را با تاریخ خودش مقایسه کنید؛ رتبه نوسان، افت از قله و روزهای پرریسک کنار هم قرار دارند.</p></div></div>}
    <div className="panel risk-table-panel">
      <div className="panel-header"><div><span className="panel-kicker">رتبه نوسان در تاریخ هر سری</span><h3>دیدبان ریسک بازارها</h3></div>{!compact && <button className="outline-button" onClick={exportRows}><Download size={15} /> گزارش CSV</button>}</div>
      {!compact && <div className="detail-toolbar risk-toolbar"><div className="period-tabs" aria-label="پنجره ریسک">{[30, 60, 120].map((size) => <button key={size} className={window === size ? "selected" : ""} onClick={() => setWindow(size)}>{formatNumber(size)} مشاهده</button>)}</div><span className="muted">بازده هر مشاهده · بدون سالانه‌سازی</span></div>}
      <div className="table-scroll"><table className="risk-table"><thead><tr><th scope="col">بازار / تاریخ</th><th scope="col">نوسان σ</th><th scope="col">صدک نوسان</th><th scope="col">افت از قله</th>{!compact && <th scope="col">بیشترین افت</th>}<th scope="col">وضعیت</th></tr></thead><tbody>{rows.map(({ item, stats }) => <tr key={item.id} className={selected === item.id ? "table-selected" : ""}><th scope="row"><button className="table-market" onClick={() => setSelected(item.id)}><span className="nav-dot" style={{ background: item.color }} />{item.shortTitle}</button><small>{formatDate(item.points.at(-1)!.date)}</small></th><td>{formatNumber(stats.sigma ?? NaN, 2)}٪</td><td><div className="percentile-cell"><span>{formatNumber(stats.percentile ?? NaN)} / ۱۰۰</span><meter min={0} max={100} value={stats.percentile ?? 0} aria-label={`صدک نوسان ${item.shortTitle}`} /></div></td><td className="negative-text">{formatNumber(stats.currentDrawdown ?? NaN, 2)}٪</td>{!compact && <td>{formatNumber(stats.maxDrawdown ?? NaN, 2)}٪</td>}<td><span className={`badge ${stats.percentile !== null && stats.percentile >= 90 ? "badge-danger" : "badge-neutral"}`}>{stressLabel(stats.percentile)}</span></td></tr>)}</tbody></table></div>
      <p className="panel-note">صدک بر پایه همه پنجره‌های کامل گذشته است؛ حداقل ۶۰ پنجره لازم دارد. تاریخ‌ها ممکن است متفاوت باشند. تنش بالا یعنی صدک ۹۰ یا بیشتر، نه پیش‌بینی ریزش.</p>
    </div>
    {!compact && <><div className="analysis-summary"><article className="panel"><span>بازار منتخب</span><strong>{active.item.shortTitle}</strong><small>{formatNumber(active.item.points.length)} مشاهده واقعی</small></article><article className="panel"><span>صدک پنجم بازده تاریخی</span><strong>{formatNumber(active.stats.downside ?? NaN, 2)}٪</strong><small>در {formatNumber(window)} بازده اخیر؛ برآورد آینده نیست</small></article><article className="panel"><span>فاصله از بالاترین سطح</span><strong>{formatNumber(active.stats.currentDrawdown ?? NaN, 2)}٪</strong><small>از ابتدای تاریخ موجود</small></article></div><div className="bond-chart-grid"><article className="panel chart-main"><div className="panel-header"><div><span className="panel-kicker">مسیر افت</span><h3>افت {active.item.shortTitle} از قله تاریخی</h3></div></div><Chart points={active.stats.drawdown} color="#bf616a" height={290} unit="٪ افت" area={false} /></article><article className="panel chart-main"><div className="panel-header"><div><span className="panel-kicker">ریسک متحرک</span><h3>انحراف معیار بازده لگاریتمی</h3></div></div><Chart points={active.stats.volatility} color="#88c0d0" height={290} unit="٪ در هر مشاهده" /></article></div><div className="panel method-strip">بازده شاخص کل و هم‌وزن شامل اثر سود نقدی است؛ افت شاخص، افت قیمت یک سبد واقعی را به‌تنهایی نشان نمی‌دهد. بازده دلار و طلا بر مبنای قیمت پایانی محاسبه می‌شود.</div></>}
  </section>;
}
