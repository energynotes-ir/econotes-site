# EcoNotes macro forecasting pipeline

## Objective and boundary

Evaluate broad-market and macroeconomic forecasts for the integrated risk/scenario workspace. Scope is the TEDPIX and equal-weight broad indices plus macro series such as free FX, real FX, inflation, liquidity/base money, rates/OMO, and precious metals. This pipeline does not cover individual stocks or portfolio holdings.

The user approved the macro-only integrated workspace design on 2026-10-04. That approves the product direction; it does **not** approve a final prediction target, model fit, tuning, final test, or deployment.

## Progress

| Step | Phase | Status | Evidence / result |
| ---: | --- | --- | --- |
| 1 | Data inspection | done | Snapshot inventory: 60 sourced series across 4 native frequencies. Raw daily level panel: 4,296 TEDPIX dates × 10 columns; candidate forward-return panel: 4,296 × 10, with 5 terminal target values unavailable by construction, no exact duplicate rows, and no automatic leakage suspects. Release timing and historical revisions remain unresolved. |
| 2 | Exploratory data analysis | done | Reproducible marimo workbench at `01_eda.py`; 12 PNG figures in `figures/`; target horizon counts in `horizon_sample_inventory.csv`. Same-date correlations are descriptive and not evidence of predictive or causal effects. |
| 3 | Define prediction problem | prepared for Gate A | `PREDICTION_CONTRACT.md` proposes a 5-session TEDPIX return as the primary target and 1-calendar-month return as a separate medium-horizon target. Exact horizons, cutoffs, candidate inputs, splits, metrics, and eligibility rule await explicit approval. |
| 4 | Data cleaning | todo | No model-ready dataset built. |
| 5 | Data engineering | todo | No feature table or time alignment built. |
| 6 | Train/validation/test split | todo | No split created. |
| 7 | Feature engineering | todo | No features created. |
| 8 | Preprocessing | todo | No preprocessing fitted. |
| 9 | Baseline model | todo | No model fitted. |
| 10 | Model training | todo | No model fitted. |
| 11 | Hyperparameter tuning | todo | No tuning performed. |
| 12 | Model evaluation | todo | No model evaluated. |
| 13 | Error analysis | todo | No error analysis performed. |
| 14 | Final test | todo | No final test set exists. |
| 15 | Deployment | todo | No model artifact deployed. |
| 16 | Monitoring and retraining plan | todo | Not designed. |

## EDA findings relevant to the proposed contract

- TEDPIX has 4,296 daily observations from 2008-12-04 through 2026-09-30. The 5-session target has 4,291 observed labels; the five unavailable terminal labels are expected because their future endpoints do not exist in the snapshot.
- Month-end TEDPIX observations provide 213 one-month, 211 three-month, 208 six-month, and 202 twelve-month overlapping forward-return labels. Only the one-month target is proposed for the initial medium-horizon forecast pilot.
- One-session, five-session, and twenty-session daily targets have 4,295, 4,291, and 4,276 labels respectively. The latter horizons are descriptive in this first pilot.
- The candidate daily return panel has 9 numeric columns including the target. Equal-weight, domestic gold, and free USDT/Toman returns have substantially more exact-date observations than official ETS FX or the current yield snapshot. Exact-date counts still require a lagged availability audit before use.
- Descriptive exact-date correlation with the five-session future TEDPIX return is about 0.27 for equal-weight, 0.04 for free USDT FX, 0.11 for domestic gold, 0.02 for global gold, and -0.01 for the yield-history series. This is contemporaneous exploratory alignment only; it neither tests lagged FX transmission nor rules out an FX effect.
- The native-frequency inventory includes daily, weekly, monthly, and quarterly series. CPI, liquidity, and base money remain at their source dates. OMO is weekly and its stored series has abrupt discontinuities that need source-quality review before quantitative use.
- The stored `published_at` field has mixed semantics: many market, FX, CBI monthly, and MEFA rows have only one or two batch timestamps; only some CPI release and OMO article rows preserve source publication dates. There is no universal historical release timestamp or vintage archive, so any later backtest using revised values must be labeled pseudo-out-of-sample.
- Liquidity and base money last end at 2026-03-20 in this snapshot; CPI rates extend to 2026-09-22. Daily FX/gold snapshots can extend beyond the latest TEDPIX observation, but such later driver observations cannot be inputs to a TEDPIX forecast origin.

## Gate record

- Gate A: **pending user approval** of the exact proposal in `PREDICTION_CONTRACT.md`.
- Gate B: not reached.
- Gate C: not reached.
- Gate D: not reached.

No model has been trained, tuned, evaluated, or deployed. Steps 4–8 and all model fitting remain paused until Gate A is approved. Every gate A–D requires a plain-language user review before proceeding to the next phase. Gate B must include a model rationale; Gate C precedes any final-test access; Gate D reports final evidence. Deployment remains a separate user-requested action.

## EDA artifact register

- Figure 01_missingness.png: 9 of 10 columns have missing values; worst is yield_return_pct at 100.0%.
- Figure 02_target_balance.png: tedpix_forward_5s_return_pct ranges -13.6 to 18.1 with median 0.338; a mean-predictor baseline is the number to beat.
- Figure 02_distributions.png: Histograms of 8 numeric features; 2 are strongly skewed (usd-official_return_pct, usd-official-buy_return_pct), which matters for scaling and outliers.
- Figure 02_correlations.png: Strongest correlation with tedpix_forward_5s_return_pct: equal_return_pct (0.27); anything above 0.95 is a leakage suspect.
- Figure 02_temporal_coverage.png: observed_on spans 2008-12-04 to 2026-09-30 over 214 months; a chronological split must hold out the latest period.
- Figure 01_native_frequency_inventory.png: 60 source series are split across 4 native frequencies; monthly and quarterly variables remain observations at their own dates, not daily rows.
- Figure 02_native_observation_paths.png: Each series is normalized from its own first available observation and stays in a separate panel; different starts and native observation dates make this a trend inspection, not a common-base performance comparison.
- Figure 02_daily_return_distributions.png: Daily series have different coverage and holiday calendars; the histograms use only each series' own consecutive observations and are not synchronized daily returns for estimation.
- Figure 02_exact_date_return_correlations.png: The matrix pairs only exact observed dates and prints pair counts; it is exploratory and does not correct release timing, horizon overlap, or multiple testing.
- Figure 02_native_frequency_macro_series.png: CPI, liquidity, base money, and OMO use separate panels and original dates; no forward-filled points or common unit scale are used.
- Figure 02_exact_date_predictor_coverage.png: Exact-date counts show which daily series can be aligned without filling; official FX and the current yield snapshot are too sparse for this daily panel, while historical coverage still requires release-time and source-quality review.
- Figure 02_stored_timestamp_semantics.png: Most historical market, FX, monthly CBI, and MEFA rows carry one or two batch timestamps; only the explicit CBI release and OMO article paths preserve source publication dates. The published_at field therefore cannot be treated as a universal real-time availability timestamp.
