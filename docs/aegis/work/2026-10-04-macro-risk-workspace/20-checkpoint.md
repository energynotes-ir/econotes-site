# Macro Risk and Scenario Workspace — Checkpoint

## Current state

- Parent plan: `docs/aegis/plans/2026-10-04-macro-risk-scenario-workspace.md`.
- Release base: `main` at `bdd1284a9c2577bee5290aeee284134e3331dd8c`.
- Completed slices: data inspection/EDA; descriptive risk and drawdown measures; the coordinated analysis workspace; rolling relationships, volatility regimes, sourced event support, and static export; persistent driver-input paths; methodology and scientific-boundary copy.
- Gate state: Gate A remains pending in `ml_pipeline/PREDICTION_CONTRACT.md`. No model-ready cleaning, feature engineering, fitting, tuning, final-test access, or forecast export has occurred.
- Release boundary: the descriptive site passed local build and interaction checks and is suitable for the requested static Git update. Browser checks confirm shared hover and date-range behavior, both risk layouts, selection persistence, and the persistent input path. Multi-horizon target responses and uncertainty bands remain unavailable because no artifact has passed the approval and validation gates; the UI says this explicitly.

## Todo checkpoint

| Item | Status | Evidence / next action |
| --- | --- | --- |
| Task 1 — data inspection, EDA, prediction contract | EDA complete; Gate A pending | `ml_pipeline/01_eda.py`, saved profiles/figures, `ml_pipeline/PIPELINE.md`, and draft `ml_pipeline/PREDICTION_CONTRACT.md`. |
| Task 2 — descriptive risk measures | complete; verification passed | `src/lib/analytics.ts`, `src/lib/analytics.test.mts`, and `src/components/risk-desk.tsx`; rolling risk and drawdown spell tests pass. |
| Task 3 — coordinated analysis workspace | complete; browser verified | `src/components/macro-analysis.tsx`; shared market context persists across subviews, charts synchronize hover/range, and risk layout is selectable. |
| Task 4 — rolling relationships, regimes, and events | implementation present; verification passed | `src/lib/analytics.ts`, `src/components/pair-analysis.tsx`, `src/components/chart.tsx`, `src/lib/use-events.ts`, exporter/API contract tests. Current published event list is empty, handled as a normal state. |
| Task 5 — forecasting | paused at Gate A | Resume only after explicit Gate A; later user review required at Gates B, C, and D. |
| Task 6 — scenarios, methodology, final verification | descriptive scope complete; forecasting remains gated | OLS is labeled descriptive, the repeated driver-input path is separate from market response, and forecast validation stays unavailable until its gates pass. |

## Fresh verification (2026-10-12)

- Refreshed the local database once and regenerated the static package at `2026-10-12T06:33:32Z`: 60 series, 37,064 points, 643 bonds, and 0 published events. Latest source observations differ by feed: TEDPIX/equal-weight, Wallex USDT, and local gold through 2026-10-11; global gold through 2026-10-10; IFB yield snapshot dated 2026-10-12; CBI release rates through 2026-09-22; OMO through 2026-10-05. Raw CBI CPI and MEFA liquidity/base money still end at 2026-03-20.
- Passed: `node --experimental-strip-types --test src/lib/analytics.test.mts` — 13 tests; `python3 -m pytest -q api/tests` — 47 tests.
- Passed: `npm run typecheck`, `npx eslint src`, `npm run prepare:static`, `npm run build:static`, and `git diff --check`.
- Browser checks on the generated static site: hover synchronized across all four risk measures and across both relationship charts; dragging the date slider synchronized ranges; both risk layouts worked; market selection persisted across risk/scenario views; persistent inputs produced the six-period 5% compounded path; forecast validation and multi-horizon target responses stayed gated; the empty event state rendered normally. At 390px, the document width stayed 390px on risk, scenario, relationships, and validation views. No browser console errors were reported.
- Limitation: full `npm run lint` traversed the local ignored `ml_pipeline/.venv` and exhausted Node's heap; application source lint passed when scoped to `src`. Browser download-event capture was unavailable in the prior smoke check; the persistent-path CSV handler and schema were reviewed in source.
- The installed Aegis workspace helper could not be located through the environment variable, command path, or installed plugin files, so the structural bundle/check was unavailable.

## Baseline usage and drift

- Product/requirement scope remains broad macro and the two market indices; no constituent-stock analytics or portfolio risk.
- Architecture remains one numerical owner per metric, native-frequency estimation, additive static artifacts, and Python-only forecast fitting.
- The approved design and parent plan authorize descriptive workspace changes. Gate A is only a blocker for ML pipeline Steps 4–8 and later model work.
- Current drift decision: continue within plan. No new source owner or API contract is proposed in the active slice.

## Next governed step

1. Keep all forecast work beyond the descriptive workspace paused until explicit Gate A approval.
2. Before any later application-code change, read the relevant installed Next.js 16.3.7 guide as required by `AGENTS.md`.
3. Preserve the user's notebook and the separate `docs/AGENT_HANDOFF.md` in future Git work unless explicitly requested.
