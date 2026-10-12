"use client";

import { useState } from "react";
import PairAnalysis from "./pair-analysis";
import RiskDesk from "./risk-desk";
import ScenarioDesk from "./scenario-desk";
import { formatNumber, periodPoints, riskIds, type Series } from "@/lib/data";
import { useEvents } from "@/lib/use-events";

export type MacroAnalysisSubview = "risk" | "relationships" | "scenario" | "validation";

const subviews: { id: MacroAnalysisSubview; label: string }[] = [
  { id: "risk", label: "ریسک بازار" },
  { id: "relationships", label: "روابط و هم‌حرکتی" },
  { id: "scenario", label: "سناریو" },
  { id: "validation", label: "اعتبارسنجی پیش‌بینی" },
];

const windows = [30, 60, 120];

export default function MacroAnalysis({
  series,
  initialSubview = "risk",
}: {
  series: Series[];
  initialSubview?: MacroAnalysisSubview;
}) {
  const [subview, setSubview] = useState(initialSubview);
  const [months, setMonths] = useState<number | null>(12);
  const [windowSize, setWindowSize] = useState(60);
  const [displayMode, setDisplayMode] = useState<"synchronized" | "native">("synchronized");
  const [regimeDriverId, setRegimeDriverId] = useState("usd-free");
  const [analysisPrimaryId, setAnalysisPrimaryId] = useState("tedpix");
  const [analysisComparisonId, setAnalysisComparisonId] = useState("usd-free");
  const [riskLayout, setRiskLayout] = useState<"side-by-side" | "stacked">("side-by-side");
  const [pairLeftId, setPairLeftId] = useState("tedpix");
  const [pairRightId, setPairRightId] = useState("usd-free");
  const [scenarioMode, setScenarioMode] = useState<"one-period" | "persistent">("one-period");
  const [scenarioPeriods, setScenarioPeriods] = useState(6);
  const [shock, setShock] = useState(5);
  const { events, error: eventsError } = useEvents();

  const scopedSeries = series.map((item) => ({
    ...item,
    points: periodPoints(item.points, months),
  }));
  const marketOptions = riskIds
    .map((id) => scopedSeries.find((item) => item.id === id))
    .filter((item): item is Series => Boolean(item?.points.length));
  const relationshipOptions = scopedSeries.filter((item) =>
    item.points.length && (item.group !== "money" || item.id.startsWith("omo-")),
  );
  const market = (id: string) => marketOptions.find((item) => item.id === id) ?? marketOptions[0];
  const pairable = (id: string) => relationshipOptions.find((item) => item.id === id) ?? relationshipOptions[0];
  const riskLeft = market(analysisPrimaryId);
  const riskRight = marketOptions.find((item) => item.id === analysisComparisonId && item.id !== riskLeft?.id)
    ?? marketOptions.find((item) => item.id !== riskLeft?.id);
  const pairLeft = pairable(pairLeftId);
  const pairRight = relationshipOptions.find((item) => item.id === pairRightId && item.id !== pairLeft?.id)
    ?? relationshipOptions.find((item) => item.id !== pairLeft?.id);
  const scenarioTarget = market(analysisPrimaryId);
  const scenarioDriver = marketOptions.find((item) => item.id === analysisComparisonId && item.id !== scenarioTarget?.id)
    ?? marketOptions.find((item) => item.id !== scenarioTarget?.id);

  const showSeriesControls = subview === "risk" || subview === "relationships" || subview === "scenario";
  const leftOptions = subview === "relationships" ? relationshipOptions : marketOptions;
  const currentLeftId = subview === "relationships" ? pairLeft?.id : subview === "scenario" ? scenarioTarget?.id : riskLeft?.id;
  const currentRightId = subview === "relationships" ? pairRight?.id : subview === "scenario" ? scenarioDriver?.id : riskRight?.id;
  const leftLabel = subview === "scenario" ? "بازار هدف" : "متغیر اصلی";
  const rightLabel = subview === "scenario" ? "متغیر شوک" : "مقایسه با";
  const updateLeft = (value: string) => {
    if (subview === "relationships") {
      setPairLeftId(value);
      if (riskIds.includes(value)) setAnalysisPrimaryId(value);
    } else {
      setAnalysisPrimaryId(value);
      if (riskIds.includes(pairLeftId)) setPairLeftId(value);
    }
  };
  const updateRight = (value: string) => {
    if (subview === "relationships") {
      setPairRightId(value);
      if (riskIds.includes(value)) setAnalysisComparisonId(value);
    } else {
      setAnalysisComparisonId(value);
      if (riskIds.includes(pairRightId)) setPairRightId(value);
    }
  };

  return (
    <section className="macro-analysis" aria-label="فضای تحلیل کلان">
      <div className="page-intro compact macro-analysis-intro">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> فضای تحلیل کلان</div>
          <h1>ریسک، رابطه و<br /><em>سناریوی بازار.</em></h1>
          <p>یک بازه و پنجره مشترک را میان تحلیل ریسک، هم‌حرکتی بازارها و سناریو نگه دارید. خروجی‌ها توصیفی‌اند تا مدل پیش‌بینی اعتبارسنجی شود.</p>
        </div>
      </div>

      <nav className="macro-analysis-tabs" aria-label="بخش‌های تحلیل کلان">
        {subviews.map(({ id, label }) => (
          <button key={id} type="button" aria-pressed={subview === id} className={subview === id ? "selected" : ""} onClick={() => setSubview(id)}>
            {label}
          </button>
        ))}
      </nav>

      <div className="panel macro-analysis-controls">
        <div className="macro-control-period">
          <span className="macro-control-label">بازه مشترک</span>
          <div className="period-tabs" aria-label="بازه مشترک تحلیل">
            {([3, 12, null] as const).map((value) => (
              <button key={String(value)} type="button" className={months === value ? "selected" : ""} onClick={() => setMonths(value)}>
                {value === null ? "تمام دوره" : `${formatNumber(value)} ماه`}
              </button>
            ))}
          </div>
        </div>
        {showSeriesControls && (
          <>
            <div><label htmlFor="macro-primary">{leftLabel}</label><div className="select-wrap"><select id="macro-primary" value={currentLeftId ?? ""} onChange={(event) => updateLeft(event.target.value)}>{leftOptions.map((item) => <option key={item.id} value={item.id}>{item.shortTitle}</option>)}</select></div></div>
            <div><label htmlFor="macro-secondary">{rightLabel}</label><div className="select-wrap"><select id="macro-secondary" value={currentRightId ?? ""} onChange={(event) => updateRight(event.target.value)}>{leftOptions.filter((item) => item.id !== currentLeftId).map((item) => <option key={item.id} value={item.id}>{item.shortTitle}</option>)}</select></div></div>
            <div className="macro-window-control"><span className="macro-control-label">پنجره مشترک</span><div className="period-tabs" aria-label="پنجره مشترک تحلیل">{windows.map((value) => <button key={value} type="button" className={windowSize === value ? "selected" : ""} onClick={() => setWindowSize(value)}>{formatNumber(value)}</button>)}</div></div>
          </>
        )}
        {subview === "relationships" && (
          <>
            <div><label htmlFor="macro-regime-driver">متغیر تعریف وضعیت نوسان</label><div className="select-wrap"><select id="macro-regime-driver" value={market(regimeDriverId)?.id ?? ""} onChange={(event) => setRegimeDriverId(event.target.value)}>{marketOptions.map((item) => <option key={item.id} value={item.id}>{item.shortTitle}</option>)}</select></div></div>
            <div className="macro-frequency-control">
              <span className="macro-control-label">نمای تاریخ</span>
              <div className="period-tabs" aria-label="نمای تاریخ نمودار">
                <button type="button" className={displayMode === "synchronized" ? "selected" : ""} onClick={() => setDisplayMode("synchronized")}>هم‌زمان</button>
                <button type="button" className={displayMode === "native" ? "selected" : ""} onClick={() => setDisplayMode("native")}>تاریخ‌های اصلی</button>
              </div>
            </div>
          </>
        )}
        <div className="macro-horizon-lock"><span>افق پیش‌بینی</span><strong>تا تأیید قرارداد و ارزیابی تاریخی غیرفعال</strong></div>
      </div>

      {subview === "risk" && riskLeft && (
        <RiskDesk
          series={scopedSeries}
          showIntro={false}
          showWindowControl={false}
          windowSize={windowSize}
          onWindowChange={setWindowSize}
          selectedId={riskLeft.id}
          onSelectedChange={updateLeft}
          comparisonId={riskRight?.id}
          layoutMode={riskLayout}
          onLayoutModeChange={setRiskLayout}
        />
      )}
      {subview === "relationships" && pairLeft && pairRight && (
        <PairAnalysis
          series={scopedSeries}
          leftId={pairLeft.id}
          rightId={pairRight.id}
          onLeftChange={updateLeft}
          onRightChange={updateRight}
          windowSize={windowSize}
          onWindowChange={setWindowSize}
          displayMode={displayMode}
          events={events}
          eventsError={eventsError}
          regimeDriverId={market(regimeDriverId)?.id ?? "usd-free"}
          showIntro={false}
          showControls={false}
        />
      )}
      {subview === "scenario" && scenarioTarget && scenarioDriver && (
        <ScenarioDesk
          series={scopedSeries}
          targetId={scenarioTarget.id}
          onTargetChange={updateLeft}
          driverId={scenarioDriver.id}
          onDriverChange={updateRight}
          windowSize={windowSize}
          onWindowChange={setWindowSize}
          shock={shock}
          onShockChange={setShock}
          mode={scenarioMode}
          onModeChange={setScenarioMode}
          periods={scenarioPeriods}
          onPeriodsChange={setScenarioPeriods}
          showIntro={false}
          showControls={false}
        />
      )}
      {subview === "validation" && (
        <article className="panel forecast-validation-pending">
          <span className="panel-kicker">وضعیت مدل</span>
          <h2>هنوز پیش‌بینی معتبر منتشر نشده است</h2>
          <p>تعریف هدف، افق، اطلاعات مجاز و معیارهای ارزیابی آماده بررسی است. تا تأیید این قرارداد و عبور از ارزیابی زمانی، هیچ خروجی مدل به‌عنوان پیش‌بینی نمایش داده نمی‌شود.</p>
          <div className="validation-status-row"><span>وضعیت قرارداد</span><strong>در انتظار تأیید</strong></div>
          <div className="validation-status-row"><span>آموزش یا تنظیم مدل</span><strong>شروع نشده</strong></div>
          <div className="validation-status-row"><span>خط مبنای مقایسه</span><strong>قبل از ارزیابی نهایی تثبیت می‌شود</strong></div>
        </article>
      )}
    </section>
  );
}
