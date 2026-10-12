# EcoNotes Initial Baseline

Date: 2026-10-04
Status: initial dual-baseline snapshot

## 1. Purpose

Record the repository state and authority surfaces before implementation of the macro risk/scenario workspace. This snapshot is evidence for later alignment checks; approved user requirements and project instructions remain authoritative.

## 2. Workspace Structure

- Next.js application: src/app and src/components.
- Shared series and descriptive analytics: src/lib.
- FastAPI and SQLite ingestion/API: api/app.
- Static data export and public snapshots: scripts/export_static_data.py and public/data.
- Forecast research tracking: ml_pipeline/PIPELINE.md.
- Project requirements and deployment instructions: README.md, AGENTS.md, docs/DEPLOYMENT.md, and docs/AGENT_WORKFLOWS.md.

## 3. Current Authority Surfaces

- AGENTS.md requires reading the installed Next.js guide under node_modules/next/dist/docs before writing application code.
- README.md describes current data definitions, analysis behavior, local run commands, and static publication.
- docs/aegis/plans/2026-09-30-daily-market-and-inflation.md contains the approved follow-up risk/scenario design.
- No ADR, context map, or prior governed baseline was present at snapshot time.
- ml_pipeline/PIPELINE.md is a process tracker, not approval of a prediction target or model.

## 4. Product / Requirement Baseline

### 4.1 Current Truth

- EcoNotes is a Persian-language macroeconomic and broad-market analysis site for Iran.
- The approved workspace is limited to macro variables and broad market indices; it excludes constituent stocks and portfolio construction.
- The approved design separates descriptive risk, conditional scenarios, and out-of-sample forecasts.
- Short and medium horizons are in scope, but the final target, horizons, information cutoff, and metrics await ML Gate A.
- Forecast quality must be evaluated against declared chronological baselines; no absolute error guarantee is authorized.

### 4.2 Non-negotiables

1. Preserve native observation frequencies in calculations; display alignment must not manufacture observations.
2. Keep units, sample coverage, source, and method visible with analysis outputs.
3. Label revised-data backtests as pseudo-out-of-sample until historical release vintages can be reconstructed.
4. Publish only public, provenance-rich artifacts in the static site.

### 4.3 Product Non-goals

- Individual-symbol or all-equity coverage.
- Portfolio holdings, weights, or portfolio-level risk.
- Investment advice or causal claims without a defensible identification strategy.
- Subscription billing, paywall, server migration, and private data publication in this workstream.

## 5. Architecture / Runtime Boundary Baseline

### 5.1 Current Truth

- Dashboard navigation and top-level page selection are owned by src/components/dashboard.tsx.
- Pair, risk, and scenario interfaces are owned by src/components/pair-analysis.tsx, src/components/risk-desk.tsx, and src/components/scenario-desk.tsx.
- Descriptive calculations are owned by src/lib/analytics.ts.
- FastAPI reads the local SQLite source store; scripts/export_static_data.py publishes JSON snapshots for static builds.
- The API has a published-events endpoint and chart rendering accepts event dates, but the static exporter does not currently publish the events endpoint.
- The public snapshot uses established series, bond, and snapshot JSON paths. Static deployment remains active.
- Macro observation upserts do not retain a complete historical real-time vintage archive.

### 5.2 Architecture Non-negotiables

1. Keep one canonical owner for each numerical definition.
2. Keep model fitting and time-series evaluation out of presentation components.
3. Preserve existing API response shapes and static data paths; any new artifact is additive and versioned.
4. Keep descriptive TypeScript analytics separate from reproducible Python forecast estimation and evaluation.

### 5.3 Architecture Non-goals

- Replacing SQLite, FastAPI, or static GitHub Pages in this phase.
- Publishing model-fitting credentials, private inputs, or mutable server state to the client.
- Maintaining two competing owners for the same metric or forecast artifact.

## 6. Ownership / Contract Snapshot

- Top-level routing and dashboard state -> src/components/dashboard.tsx.
- Pair, risk, scenario visualization -> existing respective component files.
- Shared descriptive calculations -> src/lib/analytics.ts.
- Public data contract -> api/app/main.py and current public/data/api/v1 JSON snapshots.
- Static snapshot construction -> scripts/export_static_data.py.
- Chart behavior -> src/components/chart.tsx.
- Forecast process and approval gates -> ml_pipeline/PIPELINE.md.

## 7. Current State and Risks

- The existing scenario model is same-period univariate OLS and is descriptive, not a forecast.
- Risk UI does not currently compare multiple series in synchronized charts.
- The sample-correlation panel is visually prominent.
- Macro rows can be revised without a reconstructible point-in-time vintage record.
- The Python environment has no marimo package installed at snapshot time; the research workflow must declare its isolated dependencies before EDA execution.
- Baseline checks passed at snapshot time: npm run typecheck and node --experimental-strip-types --test src/lib/analytics.test.mts.
- The analytics test emitted Node's MODULE_TYPELESS_PACKAGE_JSON warning; the tests passed.

## 8. Alignment Use

- Use the product baseline to check changes against the approved macro-only scope and quality criteria.
- Use the architecture baseline to preserve analytics ownership, static output contracts, and native-frequency behavior.
- Report scope as both when a change affects both the approved product behavior and a shared runtime or data contract.

## 9. Compatibility Boundary

Keep current public API routes, JSON response shapes, series identifiers, units, date conventions, and static file paths compatible. Add new output paths rather than silently repurposing existing ones. Do not rewrite historical source values or definitions as part of the workspace redesign.
