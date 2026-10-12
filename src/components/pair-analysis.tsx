"use client";

import Chart from "./chart";
import { ChevronDown } from "lucide-react";
import {
  alignEventAnnotations,
  alignedReturns,
  conditionalCorrelationByVolatilityRegime,
  correlation,
  rollingCorrelation,
  rollingVolatilityRegimes,
  toDailyStep,
} from "@/lib/analytics";
import { formatDate, formatNumber, frequencyLabel, type Frequency, type Point, type Series } from "@/lib/data";
import type { MacroEvent } from "@/lib/use-events";

type Props = {
  series: Series[];
  leftId: string;
  rightId: string;
  onLeftChange: (value: string) => void;
  onRightChange: (value: string) => void;
  windowSize: number;
  onWindowChange: (value: number) => void;
  displayMode?: "synchronized" | "native";
  showIntro?: boolean;
  showControls?: boolean;
  events?: MacroEvent[];
  eventsError?: string;
  regimeDriverId?: string;
};

function lastAtOrBefore(points: Point[], date: string) {
  let low = 0;
  let high = points.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].date <= date) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found < 0 ? undefined : points[found];
}

function rank(frequency: Frequency) {
  return frequency === "quarterly" ? 3 : frequency === "monthly" ? 2 : frequency === "weekly" ? 1 : 0;
}

function displayPoints(item: Series, dates: string[], nativeDates: boolean): Point[] {
  if (item.frequency !== "daily") return toDailyStep(item.points, dates);
  if (nativeDates) return dates.flatMap((date) => {
    const point = lastAtOrBefore(item.points, date);
    return point ? [{ ...point, date, sourceDate: point.date }] : [];
  });
  const exact = new Map(item.points.map((point) => [point.date, point]));
  return dates.map((date) => exact.get(date) ?? { date, value: NaN });
}

function normalizePair(left: Series, right: Series, displayMode: "synchronized" | "native") {
  const firstLeft = left.points[0]?.date;
  const firstRight = right.points[0]?.date;
  if (!firstLeft || !firstRight) return { left: [], right: [], stepLeft: false, stepRight: false };
  const start = firstLeft > firstRight ? firstLeft : firstRight;
  const dailyAnchor = left.frequency === "daily" ? left : right.frequency === "daily" ? right : null;
  const dates = dailyAnchor && displayMode === "synchronized"
    ? dailyAnchor.points.filter((point) => point.date >= start).map((point) => point.date)
    : [...new Set([...left.points, ...right.points].map((point) => point.date).filter((date) => date >= start))].sort();
  const leftRaw = displayPoints(left, dates, displayMode === "native");
  const rightRaw = displayPoints(right, dates, displayMode === "native");
  const baseIndex = leftRaw.findIndex((point, index) => Number.isFinite(point.value) && Number.isFinite(rightRaw[index]?.value));
  if (baseIndex < 0) return { left: [], right: [], stepLeft: false, stepRight: false };
  const leftBase = leftRaw[baseIndex].value;
  const rightBase = rightRaw[baseIndex].value;
  return {
    left: leftRaw.slice(baseIndex).map((point) => ({ ...point, value: Number.isFinite(point.value) ? point.value / leftBase * 100 : NaN })),
    right: rightRaw.slice(baseIndex).map((point) => ({ ...point, value: Number.isFinite(point.value) ? point.value / rightBase * 100 : NaN })),
    stepLeft: left.frequency !== "daily",
    stepRight: right.frequency !== "daily",
  };
}

function currencyPremium(left: Series, right: Series): Point[] {
  if (![left.id, right.id].includes("usd-free") || ![left.id, right.id].some((id) => id.startsWith("usd-official"))) return [];
  const free = left.id === "usd-free" ? left : right;
  const official = left.id === "usd-official" ? left : right;
  return official.points.flatMap((point) => {
    const freePoint = lastAtOrBefore(free.points, point.date);
    const gap = freePoint ? (Date.parse(point.date) - Date.parse(freePoint.date)) / 86_400_000 : Infinity;
    return freePoint && gap <= 3 && point.value > 0
      ? [{ date: point.date, value: (freePoint.value / point.value - 1) * 100 }]
      : [];
  });
}

function goldPremium(local: Series, global: Series, usdFree: Series | undefined): Point[] {
  if (!usdFree) return [];
  return local.points.flatMap((point) => {
    const ounce = lastAtOrBefore(global.points, point.date);
    const fx = lastAtOrBefore(usdFree.points, point.date);
    if (!ounce || !fx || fx.value <= 0 || (Date.parse(point.date) - Date.parse(ounce.date)) / 86_400_000 > 7 || (Date.parse(point.date) - Date.parse(fx.date)) / 86_400_000 > 3) return [];
    const implied18kTomanPerGram = ounce.value * fx.value * 0.75 / 31.1034768;
    return implied18kTomanPerGram > 0
      ? [{ date: point.date, value: (point.value / implied18kTomanPerGram - 1) * 100 }]
      : [];
  });
}

function PairSelect({ label, value, options, onChange, id }: {
  label: string; value: string; options: Series[]; onChange: (value: string) => void; id: string;
}) {
  return <div>
    <label htmlFor={id}>{label}</label>
    <div className="select-wrap">
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
      <ChevronDown size={16} />
    </div>
  </div>;
}

export default function PairAnalysis({
  series,
  leftId,
  rightId,
  onLeftChange,
  onRightChange,
  windowSize,
  onWindowChange,
  displayMode = "synchronized",
  showIntro = true,
  showControls = true,
  events = [],
  eventsError = "",
  regimeDriverId = "usd-free",
}: Props) {
  const options = series.filter((item) => item.points.length && (item.group !== "money" || item.id.startsWith("omo-")));
  const left = options.find((item) => item.id === leftId) ?? options[0];
  const right = options.find((item) => item.id === rightId && item.id !== left?.id)
    ?? options.find((item) => item.id !== left?.id) ?? left;
  if (!left || !right) return <div className="empty-state">برای مقایسه هنوز سری داده‌ای موجود نیست.</div>;

  const normalized = normalizePair(left, right, displayMode);
  const paired = alignedReturns(left.points, right.points, left.frequency, right.frequency);
  const corr = correlation(paired.map((point) => point.left), paired.map((point) => point.right));
  const dynamic = rollingCorrelation(left.points, right.points, windowSize, left.frequency, right.frequency);
  const corrWindow = dynamic.filter((point) => Number.isFinite(point.value));
  const sharedDates = [...new Set([...normalized.left, ...dynamic].map((point) => point.date))].sort();
  const coarser = rank(left.frequency) >= rank(right.frequency) ? left.frequency : right.frequency;
  const scaleLabel = frequencyLabel(coarser);
  const premium = currencyPremium(left, right);
  const goldLocal = options.find((item) => item.id === "gold");
  const goldGlobal = options.find((item) => item.id === "gold-world");
  const usdFree = options.find((item) => item.id === "usd-free");
  const goldBasis = left.id === "gold" && right.id === "gold-world" && goldLocal && goldGlobal
    ? goldPremium(goldLocal, goldGlobal, usdFree)
    : left.id === "gold-world" && right.id === "gold" && goldLocal && goldGlobal
      ? goldPremium(goldLocal, goldGlobal, usdFree)
      : [];
  const regimeDriver = options.find((item) => item.id === regimeDriverId && item.frequency === "daily");
  const regimeThresholds = [1.25, 1.5, 2];
  const regimeComparisons = regimeDriver
    ? regimeThresholds.map((multiplier) => {
      const regimes = rollingVolatilityRegimes(regimeDriver.points, 30, 60, multiplier);
      return {
        multiplier,
        regimes,
        correlations: conditionalCorrelationByVolatilityRegime(paired, regimes),
      };
    })
    : [];
  const alignedEvents = alignEventAnnotations(events, normalized.left.map((point) => point.date));

  return <>
    {showIntro && <div className="page-intro compact">
      <div>
        <div className="eyebrow"><span className="eyebrow-line" /> روابط متغیرها</div>
        <h1>بازارها و شاخص‌ها<br /><em>در یک قاب زمانی.</em></h1>
        <p>سطوح برای مقایسه از ۱۰۰ شروع می‌شوند؛ همبستگی بر پایه بازده‌های هم‌دوره محاسبه می‌شود.</p>
      </div>
    </div>}
    {showControls && <div className="compare-controls panel">
      <PairSelect id="pair-left" label="متغیر اول" value={left.id} options={options} onChange={onLeftChange} />
      <PairSelect id="pair-right" label="مقایسه با" value={right.id} options={options} onChange={onRightChange} />
      <div>
        <label htmlFor="window">پنجره همبستگی · {scaleLabel}</label>
        <div className="select-wrap">
          <select id="window" value={windowSize} onChange={(event) => onWindowChange(Number(event.target.value))}>
            {[12, 30, 60, 120].map((size) => <option key={size} value={size}>{formatNumber(size)} مشاهده</option>)}
          </select>
        </div>
      </div>
    </div>}
    <div className="panel method-strip">
      <span>{displayMode === "native" ? "در نمای تاریخ اصلی، سطح روزانه در تاریخ‌های تازه منتشرشده به‌صورت مقدار آخرِ در دسترس نشان داده می‌شود؛ تاریخ مشاهده اصلی در راهنما می‌آید." : "داده ماهانه و فصلی روی محور روزانه به شکل پله‌ای نمایش داده می‌شود؛ جزئیات نمودار تاریخ مشاهده اصلی را نشان می‌دهد."} همبستگی با بازده‌های {scaleLabel} محاسبه می‌شود؛ مقدارهای تکرارشده روزانه وارد محاسبه نمی‌شوند.</span>
    </div>
    <div className="detail-grid pair-detail-grid">
      <div className="panel chart-main pair-level-panel">
        <div className="panel-header"><div><span className="panel-kicker">مقایسه سطح</span><h3>{left.shortTitle} و {right.shortTitle}</h3></div><span className="badge badge-accent">شاخص‌شده · شروع ۱۰۰</span></div>
        <Chart points={normalized.left} color={left.color} comparison={{ points: normalized.right, name: right.shortTitle, color: right.color, step: normalized.stepRight }} step={normalized.stepLeft} area={false} height={350} unit="شاخص نسبی · ۱۰۰=شروع" events={events} sharedDates={sharedDates} syncGroup="macro-relationships" />
        <div className="chart-footer">برای مقایسه اندازه‌های متفاوت، هر سری در نخستین تاریخ مشترک به ۱۰۰ تبدیل شده است.</div>
      </div>
      <div className="panel pair-correlation-summary">
        <div><span className="panel-kicker">همبستگی نمونه · {scaleLabel}</span><strong className="correlation-number">{corr === null ? "—" : formatNumber(corr, 3)}</strong></div>
        <div><span>بازده‌های مشترک</span><strong>{formatNumber(paired.length)}</strong></div>
        <div><span>پنجره متحرک</span><strong>{formatNumber(windowSize)} مشاهده</strong></div>
        <div><span>نقطه‌های کامل همبستگی متحرک</span><strong>{formatNumber(corrWindow.length)}</strong></div>
        <p>کمتر از ۳۰ مشاهده معمولاً برآورد ناپایداری می‌دهد؛ همبستگی رابطه علّی را اثبات نمی‌کند.</p>
      </div>
      <div className="panel correlation-panel">
        <div className="panel-header"><div><span className="panel-kicker">رابطه پویا</span><h3>همبستگی متحرک بازده</h3></div><span className="badge badge-accent">{formatNumber(windowSize)} مشاهده</span></div>
        <Chart points={dynamic} color="#46ceb6" area={false} height={300} unit="ضریب همبستگی" domain={[-1, 1]} events={events} sharedDates={sharedDates} syncGroup="macro-relationships" />
        <div className="chart-footer">نقاطی که پنجره کامل ندارند نمایش داده نمی‌شوند؛ تعداد مشاهدات خام در کارت کناری آمده است.</div>
      </div>
      <div className="panel regime-panel">
        <div className="panel-header"><div><span className="panel-kicker">وضعیت مقایسه</span><h3>تواتر و پوشش</h3></div></div>
        <div className="regime-block"><strong>{left.shortTitle}</strong><p>{frequencyLabel(left.frequency)} · {formatNumber(left.points.length)} مشاهده · {left.source}</p><small>{left.points.length ? `${formatDate(left.points[0].date)} تا ${formatDate(left.points.at(-1)!.date)}` : "بدون مشاهده"}</small></div>
        <div className="regime-block"><strong>{right.shortTitle}</strong><p>{frequencyLabel(right.frequency)} · {formatNumber(right.points.length)} مشاهده · {right.source}</p><small>{right.points.length ? `${formatDate(right.points[0].date)} تا ${formatDate(right.points.at(-1)!.date)}` : "بدون مشاهده"}</small></div>
        <div className="panel-note">تاریخ دریافت به معنی انتشار داده تازه نیست؛ در مقایسه سری‌های متفاوت، آخرین مشاهده هر دو بازار را بررسی کنید.</div>
      </div>
      {premium.length > 0 && <div className="panel small-chart">
        <div className="panel-header"><div><span className="panel-kicker">شکاف نرخ</span><h3>صرف تتر نسبت به {left.id === "usd-free" ? right.shortTitle : left.shortTitle}</h3></div><span className="badge">{formatNumber(premium.length)} تاریخ رسمی</span></div>
        <Chart points={premium} color="#e2ae69" area={false} height={240} unit="٪" />
        <p>در تاریخ هر مشاهده رسمی: (تتر پایانی ÷ نرخ رسمی − ۱) × ۱۰۰. فاصله تاریخ تتر حداکثر سه روز است؛ برای نرخ ماهانه، مقایسه با تتر نزدیک تاریخ مشاهده است، نه میانگین ماهانه تتر.</p>
      </div>}
      {goldBasis.length > 0 && <div className="panel small-chart">
        <div className="panel-header"><div><span className="panel-kicker">شکاف بازار طلا</span><h3>قیمت داخلی نسبت به ارزش نظری</h3></div><span className="badge">بر مبنای XAU/USD و USDT</span></div>
        <Chart points={goldBasis} color="#d7a950" area={false} height={240} unit="٪" />
        <p>ارزش نظری هر گرم ۱۸ عیار از انس جهانی، دلار آزاد و عیار ۷۵٪ محاسبه شده؛ هزینه، مالیات و حاشیه بازار در آن نیست.</p>
      </div>}
      <div className="panel pair-event-panel">
        <div className="panel-header"><div><span className="panel-kicker">نشانه‌های منبع‌دار</span><h3>رویدادهای منتشرشده در بازه</h3></div><span className="badge">{formatNumber(alignedEvents.length)} رویداد</span></div>
        {eventsError ? <p className="event-panel-message" role="status">{eventsError}</p> : alignedEvents.length ? <ul className="pair-event-list">{alignedEvents.map((event) => <li key={event.id}><div><strong>{event.title}</strong><small>{formatDate(event.date)} · {event.category}{event.endsOn && event.endsOn !== event.date ? ` · تا ${formatDate(event.endsOn)}` : ""}</small></div>{event.source && <a href={event.source} target="_blank" rel="noreferrer">منبع</a>}</li>)}</ul> : <p className="event-panel-message">در این بازه رویداد منتشرشده‌ای ثبت نشده است.</p>}
        <p className="panel-note">خط رویداد روی نخستین تاریخ مشاهده نمودار در همان روز یا پس از آن قرار می‌گیرد؛ تاریخ اصلی و منبع در این فهرست می‌ماند.</p>
      </div>
    </div>
    <section className="panel volatility-regime-panel">
      <div className="panel-header"><div><span className="panel-kicker">رابطه مشروط</span><h3>هم‌حرکتی در وضعیت‌های نوسان {regimeDriver?.shortTitle ?? "متغیر منتخب"}</h3></div><span className="badge">بازده‌های {scaleLabel}</span></div>
      {regimeDriver && regimeComparisons.some((row) => row.regimes.length) ? <>
        <div className="table-scroll"><table className="risk-table"><thead><tr><th>آستانه پرنوسان</th><th>معمولی · n</th><th>همبستگی</th><th>پرنوسان · n</th><th>همبستگی</th></tr></thead><tbody>{regimeComparisons.map(({ multiplier, correlations: states }) => { const normal = states.find((item) => item.state === "normal")!; const high = states.find((item) => item.state === "high")!; return <tr key={multiplier}><th scope="row">{formatNumber(multiplier, 2)}× میانه گذشته</th><td>{formatNumber(normal.count)}</td><td>{normal.correlation === null ? "—" : formatNumber(normal.correlation, 3)}</td><td>{formatNumber(high.count)}</td><td>{high.correlation === null ? "—" : formatNumber(high.correlation, 3)}</td></tr>; })}</tbody></table></div>
        <p className="panel-note">وضعیت پرنوسان وقتی ثبت می‌شود که نوسان تحقق‌یافته ۳۰ مشاهده‌ای از {formatNumber(1.5, 2)} برابر میانه ۶۰ برآورد کاملِ پیشین بیشتر شود؛ فقط گذشته وارد آستانه می‌شود. جدول حساسیت آستانه‌های ۱٫۲۵×، ۱٫۵× و ۲× را نشان می‌دهد. این طبقه‌بندی توصیفی است، برچسب بحران یا رابطه علّی نیست؛ شمارها هم‌پوشانی پنجره‌ها را حذف نمی‌کنند.</p>
        {(regimeComparisons[1]?.correlations.some((item) => item.count < 30) ?? true) && <p className="event-panel-message">در دست‌کم یکی از وضعیت‌ها کمتر از ۳۰ بازده مشترک داریم؛ همبستگی آن وضعیت ناپایدار است.</p>}
      </> : <p className="event-panel-message">برای محاسبه وضعیت نوسان، حداقل ۹۰ مشاهده روزانه معتبر از {regimeDriver?.shortTitle ?? "متغیر منتخب"} لازم است.</p>}
    </section>
  </>;
}
