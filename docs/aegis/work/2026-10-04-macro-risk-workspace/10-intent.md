# Macro Risk and Scenario Workspace — Task Intent

## Requested outcome

Implement the user-approved macro-only analytical workspace for Iran market and macro data: comparable descriptive risk measures, synchronized broad-market/macro relationships, event/regime context, and scenario analysis. Forecast fitting remains separately gated by the ML pipeline contract.

## Scope and non-goals

- In scope: TEDPIX and equal-weight broad indices; macro series such as FX, inflation, liquidity/base money, rates/OMO, and precious metals; short- and medium-term views; static-site compatibility.
- Out of scope: individual stocks, portfolio construction, investment advice, model fitting before Gate A/B, final-test access before Gate C, and deployment without a separate request.

## Parent plan and approvals

- Parent implementation plan: `docs/aegis/plans/2026-10-04-macro-risk-scenario-workspace.md`.
- Product design approved by the user on 2026-10-04.
- Prediction target and evaluation contract: draft only; Gate A is pending explicit user approval in `ml_pipeline/PREDICTION_CONTRACT.md`.

## Baseline references and use

- `docs/aegis/baseline/2026-10-04-initial-baseline.md`: product scope, current owners, API/static compatibility and native-frequency requirements.
- `docs/aegis/BASELINE-GOVERNANCE.md`: baseline authority and drift checks.
- `AGENTS.md`: read the installed Next.js guide before changing app code.
- `ml_pipeline/PIPELINE.md`: forecast work is gated; no model fit has occurred.

## Compatibility and retirement boundaries

Keep existing API response shapes, series IDs, units, date conventions, and static paths. Add new static resources only where needed. Keep calculations in `src/lib/analytics.ts`, data publication in existing API/export owners, and rendering in existing component owners. Forecasts, scenarios, and descriptive relationships must remain separately labeled. Old navigation entries retire only after their subviews are integrated and verified.

## Todo map

1. Data inspection, EDA, and draft prediction contract — prepared; Gate A pending.
2. Descriptive risk definitions and numerical tests — active.
3. Coordinated analysis workspace and shared context.
4. Dynamic relationships, regimes, and sourced event annotations.
5. Forecast preparation/fitting/evaluation — only after the required ML gates.
6. Scenario/forecast distinction, methodology copy, and end-to-end verification.

## Start snapshot

- Repository root: `/Users/amin/Documents/Corporate/EcoNotes`.
- Branch/HEAD: `main` / `bdd1284a9c2577bee5290aeee284134e3331dd8c`, tracking `origin/main`, 0 ahead and 0 behind.
- Worktree: the repository root only; no active merge, rebase, cherry-pick, or bisect.
- At start, no staged paths. Existing tracked edits included the user's `orginal_and_chart_data.ipynb` and the parent data plan; untracked paths included the user's `docs/AGENT_HANDOFF.md` and existing Aegis handoff/baseline work. Preserve these unrelated paths.
- Stop states: done, blocked by a required user gate, needs verification, or scope exceeded.
