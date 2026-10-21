"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { alignedReturns, repeatedShockPath, scenarioEstimate, sensitivityModel } from "@/lib/analytics";
import { downloadCsv, formatDate, formatNumber, riskIds, type Series } from "@/lib/data";

type ScenarioDeskProps = {
  series: Series[];
  targetId?: string;
  onTargetChange?: (value: string) => void;
  driverId?: string;
  onDriverChange?: (value: string) => void;
  windowSize?: number;
  onWindowChange?: (value: number) => void;
  shock?: number;
  onShockChange?: (value: number) => void;
  mode?: "one-period" | "persistent";
  onModeChange?: (value: "one-period" | "persistent") => void;
  periods?: number;
  onPeriodsChange?: (value: number) => void;
  showIntro?: boolean;
  showControls?: boolean;
};

export default function ScenarioDesk({
  series,
  targetId,
  onTargetChange,
  driverId,
  onDriverChange,
  windowSize,
  onWindowChange,
  shock: controlledShock,
  onShockChange,
  mode: controlledMode,
  onModeChange,
  periods: controlledPeriods,
  onPeriodsChange,
  showIntro = true,
  showControls = true,
}: ScenarioDeskProps) {
  const [localTargetId, setLocalTargetId] = useState("tedpix");
  const [localDriverId, setLocalDriverId] = useState("usd-free");
  const [localWindow, setLocalWindow] = useState(120);
  const [localShock, setLocalShock] = useState(5);
  const [localMode, setLocalMode] = useState<"one-period" | "persistent">("one-period");
  const [localPeriods, setLocalPeriods] = useState(6);
  const selectedTargetId = targetId ?? localTargetId;
  const selectedDriverId = driverId ?? localDriverId;
  const window = windowSize ?? localWindow;
  const shock = controlledShock ?? localShock;
  const mode = controlledMode ?? localMode;
  const periods = controlledPeriods ?? localPeriods;
  const changeTarget = onTargetChange ?? setLocalTargetId;
  const changeDriver = onDriverChange ?? setLocalDriverId;
  const changeWindow = onWindowChange ?? setLocalWindow;
  const changeShock = onShockChange ?? setLocalShock;
  const changeMode = onModeChange ?? setLocalMode;
  const changePeriods = onPeriodsChange ?? setLocalPeriods;
  const options = riskIds.map((id) => series.find((s) => s.id === id)).filter((s): s is Series => Boolean(s));
  const target = options.find((s) => s.id === selectedTargetId) ?? options[0];
  const driver = options.find((s) => s.id === selectedDriverId && s.id !== target?.id) ?? options.find((s) => s.id !== target?.id);
  if (!target || !driver) return <div className="empty-state">برای سنجش سناریو، دو شاخص با تاریخچهٔ معتبر لازم است.</div>;
  const model = sensitivityModel(alignedReturns(target.points, driver.points), window);
  const estimate = model ? scenarioEstimate(model, shock) : null;
  const path = repeatedShockPath(shock, periods);
  const historicalShockRange = model ? [
    Math.expm1(model.minShock / 100) * 100,
    Math.expm1(model.maxShock / 100) * 100,
  ] as const : null;
  const grid = [-10, -5, -2, 0, 2, 5, 10].map((value) => ({ shock: value, result: model ? scenarioEstimate(model, value) : null }));
  const exportScenario = () => {
    if (mode === "persistent") {
      downloadCsv("scenario-path", [
        ["نوع مسیر", "محرک", "دوره", "تغییر دوره‌ای (٪)", "سطح محرک (پایه ۱۰۰)", "تغییر انباشته (٪)", "اثر بر شاخص هدف"],
        ...path.map((point) => ["مسیر ورودی محرک", driver.title, point.period, shock, point.indexValue, point.cumulativeChangePct, "محاسبه نشده"] as (string | number)[]),
      ]);
      return;
    }
    if (!model || !estimate) return;
    downloadCsv("scenario", [["شاخص هدف", "محرک", "شروع دوره", "پایان دوره", "تعداد بازده مشترک", "شوک (٪)", "بازده برآوردی (٪)", "حساسیت β", "قدرت توضیح R²", "خطای باقیمانده", "بیرون از محدوده تاریخی"],
      [target.title, driver.title, model.start, model.end, model.count, shock, estimate.value, model.beta, model.rSquared, model.residualSigma, estimate.extrapolated ? "بله" : "خیر"] as (string | number)[]]);
  };
  return <section>
    {showIntro && <div className="page-intro compact"><div><div className="eyebrow"><span className="eyebrow-line" /> سناریو</div><h1>اثر تاریخی یک تغییر</h1><p>یک متغیر و میزان تغییرش را انتخاب کنید تا رابطهٔ تاریخی آن با بازده شاخص را ببینید.</p></div></div>}
    {showControls && <div className="panel compare-controls"><div><label htmlFor="scenario-target">بازار هدف</label><div className="select-wrap"><select id="scenario-target" value={target.id} onChange={(e) => changeTarget(e.target.value)}>{options.map((s) => <option key={s.id} value={s.id}>{s.shortTitle}</option>)}</select></div></div><div><label htmlFor="scenario-driver">متغیر شوک</label><div className="select-wrap"><select id="scenario-driver" value={driver.id} onChange={(e) => changeDriver(e.target.value)}>{options.filter((s) => s.id !== target.id).map((s) => <option key={s.id} value={s.id}>{s.shortTitle}</option>)}</select></div></div><div><label htmlFor="scenario-window">پنجره برآورد</label><div className="select-wrap"><select id="scenario-window" value={window} onChange={(e) => changeWindow(Number(e.target.value))}>{[60, 120, 252].map((n) => <option key={n} value={n}>{formatNumber(n)} بازده مشترک</option>)}</select></div></div></div>}
    <fieldset className="panel scenario-mode-control">
      <legend>الگوی شوک</legend>
      <label><input type="radio" name="scenario-mode" value="one-period" checked={mode === "one-period"} onChange={() => changeMode("one-period")} /><span><strong>یک‌دوره‌ای</strong><small>بررسی اثر در یک دوره</small></span></label>
      <label><input type="radio" name="scenario-mode" value="persistent" checked={mode === "persistent"} onChange={() => changeMode("persistent")} /><span><strong>تکرارشونده</strong><small>اعمال تغییر در چند دوره</small></span></label>
    </fieldset>
    <div className="panel scenario-input">
      <div><label htmlFor="scenario-shock">{mode === "persistent" ? `تغییر ${driver.shortTitle} در هر دوره` : `تغییر ${driver.shortTitle} در یک دوره`}</label><strong>{shock > 0 ? "+" : ""}{formatNumber(shock, 1)}٪</strong></div>
      <input id="scenario-shock" type="range" min={-20} max={20} step={0.5} value={shock} aria-describedby="scenario-shock-help" onChange={(e) => changeShock(Number(e.target.value))} />
      <div id="scenario-shock-help" className="shock-presets">{[-10, -5, 0, 5, 10].map((s) => <button type="button" key={s} className={shock === s ? "selected" : ""} aria-pressed={shock === s} onClick={() => changeShock(s)}>{formatNumber(s)}٪</button>)}</div>
      {mode === "persistent" && <div className="scenario-period-control"><label htmlFor="scenario-periods">تعداد دوره‌ها</label><div className="select-wrap"><select id="scenario-periods" value={periods} onChange={(event) => changePeriods(Number(event.target.value))}>{[1, 3, 6, 12].map((value) => <option key={value} value={value}>{formatNumber(value)} دوره</option>)}</select></div></div>}
    </div>
    {mode === "one-period" && (!model || !estimate) && <div className="panel empty-state">برای این برآورد، دست‌کم ۳۰ مشاهدهٔ هم‌زمان و تغییرات کافی در هر دو سری لازم است.</div>}
    {mode === "one-period" && model && estimate && <>
      <div className="analysis-summary"><article className="panel"><span>اثر تغییر {formatNumber(shock, 1)}٪ در {target.shortTitle}</span><strong className={estimate.impact < 0 ? "negative-text" : "positive-text"}>{estimate.impact > 0 ? "+" : ""}{formatNumber(estimate.impact, 2)} واحد درصد</strong><small>اختلاف با برآورد بدون شوک</small></article><article className="panel"><span>بازده برآوردی برای همان دوره</span><strong>{formatNumber(estimate.value, 2)}٪</strong><small>برآورد پایه: {formatNumber(estimate.baseline, 2)}٪</small></article><article className="panel"><span>حساسیت (β) · قدرت توضیح (R²)</span><strong>{formatNumber(model.beta, 3)} · {formatNumber(model.rSquared * 100, 1)}٪</strong><small>بر پایهٔ {formatNumber(model.count)} بازده هم‌زمان</small></article></div>
      <div className="panel scenario-result"><div className="panel-header"><div><span className="panel-kicker">پراکندگی خطای تاریخی</span><h3>{formatNumber(estimate.low, 2)}٪ تا {formatNumber(estimate.high, 2)}٪</h3></div><button type="button" className="outline-button" onClick={exportScenario}><Download size={15} /> دریافت CSV</button></div><p>این دامنه، پراکندگی خطاهای مدل در دورهٔ انتخابی است و فاصلهٔ اطمینان پیش‌بینی آینده نیست.</p>{estimate.extrapolated && <div className="inline-warning">این شوک از محدودهٔ تغییرات ثبت‌شده در دورهٔ انتخابی بزرگ‌تر است؛ نتیجه برون‌یابی شده است.</div>}{model.rSquared < 0.1 && <div className="inline-warning">این متغیر کمتر از ۱۰٪ تغییرات شاخص هدف را در این برآورد توضیح می‌دهد.</div>}<small>دورهٔ برآورد: {formatDate(model.start)} تا {formatDate(model.end)}</small></div>
      <div className="panel risk-table-panel"><div className="panel-header"><h3>ماتریس حساسیت</h3><span className="badge">مدل خطی تک‌متغیره</span></div><div className="table-scroll"><table className="risk-table"><thead><tr><th>تغییر {driver.shortTitle}</th><th>اثر در مقایسه با تغییر صفر</th><th>بازده برآوردی {target.shortTitle}</th><th>دامنهٔ خطای تاریخی</th><th>دامنهٔ داده‌های تاریخی</th></tr></thead><tbody>{grid.map((row) => <tr key={row.shock}><td>{formatNumber(row.shock)}٪</td><td>{row.result!.impact > 0 ? "+" : ""}{formatNumber(row.result!.impact, 2)} واحد درصد</td><td>{formatNumber(row.result!.value, 2)}٪</td><td>{formatNumber(row.result!.low, 2)}٪ تا {formatNumber(row.result!.high, 2)}٪</td><td>{row.result!.extrapolated ? "بیرون از محدوده" : "در محدوده"}</td></tr>)}</tbody></table></div></div>
    </>}
    {mode === "persistent" && <>
      <div className="panel scenario-path-panel">
        <div className="panel-header"><div><span className="panel-kicker">مسیر فرضی محرک · شروع از ۱۰۰</span><h3>{driver.shortTitle}: {formatNumber(shock, 1)}٪ در هر دوره</h3></div><button type="button" className="outline-button" onClick={exportScenario}><Download size={15} /> دریافت CSV</button></div>
        <p className="panel-note">تغییر هر دوره به‌صورت مرکب روی شاخص محرک اعمال می‌شود. جدول مسیر فرضی محرک را نشان می‌دهد؛ اثر تجمعی روی شاخص هدف محاسبه نمی‌شود.</p>
        <div className="table-scroll"><table className="risk-table scenario-path-table"><thead><tr><th>دوره</th><th>تغییر محرک</th><th>سطح محرک · پایه ۱۰۰</th><th>تغییر انباشته</th></tr></thead><tbody>{path.map((point) => <tr key={point.period}><th scope="row">{formatNumber(point.period)}</th><td>{shock > 0 ? "+" : ""}{formatNumber(shock, 1)}٪</td><td>{formatNumber(point.indexValue, 2)}</td><td>{point.cumulativeChangePct > 0 ? "+" : ""}{formatNumber(point.cumulativeChangePct, 2)}٪</td></tr>)}</tbody></table></div>
        {model && historicalShockRange && <p className="scenario-support-note">پوشش تاریخی هر شوک دوره‌ای: {formatNumber(historicalShockRange[0], 2)}٪ تا {formatNumber(historicalShockRange[1], 2)}٪ در {formatNumber(model.count)} بازده مشترک ({formatDate(model.start)} تا {formatDate(model.end)}). {estimate?.extrapolated ? "شوک انتخاب‌شده خارج از این دامنه است." : "شوک انتخاب‌شده در دامنه مشاهده‌شده قرار دارد."}</p>}
        {!model && <p className="scenario-support-note">پوشش تاریخی سنجیده نشد؛ برای برآورد توصیفی حداقل ۳۰ بازده مشترک با تغییرات کافی لازم است.</p>}
      </div>
      <div className="panel scenario-response-unavailable" role="status">
        <span className="badge">اثر بر شاخص هدف</span>
        <h3>اثر تجمعی بر شاخص هدف در دسترس نیست</h3>
        <p>این بخش مسیر فرضی متغیر محرک را نشان می‌دهد. تغییر انباشتهٔ شاخص هدف محاسبه نمی‌شود.</p>
      </div>
      {model && estimate && <div className="panel scenario-reference">
        <span className="panel-kicker">مقایسهٔ یک‌دوره‌ای</span>
        <h3>{target.shortTitle}: {formatNumber(estimate.value, 2)}٪ بازده شرطی</h3>
        <p>این برآورد برای یک دوره است و به مسیر تکرارشونده تعمیم داده نمی‌شود.</p>
      </div>}
    </>}
    <div className="panel method-strip">مدل خطی: بازده هدف = α + β × بازده متغیر محرک + خطا. فقط تاریخ‌های مشترک وارد برآورد می‌شوند؛ این رابطهٔ تاریخی به‌تنهایی علیت را نشان نمی‌دهد.</div>
  </section>;
}
