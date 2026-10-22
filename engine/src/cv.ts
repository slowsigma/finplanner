// SPDX-License-Identifier: Apache-2.0
// B2.8 variance reduction: ordinary-least-squares control variates. Each
// payoff x_t is regressed on the per-trial cumulative log-growth of every
// asset class (whose expectation is known exactly under the lognormal model,
// E[log(1+r)] = log(1+mu) - sigma^2/2). The adjusted payoff
// x - beta (d - E[d]) keeps the estimator unbiased while shrinking variance.
// Singular (e.g. zero-vol) designs fall back to the raw statistics.

export interface CvStat {
  rawMean: number;
  rawHalfWidth: number;
  adjustedMean: number;
  adjustedHalfWidth: number;
  /** adjustedVar / rawVar; < 1 means the control variate helped. */
  varianceRatio: number;
}

function solveLinearSystem(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    const pv = m[piv]![col]!;
    if (Math.abs(pv) < 1e-9) return null;
    if (piv !== col) [m[col], m[piv]] = [m[piv]!, m[col]!];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r]![col]! / pv;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r]![c]! -= f * m[col]![c]!;
    }
  }
  return m.map((row, i) => row[n]! / m[i]![i]!);
}

/**
 * Adjust payoffs `x` with design matrix `design` (t × k, trial-major flat)
 * whose column means should be `expected` (t × k). Returns raw and adjusted
 * means with 95% half-widths; falls back to raw stats when the design is
 * degenerate or trials <= k + 2.
 */
export function controlVariateStats(
  x: ArrayLike<number>,
  trials: number,
  design: Float64Array,
  expected: Float64Array,
  k: number,
  z = 1.96,
): CvStat {
  const rawMean = mean(x, trials);
  const rawVar = variance(x, trials, rawMean);
  const rawHalfWidth = z * Math.sqrt(rawVar / trials);
  const fallback = (ratio: number): CvStat => ({
    rawMean,
    rawHalfWidth,
    adjustedMean: rawMean,
    adjustedHalfWidth: rawHalfWidth,
    varianceRatio: ratio,
  });
  if (k < 1 || trials <= k + 2 || rawVar === 0) return fallback(1);

  const dMean: number[] = [];
  for (let j = 0; j < k; j++) {
    let s = 0;
    for (let t = 0; t < trials; t++) s += design[t * k + j]!;
    dMean.push(s / trials);
  }
  const eMean: number[] = [];
  for (let j = 0; j < k; j++) {
    let s = 0;
    for (let t = 0; t < trials; t++) s += expected[t * k + j]!;
    eMean.push(s / trials);
  }
  // Normal equations on centered design: (D'D) beta = D'(x - xbar).
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < k; i++) {
    const row: number[] = [];
    for (let j = 0; j < k; j++) {
      let s = 0;
      for (let t = 0; t < trials; t++) s += (design[t * k + i]! - dMean[i]!) * (design[t * k + j]! - dMean[j]!);
      row.push(s / trials);
    }
    a.push(row);
    let s = 0;
    for (let t = 0; t < trials; t++) s += (design[t * k + i]! - dMean[i]!) * (x[t]! - rawMean);
    b.push(s / trials);
  }
  const beta = solveLinearSystem(a, b);
  if (!beta) return fallback(1);

  const adj = new Float64Array(trials);
  for (let t = 0; t < trials; t++) {
    let v = x[t]!;
    for (let j = 0; j < k; j++) v -= beta[j]! * (design[t * k + j]! - eMean[j]!);
    adj[t] = v;
  }
  const adjMean = mean(adj, trials);
  const adjVar = variance(adj, trials, adjMean);
  return {
    rawMean,
    rawHalfWidth,
    adjustedMean: adjMean,
    adjustedHalfWidth: z * Math.sqrt(adjVar / trials),
    varianceRatio: rawVar > 0 ? adjVar / rawVar : 1,
  };
}

function mean(v: ArrayLike<number>, n: number): number {
  let s = 0;
  for (let t = 0; t < n; t++) s += v[t]!;
  return n > 0 ? s / n : Number.NaN;
}

function variance(v: ArrayLike<number>, n: number, mu: number): number {
  if (n < 2) return 0;
  let s = 0;
  for (let t = 0; t < n; t++) {
    const d = v[t]! - mu;
    s += d * d;
  }
  return s / (n - 1);
}
