// SPDX-License-Identifier: Apache-2.0
import type { SimResult } from "./model.ts";

export function quantileOfSorted(sorted: Float64Array, q: number): number {
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const slo = sorted[lo]!;
  const shi = sorted[hi]!;
  return lo === hi ? slo : slo + (pos - lo) * (shi - slo);
}

export interface Bands {
  year: number[];
  /** byQuantile[qi][y] — value at quantiles[qi] for year y. */
  byQuantile: number[][];
}

/** Percentile bands across trials for every year; deterministic (sorted quantiles, D9). */
export function percentileBands(result: SimResult, quantiles: readonly number[]): Bands {
  const { trials, years, paths } = result;
  const stride = years + 1;
  const column = new Float64Array(trials);
  const year: number[] = [];
  const byQuantile = quantiles.map(() => new Array<number>(stride));
  for (let y = 0; y <= years; y++) {
    year.push(y);
    for (let t = 0; t < trials; t++) column[t] = paths[t * stride + y]!;
    column.sort();
    for (let qi = 0; qi < quantiles.length; qi++) {
      byQuantile[qi]![y] = quantileOfSorted(column, quantiles[qi]!);
    }
  }
  return { year, byQuantile };
}

/** Fraction of trials whose terminal balance is zero (depleted before end of horizon). */
export function ruinProbability(result: SimResult): number {
  const { trials, years, paths } = result;
  const stride = years + 1;
  let ruined = 0;
  for (let t = 0; t < trials; t++) {
    if (paths[t * stride + years]! <= 0) ruined++;
  }
  return ruined / trials;
}

/** Binomial-style ± sampling half-width for an observed proportion (D10 CI reporting). */
export function samplingHalfWidth(pHat: number, trials: number, z = 1.96): number {
  return z * Math.sqrt((pHat * (1 - pHat)) / trials);
}
