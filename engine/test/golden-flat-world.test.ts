// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { SimParams } from "../src/model.ts";
import { simulatePlan } from "../src/simulate.ts";

// Golden test (D10): flat-world closed-form annuity identities.
// With vol = 0 the simulation must match the future-value-of-annuity
// identities exactly (to fp tolerance):
//   accumulate: FV = P(1+r)^A + C((1+r)^A - 1)/r
//   decumulate: FV = A0(1+r)^D - W((1+r)^D - 1)/r
const r = 0.05;
const flat: SimParams = {
  initialBalance: 100_000,
  annualContribution: 10_000,
  accumulationYears: 20,
  decumulationYears: 30,
  annualWithdrawal: 25_000, // well below growth on the accumulated balance: never depletes
  assets: [{ meanReal: r, volReal: 0, weight: 1 }],
  correlations: [1],
  seed: 42,
  trials: 3,
};

const near = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected) / Math.max(1, Math.abs(expected))).toBeLessThan(1e-10);

describe("flat-world golden tests", () => {
  const result = simulatePlan(flat);
  const stride = flat.accumulationYears + flat.decumulationYears + 1;

  it("accumulation phase matches FV-of-annuity identity", () => {
    const growth = (1 + r) ** flat.accumulationYears;
    const expected =
      flat.initialBalance * growth +
      flat.annualContribution * ((growth - 1) / r);
    for (let t = 0; t < flat.trials; t++) {
      near(result.paths[t * stride + flat.accumulationYears]!, expected);
    }
  });

  it("terminal wealth matches decumulation annuity identity", () => {
    const growthA = (1 + r) ** flat.accumulationYears;
    const growthD = (1 + r) ** flat.decumulationYears;
    const atRetirement =
      flat.initialBalance * growthA + flat.annualContribution * ((growthA - 1) / r);
    const expected = atRetirement * growthD - flat.annualWithdrawal * ((growthD - 1) / r);
    for (let t = 0; t < flat.trials; t++) {
      near(result.paths[t * stride + stride - 1]!, expected);
    }
  });

  it("zero-vol trials are identical to each other", () => {
    for (let t = 1; t < flat.trials; t++) {
      for (let y = 0; y < stride; y++) {
        expect(result.paths[t * stride + y]).toBe(result.paths[y]);
      }
    }
  });

  it("two zero-vol correlated assets match one asset (static rebalancing)", () => {
    const two: SimParams = {
      ...flat,
      assets: [
        { meanReal: r, volReal: 0, weight: 0.6 },
        { meanReal: r, volReal: 0, weight: 0.4 },
      ],
      correlations: [1, 0.5, 0.5, 1],
    };
    const twoResult = simulatePlan(two);
    for (let i = 0; i < result.paths.length; i++) {
      near(twoResult.paths[i]!, result.paths[i]!);
    }
  });
});
