"use client";

import Chart from "./chart";
import { ChevronDown } from "lucide-react";
import { alignedReturns, correlation, rollingCorrelation, toDailyStep } from "@/lib/analytics";
import { formatDate, formatNumber, frequencyLabel, type Frequency, type Point, type Series } from "@/lib/data";

type Props = {
  series: Series[];
  leftId: string;
  rightId: string;
  onLeftChange: (value: string) => void;
  onRightChange: (value: string) => void;
  windowSize: number;
  onWindowChange: (value: number) => void;
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

function displayPoints(item: Series, dates: string[]): Point[] {
  if (item.frequency !== "daily") return toDailyStep(item.points, dates);
  const exact = new Map(item.points.map((point) => [point.date, point]));
  return dates.map((date) => exact.get(date) ?? { date, value: NaN });
}

function normalizePair(left: Series, right: Series) {
  const firstLeft = left.points[0]?.date;
  const firstRight = right.points[0]?.date;
  if (!firstLeft || !firstRight) return { left: [], right: [], stepLeft: false, stepRight: false };
  const start = firstLeft > firstRight ? firstLeft : firstRight;
  const dailyAnchor = left.frequency === "daily" ? left : right.frequency === "daily" ? right : null;
  const dates = dailyAnchor
    ? dailyAnchor.points.filter((point) => point.date >= start).map((point) => point.date)
    : [...new Set([...left.points, ...right.points].map((point) => point.date).filter((date) => date >= start))].sort();
  const leftRaw = displayPoints(left, dates);
  const rightRaw = displayPoints(right, dates);
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

export default function PairAnalysis({ series, leftId, rightId, onLeftChange, onRightChange, windowSize, onWindowChange }: Props) {
  const options = series.filter((item) => item.points.length && (item.group !== "money" || item.id.startsWith("omo-")));
  const left = options.find((item) => item.id === leftId) ?? options[0];
  const right = options.find((item) => item.id === rightId && item.id !== left?.id)
    ?? options.find((item) => item.id !== left?.id) ?? left;
  if (!left || !right) return <div className="empty-state">برای مقایسه هنوز سری داده‌ای موجود نیست.</div>;

  const normalized = normalizePair(left, right);
  const paired = alignedReturns(left.points, right.points, left.frequency, right.frequency);
  const corr = correlation(paired.map((point) => point.left), paired.map((point) => point.right));
  const dynamic = rollingCorrelation(left.points, right.points, windowSize, left.frequency, right.frequency);
  const corrWindow = dynamic.filter((point) => Number.isFinite(point.value));
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

  return <>
    <div className="page-intro compact">
      <div>
        <div className="eyebrow"><span className="eyebrow-line" /> روابط متغیرها</div>
        <h1>بازارها و شاخص‌ها<br /><em>در یک قاب زمانی.</em></h1>
        <p>سطوح برای مقایسه از ۱۰۰ شروع می‌شوند؛ همبستگی بر پایه بازده‌های هم‌دوره محاسبه می‌شود.</p>
      </div>
    </div>
    <div className="compare-controls panel">
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
    </div>
    <div className="panel method-strip">
      <span>داده ماهانه و فصلی روی محور روزانه به شکل پله‌ای نمایش داده می‌شود؛ جزئیات نمودار تاریخ مشاهده اصلی را نشان می‌دهد. همبستگی با بازده‌های {scaleLabel} محاسبه می‌شود؛ مقدارهای تکرارشده روزانه وارد محاسبه نمی‌شوند.</span>
    </div>
    <div className="detail-grid pair-detail-grid">
      <div className="panel chart-main">
        <div className="panel-header"><div><span className="panel-kicker">مقایسه سطح</span><h3>{left.shortTitle} و {right.shortTitle}</h3></div><span className="badge badge-accent">شاخص‌شده · شروع ۱۰۰</span></div>
        <Chart points={normalized.left} color={left.color} comparison={{ points: normalized.right, name: right.shortTitle, color: right.color, step: normalized.stepRight }} step={normalized.stepLeft} area={false} height={350} unit="شاخص نسبی · ۱۰۰=شروع" />
        <div className="chart-footer">برای مقایسه اندازه‌های متفاوت، هر سری در نخستین تاریخ مشترک به ۱۰۰ تبدیل شده است.</div>
      </div>
      <div className="panel insight-panel">
        <div className="panel-header"><div><span className="panel-kicker">همبستگی نمونه</span><h3>ضریب بازده‌های مشترک</h3></div><span className="badge badge-accent">{scaleLabel}</span></div>
        <div className="correlation-number">{corr === null ? "—" : formatNumber(corr, 3)}</div>
        <div className="fact-row"><span>تعداد بازده‌های مشترک</span><strong>{formatNumber(paired.length)}</strong></div>
        <div className="fact-row"><span>پنجره متحرک</span><strong>{formatNumber(windowSize)} مشاهده</strong></div>
        <div className="fact-row"><span>نقطه‌های همبستگی متحرک</span><strong>{formatNumber(corrWindow.length)}</strong></div>
        <div className="insight-callout"><span><strong>کیفیت برآورد:</strong> برای خواندن همبستگی، تعداد بازده‌های مشترک و پوشش زمانی را بررسی کنید. کمتر از ۳۰ مشاهده معمولاً برآورد ناپایداری می‌دهد. همبستگی، رابطه علّی را اثبات نمی‌کند.</span></div>
      </div>
      <div className="panel correlation-panel">
        <div className="panel-header"><div><span className="panel-kicker">رابطه پویا</span><h3>همبستگی متحرک بازده</h3></div><span className="badge badge-accent">{formatNumber(windowSize)} مشاهده</span></div>
        <Chart points={dynamic} color="#46ceb6" area={false} height={300} unit="ضریب همبستگی" domain={[-1, 1]} />
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
    </div>
  </>;
}
