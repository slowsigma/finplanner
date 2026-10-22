// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { ProjectionParams } from "../src/projector.ts";
import { projectPlan } from "../src/projector.ts";

// Property tests (D10 / Gate G2): monotonicity invariants the deterministic
// projector must never violate, regardless of inputs.

const paramsWith = (over: Partial<ProjectionParams>): ProjectionParams => ({
  startYear: 2026,
  horizonYears: 20,
  accounts: [
    {
      id: "k401",
      type: "tax_deferred",
      initialBalance: 20_000,
      allocations: [{ assetClass: "us_equity", weight: 1 }],
      plannedContribution: 0,
    },
    {
      id: "brokerage",
      type: "taxable",
      initialBalance: 10_000,
      allocations: [{ assetClass: "us_equity", weight: 0.6 }, { assetClass: "bonds", weight: 0.4 }],
    },
  ],
  assetReturns: { us_equity: 0.07, bonds: 0.01 },
  incomeStreams: [
    { id: "job", kind: "salary", annualAmount: 100_000, growthReal: 0.01, startYear: 2026 },
  ],
  liabilities: [],
  oneOffSpends: [],
  spending: { annualNow: 60_000, annualRetirement: 45_000, retirementStartYear: null },
  ...over,
});

describe("projector properties", () => {
  it("more planned savings ⇒ weakly more net worth in every year", () => {
    const levels = [0, 5_000, 23_500, 40_000, 60_000];
    const runs = levels.map((c) =>
      projectPlan(
        paramsWith({
          accounts: (paramsWith({}).accounts ?? []).map((a) =>
            a.id === "k401" ? { ...a, plannedContribution: c } : a,
          ),
        }),
      ).rows,
    );
    for (let t = 1; t < levels.length; t++) {
      for (let y = 0; y < runs[t]!.length; y++) {
        expect(runs[t]![y]!.netWorth).toBeGreaterThanOrEqual(runs[t - 1]![y]!.netWorth - 1e-9);
      }
    }
  });

  it("more scheduled one-off spending ⇒ weakly less net worth in every year", () => {
    const amounts = [0, 25_000, 50_000, 100_000];
    const runs = amounts.map((amount) =>
      projectPlan(
        paramsWith({
          oneOffSpends: amount === 0 ? [] : [{ label: "roof", amount, firstYear: 2026 }],
        }),
      ).rows,
    );
    for (let t = 1; t < amounts.length; t++) {
      for (let y = 0; y < runs[t]!.length; y++) {
        expect(runs[t]![y]!.netWorth).toBeLessThanOrEqual(runs[t - 1]![y]!.netWorth + 1e-9);
      }
    }
  });

  it("run-to-run determinism: identical inputs ⇒ identical rows", () => {
    expect(JSON.stringify(projectPlan(paramsWith({})))).toBe(
      JSON.stringify(projectPlan(paramsWith({}))),
    );
  });

  it("net worth identity: assets - liabilities on every row", () => {
    const rows = projectPlan(
      paramsWith({
        liabilities: [{ id: "home", balance: 300_000, realRate: 0.03, annualPayment: 20_000 }],
        spending: { annualNow: 60_000, annualRetirement: 45_000, retirementStartYear: 2035 },
      }),
    ).rows;
    for (const r of rows) {
      const assets = Object.values(r.accountBalances).reduce((s, b) => s + b, 0);
      expect(r.totalAssets).toBeGreaterThanOrEqual(assets - 1e-9);
      expect(r.netWorth).toBeCloseTo(r.totalAssets - r.totalLiabilities, 6);
      expect(r.netCashflow).toBeCloseTo(
        r.income - r.spending - r.oneOffSpends - r.debtPayments,
        6,
      );
    }
  });

  it("conservation (zero returns): ΔΣbalances == contributions + match + residual − withdrawals", () => {
    const rows = projectPlan(
      paramsWith({
        assetReturns: { us_equity: 0, bonds: 0 },
        accounts: [
          {
            id: "k401",
            type: "tax_deferred",
            initialBalance: 20_000,
            allocations: [{ assetClass: "us_equity", weight: 1 }],
            plannedContribution: 15_000,
            match: { matchRate: 0.5, upToShareOfIncome: 0.06 },
          },
          {
            id: "brokerage",
            type: "taxable",
            initialBalance: 10_000,
            allocations: [{ assetClass: "bonds", weight: 1 }],
          },
        ],
      }),
    ).rows;
    let prev = 30_000;
    for (const r of rows) {
      const total = Object.values(r.accountBalances).reduce((s, b) => s + b, 0);
      const residual = Math.max(0, r.netCashflow - r.contributions);
      const expected =
        r.netCashflow >= 0
          ? prev + r.contributions + r.employerMatch + residual
          : prev - r.withdrawals;
      expect(Math.abs(total - expected)).toBeLessThan(1e-6);
      prev = total;
    }
  });
});
