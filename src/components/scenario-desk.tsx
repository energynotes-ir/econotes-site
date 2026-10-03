"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { alignedReturns, scenarioEstimate, sensitivityModel } from "@/lib/analytics";
import { downloadCsv, formatDate, formatNumber, riskIds, type Series } from "@/lib/data";

export default function ScenarioDesk({ series }: { series: Series[] }) {
  const [targetId, setTargetId] = useState("tedpix");
  const [driverId, setDriverId] = useState("usd-free");
  const [window, setWindow] = useState(120);
  const [shock, setShock] = useState(5);
  const options = riskIds.map((id) => series.find((s) => s.id === id)).filter((s): s is Series => Boolean(s));
  const target = options.find((s) => s.id === targetId) ?? options[0];
  const driver = options.find((s) => s.id === driverId && s.id !== target?.id) ?? options.find((s) => s.id !== target?.id);
  if (!target || !driver) return <div className="empty-state">برای سناریو حداقل دو بازار با تاریخچه معتبر لازم است.</div>;
  const model = sensitivityModel(alignedReturns(target.points, driver.points), window);
  const estimate = model ? scenarioEstimate(model, shock) : null;
  const grid = [-10, -5, -2, 0, 2, 5, 10].map((value) => ({ shock: value, result: model ? scenarioEstimate(model, value) : null }));
  const exportScenario = () => {
    if (!model || !estimate) return;
    downloadCsv("scenario", [["target", "driver", "start", "end", "n", "shock_pct", "conditional_response_pct", "beta", "r_squared", "residual_sigma_log_pct", "extrapolation"],
      [target.title, driver.title, model.start, model.end, model.count, shock, estimate.value, model.beta, model.rSquared, model.residualSigma, String(estimate.extrapolated)] as (string | number)[]]);
  };
  return <section><div className="page-intro compact"><div><div className="eyebrow"><span className="eyebrow-line" /> آزمایش سناریو</div><h1>اگر بازار تغییر کند،<br /><em>حساسیت چقدر است؟</em></h1><p>رابطه تاریخی دو بازار را به یک سناریوی قابل بررسی تبدیل کنید؛ اندازه اثر، قدرت توضیح و دامنه خطا را هم‌زمان ببینید.</p></div></div>
    <div className="panel compare-controls"><div><label htmlFor="scenario-target">بازار هدف</label><div className="select-wrap"><select id="scenario-target" value={target.id} onChange={(e) => setTargetId(e.target.value)}>{options.map((s) => <option key={s.id} value={s.id}>{s.shortTitle}</option>)}</select></div></div><div><label htmlFor="scenario-driver">متغیر شوک</label><div className="select-wrap"><select id="scenario-driver" value={driver.id} onChange={(e) => setDriverId(e.target.value)}>{options.filter((s) => s.id !== target.id).map((s) => <option key={s.id} value={s.id}>{s.shortTitle}</option>)}</select></div></div><div><label htmlFor="scenario-window">پنجره برآورد</label><div className="select-wrap"><select id="scenario-window" value={window} onChange={(e) => setWindow(Number(e.target.value))}>{[60, 120, 252].map((n) => <option key={n} value={n}>{formatNumber(n)} بازده مشترک</option>)}</select></div></div></div>
    <div className="panel scenario-input"><div><label htmlFor="scenario-shock">شوک {driver.shortTitle} در یک مشاهده مشترک</label><strong>{shock > 0 ? "+" : ""}{formatNumber(shock, 1)}٪</strong></div><input id="scenario-shock" type="range" min={-20} max={20} step={0.5} value={shock} onChange={(e) => setShock(Number(e.target.value))} /><div className="shock-presets">{[-10, -5, 0, 5, 10].map((s) => <button key={s} className={shock === s ? "selected" : ""} onClick={() => setShock(s)}>{formatNumber(s)}٪</button>)}</div></div>
    {!model || !estimate ? <div className="panel empty-state">برآورد ممکن نیست؛ حداقل ۳۰ بازده مشترک با تغییرات کافی در هر دو بازار لازم است.</div> : <>
      <div className="analysis-summary"><article className="panel"><span>اثر شوک {formatNumber(shock, 1)}٪ بر {target.shortTitle}</span><strong className={estimate.impact < 0 ? "negative-text" : "positive-text"}>{estimate.impact > 0 ? "+" : ""}{formatNumber(estimate.impact, 2)} واحد درصد</strong><small>تغییر برآورد نسبت به سناریوی شوک صفر</small></article><article className="panel"><span>بازده شرطی یک‌دوره‌ای</span><strong>{formatNumber(estimate.value, 2)}٪</strong><small>با احتساب عرض از مبدأ {formatNumber(estimate.baseline, 2)}٪</small></article><article className="panel"><span>حساسیت β · قدرت توضیح R²</span><strong>{formatNumber(model.beta, 3)} · {formatNumber(model.rSquared * 100, 1)}٪</strong><small>{formatNumber(model.count)} بازده با تاریخ مشترک</small></article></div>
      <div className="panel scenario-result"><div className="panel-header"><div><span className="panel-kicker">پراکندگی تاریخی مدل</span><h3>{formatNumber(estimate.low, 2)}٪ تا {formatNumber(estimate.high, 2)}٪</h3></div><button className="outline-button" onClick={exportScenario}><Download size={15} /> خروجی سناریو</button></div><p>مرکز برآورد ±۱٫۹۶ انحراف معیار باقیمانده، سپس تبدیل به بازده ساده. این دامنه توصیفی است و فاصله اطمینان معتبر پیش‌بینی نیست.</p>{estimate.extrapolated && <div className="inline-warning">این شوک خارج از دامنه بازده‌های متغیر شوک در پنجره منتخب است؛ نتیجه برون‌یابی شده است.</div>}{model.rSquared < 0.1 && <div className="inline-warning">قدرت توضیح مدل کمتر از ۱۰٪ است؛ بخش عمده تغییرات بازار هدف با این متغیر توضیح داده نمی‌شود.</div>}<small>دوره برآورد: {formatDate(model.start)} تا {formatDate(model.end)}</small></div>
      <div className="panel risk-table-panel"><div className="panel-header"><h3>ماتریس حساسیت</h3><span className="badge">OLS تک‌متغیره</span></div><div className="table-scroll"><table className="risk-table"><thead><tr><th>شوک {driver.shortTitle}</th><th>اثر نسبت به شوک صفر</th><th>بازده شرطی {target.shortTitle}</th><th>دامنه توصیفی</th><th>پوشش تاریخی شوک</th></tr></thead><tbody>{grid.map((row) => <tr key={row.shock}><td>{formatNumber(row.shock)}٪</td><td>{row.result!.impact > 0 ? "+" : ""}{formatNumber(row.result!.impact, 2)} واحد درصد</td><td>{formatNumber(row.result!.value, 2)}٪</td><td>{formatNumber(row.result!.low, 2)}٪ تا {formatNumber(row.result!.high, 2)}٪</td><td>{row.result!.extrapolated ? "خارج از نمونه" : "داخل دامنه نمونه"}</td></tr>)}</tbody></table></div></div>
    </>}
    <div className="panel method-strip">مدل: بازده لگاریتمی هدف = α + β × بازده لگاریتمی متغیر شوک + خطا. از تاریخ‌های مشترک استفاده می‌شود. رابطه هم‌زمان و تاریخی است؛ تقدم زمانی، علیت و توصیه سرمایه‌گذاری از آن به دست نمی‌آید.</div>
  </section>;
}
