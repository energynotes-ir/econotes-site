# Implementation Plan: Integrated Macro Risk and Scenario Workspace

## Goal

Deliver one coherent macro analysis workspace where managers and analysts can compare broad equity indices with FX, inflation, liquidity, interest rates, OMO, and precious metals; inspect multiple well-defined risk measures; analyze dynamic relationships with regimes and dated events; and use scenarios and forecasts with visible validation evidence.

The work is macro and broad-market only. It does not add individual-stock coverage, portfolio holdings, portfolio weights, or portfolio-level risk. Short- and medium-term analysis are both in scope. No forecast is promised to have low error; a predictive edge must be demonstrated against predeclared chronological baselines.

## Architecture

- The dashboard remains the top-level navigation owner. A macro-analysis workspace coordinates shared period, frequency, selected-series, and horizon state across the existing pair, risk, and scenario views.
- Existing pair, risk, and scenario components remain the visualization owners for their respective subviews. Shared computations stay in src/lib/analytics.ts and are covered by numerical tests.
- The existing events table and /api/v1/events endpoint remain the source for approved event annotations. Static export will add a matching events JSON resource without changing current API shapes or output paths.
- Python research code owns EDA, forecast fitting, chronological evaluation, and model provenance. The browser renders exported artifacts and keeps scenario arithmetic deterministic; it does not fit forecasting models.
- Static GitHub Pages remains the release boundary. A forecast is exported only with a complete validation record and eligibility state; otherwise the interface reports that no validated edge is available.

## Tech Stack

Next.js 16.3.7, React 19, TypeScript 5.9, ECharts 6, FastAPI, SQLite, Python research scripts, and additive static JSON artifacts. The app is currently static-export capable. EDA dependencies are declared in the isolated `ml_pipeline/requirements.txt` environment, separately from API runtime dependencies; marimo 0.25.1 is installed in the ignored local research environment.

## Baseline and Authority References

- AGENTS.md — mandatory Next.js documentation check before application code changes.
- README.md — current series definitions, local workflow, and deployment boundary.
- docs/aegis/plans/2026-09-30-daily-market-and-inflation.md, Follow-up design section — user-approved behavior and scientific boundaries.
- ml_pipeline/PIPELINE.md — mandatory forecasting stages and gates; Gate A has not been approved.
- docs/aegis/baseline/2026-10-04-initial-baseline.md — repository state and compatibility evidence for this plan.
- Existing test baseline: npm run typecheck passes; node --experimental-strip-types --test src/lib/analytics.test.mts passes all 3 tests.

## Compatibility Boundary

- Keep existing API routes, response shapes, series identifiers, units, date conventions, and static JSON paths compatible.
- Add event and forecast artifacts at new static paths; do not silently change the dashboard-data or series payload contracts.
- Keep calculation frequency native. Step rendering may show the last known low-frequency observation, but no repeated daily values may enter estimation.
- Preserve the current OLS sensitivity as a clearly labeled descriptive relationship until a separately approved and validated horizon model is eligible to replace its role. Its descriptive range must not be called a forecast interval.
- Do not alter historical values to manufacture data vintages. Revised-data backtests must be labeled pseudo-out-of-sample until point-in-time inputs can be reconstructed.
- Do not publish private inputs, credentials, or mutable training state to the static client.

## Change Necessity

- User-visible need: the current risk, relationship, and scenario pages do not share controls or provide synchronized multi-market comparisons; the current contemporaneous OLS cannot support claims about forward or medium-term response.
- A docs-only change cannot provide the requested interaction, comparable risk measures, regime/event overlays, or validated forecasts.
- Minimum code boundary: a shared analysis coordinator, precise descriptive metrics and tests, event data in the existing static-export owner, and a separately owned Python forecast/evaluation pipeline that emits additive artifacts.
- Decision: code change, after the data and prediction-contract gate described below.

## Requirement Ready Check

- Approved source: user-approved design in the parent plan and the user's confirmation on 2026-10-04.
- Scope and scenarios: Iran macro variables and the TEDPIX / equal-weight broad-market indices; short and medium horizons; side-by-side/stacked risk comparisons; compact sample correlation; regime and event context.
- Acceptance evidence: synchronized charts, correct units and native frequencies, documented measures, event provenance, separate descriptive/scenario/forecast language, chronological evaluation, and static compatibility.
- Open blocker: the exact forecast target, horizon set, allowed inputs, information cutoff, baselines, metrics, and minimum test coverage are intentionally pending ML Gate A after EDA.
- Decision: ready for implementation of the approved descriptive workspace; forecast fitting remains gated.

## TDD Route

- Mode: auto.
- Decision: strict for numerical behavior and the shared dashboard/data contract because this changes shared analytical behavior and public static outputs.
- Authority: the writing-plans route's automatic risk rule for behavior, shared/core, and producer/consumer changes.
- Test posture: add failing Node built-in tests first for formulas, edge cases, alignment, and event/regime helpers; implement the smallest correct change; then run focused tests and full type/lint/static-export checks. No new test framework is required.
- Verification: use Node 24's built-in test runner with TypeScript stripping, Python pytest for API/exporter contracts, TypeScript checks, ESLint, and static build/browser smoke checks.

## Scope and Ownership Review

### Existence Check

- Proposed surface: one macro-analysis workspace with shared controls and risk, relationship, scenario, and validation subviews.
- Existing owners: dashboard.tsx owns navigation; pair-analysis.tsx, risk-desk.tsx, and scenario-desk.tsx own their current visualizations; analytics.ts owns descriptive calculations; the API events route and SQLite events table own published event data.
- Why current surfaces are insufficient: state is split across independent pages, risk selection is one-market-at-a-time, the correlation insight card takes primary width, and static export omits the existing events endpoint.
- Reuse proof: retain those owners, lift only coordination state into a workspace component, extend the existing analytics library, and export events through the current exporter. No second formula owner or event database is introduced.
- Retirement impact: old navigation entries become subviews; the same descriptive OLS remains available with corrected labeling. No API route is removed.
- Decision: add a small coordination surface with reuse; keep existing owners and public contracts.

### Ripple Signal Triage

This work crosses dashboard navigation, shared chart interactions, analytics, API data, static export, and the client consumer. The canonical metric owner stays analytics.ts; published event truth stays the events table and existing endpoint; JSON generation stays scripts/export_static_data.py; rendering stays chart.tsx and the current analysis components. Update the static producer and reader together. Preserve old API outputs and add regression checks for both the dynamic API and static artifact. Do not introduce a fallback data source for missing events or model outputs.

### Plan Pressure Test

- Owner / contract / retirement: existing calculation, API, and renderer owners remain canonical; one coordinator owns shared view state; old nav labels move into subviews without removing data contracts.
- Architecture / higher-level path: reuse existing dashboard and chart systems; keep numerical forecasting in Python and static output; do not add a database or server requirement.
- Verification scope: analytics unit tests, API and static-export tests, typecheck/lint, static build, and narrow viewport interaction review.
- Task executability: EDA and descriptive/UI tasks can proceed from current data; fitting and forecast publication are conditional on Gate A and the ML pipeline gates.
- Result: proceed with gated forecasting.

## Ordered Tasks

### Task 1 — Profile the data and produce the prediction contract

Files: ml_pipeline/PIPELINE.md; ml_pipeline/guard.py; ml_pipeline/LICENSE-APACHE-2.0; ml_pipeline/THIRD_PARTY_NOTICES.md; ml_pipeline/requirements.txt; ml_pipeline/01_eda.py; ml_pipeline/data_profile.json; ml_pipeline/data_profile_source_panel.json; ml_pipeline/horizon_sample_inventory.csv; ml_pipeline/figures/; ml_pipeline/PREDICTION_CONTRACT.md.

Inspect the raw public snapshot and source metadata for duplicates, gaps, date conventions, native frequencies, stale values, revisions, and release timing. Produce saved EDA figures and a compact table of usable samples by target and candidate horizon. Compare daily TEDPIX and equal-weight construction and examine daily FX, gold, ETS where coverage permits, OMO, yields, monthly CPI, liquidity, and base money. Keep daily and low-frequency samples separate.

The EDA workbench is a reproducible marimo notebook/script; keep research-only dependencies outside api/requirements.txt. Prepare, but do not fit, candidate definitions and baselines for a short-horizon broad-market target and a medium-horizon target. Explain forecast-origin timing and the current revised-data limitation.

Before any model fitting or tuning, present the completed prediction contract to the user and receive explicit Gate A approval. The contract must name target, transformations, allowed inputs, horizons, information cutoff, chronological split design, primary and secondary metrics, naive baselines, minimum evaluation coverage, vintage policy, and eligibility rule. If EDA shows insufficient samples, revise the contract toward descriptive relationships and state that prediction is deferred.

Retain Gate A as not approved in PIPELINE.md until the user approves the exact contract. No training, tuning, final test, forecast artifact, or model-related UI claim is allowed before that approval.

Verification: run the marimo data profile without fitting; confirm saved figures and contract tables are reproducible from the checked-in snapshot; record all data exclusions and counts in PIPELINE.md.

### Task 2 — Specify and test descriptive risk measures

Files: src/lib/analytics.ts; src/lib/analytics.test.mts; src/components/risk-desk.tsx.

Add or refine tested helpers for per-observation realized volatility, downside semideviation, historical VaR and Expected Shortfall, and drawdown depth/duration/recovery. Return sample counts and nullable outputs when a complete window is unavailable. Keep risk units explicit; do not annualize until the index trading calendar and frequency convention are verified. Keep dependence measures separate from loss measures. Historical tail statistics remain descriptive and are not labeled forecast VaR.

Use strict RED/GREEN for each new formula and edge case: short samples, flat series, non-finite values, non-positive prices, gaps, and mixed-frequency inputs. Preserve the existing drawdown and rolling-variance behavior unless a test demonstrates a defect in the approved definitions.

Verification: node --experimental-strip-types --test src/lib/analytics.test.mts; npm run typecheck.

### Task 3 — Build the coordinated analysis workspace

Files: src/components/dashboard.tsx; new src/components/macro-analysis.tsx; src/components/risk-desk.tsx; src/components/pair-analysis.tsx; src/components/scenario-desk.tsx; src/app/globals.css; src/app/enterprise.css.

Replace the separate top-level risk, comparison, and scenario navigation destinations with one analysis destination and clear internal subviews. Keep fixed-income, broad-market index, overview, catalog, and methodology destinations intact. The workspace owns selected series, period, native-frequency view, rolling window, and horizon controls and passes scoped selections to existing subviews. Users can move between risk, relationships, scenarios, and forecast validation without losing the active analysis context.

Render selected market series in synchronized small multiples with shared date range, hover, and stacked/side-by-side layouts. Permit comparison of the same risk measure across series on a common scale. Put different raw units in separate panels; normalized percentile comparisons must name the transformation. Shrink sample correlation to a compact statistic with observation count, range, and native frequency. Keep mobile layouts stacked and controls operable.

Verification: add any necessary focused component-level checks using the existing project stack; run typecheck and lint; inspect desktop and mobile widths in a local browser. Read the relevant Next.js 16.3.7 guide under node_modules/next/dist/docs before changing application code, as required by AGENTS.md.

### Task 4 — Add dynamic relationships, regime context, and event annotations

Files: src/lib/analytics.ts; src/lib/analytics.test.mts; src/components/chart.tsx; src/components/macro-analysis.tsx; src/components/pair-analysis.tsx; api/app/main.py; scripts/export_static_data.py; scripts/dev.py if needed; api/tests/test_public_api.py; api/tests/test_static_export.py.

Add transparent rolling correlation comparisons and a conditional relationship view for a regime definition selected after Task 1. Any regime must show its input, threshold/window, update rule, per-regime observation count, and sensitivity to reasonable alternative thresholds. Do not label a regime causal or infer crisis labels from the market series itself. Rolling beta, local projections, or other fitted relationship models are deferred until Gate A approves their target, horizon, and information timing; correlation and regime summaries must not be used to disguise an unapproved model fit.

Use only published rows from the existing events table. Export them as an additive static resource matching the current /api/v1/events response, load through the current apiUrl abstraction, and pass dated annotations into ECharts. Event tooltip/legend details must retain date, title, category, and source when available. Empty event lists are a normal state; do not create unverified event dates.

Verification: add unit tests for regime windows and event-date alignment; assert the live API contract and static events artifact agree; run python3 -m pytest api/tests/test_public_api.py api/tests/test_static_export.py; run the analytics tests and typecheck.

### Task 5 — Fit and evaluate forecasts only after Gate A

Files: ml_pipeline/PIPELINE.md; ml_pipeline/PREDICTION_CONTRACT.md; ml_pipeline/train.py; ml_pipeline/evaluate.py; ml_pipeline/artifacts/; package.json; scripts/export_static_data.py; public/data/api/v1/analytics/ only as generated output.

Follow PIPELINE.md in order. Complete the data-quality, point-in-time leakage, and target-construction checks before preparing time splits. Before Gate B, present the completed preparation, the required model-rationale block, and saved figures; wait for the user's explicit approval before baseline fitting or model training. Use rolling-origin or expanding-window evaluation and compare against the baselines fixed in the approved contract. Tune only inside the development period. Do not use revised releases or future rows before the chosen forecast origin. Given the missing historical vintage archive, label any affected evaluation pseudo-out-of-sample and block real-time-performance claims.

Export a versioned forecast artifact only when the declared metrics, uncertainty, test coverage, and baseline rule pass. Include model version, target, horizon, inputs, training/evaluation windows, number of origins, method, baseline and candidate metrics, data-vintage limitation, and eligibility state. If no candidate improves reliably, export an explicit unavailable/no-stable-edge state with descriptive fallback; do not force a winning model.

Verification: replay the complete pipeline from the approved contract; confirm each evaluation origin uses only available inputs; compare every horizon to its baseline; verify the static artifact rejects missing provenance and never exposes training secrets. Present validation results and figures at Gate C and wait for explicit permission before error analysis or touching the frozen test set. Present the final report at Gate D. Deployment remains a separate user-requested action.

### Task 6 — Separate scenario response from forecast presentation and finish the workflow

Files: src/components/scenario-desk.tsx; src/components/macro-analysis.tsx; src/components/methodology UI in src/components/dashboard.tsx; src/lib/api.ts; src/app/globals.css; src/app/enterprise.css; README.md; api/tests/; src/lib/analytics.test.mts.

Present historical same-period OLS as descriptive sensitivity with its sample, interval limitation, and extrapolation warning. Present horizon-specific forecasts and multi-horizon scenario responses only from eligible artifacts produced after their relevant approval and validation gates. Distinguish one-period shocks from persistent paths; display conditional response bands and historical support. Add a validation view with baseline comparisons and provenance. Keep unavailable or unvalidated models visibly distinct from validated outputs.

Update method/quality copy so definitions, release timing, source coverage, event provenance, risk units, and vintage limits agree with implementation. Keep public APIs and prior series output stable. Retain OLS as a descriptive tool; retire it only if a later user-approved, validated model fully replaces that use.

Verification: run node --experimental-strip-types --test src/lib/analytics.test.mts; npm run typecheck; npm run lint; python3 -m pytest api/tests; npm run prepare:static; inspect generated JSON for valid schemas and eligibility metadata; run a local static-browser smoke check at desktop and mobile widths. Confirm all current destinations, CSV downloads, events, and empty/error/loading states still work.

## Acceptance Criteria

1. Risk, relationship, scenario, and validation views live under a coherent macro-analysis workspace with shared context and navigable subviews.
2. Selected series have synchronized hover and range behavior in stacked and side-by-side layouts; mobile remains readable.
3. At least realized volatility, semideviation, historical VaR/Expected Shortfall, drawdown spell metrics, and FX dependence are available with explicit units and complete-window sample counts.
4. Distinct units are not put on one raw axis; normalized comparisons identify their transformation.
5. Sample correlation is compact and accompanied by date span, frequency, and paired count.
6. Rolling relationships and any conditional-regime output show their windows, thresholds, counts, uncertainty limits, and non-causal interpretation.
7. Event markers come only from published, sourced event records and work in both API-backed and static builds.
8. Daily and low-frequency inputs retain native estimation frequency; no forward-filled values enter returns, regressions, or forecasts.
9. Forecasts and scenarios are separate; forecasts are marked validated only when they pass the approved time-ordered baseline and coverage rules.
10. Every released forecast includes reproducible provenance, evaluation results, and vintage caveats. Otherwise the UI states that no stable predictive edge is available.
11. Existing public response shapes, series identities, units, and static data paths remain compatible.

## Risks and Stop Conditions

- If target coverage, missingness, or vintage timing makes a candidate unusable, revise the prediction contract before Gate A; do not interpolate or fabricate history.
- If Gate A is not approved, finish the descriptive workspace and leave forecast outputs unavailable.
- If there are too few observations in a regime or horizon, suppress conditional estimates and show the sample count.
- If existing events are not published/sourced or are not present in static export, show no markers until the export path passes tests.
- If a static artifact cannot establish baseline improvement, publish no validated forecast.
- Any upstream source-shape or unit change pauses its importer and related analytics until reconciled.

## Retirement and Execution Route

- Retire the three separate navigation entries after the integrated workspace is verified; keep their visualization components as internal subviews.
- Keep the current OLS sensitivity as explicitly descriptive, not as a fallback forecast.
- Do not remove or repurpose existing API and static JSON contracts.
- Execution route: inline. Shared dashboard state, chart contracts, producer/consumer export, and conditional model gates make parallel file ownership costly. User confirmation is not required to execute the approved descriptive scope; exact forecast fitting still requires explicit ML Gate A approval.
- Do not create branches, commits, pushes, or remote changes unless the user explicitly requests them.
