import assert from "node:assert/strict";
import test from "node:test";
import * as analytics from "./analytics.ts";
import type { Point } from "./data.ts";

test("mixed-frequency chart points carry the last observation and preserve its source date", () => {
  const points: Point[] = [
    { date: "2026-01-31", value: 100 },
    { date: "2026-02-28", value: 110 },
  ];
  const daily = ["2026-01-31", "2026-02-01", "2026-02-28"];
  assert.equal(typeof analytics.toDailyStep, "function", "daily step alignment is not implemented");
  assert.deepEqual(analytics.toDailyStep(points, daily), [
    { date: "2026-01-31", value: 100, sourceDate: "2026-01-31" },
    { date: "2026-02-01", value: 100, sourceDate: "2026-01-31" },
    { date: "2026-02-28", value: 110, sourceDate: "2026-02-28" },
  ]);
});

test("mixed-frequency correlation samples the daily series at monthly observations", () => {
  const monthly: Point[] = [
    { date: "2026-01-31", value: 100 },
    { date: "2026-02-28", value: 110 },
    { date: "2026-03-31", value: 121 },
    { date: "2026-04-30", value: 133.1 },
  ];
  const daily: Point[] = [
    { date: "2026-01-30", value: 100 },
    { date: "2026-02-27", value: 110 },
    { date: "2026-03-30", value: 121 },
    { date: "2026-04-29", value: 133.1 },
  ];
  const result = analytics.rollingCorrelation(monthly, daily, 3, "monthly", "daily");
  assert.equal(result.length, 3);
  assert.ok(Math.abs(result.at(-1)!.value - 1) < 1e-12);
});

test("weekly OMO observations anchor mixed-frequency correlation", () => {
  const weekly: Point[] = [
    { date: "2026-06-01", value: 100 },
    { date: "2026-06-08", value: 110 },
    { date: "2026-06-15", value: 121 },
    { date: "2026-06-22", value: 133.1 },
  ];
  const daily: Point[] = [
    { date: "2026-05-31", value: 90 },
    { date: "2026-06-01", value: 100 },
    { date: "2026-06-07", value: 110 },
    { date: "2026-06-08", value: 110 },
    { date: "2026-06-14", value: 121 },
    { date: "2026-06-15", value: 121 },
    { date: "2026-06-21", value: 133.1 },
    { date: "2026-06-22", value: 133.1 },
  ];
  const result = analytics.rollingCorrelation(weekly, daily, 3, "weekly", "daily");
  assert.equal(result.length, 3);
  assert.ok(Math.abs(result.at(-1)!.value - 1) < 1e-12);
});

function pricesFromLogReturns(changes: number[]): Point[] {
  let value = 100;
  return [
    { date: "2026-01-01", value },
    ...changes.map((change, index) => {
      value *= Math.exp(change / 100);
      return { date: `2026-01-${String(index + 2).padStart(2, "0")}`, value };
    }),
  ];
}

test("rolling risk reports per-observation volatility, downside semideviation, historical VaR and ES", () => {
  assert.equal(typeof analytics.rollingRisk, "function", "rolling risk measures are not implemented");
  const result = analytics.rollingRisk(pricesFromLogReturns([2, -1, -3, 4]), 4, 0.25);
  const latest = result.at(-1)!;

  assert.equal(latest.sampleCount, 4);
  assert.equal(latest.tailSampleCount, 1);
  assert.ok(Math.abs(latest.realizedVolatilityPct! - Math.sqrt(29 / 3)) < 1e-10);
  assert.ok(Math.abs(latest.downsideSemideviationPct! - Math.sqrt(2.5)) < 1e-10);
  assert.ok(Math.abs(latest.historicalVaRPct! - 1.5) < 1e-10);
  assert.ok(Math.abs(latest.expectedShortfallPct! - 3) < 1e-10);
  assert.equal(latest.unit, "% per observation");
});

test("rolling risk returns null until a complete finite window exists", () => {
  const short = analytics.rollingRisk(pricesFromLogReturns([1, -1]), 3);
  assert.equal(short.at(-1)!.sampleCount, 2);
  assert.equal(short.at(-1)!.realizedVolatilityPct, null);
  assert.equal(short.at(-1)!.historicalVaRPct, null);

  const withGap = analytics.rollingRisk([
    { date: "2026-01-01", value: 100 },
    { date: "2026-01-02", value: 101 },
    { date: "2026-01-03", value: 0 },
    { date: "2026-01-04", value: 103 },
    { date: "2026-01-05", value: 104 },
    { date: "2026-01-06", value: 105 },
  ], 2);
  assert.equal(withGap[2].sampleCount, 0);
  assert.equal(withGap[2].realizedVolatilityPct, null);
  assert.equal(withGap.at(-1)!.sampleCount, 2);
  assert.ok(Number.isFinite(withGap.at(-1)!.realizedVolatilityPct));
});

test("flat and monthly series stay unannualized per observation", () => {
  const flat = analytics.rollingRisk([
    { date: "2026-01-01", value: 100 },
    { date: "2026-02-01", value: 100 },
    { date: "2026-03-01", value: 100 },
  ], 2);
  const latest = flat.at(-1)!;
  assert.equal(latest.realizedVolatilityPct, 0);
  assert.equal(latest.downsideSemideviationPct, 0);
  assert.equal(latest.historicalVaRPct, 0);
  assert.equal(latest.expectedShortfallPct, 0);
  assert.throws(() => analytics.rollingRisk([], 1), RangeError);
  assert.throws(() => analytics.rollingRisk([], 3, 0), RangeError);
});

test("drawdown spells report peak-to-trough depth, duration and recovery", () => {
  assert.equal(typeof analytics.drawdownSpells, "function", "drawdown spell metrics are not implemented");
  const result = analytics.drawdownSpells([
    { date: "2026-01-01", value: 100 },
    { date: "2026-01-02", value: 110 },
    { date: "2026-01-03", value: 100 },
    { date: "2026-01-04", value: 80 },
    { date: "2026-01-05", value: 100 },
    { date: "2026-01-06", value: 110 },
    { date: "2026-01-07", value: 100 },
    { date: "2026-01-08", value: 90 },
  ]);

  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    peakDate: "2026-01-02",
    troughDate: "2026-01-04",
    recoveryDate: "2026-01-06",
    depthPct: (80 / 110 - 1) * 100,
    durationObservations: 4,
    recoveryObservations: 2,
    status: "recovered",
  });
  assert.equal(result[1].status, "ongoing");
  assert.equal(result[1].recoveryDate, null);
  assert.equal(result[1].durationObservations, 2);
  assert.equal(result[1].recoveryObservations, null);
});

test("invalid price gaps censor an active drawdown instead of implying recovery", () => {
  const result = analytics.drawdownSpells([
    { date: "2026-01-01", value: 100 },
    { date: "2026-01-02", value: 90 },
    { date: "2026-01-03", value: 80 },
    { date: "2026-01-04", value: Number.NaN },
    { date: "2026-01-05", value: 82 },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].status, "censored");
  assert.equal(result[0].recoveryDate, null);
  assert.equal(result[0].durationObservations, 2);
});

test("volatility regimes use only prior trailing volatility and classify sensitivity thresholds", () => {
  const prices = pricesFromLogReturns([2, -1, -3, 4, 2, 0.5, -2]);
  const rolling = analytics.rollingRisk(prices, 2).filter((point) => point.realizedVolatilityPct !== null);
  const regimes = analytics.rollingVolatilityRegimes(prices, 2, 1, 1.5);

  assert.equal(regimes.length, rolling.length - 1);
  assert.equal(regimes[0].date, rolling[1].date);
  assert.equal(regimes[0].baselinePct, rolling[0].realizedVolatilityPct);
  assert.equal(regimes[0].thresholdPct, rolling[0].realizedVolatilityPct! * 1.5);
  assert.deepEqual(regimes.map((point) => point.state), ["normal", "high", "normal", "normal", "high"]);
  assert.deepEqual(
    analytics.rollingVolatilityRegimes(prices, 2, 1, 1).map((point) => point.state),
    ["normal", "high", "normal", "normal", "high"],
  );
  assert.deepEqual(analytics.rollingVolatilityRegimes(prices, 2, 1, 0.6).map((point) => point.state), ["high", "high", "normal", "high", "high"]);
});

test("repeated shock paths compound the same one-period input without inventing a response", () => {
  const path = analytics.repeatedShockPath(5, 3);

  assert.deepEqual(path.map((point) => point.period), [1, 2, 3]);
  assert.ok(Math.abs(path[0].indexValue - 105) < 1e-10);
  assert.ok(Math.abs(path[1].indexValue - 110.25) < 1e-10);
  assert.ok(Math.abs(path[2].cumulativeChangePct - 15.7625) < 1e-10);
  assert.deepEqual(analytics.repeatedShockPath(0, 2).map((point) => point.indexValue), [100, 100]);
  assert.deepEqual(analytics.repeatedShockPath(-5, 2).map((point) => point.indexValue), [95, 90.25]);
  assert.deepEqual(analytics.repeatedShockPath(-100, 2), []);
  assert.deepEqual(analytics.repeatedShockPath(5, 0), []);
  assert.deepEqual(analytics.repeatedShockPath(Number.NaN, 2), []);
});

test("volatility regimes need measurable finite history and validate their windows", () => {
  const flat: Point[] = [
    { date: "2026-01-01", value: 100 },
    { date: "2026-01-02", value: 100 },
    { date: "2026-01-03", value: 100 },
    { date: "2026-01-04", value: 100 },
  ];
  assert.deepEqual(analytics.rollingVolatilityRegimes(flat, 2, 1, 1.5), []);
  assert.throws(() => analytics.rollingVolatilityRegimes(flat, 1), RangeError);
  assert.throws(() => analytics.rollingVolatilityRegimes(flat, 2, 0), RangeError);
  assert.throws(() => analytics.rollingVolatilityRegimes(flat, 2, 1, 0), RangeError);
});

test("conditional correlations use the latest known regime and report sparse coverage", () => {
  const result = analytics.conditionalCorrelationByVolatilityRegime(
    [
      { date: "2026-01-02", left: 1, right: 1 },
      { date: "2026-01-03", left: 2, right: 2 },
      { date: "2026-01-04", left: 3, right: -3 },
      { date: "2026-01-05", left: 4, right: -4 },
    ],
    [
      { date: "2026-01-01", value: 10, baselinePct: 5, thresholdPct: 7.5, multiplier: 1.5, state: "normal" },
      { date: "2026-01-04", value: 9, baselinePct: 5, thresholdPct: 7.5, multiplier: 1.5, state: "high" },
    ],
  );
  assert.deepEqual(result, [
    { state: "normal", count: 2, correlation: 1 },
    { state: "high", count: 2, correlation: -1 },
  ]);

  const stale = analytics.conditionalCorrelationByVolatilityRegime(
    [{ date: "2026-01-20", left: 1, right: 1 }],
    [{ date: "2026-01-01", value: 10, baselinePct: 5, thresholdPct: 7.5, multiplier: 1.5, state: "normal" }],
    7,
  );
  assert.deepEqual(stale, [
    { state: "normal", count: 0, correlation: null },
    { state: "high", count: 0, correlation: null },
  ]);
});

test("event annotations align to the next observed date and omit events outside the chart", () => {
  const aligned = analytics.alignEventAnnotations(
    [
      { id: 1, title: "جلسه سیاستی", date: "2026-01-03", category: "policy", source: "https://example.test/source" },
      { id: 2, title: "پیش از بازه", date: "2025-12-31", category: "policy", source: null },
      { id: 3, title: "پس از بازه", date: "2026-01-09", category: "policy", source: null },
    ],
    ["2026-01-02", "2026-01-05", "2026-01-08"],
  );
  assert.deepEqual(aligned, [{
    id: 1,
    title: "جلسه سیاستی",
    date: "2026-01-03",
    chartDate: "2026-01-05",
    category: "policy",
    source: "https://example.test/source",
  }]);
  assert.deepEqual(analytics.alignEventAnnotations([], []), []);
});
