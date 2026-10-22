// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  assessGoal,
  fiAssessment,
  fiNumber,
  requiredAnnualSavings,
  type GoalSpec,
} from "../src/goals.ts";
import { projectPlan, type ProjectionParams, type YearRow } from "../src/projector.ts";

const near = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected) / Math.max(1, Math.abs(expected))).toBeLessThan(1e-9);

const row = (year: number, netWorth: number, unmetSpending = 0) =>
  ({ year, netWorth, unmetSpending }) as YearRow;

const rows = (years: [number, number][]) => years.map(([y, nw]) => row(y, nw));

const opts = { withdrawalRate: 0.04, blendedRealReturn: 0.05 };
const ann = (r: number, n: number) => (r === 0 ? n : ((1 + r) ** n - 1) / r);

describe("FI number & date (D3)", () => {
  it("FI number is spend ÷ SWR", () => {
    near(fiNumber(60_000, 0.04), 1_500_000);
    near(fiNumber(60_000, 0.035), 1_714_285.7142857143);
    expect(fiNumber(60_000, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it("FI date is the first year that stays at or above the FI number", () => {
    const growing = Array.from({ length: 50 }, (_, i) => row(2026 + i, 100_000 * 1.07 ** i));
    const fi = fiAssessment(growing, 60_000, 0.04);
    const firstCrossing = growing.findIndex((r) => r.netWorth >= 1_500_000);
    expect(fi.fiDate).toBe(2026 + firstCrossing);

    const dips = growing.map((r, i) => (i === firstCrossing + 3 ? row(r.year, 1_000_000) : r));
    const dipped = fiAssessment(dips, 60_000, 0.04);
    expect((dipped.fiDate ?? 0) > (fi.fiDate ?? 0)).toBe(true);

    const never = fiAssessment([row(2026, 100_000)], 60_000, 0.04);
    expect(never.fiDate).toBeNull();
  });

  it("run-out years block the FI date even above the number", () => {
    const above = Array.from({ length: 20 }, (_, i) => row(2026 + i, 2_000_000));
    above[10] = row(above[10]!.year, 2_000_000, 5_000);
    const fi = fiAssessment(above, 60_000, 0.04);
    expect(fi.fiDate).toBe(2026 + 11);
  });
});

describe("required savings (D2)", () => {
  it("saving the required amount accumulates exactly the gap", () => {
    const gap = 100_000;
    const n = 10;
    const r = 0.05;
    const pmt = requiredAnnualSavings(gap, n, r);
    near(pmt * ann(r, n), gap);
  });

  it("zero rate divides by years; no gap or no years means zero", () => {
    near(requiredAnnualSavings(100_000, 8, 0), 12_500);
    expect(requiredAnnualSavings(0, 10, 0.05)).toBe(0);
    expect(requiredAnnualSavings(50_000, 0, 0.05)).toBe(0);
  });
});

describe("goal assessment (D1/D2)", () => {
  const college: GoalSpec = {
    id: "g1", label: "College", kind: "college", targetYear: 2031, targetAmount: 50_000,
  };

  it("on-track when projected net worth at target year covers the amount", () => {
    const a = assessGoal(rows([[2030, 40_000], [2031, 60_000]]), college, opts);
    expect(a.onTrack).toBe(true);
    expect(a.requiredAnnualSavings).toBe(0);
    near(a.projectedAtTarget!, 60_000);
  });

  it("off-track reports the extra annual savings to close the gap", () => {
    const goal = { ...college, targetAmount: 5_000_000 };
    const a = assessGoal(rows([[2026, 100_000], [2031, 60_000]]), goal, opts);
    expect(a.onTrack).toBe(false);
    near(a.requiredAnnualSavings!, (5_000_000 - 60_000) / ann(0.05, 2031 - 2026));
  });

  it("retirement goal derives the nest egg from need ÷ SWR and checks sustainability", () => {
    const retire: GoalSpec = {
      id: "g2", label: "Retire", kind: "retire", targetYear: 2040, annualRetirementNeed: 60_000,
    };
    near(assessGoal(rows([[2040, 1_600_000]]), retire, opts).targetAmount!, 1_500_000);

    const ok = assessGoal(
      ([[2040, 1_600_000, 0], [2041, 1_650_000, 0]] as const).map(([y, nw, u]) => row(y, nw, u)),
      retire, opts,
    );
    expect(ok.onTrack).toBe(true);

    const runsDry = assessGoal(
      ([[2040, 1_600_000, 0], [2041, 1_650_000, 3_000]] as const).map(([y, nw, u]) => row(y, nw, u)),
      retire, opts,
    );
    expect(runsDry.onTrack).toBe(false);
  });

  it("fi goal tracks the FI date", () => {
    const growing = Array.from({ length: 50 }, (_, i) => row(2026 + i, 100_000 * 1.07 ** i));
    const fiGoal: GoalSpec = { id: "g3", label: "FI", kind: "fi", annualRetirementNeed: 60_000 };
    const a = assessGoal(growing, fiGoal, opts);
    expect(a.onTrack).toBe(true);
    near(a.targetAmount!, 1_500_000);
  });

  it("missing target year/amount reports not-assessable rather than failing silently", () => {
    expect(assessGoal(rows([[2031, 60_000]]), { id: "x", label: "x", kind: "custom" }, opts).basis)
      .toBe("no target year set");
    expect(assessGoal(rows([[2031, 60_000]]), { id: "x", label: "x", kind: "custom", targetYear: 2031 }, opts).onTrack)
      .toBe(false);
  });
});

describe("required savings closes the gap in the real waterfall", () => {
  const base: ProjectionParams = {
    startYear: 2026,
    horizonYears: 20,
    accounts: [
      {
        id: "b", type: "taxable", initialBalance: 50_000,
        allocations: [{ assetClass: "us_equity", weight: 1 }],
        plannedContribution: 10_000,
      },
    ],
    assetReturns: { us_equity: 0.05 },
    incomeStreams: [{ id: "sal", kind: "salary", annualAmount: 100_000, growthReal: 0, startYear: 2026 }],
    liabilities: [],
    oneOffSpends: [],
    spending: { annualNow: 50_000, annualRetirement: 0, retirementStartYear: null },
  };

  it("adding the reported required savings to contributions reaches the target", () => {
    const result = projectPlan(base);
    const goal: GoalSpec = { id: "g", label: "House down", kind: "custom", targetYear: 2036, targetAmount: 500_000 };
    const before = assessGoal(result.rows, goal, opts);

    const extra = Math.ceil(before.requiredAnnualSavings! / 100) * 100;
    const boosted = projectPlan({
      ...base,
      accounts: [{ ...base.accounts[0]!, plannedContribution: 10_000 + extra }],
    });
    const after = assessGoal(boosted.rows, goal, opts);
    expect(after.onTrack).toBe(true);
  });
});
