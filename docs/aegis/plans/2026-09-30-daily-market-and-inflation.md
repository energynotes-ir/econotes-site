# Daily market and inflation data

## Goal

Connect daily TSETMC index history and local/global gold observations, add the latest verified CBI monthly inflation rates, and make variance/correlation views use percentage changes with honest mixed-frequency handling.

## Architecture

Existing SQLite `series` and `observations` tables remain the macro-series persistence contract. A separate additive bond-market-history table stores TSETMC price/derived-yield points per IFB bond. Small source importers own TSETMC index, TGJU metal, and CBI headline release parsing. `refresh_data.py` schedules them. Existing API shapes remain unchanged, with one read-only bond-history endpoint added.

## Technology

FastAPI, Python requests, SQLite, Next.js client components, TypeScript, and ECharts.

## Baseline and authority

- Approved design and refinements: user messages in this conversation, 2026-09-30.
- Existing TSETMC instrument importer: `api/app/ingest_tse.py`.
- Existing CBI monthly CPI importer: `api/app/ingest_cbi_monthly.py`.
- Existing series API: `api/app/main.py`.
- Existing analytics and dashboard: `src/lib/analytics.ts`, `src/components/chart.tsx`, `src/components/dashboard.tsx`.
- Workspace has no `.git` repository; file hashes were captured before implementation for six directly touched files. No branch/commit workflow is available.

## Compatibility boundary

Keep existing endpoint shapes; additive schema changes are allowed for source-specific market history, with no destructive migrations or observation deletion. Slow series may be drawn as last-observation step lines on daily axes, with their original observation date shown; statistical comparisons must use native/coarser common-period returns and must never use forward-filled daily values. Do not interpolate official ETS observations. Label TGJU global gold as an XAU/USD spot proxy, not an LBMA fixing. Keep CBI raw CPI index history and recent published inflation rates as distinct series.

## Change necessity

- User-visible need: real daily market benchmarks, recent monthly inflation values, percent-scale risk charts, and cross-frequency comparison.
- No-code option: the current dashboard contains demo TEDPIX/gold values and has no correct daily step alignment or percent variance; it cannot satisfy the approved design.
- Minimum code boundary: source importers and tests, refresh wiring, percentage analytics, chart tooltip/step support, pair-analysis component, dashboard wiring, and source/method notes.
- Decision: code-change.

## TDD route

- Mode: auto.
- Decision: strict.
- Strict authority: recorded automatic decision based on persisted imports, shared analytics, and producer-consumer behavior.
- Test posture: strict RED tests for import parsing and persistence; focused post-change TypeScript/build checks for the client flow.
- Verification: Python unit suite, lint, typecheck, production build, and API/data readback.

## Tasks

1. Add failing tests for TSETMC index fields/date mapping, TGJU local/global table parsing, and CPI release metric definitions.
2. Implement isolated importers, wire daily refresh, and import real TEDPIX/equal-weight index and metal observations.
3. Update percentage-change variance and mixed-frequency alignment; add the normalized pair chart with sample counts and rolling return correlation.
4. Add CPI monthly/point-to-point release charts, precious-metals grouping, source freshness/provenance notes, and concise documentation.
5. Run the complete verification set and read back imported date ranges, units, and observation counts.

## Follow-up scope (2026-09-30)

- Replace the short, internally inconsistent TGJU `tgju_gold_irg18` history with the deeper standard `geram18` series after validating its full date range and overlap. Preserve pre-existing observations that are absent from the new archive and report them for explicit cleanup review rather than deleting stored data during refresh.
- Build historical CBI month-over-month and year-over-year inflation from the published monthly CPI index, rounded to the release precision; use the separately published headline rates for 1405/01–1405/06, which are newer than the raw index archive.
- Persist source provenance per observation, refresh CPI rates daily, and verify date coverage and counts. Do not fill missing price-index levels or interpolate.

## Follow-up results

- The active `gold` series now uses TGJU's standard `geram18` symbol: 3,516 daily observations from 2013-07-22 through 2026-09-29. The previous shorter symbol had materially stale values in several stretches. The deeper archive is still from TGJU; no independent provider with an equally long, freely accessible daily archive was found, so the dashboard labels the source and symbol explicitly.
- CPI rates now contain 65 monthly observations from 1400/02 through 1405/06 and 54 point-to-point observations from 1401/01 through 1405/06. The 1405/01–1405/06 rates use CBI's published headlines; historical rates are calculated from the CBI CPI index.
- The CBI TSD source does not return `cpi-goods` or `cpi-services` for 1401/02. That single month remains visibly absent rather than being estimated.
- Verification: Python unit suite, `npm run lint`, `npm run typecheck`, API health, and series readback passed.

## Follow-up scope (2026-09-30): continuous ingestion and remaining public archives

- Reuse `refresh_data.py` as the single local scheduler owner. It wakes every five minutes, checks per-source due times, compares offset-aware timestamps as UTC instants, isolates failures, and applies bounded retry backoff. It remains an ordinary foreground process under `npm run dev:all`; this change does not install an OS startup service or deploy a hosted worker.
- Replace the one-year XAU/USD history cap with TGJU's paginated public `ons` summary endpoint. Validate archive length and oldest date before accepting it, and raise the series API cap so the UI receives all stored rows.
- Crawl IBENA news-archive sitemaps and parse OMO report `NewsArticle` JSON-LD. Store only explicitly reported amounts for repo, reverse repo, and outright purchase. Convert source amounts to `همت`, use the report's Jalali operation date when stated, and leave unreported metrics missing. A report that explicitly says no bid/proposal was received may produce zero.
- Make weekly frequency visible in the dashboard and compare weekly OMO observations on their native weekly anchor dates.

## Follow-up results

- TGJU global gold archive now contains 12,153 daily observations from 1979-12-26 through 2026-09-29; local `geram18` remains 3,516 observations from 2013-07-22 through 2026-09-29. The XAU/USD label remains a TGJU spot quote proxy, not an LBMA fixing.
- IBENA archive scan found 177 OMO reports and imported 126 numeric observations into three separate weekly series. The report dated 1405/07/06 (2026-09-28) reports 700.0 thousand billion rials in repo, stored as 70.0 همت. The prior report for 1405/06/30 reports 70.0 همت repo and 2.06 همت outright purchase. The page does not state the repo contract tenor in that headline amount, so no 7-day tenor is inferred.
- OMO series are exposed in the dashboard catalog and comparison selector; weekly observations get a weekly label and use weekly anchors for dynamic correlations. The series detail page carries the standard value, variance, and change-variance charts.
- The local scheduler checks due work every five minutes: imported TSETMC instruments and indices every six hours, IFB YTM every six hours, Nobitex every two hours, TGJU metals every four hours, and CBI / IBENA archives every twelve hours. Failures use a bounded 5–60 minute exponential retry schedule, and a stale `running` attempt becomes retryable after 30 minutes.
- Live CBI liquidity/base-money pulls on 2026-09-30 still returned their latest observations dated 2025-12-21. The source has not published a later quarter in the public API response; no values were filled.
- ETS remains only four verified snapshots because the public CBI date lookup rejects repeated automated historical lookups. IFB YTM remains a current-page snapshot feed and will build its usable series from ongoing polling. These are source-history limits, not missed local imports.
- Verification added parser, full-archive guard, timezone scheduling/backoff, and weekly-correlation tests. The series API now allows up to 20,000 rows so the whole XAU/USD archive reaches the dashboard.
- The canonical TGJU API archive currently has 12,153 XAU/USD daily rows. Five legacy Sunday snapshots already in the local database are preserved by refresh and remain outside that canonical archive count until reviewed.

## Follow-up scope (2026-09-30): Tether daily feed recovery

- The official Nobitex UDF endpoint currently returns `no_data` for `USDTIRT` at daily, hourly, and minute resolutions while still returning active order-book quotes. Preserve its existing historical observations and retry it with bounded backoff.
- Add Wallex's public `USDTTMN` daily-close archive as a separate, source-attributed series rather than silently merging exchange prices. Fetch in calendar-year windows so endpoint response limits cannot truncate a multi-year request; verify `TMN` units and omit the still-open Tehran day.
- Schedule the independent Wallex importer every two hours, expose the resulting series in the currency group and dashboard, and retain the existing SQLite/API contracts. Do not delete existing observations.
- TDD route: strict for parsing and archive validation. Verify parser tests, scheduler registration, full archive persistence, API readback, and client lint/typecheck/build.

## Follow-up results

- The official Nobitex UDF returns `no_data` for USDT at daily, hourly, and minute intervals in the live check; the same UDF returns BTC daily candles and the USDT order book remains active. The existing Nobitex history remains stored and its worker retries independently.
- Wallex import completed with 2,447 daily `USDTTMN` observations from 2020-01-01 through 2026-09-29. Latest close was 257,015 TMN/toman. The API omits 17 dates in that span, confirmed with narrower requests; these gaps remain missing. The adapter requests separate calendar-year intervals, filters the open Tehran date, validates archive depth/freshness, and upserts without deleting prior rows. Its 2,300-row floor rejects a missing full historical year.
- The independent Wallex series is available in currency cards/navigation and as an option in pair analysis. Its scheduler interval is two hours.
- Final local verification passed: 28 Python tests, ESLint, TypeScript, and production build. The running local API reports health `ok`; its Wallex series returns 2,447 rows (2020-01-01–2026-09-29, 257,015 Toman latest), OMO repo 114 rows with 70.0 همت on 2026-09-28, and XAU/USD 12,158 rows including five preserved legacy Sunday points. Dashboard HTTP returned 200.

## Follow-up scope (2026-09-30): official FX history and Treasury-bill YTM history

- Import the public CBI TSD USD official remittance, cash, weighted-average, and preferential monthly categories as independent series. Convert Rial source values to Toman for comparison while preserving the original payload and keep them separate from daily ETS quotes.
- Resolve active IFB zero-coupon Treasury symbols to TSETMC instrument codes and ingest only dates with reported trades. Calculate an annual compound yield from the verified IFB maturity and a 1,000,000 Rial face value using a 365-day basis; store this separately from the IFB-reported YTM snapshots.
- Add an individual instrument history API and interactive chart, plus a daily aggregate estimate series for pair analysis. Refresh the historical archive once per day and current IFB terms every six hours.
- Do not infer coupons or maturities for corporate coupon securities. Keep YTM history limited to the current IFB-listed اخزا/سخاب instruments until terms for other classes are available.

## Follow-up results

- The CBI monthly importer now exposes 21 series. Four new official USD series were added; source Rials are converted to Toman while raw payloads are preserved. The official remittance/cash/weighted-average categories currently end on 2025-04-20, and the preferential archive ends on 2026-03-20. Existing free-market series were also normalized from Rial to Toman.
- The TSETMC archive matched all 16 active IFB اخزا symbols. It stored 4,736 traded price/YTM observations from 2023-12-09 through 2026-09-30 and no unmatched active symbols. The pointwise calculation matches four live IFB YTM examples to two decimal places.
- New API `GET /api/v1/bonds/{instrument_id}/history` returns the per-symbol price, transaction date, maturity, and estimated YTM. The aggregate daily series is `yield-history`; the direct IFB-reported aggregate remains `yield`.
- A transient IFB connection timeout showed that history refresh should rely on the already stored current IFB terms rather than re-fetching the large IFB page. The importer now uses the latest successful local IFB snapshot and performs network reads before opening its batch write transaction.
- Direct BLS API/download hosts returned HTTP 403 and FRED CSV timed out from this network. A public OECD SDMX CPI endpoint was reachable and supplied national, all-items, non-seasonally-adjusted U.S. CPI index observations from 1955-01 through 2026-08. The importer also derives monthly and year-over-year rates from the index.
- The monthly real-USD index uses period-average Wallex USDT/Toman, directly observed CBI CPI levels, and the latest completed OECD U.S. CPI month before each Iranian CPI period end. It is rebased to 100 at the first common period and intentionally stops at the latest raw CBI CPI level (2026-03-20); newer rounded headline rates are not chained into a fabricated index.
- The CBI TSD catalog identifies a daily weighted interbank-rate category, but its public graph endpoint currently returns empty values for that category. IBENA news pages with explicit rates are indexed irregularly, so they do not form a complete weekly archive; no synthetic or irregular series was substituted.

## Risks and stop conditions

- Daily ETS currently has four verified points; show the descriptive sample size and suppress rolling estimates until the selected window is met. The CBI TSD monthly official-rate series are separate and have older, different coverage.
- The CBI TSD raw CPI index currently ends at 2026-03-20; do not fabricate later index levels. Add separately sourced headline rates only.
- TGJU global gold is a market quote proxy. It is not the licensed LBMA benchmark; public-domain redistribution remains outside this local implementation.
- The `yield-history` series is a zero-coupon Treasury-bill estimate built from TSETMC trades and IFB maturity terms. It is not an official IFB YTM history and does not cover coupon bonds.
- OECD U.S. CPI is the connected national CPI series; it is not a direct BLS series identifier. The real-exchange calculation has an explicit one-month-safe CPI alignment and is limited by the raw CBI CPI archive.
- The daily CBI weighted interbank-rate category currently has metadata but no values from the graph API. Explicit IBENA rate articles are too irregular for a continuous weekly series; keep the dashboard item marked as unconnected unless a verifiable archive is found.
- OMO articles do not consistently publish every metric. Import explicit numeric values only; a missing value is not zero. If the local machine sleeps or `dev:all` stops, scheduled updates pause until the worker runs again.
- Stop rather than silently changing units, date conventions, or a source response parser when the upstream shape changes.

## Follow-up design: macro risk and scenario workspace

**Design state:** The user approved an integrated risk/scenario workspace for macroeconomic analysis on 2026-10-04. The implementation plan is `docs/aegis/plans/2026-10-04-macro-risk-scenario-workspace.md`; implementation is underway. Shared chart range/hover, switchable chart layout, and persistent scenario paths remain open acceptance items. The exact prediction contract remains subject to the ML pipeline's Gate A after data inspection and EDA.

### User, outcome, and scope

- Audience: corporate finance managers, portfolio managers who need a macro view, and equity analysts.
- Goal: make EcoNotes a coherent analytical workbench for how FX, inflation, liquidity, rates, precious metals, and broad equity indices interact; compare daily market behavior with medium-term macro responses.
- Keep analysis at macro and broad-market level. Do not add constituent-stock coverage, portfolio holdings, portfolio weights, or stock-level risk to this work.
- Reorganize the experience around a management overview, macro variables, cross-market relationships, risk and scenarios, fixed income, and data/method quality. Avoid a general-purpose drag-and-drop dashboard builder.
- Preserve the current static GitHub Pages deployment for this phase. Published model and data artifacts are public; do not put private inputs or credentials in the static payload.

### Current behavior and evidence

- `src/components/scenario-desk.tsx` fits one contemporaneous, univariate OLS relationship between same-period log returns. The default window is 120 common daily observations; it does not model lags, future response horizons, regimes, or other macro drivers.
- `src/components/risk-desk.tsx` selects one market at a time and shows drawdown and rolling volatility. VaR-like downside is the historical fifth percentile of the selected recent window; it is not a calibrated future-loss forecast.
- `src/components/pair-analysis.tsx` gives a large panel to sample correlation while the normalized comparison and rolling-correlation charts share the page. The sample-correlation result should become a compact statistic beside or above the primary chart.
- `src/lib/analytics.ts` is the current TypeScript owner for descriptive analytics. Model estimation and backtesting must have a reproducible, testable owner and must not be mixed into presentation components.
- The current public snapshot has 4,296 daily TEDPIX observations, 3,017 daily equal-weight observations, 2,450 daily free-FX observations, 59 monthly real-FX observations, and 54–65 monthly CBI inflation observations, depending on the series. These counts are evidence for initial scope, not promises of future coverage.
- Macro rows are keyed by series and observation date and refreshed with upserts. Previous revisions are not retained as a full point-in-time vintage history. Source release availability and vintage retention must be addressed before claiming a real-time macro backtest.

### Interaction and visualization design

- Give risk and scenario one top-level workspace with clear subviews for risk state, macro relationships, scenario response, and forecast validation. Keep model outputs, units, horizons, and data timestamps visible near the chart that uses them.
- Use shared controls for selected broad-market series, period, native frequency, and forecast/response horizon. Daily and monthly data must remain on their native statistical frequency; step-line rendering must not create repeated observations.
- Risk view defaults to synchronized small multiples with a shared date axis, range selection, and hover. Users can switch between stacked and side-by-side layouts. Comparing the same metric across markets uses a common scale.
- Different raw units (for example volatility, drawdown, and yield) must not share a raw y-axis. Offer separate aligned panels or an explicitly labeled normalized percentile view. Do not create a composite stress score without a documented formula, component provenance, and validation.
- Risk metrics to assess: realized volatility, downside semideviation, historical VaR/Expected Shortfall, drawdown depth/duration/recovery, and FX sensitivity. Keep dependence measures (rolling correlation, beta, and any conditional-correlation model) distinct from direct loss measures. Do not label macro funding conditions as trading liquidity risk without market microstructure data.
- Cross-market view gives the normalized market-path chart and dynamic relationship charts primary width. Show sample correlation as a compact statistic with the paired-observation count, date range, and frequency. Synchronize hover and time-range selection across charts.
- Scenario controls must distinguish a one-period shock from a persistent shock path. Render response by horizon with uncertainty bands and identify when a shock is outside the historical support.
- Responsive behavior: side-by-side plots on wide screens when legible; stacked, synchronized plots on narrow screens. Do not drop units, sample counts, method notes, or observation dates on mobile.

### Analytical design and scientific boundaries

- Separate **forecasting** from **scenario/response analysis**. A forecasting model is selected for out-of-sample predictive performance. A scenario model describes a conditional response to a specified shock and is not automatically causal.
- Candidate short-term targets: broad-index returns and forward realized volatility at 1, 5, and 20 Tehran trading sessions. Treat TEDPIX as the primary broad-market target and equal-weight as a robustness/market-breadth comparison; verify each index's return construction during data inspection.
- Candidate medium-term targets: broad-index cumulative returns and selected risk indicators at 1, 3, 6, and 12 months. Use monthly/quarterly observations and release-availability timing; never interpolate low-frequency values into daily observations for estimation.
- Candidate methods, subject to data profile and Gate A: simple zero-return/AR and persistence baselines; a parsimonious lagged market/FX model; local projections for horizon-specific conditional responses; and small VAR/ARDL-type systems only if the available sample supports the number of variables and lags. Compare rolling correlation with DCC only on data with adequate observations. These are candidate families, not pre-approved final models.
- A simultaneous or structural system must specify how shocks are identified and pass stability/sensitivity checks. Without defensible identification, label results as reduced-form or conditional responses, not causal effects.
- Keep candidate predictor sets small. Monthly FX/CPI samples are currently short; an unrestricted many-variable system is at high risk of overfitting. Add regime asymmetry only after the baseline has passed out-of-sample checks and there are enough observations in each regime.
- Do not present an absolute promise of low forecast error. A forecast is eligible for a “validated” label only for horizons where it consistently improves on the predeclared naive baseline in chronological out-of-sample evaluation and has adequate test coverage. Otherwise show “no stable predictive edge” and retain descriptive risk/scenario views.

### Forecast validation contract

- Use rolling-origin or expanding-window evaluation. At each origin, fit only on information that would have been available then. Do not shuffle time rows or use future releases, revised observations, or test outcomes in feature selection or tuning.
- Compare return forecasts with zero-return/random-walk and simple autoregressive baselines. Report MAE and RMSE, plus relative error versus the baseline, separately by horizon; direction accuracy is secondary.
- Evaluate volatility forecasts against realized volatility using a suitable loss such as QLIKE and a simple persistence/EWMA baseline. Evaluate VaR/Expected Shortfall with quantile/tail scores and calibration/exceedance diagnostics, not only in-sample fit.
- Report training and evaluation spans, origin count, target definition, input series and vintage policy, frequency, horizon, model/version, baseline error, candidate error, uncertainty, and known limitations.
- Do not use one threshold across incomparable targets. Define the exact target, allowed inputs, forecast origin, horizons, primary metrics, and minimum evaluation coverage in the prediction contract before fitting; this is ML Gate A and requires explicit user approval.
- Current historical rows cannot reconstruct all past macro data vintages. Until point-in-time releases are archived prospectively, label macro backtests as revised-data/pseudo-out-of-sample and do not claim true real-time forecast performance. Record `available_at`/first-seen timestamps and value revisions in an append-only vintage store before promoting real-time claims.

### Runtime and output ownership

- Keep the existing static publication path. Estimate and validate models in a reproducible Python research pipeline, then export a versioned, provenance-rich analytical snapshot alongside the public series snapshot. The client renders estimates and performs only the interactive scenario arithmetic supported by the exported model artifact; it does not silently fit a model in the browser.
- The forecast artifact must include target, horizon, inputs, model identifier/version, training and evaluation periods, sample counts, metrics versus baseline, generation time, vintage limitations, and publication eligibility.
- New data-vintage storage is additive. Preserve existing observation/API shapes while the vintage owner is introduced; do not delete current observations or rewrite historical definitions without an explicit migration plan.
- Retain existing ECharts components where possible. Keep presentation components focused on interactions and rendering; isolate and unit-test numerical methods.

### Acceptance criteria

1. Risk comparisons support synchronized side-by-side and stacked layouts for selected broad-market/macro series, with shared dates and hover.
2. Multiple raw risk measures are separated by units; normalized comparisons state their scale and transformation.
3. The sample-correlation statistic is compact and does not compete with the main comparison or dynamic-relationship charts.
4. Daily/short-term and monthly/medium-term analysis are separately labeled and never imply that forward-filled daily points are macro observations.
5. Forecasts and scenarios are visually and methodologically distinct; no forecast is labeled validated without passing the baseline and temporal-evaluation rules above.
6. Every visible estimate carries enough provenance to reproduce its inputs, definition, horizon, sample, and validation result.
7. When the available sample or vintage information is insufficient, the UI reports that limitation and falls back to descriptive analysis rather than manufacturing confidence.
8. The redesigned workspace remains usable at desktop and mobile widths and preserves the static deployment boundary.

### Prior art and reuse references

- Jordà (2005), “Estimation and Inference of Impulse Responses by Local Projections,” *American Economic Review* — candidate method for horizon-specific responses.
- Engle (2002), “Dynamic Conditional Correlation: A Simple Class of Multivariate GARCH Models,” *Journal of Business & Economic Statistics* — candidate conditional-dependence model.
- Patton (2011), “Volatility Forecast Comparison Using Imperfect Volatility Proxies,” *Journal of Econometrics* — reference for comparing volatility forecast losses.
- Croushore and Stark (2001), “A Real-Time Data Set for Macroeconomists,” *Journal of Econometrics* — reference for point-in-time macro data and revision risk.

### Implementation gate

The approved design has an implementation plan at `docs/aegis/plans/2026-10-04-macro-risk-scenario-workspace.md`. Before any model fitting, follow `ml_pipeline/PIPELINE.md`: complete data inspection, EDA, and the prediction contract first; obtain explicit Gate A approval; then proceed through the temporal validation gates. No model has been trained or deployed under this design.
