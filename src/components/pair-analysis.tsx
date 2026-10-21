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
import { themeColors } from "@/lib/theme";

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
  if (![left.id, right.id].includes("usd-free") || ![left.id, right.id].includes("usd-official")) return [];
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
  if (!left || !right) return <div className="empty-state">برای این مقایسه دادهٔ کافی در دسترس نیست.</div>;

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
        <h1>مقایسه بازارها</h1>
        <p>بازده نسبی و همبستگی متحرک بازارها را در بازه‌های مختلف کنار هم ببینید.</p>
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
      <span>{displayMode === "native" ? "این نما فقط تاریخ‌هایی را نشان می‌دهد که هر شاخص مقدار تازه داشته است." : "در داده‌های ماهانه و فصلی، آخرین مقدار تا انتشار بعدی روی نمودار می‌ماند."} همبستگی با تاریخ‌های مشترک محاسبه می‌شود و مقدارهای تکراری وارد آن نمی‌شوند.</span>
    </div>
    <div className="detail-grid pair-detail-grid">
      <div className="panel chart-main pair-level-panel">
        <div className="panel-header"><div><span className="panel-kicker">مقایسه سطح</span><h3>{left.shortTitle} و {right.shortTitle}</h3></div><span className="badge badge-accent">شاخص‌شده · شروع ۱۰۰</span></div>
        <Chart points={normalized.left} color={left.color} comparison={{ points: normalized.right, name: right.shortTitle, color: right.color, step: normalized.stepRight }} step={normalized.stepLeft} area={false} height={350} unit="شاخص نسبی · ۱۰۰=شروع" events={events} sharedDates={sharedDates} syncGroup="macro-relationships" />
        <div className="chart-footer">برای هم‌مقیاس‌کردن دو سری، مقدار هرکدام در نخستین تاریخ مشترک برابر ۱۰۰ در نظر گرفته شده است.</div>
      </div>
      <div className="panel pair-correlation-summary">
        <div><span className="panel-kicker">همبستگی نمونه · {scaleLabel}</span><strong className="correlation-number">{corr === null ? "—" : formatNumber(corr, 3)}</strong></div>
        <div><span>بازده‌های مشترک</span><strong>{formatNumber(paired.length)}</strong></div>
        <div><span>پنجره متحرک</span><strong>{formatNumber(windowSize)} مشاهده</strong></div>
        <div><span>نقطه‌های کامل همبستگی متحرک</span><strong>{formatNumber(corrWindow.length)}</strong></div>
        <p>با کمتر از ۳۰ مشاهده، همبستگی ناپایدار است؛ همبستگی به‌تنهایی رابطهٔ علّی را نشان نمی‌دهد.</p>
      </div>
      <div className="panel correlation-panel">
        <div className="panel-header"><div><span className="panel-kicker">رابطه پویا</span><h3>همبستگی متحرک بازده</h3></div><span className="badge badge-accent">{formatNumber(windowSize)} مشاهده</span></div>
        <Chart points={dynamic} color={themeColors.positive} area={false} height={300} unit="ضریب همبستگی" domain={[-1, 1]} events={events} sharedDates={sharedDates} syncGroup="macro-relationships" />
        <div className="chart-footer">نقاطی که پنجره کامل ندارند نمایش داده نمی‌شوند؛ تعداد مشاهدات خام در کارت کناری آمده است.</div>
      </div>
      <div className="panel regime-panel">
        <div className="panel-header"><div><span className="panel-kicker">وضعیت مقایسه</span><h3>بازه و تعداد داده‌ها</h3></div></div>
        <div className="regime-block"><strong>{left.shortTitle}</strong><p>{frequencyLabel(left.frequency)} · {formatNumber(left.points.length)} مشاهده · {left.source}</p><small>{left.points.length ? `${formatDate(left.points[0].date)} تا ${formatDate(left.points.at(-1)!.date)}` : "بدون مشاهده"}</small></div>
        <div className="regime-block"><strong>{right.shortTitle}</strong><p>{frequencyLabel(right.frequency)} · {formatNumber(right.points.length)} مشاهده · {right.source}</p><small>{right.points.length ? `${formatDate(right.points[0].date)} تا ${formatDate(right.points.at(-1)!.date)}` : "بدون مشاهده"}</small></div>
        <div className="panel-note">تاریخ بارگیری، تاریخ انتشار آخرین مقدار نیست. تاریخ هر شاخص را در مشخصات بالا ببینید.</div>
      </div>
      {premium.length > 0 && <div className="panel small-chart">
        <div className="panel-header"><div><span className="panel-kicker">شکاف نرخ</span><h3>صرف تتر نسبت به {left.id === "usd-free" ? right.shortTitle : left.shortTitle}</h3></div><span className="badge">{formatNumber(premium.length)} تاریخ ETS</span></div>
        <Chart points={premium} color={themeColors.accent} area={false} height={240} unit="٪" />
        <p>برای هر تاریخ انتشار نرخ فروش ETS، این اختلاف را حساب می‌کنیم: (قیمت پایانی تتر ÷ نرخ ETS − ۱) × ۱۰۰. نرخ تتر ممکن است تا سه روز قدیمی‌تر باشد و تاریخچهٔ ETS هنوز پیوسته نیست.</p>
      </div>}
      {goldBasis.length > 0 && <div className="panel small-chart">
        <div className="panel-header"><div><span className="panel-kicker">شکاف بازار طلا</span><h3>قیمت داخلی نسبت به ارزش نظری</h3></div><span className="badge">بر مبنای XAU/USD و USDT</span></div>
        <Chart points={goldBasis} color={themeColors.gold} area={false} height={240} unit="٪" />
        <p>ارزش نظری هر گرم ۱۸ عیار از انس جهانی، دلار آزاد و عیار ۷۵٪ محاسبه شده؛ هزینه، مالیات و حاشیه بازار در آن نیست.</p>
      </div>}
      <div className="panel pair-event-panel">
        <div className="panel-header"><div><span className="panel-kicker">رویدادهای مهم</span><h3>رویدادهای بازهٔ انتخاب‌شده</h3></div><span className="badge">{formatNumber(alignedEvents.length)} رویداد</span></div>
        {eventsError ? <p className="event-panel-message" role="status">{eventsError}</p> : alignedEvents.length ? <ul className="pair-event-list">{alignedEvents.map((event) => <li key={event.id}><div><strong>{event.title}</strong><small>{formatDate(event.date)} · {event.category}{event.endsOn && event.endsOn !== event.date ? ` · تا ${formatDate(event.endsOn)}` : ""}</small></div>{event.source && <a href={event.source} target="_blank" rel="noreferrer">جزئیات</a>}</li>)}</ul> : <p className="event-panel-message">برای این بازه رویدادی ثبت نشده است.</p>}
        <p className="panel-note">تاریخ رویداد در فهرست اصلی ثبت می‌شود؛ در نمودار، خط آن روی نزدیک‌ترین مشاهدهٔ بعدی قرار می‌گیرد.</p>
      </div>
    </div>
    <section className="panel volatility-regime-panel">
      <div className="panel-header"><div><span className="panel-kicker">رابطه مشروط</span><h3>هم‌حرکتی در وضعیت‌های نوسان {regimeDriver?.shortTitle ?? "متغیر منتخب"}</h3></div><span className="badge">بازده‌های {scaleLabel}</span></div>
      {regimeDriver && regimeComparisons.some((row) => row.regimes.length) ? <>
        <div className="table-scroll"><table className="risk-table"><thead><tr><th>آستانه پرنوسان</th><th>معمولی · n</th><th>همبستگی</th><th>پرنوسان · n</th><th>همبستگی</th></tr></thead><tbody>{regimeComparisons.map(({ multiplier, correlations: states }) => { const normal = states.find((item) => item.state === "normal")!; const high = states.find((item) => item.state === "high")!; return <tr key={multiplier}><th scope="row">{formatNumber(multiplier, 2)}× میانه گذشته</th><td>{formatNumber(normal.count)}</td><td>{normal.correlation === null ? "—" : formatNumber(normal.correlation, 3)}</td><td>{formatNumber(high.count)}</td><td>{high.correlation === null ? "—" : formatNumber(high.correlation, 3)}</td></tr>; })}</tbody></table></div>
        <p className="panel-note">وضعیت پرنوسان زمانی ثبت می‌شود که نوسان ۳۰ مشاهدهٔ اخیر از {formatNumber(1.5, 2)} برابر میانهٔ ۶۰ پنجرهٔ پیشین بیشتر باشد. جدول، نتیجه را با آستانه‌های ۱٫۲۵× و ۲× هم می‌سنجد. این برچسب توصیفی است و پنجره‌ها هم‌پوشانی دارند.</p>
        {(regimeComparisons[1]?.correlations.some((item) => item.count < 30) ?? true) && <p className="event-panel-message">در یکی از دو وضعیت کمتر از ۳۰ بازده مشترک داریم؛ نتیجهٔ همبستگی در این نمونه ناپایدار است.</p>}
      </> : <p className="event-panel-message">برای سنجش وضعیت نوسان {regimeDriver?.shortTitle ?? "متغیر منتخب"} دست‌کم ۹۰ مشاهدهٔ روزانهٔ معتبر لازم است.</p>}
    </section>
  </>;
}
