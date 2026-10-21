"use client";

import { useState } from "react";
import Chart from "./chart";
import { drawdowns, relativePerformance } from "@/lib/analytics";
import { formatDate, formatNumber, last, periodPoints, type Series } from "@/lib/data";
import { themeColors } from "@/lib/theme";

export default function StockMarket({ series }: { series: Series[] }) {
  const [months, setMonths] = useState<number | null>(12);
  const total = series.find((s) => s.id === "tedpix");
  const equal = series.find((s) => s.id === "equal");
  if (!total || !equal) return <div className="empty-state">برای مقایسه، دادهٔ شاخص کل و هم‌وزن هر دو لازم است.</div>;
  const totalPoints = periodPoints(total.points, months);
  const equalPoints = periodPoints(equal.points, months);
  const dates = new Set(equalPoints.map((p) => p.date));
  const start = totalPoints.find((p) => dates.has(p.date))?.date;
  const left = totalPoints.filter((p) => start && p.date >= start);
  const right = equalPoints.filter((p) => start && p.date >= start);
  const rebase = (points: Series["points"]) => points.map((p) => ({ ...p, value: p.value / points[0].value * 100 }));
  const relative = relativePerformance(right, left);
  return <section><div className="page-intro compact"><div><div className="eyebrow"><span className="eyebrow-line" /> بورس تهران</div><h1>شاخص کل و هم‌وزن</h1><p>بازده روزانهٔ شاخص کل و هم‌وزن را کنار هم ببینید؛ این مقایسه حرکت شرکت‌های بزرگ را از عملکرد گسترده‌تر بازار جدا می‌کند.</p></div></div><div className="panel method-strip">این صفحه فقط شاخص کل و هم‌وزن را مقایسه می‌کند؛ دادهٔ نمادهای منفرد در آن نیست.</div>
    <div className="detail-toolbar risk-toolbar"><div className="period-tabs">{[3, 12, null].map((n) => <button key={String(n)} className={months === n ? "selected" : ""} onClick={() => setMonths(n)}>{n === null ? "تمام دوره" : n === 12 ? "۱ سال" : "۳ ماه"}</button>)}</div><span className="muted">بازه تا آخرین مشاهده، با تقویم واقعی</span></div><div className="analysis-summary"><article className="panel"><span>شاخص کل</span><strong>{formatNumber(last(total))}</strong><small>{formatDate(total.points.at(-1)!.date)}</small></article><article className="panel"><span>شاخص هم‌وزن</span><strong>{formatNumber(last(equal))}</strong><small>{formatDate(equal.points.at(-1)!.date)}</small></article><article className="panel"><span>عملکرد نسبی هم‌وزن</span><strong>{formatNumber((relative.at(-1)?.value ?? 100) - 100, 2)}٪</strong><small>نسبت هم‌وزن به شاخص کل؛ پایه مشترک ۱۰۰</small></article></div>
    <article className="panel chart-main"><div className="panel-header"><h3>عملکرد در بازه مشترک</h3><span className="badge">شروع ۱۰۰</span></div><div className="dual-legend"><span><i style={{ background: total.color }} /> شاخص کل</span><span><i style={{ background: equal.color }} /> هم‌وزن</span></div><Chart points={rebase(left)} color={total.color} comparison={{ points: rebase(right), color: equal.color, name: "هم‌وزن" }} unit="شاخص پایه ۱۰۰" height={340} area={false} /></article><div className="bond-chart-grid risk-toolbar"><article className="panel chart-main"><div className="panel-header"><h3>هم‌وزن در برابر شاخص کل</h3></div><Chart points={relative} color={themeColors.violet} unit="نسبت شاخص‌شده" height={270} /><p className="panel-note">بالاتر از ۱۰۰: عملکرد بهتر هم‌وزن نسبت به شاخص کل از ابتدای بازه.</p></article><article className="panel chart-main"><div className="panel-header"><h3>افت دو شاخص از قله</h3></div><Chart points={periodPoints(drawdowns(total.points), months)} color={total.color} comparison={{ points: periodPoints(drawdowns(equal.points), months), color: equal.color, name: "هم‌وزن" }} area={false} height={270} unit="٪ افت" /><p className="panel-note">قله از ابتدای تاریخ هر شاخص محاسبه می‌شود؛ تغییر بازهٔ نمایشی قله را بازنشانی نمی‌کند.</p></article></div>
  </section>;
}
