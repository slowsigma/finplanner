// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { SimParams } from "../src/model.ts";
import { simulatePlan } from "../src/simulate.ts";
import { cholesky } from "../src/cholesky.ts";
import { ruinProbability } from "../src/metrics.ts";

// Property tests (D10): monotonicity and statistical sanity. All use fixed
// seeds, so "flaky" is impossible — a failure is always a real regression.

describe("property tests", () => {
  const base: SimParams = {
    initialBalance: 100_000,
    annualContribution: 10_000,
    accumulationYears: 25,
    decumulationYears: 30,
    annualWithdrawal: 50_000,
    assets: [
      { meanReal: 0.07, volReal: 0.16, weight: 0.7 },
      { meanReal: 0.015, volReal: 0.05, weight: 0.3 },
    ],
    correlations: [1, 0.1, 0.1, 1],
    seed: 7,
    trials: 300,
  };

  it("more savings => weakly higher balance in every trial and year", () => {
    const low = simulatePlan(base);
    const high = simulatePlan({ ...base, annualContribution: 15_000 });
    for (let i = 0; i < low.paths.length; i++) {
      expect(high.paths[i]!).toBeGreaterThanOrEqual(low.paths[i]!);
    }
  });

  it("higher withdrawal => weakly lower balance and weakly more ruin", () => {
    const low = simulatePlan(base);
    const high = simulatePlan({ ...base, annualWithdrawal: 70_000 });
    for (let i = 0; i < low.paths.length; i++) {
      expect(high.paths[i]!).toBeLessThanOrEqual(low.paths[i]!);
    }
    expect(ruinProbability(high)).toBeGreaterThanOrEqual(ruinProbability(low));
  });

  it("zero volatility with mean above withdrawal growth cannot ruin", () => {
    const flat = simulatePlan({
      ...base,
      annualWithdrawal: 4_000,
      assets: [{ meanReal: 0.07, volReal: 0, weight: 1 }],
      correlations: [1],
    });
    expect(ruinProbability(flat)).toBe(0);
  });
});

describe("cholesky", () => {
  it("reconstructs a valid correlation matrix (L * Lᵀ = A)", () => {
    const n = 3;
    const a = [1, 0.6, 0.2, 0.6, 1, 0.4, 0.2, 0.4, 1];
    const L = cholesky(Float64Array.from(a), n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let sum = 0;
        for (let k = 0; k < n; k++) sum += L[i * n + k]! * L[j * n + k]!;
        expect(Math.abs(sum - a[i * n + j]!)).toBeLessThan(1e-12);
      }
    }
  });

  it("identity in, identity out", () => {
    const L = cholesky(Float64Array.from([1, 0, 0, 1]), 2);
    expect(Array.from(L)).toStrictEqual([1, 0, 0, 1]);
  });

  it("rejects non-positive-definite input", () => {
    expect(() => cholesky(Float64Array.from([1, 1.1, 1.1, 1]), 2)).toThrow(/positive definite/);
  });
});

describe("statistical convergence", () => {
  it("mean sampled log return matches analytic drift as N grows", () => {
    const mu = 0.07;
    const sigma = 0.18;
    const years = 30;
    const trials = 20_000;
    const result = simulatePlan({
      initialBalance: 100_000,
      annualContribution: 0,
      accumulationYears: years,
      decumulationYears: 0,
      annualWithdrawal: 0,
      assets: [{ meanReal: mu, volReal: sigma, weight: 1 }],
      correlations: [1],
      seed: 2026,
      trials,
    });
    const stride = years + 1;
    let sumLog = 0;
    for (let t = 0; t < trials; t++) {
      sumLog += Math.log(result.paths[t * stride + years]! / 100_000);
    }
    const sampled = sumLog / trials;
    const analytic = years * (Math.log(1 + mu) - 0.5 * sigma * sigma);
    // standard error of the mean of log terminals = sigma*sqrt(T)/sqrt(N)
    const se = (sigma * Math.sqrt(years)) / Math.sqrt(trials);
    expect(Math.abs(sampled - analytic)).toBeLessThan(4 * se);
  });
});
