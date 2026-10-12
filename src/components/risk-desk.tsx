"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import Chart from "./chart";
import { drawdownSpells, riskSummary, rollingRisk } from "@/lib/analytics";
import { downloadCsv, formatDate, formatNumber, riskIds, type Series } from "@/lib/data";

const measures = [
  { key: "realizedVolatilityPct", title: "نوسان تحقق‌یافته", color: "#88c0d0" },
  { key: "downsideSemideviationPct", title: "نیم‌انحراف نزولی", color: "#a3be8c" },
  { key: "historicalVaRPct", title: "VaR تاریخی ۹۵٪", color: "#ebcb8b" },
  { key: "expectedShortfallPct", title: "ES تاریخی ۹۵٪", color: "#bf616a" },
] as const;

type MeasureKey = (typeof measures)[number]["key"];

export function stressLabel(percentile: number | null) {
  return percentile === null ? "نمونه ناکافی" : percentile >= 90 ? "تنش بالا" : percentile >= 60 ? "نوسان بالاتر" : "نوسان معمول";
}

function riskHistoryPoints(
  history: ReturnType<typeof rollingRisk>,
  key: MeasureKey,
) {
  const lastIncomplete = history.reduce(
    (last, point, index) => point.realizedVolatilityPct === null ? index : last,
    -1,
  );
  return history.slice(lastIncomplete + 1).map((point) => ({
    date: point.date,
    value: point[key] ?? Number.NaN,
  }));
}

type RiskDeskProps = {
  series: Series[];
  compact?: boolean;
  showIntro?: boolean;
  showWindowControl?: boolean;
  windowSize?: number;
  onWindowChange?: (value: number) => void;
  selectedId?: string;
  onSelectedChange?: (value: string) => void;
  comparisonId?: string;
  layoutMode?: "side-by-side" | "stacked";
  onLayoutModeChange?: (value: "side-by-side" | "stacked") => void;
};

export default function RiskDesk({
  series,
  compact = false,
  showIntro = !compact,
  showWindowControl = !compact,
  windowSize,
  onWindowChange,
  selectedId,
  onSelectedChange,
  comparisonId,
  layoutMode,
  onLayoutModeChange,
}: RiskDeskProps) {
  const [localWindow, setLocalWindow] = useState(60);
  const [localSelected, setLocalSelected] = useState("tedpix");
  const [localLayoutMode, setLocalLayoutMode] = useState<"side-by-side" | "stacked">("side-by-side");
  const window = windowSize ?? localWindow;
  const selected = selectedId ?? localSelected;
  const layout = layoutMode ?? localLayoutMode;
  const changeWindow = onWindowChange ?? setLocalWindow;
  const changeSelected = onSelectedChange ?? setLocalSelected;
  const changeLayoutMode = onLayoutModeChange ?? setLocalLayoutMode;
  const items = riskIds
    .map((id) => series.find((item) => item.id === id))
    .filter((item): item is Series => Boolean(item?.points.length));

  const rows = items.map((item) => {
    const history = rollingRisk(item.points, window, 0.05);
    return {
      item,
      stats: riskSummary(item.points, window),
      history,
      latestRisk: history.filter((point) => point.realizedVolatilityPct !== null).at(-1),
      spells: drawdownSpells(item.points),
    };
  });
  const active = rows.find((row) => row.item.id === selected) ?? rows[0];
  const comparison = rows.find((row) => row.item.id === comparisonId && row.item.id !== active?.item.id);
  if (!active) return <div className="empty-state">برای محاسبه ریسک هنوز داده کافی دریافت نشده است.</div>;

  const sharedDates = [...new Set([
    ...active.history.map((point) => point.date),
    ...(comparison?.history.map((point) => point.date) ?? []),
  ])].sort();

  const exportRows = () => downloadCsv("risk", [
    [
      "series", "last_observation", "risk_window_end", "window_observations",
      "sample_count", "tail_sample_count", "realized_volatility_pct_per_observation",
      "downside_semideviation_pct_per_observation", "historical_var_95_pct_loss",
      "historical_es_95_pct_loss", "volatility_percentile", "current_drawdown_pct",
      "max_drawdown_pct", "latest_drawdown_status", "latest_drawdown_duration_observations", "source",
    ],
    ...rows.map(({ item, stats, latestRisk, spells }) => {
      const latestSpell = spells.at(-1);
      return [
        item.title,
        item.points.at(-1)?.date ?? "",
        latestRisk?.date ?? "",
        window,
        latestRisk?.sampleCount ?? "",
        latestRisk?.tailSampleCount ?? "",
        latestRisk?.realizedVolatilityPct ?? "",
        latestRisk?.downsideSemideviationPct ?? "",
        latestRisk?.historicalVaRPct ?? "",
        latestRisk?.expectedShortfallPct ?? "",
        stats.percentile ?? "",
        stats.currentDrawdown ?? "",
        stats.maxDrawdown ?? "",
        latestSpell?.status ?? "",
        latestSpell?.durationObservations ?? "",
        item.source,
      ] as (string | number)[];
    }),
  ]);

  const latestSpellRows = active.spells.slice(-6).reverse();
  const asOfDate = active.latestRisk?.date ?? active.item.points.at(-1)!.date;

  return (
    <section aria-label="دیدبان ریسک">
      {showIntro && (
        <div className="page-intro compact">
          <div>
            <div className="eyebrow"><span className="eyebrow-line" /> پایش ریسک بازار</div>
            <h1>نوسان، زیان و<br /><em>زمان بازیابی</em></h1>
            <p>چند سنجه تاریخی را برای هر بازار کنار هم ببینید؛ هیچ‌کدام به‌تنهایی پیش‌بینی ریزش نیستند.</p>
          </div>
        </div>
      )}

      <div className="panel risk-table-panel">
        <div className="panel-header">
          <div><span className="panel-kicker">مقایسه بازارهای کلان</span><h3>دیدبان ریسک بازارها</h3></div>
          {!compact && <button className="outline-button" onClick={exportRows}><Download size={15} /> گزارش CSV</button>}
        </div>
        {showWindowControl && !compact && (
          <div className="detail-toolbar risk-toolbar">
            <div className="period-tabs" aria-label="پنجره محاسبه ریسک">
              {[30, 60, 120].map((size) => (
                <button key={size} className={window === size ? "selected" : ""} onClick={() => changeWindow(size)}>
                  {formatNumber(size)} مشاهده
                </button>
              ))}
            </div>
            <span className="muted">همه سنجه‌ها بر پایه بازده لگاریتمی و پنجره یکسان‌اند.</span>
          </div>
        )}
        <div className="table-scroll">
          <table className="risk-table">
            <thead>
              <tr>
                <th scope="col">بازار / تاریخ</th>
                <th scope="col">نوسان</th>
                <th scope="col">صدک تاریخی</th>
                <th scope="col">افت جاری</th>
                {!compact && <th scope="col" className="risk-table-hide-mobile">بیشترین افت</th>}
                <th scope="col" className="risk-table-hide-mobile">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, stats, latestRisk }) => (
                <tr key={item.id} className={selected === item.id ? "table-selected" : ""}>
                  <th scope="row">
                    <button className="table-market" onClick={() => changeSelected(item.id)}>
                      <span className="nav-dot" style={{ background: item.color }} />{item.shortTitle}
                    </button>
                    <small>{formatDate(item.points.at(-1)!.date)}</small>
                  </th>
                  <td>
                    {formatNumber(latestRisk?.realizedVolatilityPct ?? NaN, 2)}٪
                    <small>n={formatNumber(latestRisk?.sampleCount ?? NaN)} / {formatNumber(window)}</small>
                  </td>
                  <td>
                    <div className="percentile-cell">
                      <span>{formatNumber(stats.percentile ?? NaN)} / ۱۰۰</span>
                      <meter min={0} max={100} value={stats.percentile ?? 0} aria-label={`صدک نوسان ${item.shortTitle}`} />
                    </div>
                  </td>
                  <td className="negative-text">{formatNumber(stats.currentDrawdown ?? NaN, 2)}٪</td>
                  {!compact && <td className="risk-table-hide-mobile">{formatNumber(stats.maxDrawdown ?? NaN, 2)}٪</td>}
                  <td className="risk-table-hide-mobile">
                    <span className={`badge ${stats.percentile !== null && stats.percentile >= 90 ? "badge-danger" : "badge-neutral"}`}>
                      {stressLabel(stats.percentile)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="panel-note">صدک نوسان از پنجره‌های کامل گذشته محاسبه می‌شود؛ دست‌کم ۶۰ پنجره لازم دارد. رتبه‌ها توصیفی‌اند و تاریخ بازارها می‌تواند متفاوت باشد.</p>
      </div>

      {!compact && (
        <>
          <div className="analysis-summary risk-summary">
            <article className="panel">
              <span>نوسان تحقق‌یافته · {active.item.shortTitle}</span>
              <strong>{formatNumber(active.latestRisk?.realizedVolatilityPct ?? NaN, 2)}٪</strong>
              <small>انحراف معیار بازده · {formatNumber(window)} مشاهده تا {formatDate(asOfDate)}</small>
            </article>
            <article className="panel">
              <span>نیم‌انحراف نزولی</span>
              <strong>{formatNumber(active.latestRisk?.downsideSemideviationPct ?? NaN, 2)}٪</strong>
              <small>فقط بازده‌های زیر صفر؛ مخرج برابر کل پنجره است</small>
            </article>
            <article className="panel">
              <span>VaR تاریخی ۹۵٪ / ES تاریخی ۹۵٪</span>
              <strong>{formatNumber(active.latestRisk?.historicalVaRPct ?? NaN, 2)}٪ / {formatNumber(active.latestRisk?.expectedShortfallPct ?? NaN, 2)}٪</strong>
              <small>دم شامل {formatNumber(active.latestRisk?.tailSampleCount ?? NaN)} بازده از {formatNumber(window)} مشاهده است</small>
            </article>
          </div>

          <div className="risk-layout-toolbar">
            <span className="macro-control-label">چیدمان نمودارها</span>
            <div className="period-tabs" role="group" aria-label="چیدمان نمودارهای ریسک">
              {(["side-by-side", "stacked"] as const).map((mode) => (
                <button key={mode} type="button" aria-pressed={layout === mode} className={layout === mode ? "selected" : ""} onClick={() => changeLayoutMode(mode)}>
                  {mode === "side-by-side" ? "کنار هم" : "زیر هم"}
                </button>
              ))}
            </div>
          </div>
          <div className={`risk-measure-grid risk-measure-grid-${layout}`}>
            {measures.map((measure) => (
              <article className="panel risk-measure-panel" key={measure.key}>
                <div className="panel-header">
                  <div><span className="panel-kicker">{active.item.shortTitle}{comparison ? ` و ${comparison.item.shortTitle}` : ""} · {formatNumber(window)} مشاهده</span><h3>{measure.title}</h3></div>
                  <span className="badge">درصد به‌ازای هر مشاهده</span>
                </div>
                <Chart
                  points={riskHistoryPoints(active.history, measure.key)}
                  color={measure.color}
                  comparison={comparison ? {
                    points: riskHistoryPoints(comparison.history, measure.key),
                    name: comparison.item.shortTitle,
                    color: comparison.item.color,
                  } : undefined}
                  height={270}
                  area={false}
                  unit="٪ به‌ازای هر مشاهده"
                  sharedDates={sharedDates}
                  syncGroup="macro-risk"
                />
                {measure.key === "historicalVaRPct" || measure.key === "expectedShortfallPct" ? (
                  <p className="risk-measure-note">دم تاریخی ۵٪ در پنجره جاری؛ منفی بودن مقدار یعنی آستانه دم بازده مثبت است. این برآورد پیش‌بینی آینده نیست.</p>
                ) : (
                  <p className="risk-measure-note">برآورد در تواتر طبیعی سری؛ سالانه‌سازی نشده و فقط پنجره کامل نمایش داده می‌شود.</p>
                )}
              </article>
            ))}
          </div>

          <div className="panel risk-spells-panel">
            <div className="panel-header">
              <div><span className="panel-kicker">افت از قله تاریخی</span><h3>دوره‌های افت و بازیابی · {active.item.shortTitle}</h3></div>
              <span className="badge">{formatNumber(active.spells.length)} دوره</span>
            </div>
            {latestSpellRows.length ? (
              <div className="table-scroll">
                <p className="risk-table-hint">برای دیدن همه ستون‌ها، جدول را به‌صورت افقی بکشید.</p>
                <table className="risk-table risk-spell-table">
                  <thead><tr><th>قله</th><th>کف</th><th>بازیابی / وضعیت</th><th>عمق افت</th><th>مشاهده تا پایان</th><th>مشاهده تا بازیابی</th></tr></thead>
                  <tbody>
                    {latestSpellRows.map((spell) => (
                      <tr key={`${spell.peakDate}-${spell.troughDate}`}>
                        <td>{formatDate(spell.peakDate)}</td>
                        <td>{formatDate(spell.troughDate)}</td>
                        <td>
                          {spell.recoveryDate ? formatDate(spell.recoveryDate) : "—"}
                          <small className={`risk-spell-status risk-spell-${spell.status}`}>
                            {spell.status === "recovered" ? "بازیابی‌شده" : spell.status === "ongoing" ? "هنوز زیر قله" : "قطع‌شده به‌علت شکاف داده"}
                          </small>
                        </td>
                        <td className="negative-text">{formatNumber(spell.depthPct, 2)}٪</td>
                        <td>{formatNumber(spell.durationObservations)}</td>
                        <td>{spell.recoveryObservations === null ? "—" : formatNumber(spell.recoveryObservations)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="risk-spells-empty">در تاریخچه قابل‌استفاده این سری دوره افتِ زیر قله‌ای ثبت نشده است.</p>
            )}
            <p className="panel-note">مدت بر حسب فاصله مشاهده‌هاست، نه روز تقویمی. قیمت نامعتبر دوره جاری را سانسور می‌کند؛ بازیابی در شکاف داده فرض نمی‌شود.</p>
          </div>

          <div className="panel method-strip">نوسان و نیم‌انحراف، درصد به‌ازای هر بازده مشاهده‌شده‌اند؛ VaR و ES از دم تاریخی پنجره به‌دست می‌آیند. این سنجه‌ها زیان آینده را پیش‌بینی نمی‌کنند. افت شاخص نیز افت قیمت یک سبد واقعی را به‌تنهایی نشان نمی‌دهد.</div>
        </>
      )}
    </section>
  );
}
