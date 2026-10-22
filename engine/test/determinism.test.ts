// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { SimParams } from "../src/model.ts";
import { simulatePlan, simulateTrial } from "../src/simulate.ts";
import { percentileBands, ruinProbability } from "../src/metrics.ts";

const noisy: SimParams = {
  initialBalance: 250_000,
  annualContribution: 20_000,
  accumulationYears: 30,
  decumulationYears: 30,
  annualWithdrawal: 90_000,
  assets: [
    { meanReal: 0.075, volReal: 0.17, weight: 0.6 },
    { meanReal: 0.015, volReal: 0.06, weight: 0.4 },
  ],
  correlations: [1, 0.1, 0.1, 1],
  seed: 12345,
  trials: 400,
};

describe("determinism (R2)", () => {
  it("same seed produces bit-identical paths", () => {
    const a = simulatePlan(noisy);
    const b = simulatePlan(noisy);
    expect(a.paths).toStrictEqual(b.paths);
  });

  it("trial k is independent of batch size and re-sampled exactly by simulateTrial", () => {
    const batch = simulatePlan(noisy);
    const smaller = simulatePlan({ ...noisy, trials: 7 });
    const stride = noisy.accumulationYears + noisy.decumulationYears + 1;
    for (let i = 0; i < smaller.paths.length; i++) {
      expect(batch.paths[i]).toBe(smaller.paths[i]);
    }
    for (const k of [0, 3, 137]) {
      const single = simulateTrial(noisy, k);
      for (let y = 0; y < stride; y++) expect(single[y]).toBe(batch.paths[k * stride + y]);
    }
  });

  it("changing the seed changes the paths", () => {
    const a = simulatePlan(noisy);
    const b = simulatePlan({ ...noisy, seed: 12346 });
    let equal = true;
    for (let i = 0; i < a.paths.length; i++) {
      if (a.paths[i] !== b.paths[i]) equal = false;
    }
    expect(equal).toBe(false);
  });

  it("metrics are deterministic", () => {
    const result = simulatePlan(noisy);
    const q = [0.05, 0.5, 0.95];
    expect(percentileBands(result, q)).toStrictEqual(percentileBands(result, q));
    expect(ruinProbability(result)).toBe(ruinProbability(result));
  });
});
