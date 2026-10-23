// SPDX-License-Identifier: Apache-2.0
// DB → engine bridge for the deterministic projection (M2). Account types map
// to WrapperRules via the D15 layer; unmapped allocation slices fall back to a
// per-type proxy asset class so every account still has a growth model.

import {
  assumptionsHash,
  isWrapperType,
  projectPlan,
  type AccountSpec,
  type IncomeKind,
  type MarketAssumptions,
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

export interface AssetClassData {
  name: string;
  label: string;
  meanReal: number;
  /** Volatility of the annual real log return (M3, B2.2). */
  volReal: number;
}

export interface AssumptionsData {
  assetReturns: Record<string, number>;
  assets: AssetClassData[];
  /** Pair correlations keyed by the two class names joined with "|" (sorted). */
  correlationPairs: Record<string, number>;
  withdrawalRate: number;
  blendedRealReturn: number;
  note: string;
}

export function corrKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// PLACEHOLDER returns/vols (real terms) — sourced, versioned default sets
// replace these before beta (PLAN §15 "Validation data" workstream).
export const DEFAULT_ASSUMPTIONS: AssumptionsData = {
  assetReturns: {
    us_equity: 0.075,
    intl_equity: 0.07,
    bonds: 0.01,
    real_estate: 0.045,
    cash: 0.0,
  },
  assets: [
    { name: "us_equity", label: "US equities", meanReal: 0.075, volReal: 0.17 },
    { name: "intl_equity", label: "International equities", meanReal: 0.07, volReal: 0.18 },
    { name: "bonds", label: "Bonds", meanReal: 0.01, volReal: 0.05 },
    { name: "real_estate", label: "Real estate", meanReal: 0.045, volReal: 0.12 },
    { name: "cash", label: "Cash", meanReal: 0.0, volReal: 0.01 },
  ],
  correlationPairs: {
    [corrKey("us_equity", "intl_equity")]: 0.9,
    [corrKey("us_equity", "bonds")]: -0.1,
    [corrKey("intl_equity", "bonds")]: -0.1,
    [corrKey("us_equity", "real_estate")]: 0.6,
    [corrKey("intl_equity", "real_estate")]: 0.55,
    [corrKey("bonds", "real_estate")]: 0.2,
  },
  withdrawalRate: 0.04,
  blendedRealReturn: 0.05,
  note: "Unvalidated real-return placeholders — replace with sourced assumption set before beta (provenance id: market-us-1970-2024-placeholder).",
};

/** Accepts pre-M3 (label-only, no vol/corr) stored shapes and fills defaults. */
export function normalizeAssumptions(raw: unknown): AssumptionsData {
  const r = raw as Partial<AssumptionsData> & { assets?: { name?: string; label?: string }[] };
  const entries = Object.entries(r?.assetReturns ?? DEFAULT_ASSUMPTIONS.assetReturns);
  const assets: AssetClassData[] = entries.map(([name, meanReal], i) => {
    const stored = r?.assets?.[i];
    const match = stored?.name ? DEFAULT_ASSUMPTIONS.assets.find((d) => d.name === stored.name) : undefined;
    const fallback = match ?? DEFAULT_ASSUMPTIONS.assets.find((d) => d.label === stored?.label) ?? DEFAULT_ASSUMPTIONS.assets[i]!;
    return {
      name,
      label: fallback.label,
      meanReal: Number.isFinite(meanReal) ? meanReal : fallback.meanReal,
      volReal: Number.isFinite(stored?.volReal) ? (stored as { volReal: number }).volReal : fallback.volReal,
    };
  });
  return {
    assetReturns: Object.fromEntries(assets.map((a) => [a.name, a.meanReal])),
    assets,
    correlationPairs: r?.correlationPairs ?? { ...DEFAULT_ASSUMPTIONS.correlationPairs },
    withdrawalRate: r?.withdrawalRate ?? DEFAULT_ASSUMPTIONS.withdrawalRate,
    blendedRealReturn: r?.blendedRealReturn ?? DEFAULT_ASSUMPTIONS.blendedRealReturn,
    note: r?.note ?? DEFAULT_ASSUMPTIONS.note,
  };
}

/** Market assumption set for the M3 simulator (B2.2) from stored assumptions. */
export function buildMarketAssumptions(a: AssumptionsData): MarketAssumptions {
  const n = a.assets.length;
  const correlations = new Array<number>(n * n).fill(0);
  for (let i = 0; i < n; i++) {
    correlations[i * n + i] = 1;
    for (let j = i + 1; j < n; j++) {
      const rho = a.correlationPairs[corrKey(a.assets[i]!.name, a.assets[j]!.name)] ?? 0;
      correlations[i * n + j] = rho;
      correlations[j * n + i] = rho;
    }
  }
  return {
    classes: a.assets.map(({ name, meanReal, volReal }) => ({ name, meanReal, volReal })),
    correlations,
  };
}

export function ensureDefaultAssumptions(db: AppDatabase): AssumptionsData {
  seedDefaultAssumptions(db, DEFAULT_ASSUMPTIONS);
  const row = getDefaultAssumptions(db);
  if (!row) throw new Error("assumptions seeding failed");
  return normalizeAssumptions(JSON.parse(row.data_json));
}

const PROXY_BY_TYPE: Record<string, string> = {
  real_estate: "real_estate",
  defined_benefit: "bonds",
};

export interface PlanView {
  params: ProjectionParams;
  result: ProjectionResult;
  assumptions: AssumptionsData;
  market: MarketAssumptions;
  marketHash: string;
  /** Last-survivor death year per the (unvalidated) expectancy table (B2.5). */
  deathYear: number;
  /** Base death year per person (B2.5 joint longevity). */
  deathYears: number[];
  /** Person id → birth year (SS claiming-age shifts, B2.4). */
  personBirthYear: Record<string, number>;
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
  const deathYears = persons.map((p) => p.birth_year + (p.life_expectancy_age ?? 95));
  const deathYear = Math.max(...deathYears);
  const horizonToYear = deathYear + 5;
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

  const market = buildMarketAssumptions(assumptions);
  return {
    params,
    result: projectPlan(params),
    assumptions,
    market,
    marketHash: assumptionsHash(market),
    deathYear,
    deathYears,
    personBirthYear: Object.fromEntries(persons.map((p) => [p.id, p.birth_year])),
    notes,
  };
}
