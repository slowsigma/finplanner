// SPDX-License-Identifier: Apache-2.0
// Goal assessment + financial-independence math (D1–D3) over deterministic
// projection rows. Pure real terms; no knowledge of storage.

import type { YearRow } from "./projector.ts";

export type GoalKind = "retire" | "college" | "fi" | "custom";

export interface GoalSpec {
  id: string;
  label: string;
  kind: GoalKind;
  targetYear?: number | null;
  targetAmount?: number | null;
  annualRetirementNeed?: number | null;
}

export interface GoalAssessment {
  id: string;
  label: string;
  kind: GoalKind;
  targetYear: number | null;
  targetAmount: number | null;
  projectedAtTarget: number | null;
  onTrack: boolean;
  /** Extra savings per year (from today to target year) needed to close the gap. */
  requiredAnnualSavings: number | null;
  basis: string;
}

export interface FiAssessment {
  annualRetirementSpend: number;
  withdrawalRate: number;
  fiNumber: number;
  /** First year net worth crosses the FI number and never falls below it again. */
  fiDate: number | null;
}

export function fiNumber(annualRetirementSpend: number, withdrawalRate: number): number {
  if (withdrawalRate <= 0) return Number.POSITIVE_INFINITY;
  return annualRetirementSpend / withdrawalRate;
}

export function fiAssessment(
  rows: readonly YearRow[],
  annualRetirementSpend: number,
  withdrawalRate: number,
): FiAssessment {
  const number = fiNumber(annualRetirementSpend, withdrawalRate);
  let fiDate: number | null = null;
  for (let i = 0; i < rows.length; i += 1) {
    const suffixSustainable = rows
      .slice(i)
      .every((r) => r.netWorth >= number && r.unmetSpending === 0);
    if (suffixSustainable) {
      fiDate = rows[i]!.year;
      break;
    }
  }
  return { annualRetirementSpend, withdrawalRate, fiNumber: number, fiDate };
}

export function requiredAnnualSavings(gap: number, years: number, realReturn: number): number {
  if (gap <= 0 || years <= 0) return 0;
  const factor =
    realReturn === 0 ? years : (Math.pow(1 + realReturn, years) - 1) / realReturn;
  return gap / factor;
}

export function assessGoal(
  rows: readonly YearRow[],
  goal: GoalSpec,
  opts: { withdrawalRate: number; blendedRealReturn: number },
): GoalAssessment {
  const base = { id: goal.id, label: goal.label, kind: goal.kind };
  const targetYear = goal.targetYear ?? null;

  if (goal.kind === "fi") {
    const fi = fiAssessment(rows, goal.annualRetirementNeed ?? 0, opts.withdrawalRate);
    return {
      ...base,
      targetYear: fi.fiDate,
      targetAmount: Number.isFinite(fi.fiNumber) ? fi.fiNumber : null,
      projectedAtTarget: null,
      onTrack: fi.fiDate !== null,
      requiredAnnualSavings: null,
      basis: `FI number ${(fi.fiNumber / 1000).toFixed(0)}k = spend ÷ ${(opts.withdrawalRate * 100).toFixed(1)}% SWR (plan, not contract)`,
    };
  }

  if (targetYear === null) {
    return { ...base, targetYear: null, targetAmount: null, projectedAtTarget: null, onTrack: false, requiredAnnualSavings: null, basis: "no target year set" };
  }

  const row = rows.find((r) => r.year === targetYear) ?? rows[rows.length - 1];
  const projected = row?.netWorth ?? null;
  const target = goal.targetAmount ?? null;

  if (target === null && goal.kind === "retire" && (goal.annualRetirementNeed ?? 0) > 0) {
    const need = (goal.annualRetirementNeed as number) / opts.withdrawalRate;
    const sustainable = rows
      .filter((r) => r.year >= targetYear)
      .every((r) => r.unmetSpending === 0);
    const gap = (projected ?? 0) >= need ? 0 : need - (projected ?? 0);
    return {
      ...base,
      targetYear,
      targetAmount: need,
      projectedAtTarget: projected,
      onTrack: (projected ?? 0) >= need && sustainable,
      requiredAnnualSavings: gap > 0 ? requiredAnnualSavings(gap, Math.max(1, targetYear - rows[0]!.year), opts.blendedRealReturn) : 0,
      basis: `retirement nest egg = ${((goal.annualRetirementNeed as number) / 1000).toFixed(0)}k/yr ÷ ${(opts.withdrawalRate * 100).toFixed(1)}% SWR, sustainable from ${targetYear} on`,
    };
  }

  if (target === null) {
    return { ...base, targetYear, targetAmount: null, projectedAtTarget: projected, onTrack: false, requiredAnnualSavings: null, basis: "no target amount set" };
  }

  const gap = (projected ?? 0) >= target ? 0 : target - (projected ?? 0);
  return {
    ...base,
    targetYear,
    targetAmount: target,
    projectedAtTarget: projected,
    onTrack: gap === 0,
    requiredAnnualSavings: gap > 0 ? requiredAnnualSavings(gap, Math.max(1, targetYear - rows[0]!.year), opts.blendedRealReturn) : 0,
    basis: "competing for the same pool: total net worth at target year",
  };
}

export function assessGoals(
  rows: readonly YearRow[],
  goals: GoalSpec[],
  opts: { withdrawalRate: number; blendedRealReturn: number },
): GoalAssessment[] {
  return goals.map((g) => assessGoal(rows, g, opts));
}
