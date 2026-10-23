// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { mcSummary, projectPlan, simulatePlanMonteCarlo, type ProjectionParams } from "../src/index.ts";

const mk = (overrides: Partial<ProjectionParams> = {}): ProjectionParams => ({
  startYear: 2030,
  horizonYears: 10,
  accounts: [
    { id: "t", type: "taxable", initialBalance: 500_000, allocations: [{ assetClass: "us_equity", weight: 1 }] },
  ],
  assetReturns: { us_equity: 0.05 },
  incomeStreams: [],
  liabilities: [],
  oneOffSpends: [],
  spending: { annualNow: 0, annualRetirement: 40_000, retirementStartYear: 2030 },
  ...overrides,
});

describe("guardrail withdrawal policy (M2)", () => {
  it("raises spending after a strong year and cuts after a weak one", () => {
    const strong = projectPlan({ ...mk(), assetReturnsByYear: { us_equity: [0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0] } });
    const flat = projectPlan(mk());
    const weak = projectPlan({ ...mk(), assetReturnsByYear: { us_equity: [-0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0] } });
    const g = { kind: "guardrail" as const, band: 0.15, step: 0.1 };
    const strongG = projectPlan({ ...mk({ withdrawalPolicy: g }), assetReturnsByYear: { us_equity: [0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0] } });
    const weakG = projectPlan({ ...mk({ withdrawalPolicy: g }), assetReturnsByYear: { us_equity: [-0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0] } });
    expect(strong.rows[0]!.spending).toBeCloseTo(40_000);
    expect(flat.rows[1]!.spending).toBeCloseTo(40_000);
    expect(strongG.rows[1]!.spending).toBeGreaterThan(strong.rows[1]!.spending);
    expect(weakG.rows[1]!.spending).toBeLessThan(weak.rows[1]!.spending);
  });

  it("validates guardrail parameters", () => {
    expect(() => projectPlan(mk({ withdrawalPolicy: { kind: "guardrail", band: 0, step: 0.1 } }))).toThrow();
    expect(() => projectPlan(mk({ withdrawalPolicy: { kind: "guardrail", band: 0.15, step: 0 } }))).toThrow();
  });

  it("fixed default is untouched: guardrail off reproduces baseline exactly", () => {
    const base = projectPlan(mk());
    const also = projectPlan({ ...mk(), withdrawalPolicy: { kind: "fixed" } });
    expect(also.rows.map((r) => r.netWorth)).toEqual(base.rows.map((r) => r.netWorth));
  });
});

describe("cash buffer bucket (M1)", () => {
  const crash = [-0.25, -0.15, 0.2, 0, 0, 0, 0, 0, 0, 0];
  it("shielding: invested accounts draw down less during decline years", () => {
    const fixed = projectPlan({ ...mk(), assetReturnsByYear: { us_equity: crash } });
    const bucket = projectPlan({ ...mk({ cashBufferYears: 2 }), assetReturnsByYear: { us_equity: crash } });
    // Year 3 (index 2): after two decline years the fixed plan has been selling
    // equities into the drawdown; the bucket plan has been spending the reserve.
    expect(bucket.rows[1]!.accountBalances.t!).toBeGreaterThan(fixed.rows[1]!.accountBalances.t!);
    // Cost of insurance: the recovery-year top-up (and 0% reserve yield) leaves
    // the invested sleeve below the fixed plan once markets rebound.
    expect(bucket.rows[2]!.accountBalances.t!).toBeLessThan(fixed.rows[2]!.accountBalances.t!);
  });

  it("rejects invalid buffer sizes", () => {
    expect(() => projectPlan(mk({ cashBufferYears: -1 }))).toThrow();
    expect(() => projectPlan(mk({ cashBufferYears: Number.NaN }))).toThrow();
  });
});

describe("C.3 spending metrics", () => {
  it("summary exposes median lifetime and minimum spending", () => {
    const r = simulatePlanMonteCarlo({
      projection: mk({ horizonYears: 8 }),
      market: {
        classes: [{ name: "us_equity", meanReal: 0.05, volReal: 0.18 }],
        correlations: [1],
      },
      goals: [],
      withdrawalRate: 0.04,
      seed: 7,
      trials: 100,
    });
    const s = mcSummary(r);
    expect(s.medianLifetimeSpend).toBeGreaterThan(8 * 30_000);
    expect(s.medianMinSpend).toBeGreaterThan(0);
    expect(s.medianMinSpend).toBeLessThanOrEqual(s.medianLifetimeSpend);
  });
});
