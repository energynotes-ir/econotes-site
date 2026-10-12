import type { Point } from "./data";
import type { Frequency } from "./data";

export type PairedReturn = { date: string; left: number; right: number };

export function variance(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
}

export function rollingVariance(points: Point[], window: number, differences = false): Point[] {
  const values = differences ? points.slice(1).map((p, i) => ({ date: p.date, value: p.value - points[i].value })) : points;
  return values.map((p, i) => {
    const sample = values.slice(Math.max(0, i - window + 1), i + 1).map((x) => x.value);
    return { date: p.date, value: sample.length >= window ? variance(sample)! : NaN };
  });
}

export function returns(points: Point[]): Point[] {
  return points.slice(1).map((p, i) => ({ date: p.date, value: p.value > 0 && points[i].value > 0 ? Math.log(p.value / points[i].value) * 100 : NaN }));
}

function atOrBefore(points: Point[], date: string): Point | undefined {
  let low = 0;
  let high = points.length - 1;
  let match = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].date <= date) {
      match = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return match >= 0 ? points[match] : undefined;
}

export function toDailyStep(points: Point[], dates: string[]): Point[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  let index = -1;
  return dates.flatMap((date) => {
    while (index + 1 < sorted.length && sorted[index + 1].date <= date) index += 1;
    const point = sorted[index];
    if (!point) return [];
    return [{
      date,
      value: point.value,
      ...(point.symbol ? { symbol: point.symbol } : {}),
      sourceDate: point.date,
    }];
  });
}

function frequencyRank(frequency: Frequency) {
  return frequency === "quarterly" ? 3 : frequency === "monthly" ? 2 : frequency === "weekly" ? 1 : 0;
}

export function alignedReturns(
  a: Point[], b: Point[], frequencyA: Frequency = "daily", frequencyB: Frequency = "daily",
): PairedReturn[] {
  const left = [...a].sort((x, y) => x.date.localeCompare(y.date));
  const right = [...b].sort((x, y) => x.date.localeCompare(y.date));
  if (!left.length || !right.length) return [];

  let anchors: Point[];
  if (frequencyA === "daily" && frequencyB === "daily") {
    const rightDates = new Set(right.map((point) => point.date));
    anchors = left.filter((point) => rightDates.has(point.date));
  } else if (frequencyRank(frequencyA) === frequencyRank(frequencyB)) {
    anchors = left.length <= right.length ? left : right;
  } else {
    anchors = frequencyRank(frequencyA) > frequencyRank(frequencyB) ? left : right;
  }

  const pairs: PairedReturn[] = [];
  for (let i = 1; i < anchors.length; i += 1) {
    const previousDate = anchors[i - 1].date;
    const date = anchors[i].date;
    const aPrevious = atOrBefore(left, previousDate);
    const aCurrent = atOrBefore(left, date);
    const bPrevious = atOrBefore(right, previousDate);
    const bCurrent = atOrBefore(right, date);
    if (!aPrevious || !aCurrent || !bPrevious || !bCurrent || aPrevious.date === aCurrent.date || bPrevious.date === bCurrent.date) continue;
    if ((frequencyA === "daily" && Date.parse(date) - Date.parse(aCurrent.date) > 7 * 86_400_000) ||
        (frequencyB === "daily" && Date.parse(date) - Date.parse(bCurrent.date) > 7 * 86_400_000)) continue;
    const a0 = aPrevious.value;
    const a1 = aCurrent.value;
    const b0 = bPrevious.value;
    const b1 = bCurrent.value;
    if (!a0 || !a1 || !b0 || !b1 || a0 <= 0 || a1 <= 0 || b0 <= 0 || b1 <= 0) continue;
    pairs.push({ date, left: Math.log(a1 / a0) * 100, right: Math.log(b1 / b0) * 100 });
  }
  return pairs;
}

export function correlation(left: number[], right: number[]): number | null {
  if (left.length < 2 || left.length !== right.length) return null;
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / left.length;
  const meanRight = right.reduce((sum, value) => sum + value, 0) / right.length;
  const covariance = left.reduce((sum, value, index) => sum + (value - meanLeft) * (right[index] - meanRight), 0);
  const varianceLeft = left.reduce((sum, value) => sum + (value - meanLeft) ** 2, 0);
  const varianceRight = right.reduce((sum, value) => sum + (value - meanRight) ** 2, 0);
  const denominator = Math.sqrt(varianceLeft * varianceRight);
  return denominator ? covariance / denominator : null;
}

export function rollingCorrelation(
  a: Point[], b: Point[], window: number, frequencyA: Frequency = "daily", frequencyB: Frequency = "daily",
): Point[] {
  const aligned = alignedReturns(a, b, frequencyA, frequencyB);
  return aligned.map((point, index) => {
    const sample = aligned.slice(Math.max(0, index - window + 1), index + 1);
    const value = sample.length < window
      ? NaN
      : correlation(sample.map((row) => row.left), sample.map((row) => row.right)) ?? NaN;
    return { date: point.date, value };
  });
}

export function drawdowns(points: Point[]): Point[] {
  let peak = -Infinity;
  return points.map((point) => {
    if (!Number.isFinite(point.value) || point.value <= 0) return { date: point.date, value: NaN };
    peak = Math.max(peak, point.value);
    return { date: point.date, value: (point.value / peak - 1) * 100 };
  });
}

export type RollingRiskPoint = Point & {
  sampleCount: number;
  tailSampleCount: number | null;
  unit: "% per observation";
  realizedVolatilityPct: number | null;
  downsideSemideviationPct: number | null;
  historicalVaRPct: number | null;
  expectedShortfallPct: number | null;
};

/** Historical rolling risk of one series' observed log returns; values are not annualized. */
export function rollingRisk(points: Point[], window = 30, tailProbability = 0.05): RollingRiskPoint[] {
  if (!Number.isInteger(window) || window < 2) throw new RangeError("window must be an integer of at least 2");
  if (!Number.isFinite(tailProbability) || tailProbability <= 0 || tailProbability >= 0.5) {
    throw new RangeError("tailProbability must be greater than 0 and less than 0.5");
  }

  const ordered = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const observations = returns(ordered);
  return observations.map((point, index) => {
    const windowRows = observations.slice(Math.max(0, index - window + 1), index + 1);
    const values = windowRows.map((row) => row.value).filter(Number.isFinite);
    const sampleCount = values.length;
    if (windowRows.length < window || sampleCount < window) {
      return {
        date: point.date,
        value: point.value,
        sampleCount,
        tailSampleCount: null,
        unit: "% per observation",
        realizedVolatilityPct: null,
        downsideSemideviationPct: null,
        historicalVaRPct: null,
        expectedShortfallPct: null,
      };
    }

    const mean = values.reduce((sum, value) => sum + value, 0) / sampleCount;
    const realizedVolatilityPct = Math.sqrt(
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (sampleCount - 1),
    );
    const downsideSemideviationPct = Math.sqrt(
      values.reduce((sum, value) => sum + Math.min(value, 0) ** 2, 0) / sampleCount,
    );
    const lowerReturnQuantile = quantile(values, tailProbability);
    const tailValues = lowerReturnQuantile === null
      ? []
      : values.filter((value) => value <= lowerReturnQuantile);
    const tailMean = tailValues.length
      ? tailValues.reduce((sum, value) => sum + value, 0) / tailValues.length
      : null;
    const expectedShortfallPct = tailMean === null ? null : tailMean === 0 ? 0 : -tailMean;
    const historicalVaRPct = lowerReturnQuantile === null
      ? null
      : lowerReturnQuantile === 0 ? 0 : -lowerReturnQuantile;

    return {
      date: point.date,
      value: point.value,
      sampleCount,
      tailSampleCount: tailValues.length,
      unit: "% per observation",
      realizedVolatilityPct,
      downsideSemideviationPct,
      historicalVaRPct,
      expectedShortfallPct,
    };
  });
}

export type VolatilityRegimePoint = Point & {
  baselinePct: number;
  thresholdPct: number;
  multiplier: number;
  state: "normal" | "high";
};

/** Classifies trailing volatility against a median built only from preceding estimates. */
export function rollingVolatilityRegimes(
  points: Point[],
  volatilityWindow = 30,
  baselineWindow = 60,
  thresholdMultiplier = 1.5,
): VolatilityRegimePoint[] {
  if (!Number.isInteger(volatilityWindow) || volatilityWindow < 2) {
    throw new RangeError("volatilityWindow must be an integer of at least 2");
  }
  if (!Number.isInteger(baselineWindow) || baselineWindow < 1) {
    throw new RangeError("baselineWindow must be a positive integer");
  }
  if (!Number.isFinite(thresholdMultiplier) || thresholdMultiplier <= 0) {
    throw new RangeError("thresholdMultiplier must be positive and finite");
  }

  const history = rollingRisk(points, volatilityWindow)
    .filter((point): point is typeof point & { realizedVolatilityPct: number } =>
      point.realizedVolatilityPct !== null && Number.isFinite(point.realizedVolatilityPct),
    );
  return history.flatMap((point, index) => {
    if (index < baselineWindow) return [];
    const baselinePct = quantile(
      history.slice(index - baselineWindow, index).map((prior) => prior.realizedVolatilityPct),
      0.5,
    );
    if (baselinePct === null || baselinePct <= 0) return [];
    const thresholdPct = baselinePct * thresholdMultiplier;
    return [{
      date: point.date,
      value: point.realizedVolatilityPct,
      baselinePct,
      thresholdPct,
      multiplier: thresholdMultiplier,
      state: point.realizedVolatilityPct > thresholdPct ? "high" as const : "normal" as const,
    }];
  });
}

export type ConditionalRegimeCorrelation = {
  state: "normal" | "high";
  count: number;
  correlation: number | null;
};

/** Joins pair returns to the last regime known on that date; stale labels are omitted. */
export function conditionalCorrelationByVolatilityRegime(
  pairs: PairedReturn[],
  regimes: VolatilityRegimePoint[],
  maxAgeDays = 7,
): ConditionalRegimeCorrelation[] {
  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 0) {
    throw new RangeError("maxAgeDays must be a non-negative integer");
  }
  const orderedPairs = [...pairs].sort((a, b) => a.date.localeCompare(b.date));
  const orderedRegimes = [...regimes].sort((a, b) => a.date.localeCompare(b.date));
  const samples: Record<"normal" | "high", { left: number[]; right: number[] }> = {
    normal: { left: [], right: [] },
    high: { left: [], right: [] },
  };

  for (const pair of orderedPairs) {
    let low = 0;
    let high = orderedRegimes.length - 1;
    let match = -1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (orderedRegimes[mid].date <= pair.date) {
        match = mid;
        low = mid + 1;
      } else high = mid - 1;
    }
    if (match < 0) continue;
    const regime = orderedRegimes[match];
    const ageDays = (Date.parse(pair.date) - Date.parse(regime.date)) / 86_400_000;
    if (ageDays < 0 || ageDays > maxAgeDays || !Number.isFinite(pair.left) || !Number.isFinite(pair.right)) continue;
    samples[regime.state].left.push(pair.left);
    samples[regime.state].right.push(pair.right);
  }

  return (["normal", "high"] as const).map((state) => ({
    state,
    count: samples[state].left.length,
    correlation: correlation(samples[state].left, samples[state].right),
  }));
}

export type EventAnnotation = {
  id: string | number;
  title: string;
  date: string;
  category: string;
  source: string | null;
  endsOn?: string | null;
};

export type AlignedEventAnnotation = EventAnnotation & { chartDate: string };

/** Places each published event on the next observed x-axis date, omitting out-of-range events. */
export function alignEventAnnotations(events: EventAnnotation[], dates: string[]): AlignedEventAnnotation[] {
  const axisDates = [...new Set(dates)].sort();
  if (!axisDates.length) return [];
  const aligned: AlignedEventAnnotation[] = [];
  for (const event of events) {
    if (event.date < axisDates[0] || event.date > axisDates.at(-1)!) continue;
    let low = 0;
    let high = axisDates.length - 1;
    let match = -1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (axisDates[mid] >= event.date) {
        match = mid;
        high = mid - 1;
      } else low = mid + 1;
    }
    if (match >= 0) aligned.push({ ...event, chartDate: axisDates[match] });
  }
  return aligned.sort((a, b) => a.chartDate.localeCompare(b.chartDate));
}

export type DrawdownSpell = {
  peakDate: string;
  troughDate: string;
  recoveryDate: string | null;
  depthPct: number;
  durationObservations: number;
  recoveryObservations: number | null;
  status: "recovered" | "ongoing" | "censored";
};

/** Drawdown episodes are measured on observed levels; invalid prices censor the current spell. */
export function drawdownSpells(points: Point[]): DrawdownSpell[] {
  const ordered = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const spells: DrawdownSpell[] = [];
  let segmentIndex = -1;
  let peak: { date: string; value: number; index: number } | null = null;
  let active: {
    peakDate: string;
    peakIndex: number;
    troughDate: string;
    troughIndex: number;
    depthPct: number;
  } | null = null;

  for (const point of ordered) {
    if (!Number.isFinite(point.value) || point.value <= 0) {
      if (active) {
        spells.push({
          peakDate: active.peakDate,
          troughDate: active.troughDate,
          recoveryDate: null,
          depthPct: active.depthPct,
          durationObservations: Math.max(0, segmentIndex - active.peakIndex),
          recoveryObservations: null,
          status: "censored",
        });
      }
      segmentIndex = -1;
      peak = null;
      active = null;
      continue;
    }

    segmentIndex += 1;
    if (!peak) {
      peak = { date: point.date, value: point.value, index: segmentIndex };
      continue;
    }

    if (point.value >= peak.value) {
      if (active) {
        spells.push({
          peakDate: active.peakDate,
          troughDate: active.troughDate,
          recoveryDate: point.date,
          depthPct: active.depthPct,
          durationObservations: segmentIndex - active.peakIndex,
          recoveryObservations: segmentIndex - active.troughIndex,
          status: "recovered",
        });
      }
      peak = { date: point.date, value: point.value, index: segmentIndex };
      active = null;
      continue;
    }

    const depthPct = (point.value / peak.value - 1) * 100;
    if (!active) {
      active = {
        peakDate: peak.date,
        peakIndex: peak.index,
        troughDate: point.date,
        troughIndex: segmentIndex,
        depthPct,
      };
    } else if (depthPct < active.depthPct) {
      active.troughDate = point.date;
      active.troughIndex = segmentIndex;
      active.depthPct = depthPct;
    }
  }

  if (active) {
    spells.push({
      peakDate: active.peakDate,
      troughDate: active.troughDate,
      recoveryDate: null,
      depthPct: active.depthPct,
      durationObservations: Math.max(0, segmentIndex - active.peakIndex),
      recoveryObservations: null,
      status: "ongoing",
    });
  }
  return spells;
}

export function quantile(values: number[], fraction: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * Math.max(0, Math.min(1, fraction));
  const low = Math.floor(position);
  return sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low);
}

export function riskSummary(points: Point[], window = 30) {
  const samples = returns(points);
  const volatility = rollingVariance(samples, window).filter((p) => Number.isFinite(p.value)).map((p) => ({ ...p, value: Math.sqrt(p.value) }));
  const latest = volatility.at(-1)?.value;
  // Strict comparisons give ties a mid-rank instead of marking flat markets as stressed.
  const percentile = latest === undefined || volatility.length < 60 ? null :
    volatility.reduce((sum, p) => sum + (p.value < latest ? 1 : p.value === latest ? 0.5 : 0), 0) / volatility.length * 100;
  const drawdown = drawdowns(points);
  const tail = samples.slice(-window).map((p) => Math.expm1(p.value / 100) * 100);
  const downside = tail.length === window && tail.every(Number.isFinite) ? quantile(tail, 0.05) : null;
  const finiteDrawdowns = drawdown.map((p) => p.value).filter(Number.isFinite);
  return { volatility, sigma: latest ?? null, percentile, drawdown,
    currentDrawdown: drawdown.at(-1)?.value ?? null,
    maxDrawdown: finiteDrawdowns.length ? Math.min(...finiteDrawdowns) : null, downside };
}

export type Sensitivity = { beta: number; alpha: number; rSquared: number; residualSigma: number; count: number; minShock: number; maxShock: number; start: string; end: string };
export function sensitivityModel(pairs: PairedReturn[], window = 120): Sensitivity | null {
  const sample = pairs.slice(-window);
  if (sample.length < 30 || sample.some((p) => !Number.isFinite(p.left) || !Number.isFinite(p.right))) return null;
  const xMean = sample.reduce((sum, p) => sum + p.right, 0) / sample.length;
  const yMean = sample.reduce((sum, p) => sum + p.left, 0) / sample.length;
  const xx = sample.reduce((sum, p) => sum + (p.right - xMean) ** 2, 0);
  const yy = sample.reduce((sum, p) => sum + (p.left - yMean) ** 2, 0);
  if (xx < 1e-10 || yy < 1e-10) return null;
  const beta = sample.reduce((sum, p) => sum + (p.right - xMean) * (p.left - yMean), 0) / xx;
  const alpha = yMean - beta * xMean;
  const residualSum = sample.reduce((sum, p) => sum + (p.left - alpha - beta * p.right) ** 2, 0);
  return { beta, alpha, rSquared: Math.max(0, Math.min(1, 1 - residualSum / yy)),
    residualSigma: Math.sqrt(residualSum / (sample.length - 2)), count: sample.length,
    minShock: Math.min(...sample.map((p) => p.right)), maxShock: Math.max(...sample.map((p) => p.right)),
    start: sample[0].date, end: sample.at(-1)!.date };
}
export function scenarioEstimate(model: Sensitivity, simpleShock: number) {
  if (!Number.isFinite(simpleShock) || simpleShock <= -100) return null;
  const shock = Math.log1p(simpleShock / 100) * 100;
  const estimate = model.alpha + model.beta * shock;
  const simple = (value: number) => Math.expm1(value / 100) * 100;
  return { value: simple(estimate), impact: simple(model.beta * shock), baseline: simple(model.alpha),
    low: simple(estimate - 1.96 * model.residualSigma),
    high: simple(estimate + 1.96 * model.residualSigma), extrapolated: shock < model.minShock || shock > model.maxShock };
}

export function repeatedShockPath(simpleShockPct: number, periods: number) {
  if (!Number.isFinite(simpleShockPct) || simpleShockPct <= -100 || !Number.isInteger(periods) || periods < 1 || periods > 120) return [];
  const multiplier = 1 + simpleShockPct / 100;
  const path = Array.from({ length: periods }, (_, index) => {
    const indexValue = 100 * multiplier ** (index + 1);
    return { period: index + 1, indexValue, cumulativeChangePct: indexValue - 100 };
  });
  return path.every((point) => Number.isFinite(point.indexValue)) ? path : [];
}

export function relativePerformance(left: Point[], right: Point[]): Point[] {
  const lookup = new Map(right.map((p) => [p.date, p.value]));
  const joined = left.flatMap((p) => {
    const value = lookup.get(p.date);
    return value && value > 0 && p.value > 0 ? [{ date: p.date, value: p.value / value }] : [];
  });
  const base = joined[0]?.value;
  return base ? joined.map((p) => ({ ...p, value: p.value / base * 100 })) : [];
}
