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

export function relativePerformance(left: Point[], right: Point[]): Point[] {
  const lookup = new Map(right.map((p) => [p.date, p.value]));
  const joined = left.flatMap((p) => {
    const value = lookup.get(p.date);
    return value && value > 0 && p.value > 0 ? [{ date: p.date, value: p.value / value }] : [];
  });
  const base = joined[0]?.value;
  return base ? joined.map((p) => ({ ...p, value: p.value / base * 100 })) : [];
}
