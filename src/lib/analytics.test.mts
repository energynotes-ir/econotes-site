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
