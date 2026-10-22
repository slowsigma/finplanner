// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { ProjectionParams } from "../src/projector.ts";
import { projectPlan } from "../src/projector.ts";
import { isWrapperType, US_WRAPPER_PRESETS, wrapperRulesFor } from "../src/wrappers.ts";

const near = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected) / Math.max(1, Math.abs(expected))).toBeLessThan(1e-10);

const ann = (r: number, n: number) => (r === 0 ? n : ((1 + r) ** n - 1) / r);

const equity = { us_equity: 1 };

const base: ProjectionParams = {
  startYear: 2026,
  horizonYears: 20,
  accounts: [],
  assetReturns: { us_equity: 0.05, bonds: 0.0 },
  incomeStreams: [],
  liabilities: [],
  oneOffSpends: [],
  spending: { annualNow: 0, annualRetirement: 0, retirementStartYear: null },
};

describe("flat-world golden tests (projector)", () => {
  it("single taxable account matches FV-of-annuity identity", () => {
    const r = 0.05;
    const result = projectPlan({
      ...base,
      accounts: [
        {
          id: "brokerage",
          type: "taxable",
          initialBalance: 100_000,
          allocations: [{ assetClass: "us_equity", weight: 1 }],
          plannedContribution: 10_000,
        },
      ],
      incomeStreams: [
        { id: "misc", kind: "other", annualAmount: 10_000, growthReal: 0, startYear: 2026 },
      ],
    });
    expect(result.rows).toHaveLength(20);
    near(result.rows[0]!.accountBalances["brokerage"]!, 100_000 * (1 + r) + 10_000);
    const fv = 100_000 * (1 + r) ** 20 + 10_000 * ann(r, 20);
    const last = result.rows[19]!;
    near(last.accountBalances["brokerage"]!, fv);
    near(last.netWorth, fv);
    near(last.contributions, 10_000);
  });

  it("contribution cap clamps employee dollars; excess parks in 0% cash reserve", () => {
    const r = 0.08;
    const n = 10;
    const result = projectPlan({
      ...base,
      horizonYears: n,
      accounts: [
        {
          id: "k401",
          type: "tax_deferred",
          initialBalance: 0,
          allocations: [{ assetClass: "us_equity", weight: 1 }],
          plannedContribution: 30_000,
          contributionLimit: 23_500,
        },
      ],
      assetReturns: { us_equity: r },
      incomeStreams: [
        { id: "misc", kind: "other", annualAmount: 100_000, growthReal: 0, startYear: 2026 },
      ],
    });
    const last = result.rows[n - 1]!;
    expect(last.contributions).toBe(23_500);
    near(last.accountBalances["k401"]!, 23_500 * ann(r, n));
    near(last.netWorth, 23_500 * ann(r, n) + (100_000 - 23_500) * n);
  });

  it("employer match: 50c per dollar up to 6% of salary", () => {
    const plan = (planned: number, spending: number) =>
      projectPlan({
        ...base,
        horizonYears: 5,
        accounts: [
          {
            id: "k401",
            type: "tax_deferred",
            initialBalance: 0,
            allocations: [{ assetClass: "bonds", weight: 1 }],
            plannedContribution: planned,
            match: { matchRate: 0.5, upToShareOfIncome: 0.06 },
          },
        ],
        incomeStreams: [
          { id: "job", kind: "salary", annualAmount: 100_000, growthReal: 0, startYear: 2026 },
        ],
        spending: { annualNow: spending, annualRetirement: 0, retirementStartYear: null },
      });

    const under = plan(5_000, 90_000).rows[4]!; // full match: 0.5 * 5000
    expect(under.contributions).toBe(5_000);
    expect(under.employerMatch).toBe(2_500);
    near(under.accountBalances["k401"]!, (5_000 + 2_500) * 5);

    const over = plan(8_000, 90_000).rows[4]!; // match capped at 6% salary = 6000 → 3000
    expect(over.contributions).toBe(8_000);
    expect(over.employerMatch).toBe(3_000);

    const starved = plan(5_000, 98_000).rows[4]!; // only 2000 of cash actually available
    expect(starved.contributions).toBe(2_000);
    expect(starved.employerMatch).toBe(1_000);
    near(starved.accountBalances["k401"]!, (2_000 + 1_000) * 5);
  });

  it("recurring one-off spends compound category inflation in real terms", () => {
    const result = projectPlan({
      ...base,
      horizonYears: 7,
      accounts: [
        {
          id: "vault",
          type: "other",
          initialBalance: 10_000_000,
          allocations: [{ assetClass: "bonds", weight: 1 }],
          withdrawalPriority: 1,
        },
      ],
      oneOffSpends: [
        { label: "car", amount: 20_000, firstYear: 2028, repeatEveryYears: 2, extraInflation: 0.05 },
      ],
    });
    expect(result.rows.map((r) => r.oneOffSpends)).toEqual([
      0,
      0,
      20_000,
      0,
      20_000 * 1.05 ** 2,
      0,
      20_000 * 1.05 ** 4,
    ]);
  });

  it("liability amortizes at its real rate and payment stops at payoff", () => {
    const result = projectPlan({
      ...base,
      horizonYears: 6,
      accounts: [
        {
          id: "vault",
          type: "taxable",
          initialBalance: 0,
          allocations: [{ assetClass: "bonds", weight: 1 }],
        },
      ],
      assetReturns: { us_equity: 0.05, bonds: 0 },
      liabilities: [{ id: "home", balance: 100_000, realRate: 0.05, annualPayment: 30_000 }],
      incomeStreams: [
        { id: "misc", kind: "other", annualAmount: 40_000, growthReal: 0, startYear: 2026 },
      ],
    });
    const payments = result.rows.map((r) => r.debtPayments);
    near(payments[0]!, 30_000);
    near(payments[2]!, 30_000);
    const owedYear4 = ((100_000 * 1.05 - 30_000) * 1.05 - 30_000) * 1.05 - 30_000;
    near(payments[3]!, owedYear4 * 1.05); // payoff: last payment covers interest + stub
    near(result.rows[2]!.totalLiabilities, owedYear4);
    near(result.rows[3]!.totalLiabilities, 0);
    expect(payments[4]).toBe(0);
    expect(payments[5]).toBe(0);
    const vaults = result.rows.map((r) => r.accountBalances["vault"]!);
    near(vaults[0]!, 10_000);
    near(vaults[2]!, 30_000);
    near(vaults[3]!, 30_000 + (40_000 - owedYear4 * 1.05));
    near(result.rows[3]!.netWorth, vaults[3]!);
  });

  it("asset depletion: priority-ordered draws, unmet spending flagged, net worth floored", () => {
    const result = projectPlan({
      ...base,
      horizonYears: 4,
      accounts: [
        {
          id: "a",
          type: "taxable",
          initialBalance: 20_000,
          allocations: [{ assetClass: "bonds", weight: 1 }],
        },
        {
          id: "b",
          type: "taxable",
          initialBalance: 5_000,
          allocations: [{ assetClass: "bonds", weight: 1 }],
        },
      ],
      spending: { annualNow: 10_000, annualRetirement: 0, retirementStartYear: null },
    });
    near(result.rows[0]!.withdrawals, 10_000);
    near(result.rows[0]!.netWorth, 15_000);
    expect(result.rows[1]!.unmetSpending).toBe(0);
    near(result.rows[2]!.withdrawals, 5_000);
    near(result.rows[2]!.unmetSpending, 5_000);
    expect(result.rows[2]!.netWorth).toBe(0);
    expect(result.rows[3]!.netWorth).toBe(0);
    expect(result.rows[3]!.unmetSpending).toBe(10_000);
  });

  it("waterfall order: match-priority account funded first, residual to taxable sink", () => {
    const n = 3;
    const result = projectPlan({
      ...base,
      horizonYears: n,
      accounts: [
        {
          id: "brokerage",
          type: "taxable",
          initialBalance: 0,
          allocations: [{ assetClass: "bonds", weight: 1 }],
        },
        {
          id: "k401",
          type: "tax_deferred",
          initialBalance: 0,
          allocations: [{ assetClass: "us_equity", weight: 1 }],
          plannedContribution: 5_000,
          contributionPriority: 1,
        },
      ],
      assetReturns: { us_equity: 0.08, bonds: 0.07 },
      incomeStreams: [
        { id: "misc", kind: "other", annualAmount: 20_000, growthReal: 0, startYear: 2026 },
      ],
    });
    const last = result.rows[n - 1]!;
    near(last.accountBalances["k401"]!, 5_000 * ann(0.08, n));
    near(last.accountBalances["brokerage"]!, 15_000 * ann(0.07, n));
  });

  it("retirement switch swaps spending level from retirementStartYear", () => {
    const result = projectPlan({
      ...base,
      horizonYears: 6,
      accounts: [
        {
          id: "v",
          type: "other",
          initialBalance: 1e9,
          allocations: [{ assetClass: "bonds", weight: 1 }],
        },
      ],
      spending: { annualNow: 80_000, annualRetirement: 50_000, retirementStartYear: 2029 },
    });
    expect(result.rows.map((r) => r.spending)).toEqual([
      80_000, 80_000, 80_000, 50_000, 50_000, 50_000,
    ]);
  });
});

describe("wrapper presets (D15)", () => {
  it("covers every schema-v1 account type", () => {
    for (const t of [
      "taxable",
      "tax_deferred",
      "tax_free",
      "hsa",
      "529",
      "defined_benefit",
      "real_estate",
      "other",
    ] as const) {
      expect(isWrapperType(t)).toBe(true);
      expect(US_WRAPPER_PRESETS[t].type).toBe(t);
    }
    expect(isWrapperType("isa_uk")).toBe(false);
  });

  it("overrides layer over presets without mutating them", () => {
    const rules = wrapperRulesFor("tax_deferred", {
      employeeContributionLimit: 99_999,
      employerMatch: { matchRate: 1, upToShareOfIncome: 0.03 },
    });
    expect(rules.employeeContributionLimit).toBe(99_999);
    expect(US_WRAPPER_PRESETS.tax_deferred.employeeContributionLimit).not.toBe(99_999);
    expect(wrapperRulesFor("hsa").employerMatch).toBeNull();
  });
});
