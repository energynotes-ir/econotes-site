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
  if (!target || !driver) return <div className="empty-state">برای سناریو حداقل دو بازار با تاریخچه معتبر لازم است.</div>;
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
        ["scenario_type", "driver", "period", "per_period_shock_pct", "driver_index_base_100", "driver_cumulative_change_pct", "target_response_status"],
        ...path.map((point) => ["persistent_input_path_only", driver.title, point.period, shock, point.indexValue, point.cumulativeChangePct, "unavailable_without_eligible_horizon_artifact"] as (string | number)[]),
      ]);
      return;
    }
    if (!model || !estimate) return;
    downloadCsv("scenario", [["target", "driver", "start", "end", "n", "shock_pct", "conditional_response_pct", "beta", "r_squared", "residual_sigma_log_pct", "extrapolation"],
      [target.title, driver.title, model.start, model.end, model.count, shock, estimate.value, model.beta, model.rSquared, model.residualSigma, String(estimate.extrapolated)] as (string | number)[]]);
  };
  return <section>
    {showIntro && <div className="page-intro compact"><div><div className="eyebrow"><span className="eyebrow-line" /> آزمایش سناریو</div><h1>اگر بازار تغییر کند،<br /><em>حساسیت چقدر است؟</em></h1><p>رابطه تاریخی دو بازار را به یک سناریوی قابل بررسی تبدیل کنید؛ اندازه اثر، قدرت توضیح و دامنه خطا را هم‌زمان ببینید.</p></div></div>}
    {showControls && <div className="panel compare-controls"><div><label htmlFor="scenario-target">بازار هدف</label><div className="select-wrap"><select id="scenario-target" value={target.id} onChange={(e) => changeTarget(e.target.value)}>{options.map((s) => <option key={s.id} value={s.id}>{s.shortTitle}</option>)}</select></div></div><div><label htmlFor="scenario-driver">متغیر شوک</label><div className="select-wrap"><select id="scenario-driver" value={driver.id} onChange={(e) => changeDriver(e.target.value)}>{options.filter((s) => s.id !== target.id).map((s) => <option key={s.id} value={s.id}>{s.shortTitle}</option>)}</select></div></div><div><label htmlFor="scenario-window">پنجره برآورد</label><div className="select-wrap"><select id="scenario-window" value={window} onChange={(e) => changeWindow(Number(e.target.value))}>{[60, 120, 252].map((n) => <option key={n} value={n}>{formatNumber(n)} بازده مشترک</option>)}</select></div></div></div>}
    <fieldset className="panel scenario-mode-control">
      <legend>الگوی شوک</legend>
      <label><input type="radio" name="scenario-mode" value="one-period" checked={mode === "one-period"} onChange={() => changeMode("one-period")} /><span><strong>یک‌دوره‌ای</strong><small>اثر توصیفی همان مشاهده مشترک</small></span></label>
      <label><input type="radio" name="scenario-mode" value="persistent" checked={mode === "persistent"} onChange={() => changeMode("persistent")} /><span><strong>مسیر پایا</strong><small>تکرار شوک ورودی در چند مشاهده</small></span></label>
    </fieldset>
    <div className="panel scenario-input">
      <div><label htmlFor="scenario-shock">{mode === "persistent" ? `شوک تکرارشونده ${driver.shortTitle} در هر مشاهده مشترک` : `شوک ${driver.shortTitle} در یک مشاهده مشترک`}</label><strong>{shock > 0 ? "+" : ""}{formatNumber(shock, 1)}٪</strong></div>
      <input id="scenario-shock" type="range" min={-20} max={20} step={0.5} value={shock} aria-describedby="scenario-shock-help" onChange={(e) => changeShock(Number(e.target.value))} />
      <div id="scenario-shock-help" className="shock-presets">{[-10, -5, 0, 5, 10].map((s) => <button type="button" key={s} className={shock === s ? "selected" : ""} aria-pressed={shock === s} onClick={() => changeShock(s)}>{formatNumber(s)}٪</button>)}</div>
      {mode === "persistent" && <div className="scenario-period-control"><label htmlFor="scenario-periods">طول مسیر</label><div className="select-wrap"><select id="scenario-periods" value={periods} onChange={(event) => changePeriods(Number(event.target.value))}>{[1, 3, 6, 12].map((value) => <option key={value} value={value}>{formatNumber(value)} مشاهده مشترک</option>)}</select></div></div>}
    </div>
    {mode === "one-period" && (!model || !estimate) && <div className="panel empty-state">برآورد ممکن نیست؛ حداقل ۳۰ بازده مشترک با تغییرات کافی در هر دو بازار لازم است.</div>}
    {mode === "one-period" && model && estimate && <>
      <div className="analysis-summary"><article className="panel"><span>اثر شوک {formatNumber(shock, 1)}٪ بر {target.shortTitle}</span><strong className={estimate.impact < 0 ? "negative-text" : "positive-text"}>{estimate.impact > 0 ? "+" : ""}{formatNumber(estimate.impact, 2)} واحد درصد</strong><small>تغییر برآورد نسبت به سناریوی شوک صفر</small></article><article className="panel"><span>بازده شرطی یک‌دوره‌ای</span><strong>{formatNumber(estimate.value, 2)}٪</strong><small>با احتساب عرض از مبدأ {formatNumber(estimate.baseline, 2)}٪</small></article><article className="panel"><span>حساسیت β · قدرت توضیح R²</span><strong>{formatNumber(model.beta, 3)} · {formatNumber(model.rSquared * 100, 1)}٪</strong><small>{formatNumber(model.count)} بازده با تاریخ مشترک</small></article></div>
      <div className="panel scenario-result"><div className="panel-header"><div><span className="panel-kicker">پراکندگی تاریخی مدل</span><h3>{formatNumber(estimate.low, 2)}٪ تا {formatNumber(estimate.high, 2)}٪</h3></div><button type="button" className="outline-button" onClick={exportScenario}><Download size={15} /> خروجی سناریو</button></div><p>مرکز برآورد ±۱٫۹۶ انحراف معیار باقیمانده، سپس تبدیل به بازده ساده. این دامنه توصیفی است و فاصله اطمینان معتبر پیش‌بینی نیست.</p>{estimate.extrapolated && <div className="inline-warning">این شوک خارج از دامنه تاریخی متغیر شوک در پنجره منتخب است؛ نتیجه برون‌یابی شده است.</div>}{model.rSquared < 0.1 && <div className="inline-warning">قدرت توضیح مدل کمتر از ۱۰٪ است؛ بخش عمده تغییرات بازار هدف با این متغیر توضیح داده نمی‌شود.</div>}<small>دوره برآورد: {formatDate(model.start)} تا {formatDate(model.end)}</small></div>
      <div className="panel risk-table-panel"><div className="panel-header"><h3>ماتریس حساسیت</h3><span className="badge">OLS تک‌متغیره</span></div><div className="table-scroll"><table className="risk-table"><thead><tr><th>شوک {driver.shortTitle}</th><th>اثر نسبت به شوک صفر</th><th>بازده شرطی {target.shortTitle}</th><th>دامنه توصیفی</th><th>پوشش تاریخی شوک</th></tr></thead><tbody>{grid.map((row) => <tr key={row.shock}><td>{formatNumber(row.shock)}٪</td><td>{row.result!.impact > 0 ? "+" : ""}{formatNumber(row.result!.impact, 2)} واحد درصد</td><td>{formatNumber(row.result!.value, 2)}٪</td><td>{formatNumber(row.result!.low, 2)}٪ تا {formatNumber(row.result!.high, 2)}٪</td><td>{row.result!.extrapolated ? "خارج از نمونه" : "داخل دامنه نمونه"}</td></tr>)}</tbody></table></div></div>
    </>}
    {mode === "persistent" && <>
      <div className="panel scenario-path-panel">
        <div className="panel-header"><div><span className="panel-kicker">مسیر ورودی محرک · شاخص پایه ۱۰۰</span><h3>{driver.shortTitle}: {formatNumber(shock, 1)}٪ در هر مشاهده مشترک</h3></div><button type="button" className="outline-button" onClick={exportScenario}><Download size={15} /> خروجی مسیر</button></div>
        <p className="panel-note">بازده سادهٔ یکسان در هر مشاهده روی شاخص محرک به‌صورت مرکب اعمال می‌شود. این جدول مسیر فرضیِ ورودی سناریو است، نه پاسخ بازار هدف.</p>
        <div className="table-scroll"><table className="risk-table scenario-path-table"><thead><tr><th>مشاهده مشترک</th><th>شوک همان دوره</th><th>سطح محرک · پایه ۱۰۰</th><th>تغییر تجمعی محرک</th></tr></thead><tbody>{path.map((point) => <tr key={point.period}><th scope="row">{formatNumber(point.period)}</th><td>{shock > 0 ? "+" : ""}{formatNumber(shock, 1)}٪</td><td>{formatNumber(point.indexValue, 2)}</td><td>{point.cumulativeChangePct > 0 ? "+" : ""}{formatNumber(point.cumulativeChangePct, 2)}٪</td></tr>)}</tbody></table></div>
        {model && historicalShockRange && <p className="scenario-support-note">پوشش تاریخی هر شوک دوره‌ای: {formatNumber(historicalShockRange[0], 2)}٪ تا {formatNumber(historicalShockRange[1], 2)}٪ در {formatNumber(model.count)} بازده مشترک ({formatDate(model.start)} تا {formatDate(model.end)}). {estimate?.extrapolated ? "شوک انتخاب‌شده خارج از این دامنه است." : "شوک انتخاب‌شده در دامنه مشاهده‌شده قرار دارد."}</p>}
        {!model && <p className="scenario-support-note">پوشش تاریخی سنجیده نشد؛ برای برآورد توصیفی حداقل ۳۰ بازده مشترک با تغییرات کافی لازم است.</p>}
      </div>
      <div className="panel scenario-response-unavailable" role="status">
        <span className="badge">پاسخ افق‌دار منتشر نشده</span>
        <h3>پاسخ چنددوره و باندهای عدم‌قطعیت در دسترس نیست</h3>
        <p>هنوز artifact افق‌داری از دروازه‌های تأیید و اعتبارسنجی عبور نکرده است. رابطه OLS موجود فقط هم‌زمان و یک‌دوره‌ای است؛ آن را به پاسخ چنددوره‌ای تعمیم نمی‌دهیم.</p>
      </div>
      {model && estimate && <div className="panel scenario-reference">
        <span className="panel-kicker">مرجع جداگانه · حساسیت تاریخی یک‌دوره‌ای</span>
        <h3>{target.shortTitle}: {formatNumber(estimate.value, 2)}٪ بازده شرطی</h3>
        <p>دامنه باقیماندهٔ توصیفی یک‌دوره‌ای: {formatNumber(estimate.low, 2)}٪ تا {formatNumber(estimate.high, 2)}٪؛ این دامنه باند مسیر پایا یا فاصله اطمینان پیش‌بینی نیست.</p>
      </div>}
    </>}
    <div className="panel method-strip">مدل توصیفی: بازده لگاریتمی هدف = α + β × بازده لگاریتمی متغیر شوک + خطا. از تاریخ‌های مشترک استفاده می‌شود. رابطه هم‌زمان و تاریخی است؛ تقدم زمانی، علیت و توصیه سرمایه‌گذاری از آن به دست نمی‌آید.</div>
  </section>;
}
