// SPDX-License-Identifier: Apache-2.0
// DB → engine bridge for the deterministic projection (M2). Account types map
// to WrapperRules via the D15 layer; unmapped allocation slices fall back to a
// per-type proxy asset class so every account still has a growth model.

import {
  isWrapperType,
  projectPlan,
  type AccountSpec,
  type IncomeKind,
  type ProjectionParams,
  type ProjectionResult,
} from "@finplanner/engine";
import type { AppDatabase } from "../db/sqlite.ts";
import {
  getDefaultAssumptions,
  listAccounts,
  listAllocations,
  listIncome,
  listLiabilities,
  listOneOffSpends,
  listPersons,
  getSpending,
  seedDefaultAssumptions,
} from "../db/repo.ts";

export interface AssetAssumptionData {
  label: string;
  meanReal: number;
}

export interface AssumptionsData {
  assetReturns: Record<string, number>;
  assets: AssetAssumptionData[];
  withdrawalRate: number;
  blendedRealReturn: number;
  note: string;
}

// PLACEHOLDER returns (real terms) — sourced, versioned default sets replace
// these before beta (PLAN §15 "Validation data" workstream).
export const DEFAULT_ASSUMPTIONS: AssumptionsData = {
  assetReturns: {
    us_equity: 0.075,
    intl_equity: 0.07,
    bonds: 0.01,
    real_estate: 0.045,
    cash: 0.0,
  },
  assets: [
    { label: "US equities", meanReal: 0.075 },
    { label: "International equities", meanReal: 0.07 },
    { label: "Bonds", meanReal: 0.01 },
    { label: "Real estate", meanReal: 0.045 },
    { label: "Cash", meanReal: 0.0 },
  ],
  withdrawalRate: 0.04,
  blendedRealReturn: 0.05,
  note: "Unvalidated real-return placeholders — replace with sourced assumption set before beta.",
};

export function ensureDefaultAssumptions(db: AppDatabase): AssumptionsData {
  seedDefaultAssumptions(db, DEFAULT_ASSUMPTIONS);
  const row = getDefaultAssumptions(db);
  if (!row) throw new Error("assumptions seeding failed");
  return JSON.parse(row.data_json) as AssumptionsData;
}

const PROXY_BY_TYPE: Record<string, string> = {
  real_estate: "real_estate",
  defined_benefit: "bonds",
};

export interface PlanView {
  params: ProjectionParams;
  result: ProjectionResult;
  assumptions: AssumptionsData;
  notes: string[];
}

export function buildPlan(db: AppDatabase): PlanView | { error: string } {
  const persons = listPersons(db);
  if (persons.length === 0) return { error: "Add at least one adult under Household first." };
  const accounts = listAccounts(db);
  if (accounts.length === 0) return { error: "Add at least one account under Accounts first." };

  const assumptions = ensureDefaultAssumptions(db);
  const notes: string[] = [];
  const allocations = listAllocations(db);
  const byAccount = new Map<string, { assetClass: string; weight: number }[]>();
  for (const a of allocations) {
    const list = byAccount.get(a.account_id) ?? [];
    list.push({ assetClass: a.asset_class, weight: a.weight });
    byAccount.set(a.account_id, list);
  }

  const currentYear = new Date().getFullYear();
  const specs: AccountSpec[] = accounts.map((a) => {
    if (!isWrapperType(a.type)) throw new Error(`unknown account type '${a.type}'`);
    let alloc = byAccount.get(a.id) ?? [];
    const used = alloc.reduce((s, r) => s + r.weight, 0);
    if (used < 1 - 1e-9) {
      const proxy = PROXY_BY_TYPE[a.type] ?? "cash";
      alloc = [...alloc, { assetClass: proxy, weight: 1 - used }];
      notes.push(`${a.label}: ${(1 - used) * 100}% unallocated → modeled as ${proxy.replaceAll("_", " ")}.`);
    }
    return {
      id: a.id,
      type: a.type,
      initialBalance: a.balance,
      allocations: alloc,
      plannedContribution: a.planned_contribution,
      contributionLimit: a.contribution_limit ?? undefined,
      match:
        a.match_rate !== null
          ? { matchRate: a.match_rate, upToShareOfIncome: a.match_up_to_share ?? 0.06 }
          : null,
    };
  });

  const retirementAges = persons
    .filter((p) => p.planned_retirement_age !== null)
    .map((p) => p.birth_year + (p.planned_retirement_age as number));
  const retirementStartYear = retirementAges.length > 0 ? Math.min(...retirementAges) : null;

  const spending = getSpending(db);
  const horizonToYear = Math.max(...persons.map((p) => p.birth_year + (p.life_expectancy_age ?? 95) + 5));
  const horizonYears = Math.max(10, horizonToYear - currentYear);

  const params: ProjectionParams = {
    startYear: currentYear,
    horizonYears,
    accounts: specs,
    assetReturns: assumptions.assetReturns,
    incomeStreams: listIncome(db).map((i) => ({
      id: i.id,
      kind: i.kind as IncomeKind,
      annualAmount: i.annual_amount,
      growthReal: i.growth_real,
      startYear: i.start_year,
      endYear: i.end_year ?? undefined,
    })),
    liabilities: listLiabilities(db).map((l) => ({
      id: l.id,
      balance: l.balance,
      realRate: l.rate,
      annualPayment: l.annual_payment,
    })),
    oneOffSpends: listOneOffSpends(db).map((o) => ({
      label: o.label,
      amount: o.amount,
      firstYear: o.first_year,
      repeatEveryYears: o.repeat_every_years ?? undefined,
      extraInflation: o.extra_inflation,
    })),
    spending: {
      annualNow: spending?.annual_now ?? 0,
      annualRetirement: spending?.annual_retirement ?? 0,
      retirementStartYear,
    },
  };

  if (retirementStartYear === null) {
    notes.push("No planned retirement age set — modeling this spending level across the whole horizon.");
  }
  if (!spending) notes.push("No spending profile set (Cash flow tab) — projecting contributions only.");
  notes.push(assumptions.note);

  return { params, result: projectPlan(params), assumptions, notes };
}
