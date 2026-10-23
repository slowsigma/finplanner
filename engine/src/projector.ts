// SPDX-License-Identifier: Apache-2.0
// M2 deterministic core (B1.2): account-level, real-terms, year-by-year
// projection across multiple accounts. Static allocation with annual
// rebalancing per account (mirrors the M0 engine), per-asset-class real
// returns, contribution limits and employer-match rules via the D15
// WrapperRules layer. Taxes (B1.3) are intentionally NOT modeled here —
// they are gated behind IRS-source validation (PLAN §14 HSA row) and will
// layer on top of this waterfall.
//
// Everything is in today's (real) dollars. Inflation is invisible: returns
// and growth inputs are already real. End-of-year cashflow timing (matches
// the M0 FV-of-annuity golden identity): balances grow, then that year's net
// cashflow moves in/out, so a contribution earns nothing in its own year.

import {
  US_WRAPPER_PRESETS,
  type EmployerMatchRule,
  type WrapperRules,
  type WrapperType,
} from "./wrappers.ts";

export interface AccountAllocation {
  assetClass: string;
  weight: number;
}

export interface AccountSpec {
  id: string;
  type: WrapperType;
  initialBalance: number;
  /** Static allocation within the account; weights must sum to 1. */
  allocations: readonly AccountAllocation[];
  /** Planned real annual employee/owner contribution. Defaults to 0. */
  plannedContribution?: number;
  /** Overrides the D15 preset employee contribution cap for this account. */
  contributionLimit?: number;
  /** Overrides the D15 preset employer match (e.g. plan-specific formula). */
  match?: EmployerMatchRule | null;
  /** Fund order when savings are positive (lower first). Ties break by id. */
  contributionPriority?: number;
  /** Draw order when cashflow is negative (lower first). Ties break by id. */
  withdrawalPriority?: number;
}

export type IncomeKind =
  | "salary"
  | "social_security"
  | "pension"
  | "annuity"
  | "rental"
  | "other";

export interface IncomeStreamSpec {
  id: string;
  kind: IncomeKind;
  annualAmount: number;
  /** Real growth applied per year after startYear (salary raises). */
  growthReal: number;
  /** First calendar year the stream pays. */
  startYear: number;
  /** Last calendar year the stream pays (inclusive). Open-ended if omitted. */
  endYear?: number;
}

export interface LiabilitySpec {
  id: string;
  balance: number;
  realRate: number;
  annualPayment: number;
}

export interface OneOffSpendSpec {
  label: string;
  /** Real amount in firstYear dollars. */
  amount: number;
  firstYear: number;
  /** If set, recurs every N years (roof every 6, car every ~7). */
  repeatEveryYears?: number;
  /** Category-specific real inflation above general CPI (vehicles/travel ≠ CPI). */
  extraInflation?: number;
}

/**
 * Retirement withdrawal policy (C.2 M2), applied inside every trial year.
 * fixed: baseline real retirement spending. Guardrails (M2): spending steps
 * up/down by `step` whenever prior-year assets drift past ±`band` of the
 * retirement-entry baseline (Landscape-style; real-terms flat baseline).
 */
export type WithdrawalPolicy =
  | { kind: "fixed" }
  | { kind: "guardrail"; band: number; step: number };

export interface SpendingSpec {
  annualNow: number;
  annualRetirement: number;
  /** First calendar year retirement spending applies; null ⇒ never switches. */
  retirementStartYear: number | null;
}

export interface ProjectionParams {
  startYear: number;
  horizonYears: number;
  accounts: readonly AccountSpec[];
  /** Real arithmetic mean return per named asset class. */
  assetReturns: Readonly<Record<string, number>>;
  /**
   * Optional per-year overrides (index 0 = startYear) used by Monte Carlo
   * trials; falls back to assetReturns for classes/years not provided.
   */
  assetReturnsByYear?: Readonly<Record<string, readonly number[]>>;
  /**
   * Optional per-year multiplicative spending shocks (B2.7, index 0 =
   * startYear), e.g. exp(σx − σ²/2) draws with mean ≈ 1. Defaults to none.
   */
  spendingShocksByYear?: readonly number[];
  incomeStreams: readonly IncomeStreamSpec[];
  liabilities: readonly LiabilitySpec[];
  oneOffSpends: readonly OneOffSpendSpec[];
  spending: SpendingSpec;
  /** Retirement withdrawal policy (M2); defaults to fixed. */
  withdrawalPolicy?: WithdrawalPolicy;
  /**
   * Cash-bucket size in years of retirement spending (M1). During retirement
   * shortfalls draw from this 0%-real reserve first; it is replenished from
   * the portfolio only in years the invested sleeve did not decline.
   */
  cashBufferYears?: number;
}

export interface YearRow {
  year: number;
  income: number;
  oneOffSpends: number;
  debtPayments: number;
  spending: number;
  /** income - spending - oneOff - debtPayments; >0 saves, <0 draws down. */
  netCashflow: number;
  /** Employee/owner contributions actually deposited (post-cap). */
  contributions: number;
  /** Employer match dollars deposited on top (not capped by deferral limit). */
  employerMatch: number;
  /** Distributions taken out to cover a negative net cashflow. */
  withdrawals: number;
  /** Spending not covered even after draining every asset (destitution). */
  unmetSpending: number;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  /** Year-end balance per account id (excludes implicit cash reserve). */
  accountBalances: Readonly<Record<string, number>>;
}

export interface ProjectionResult {
  rows: readonly YearRow[];
}

interface PreparedAccount {
  spec: AccountSpec;
  rules: WrapperRules;
  limit: number;
  match: EmployerMatchRule | null;
  contributionPriority: number;
  withdrawalPriority: number;
  /** One effective return per horizon year (static when no override given). */
  accountReturns: number[];
  balance: number;
}

function resolveAccountReturns(
  allocations: readonly AccountAllocation[],
  params: ProjectionParams,
  id: string,
): number[] {
  if (allocations.length === 0) {
    throw new Error(`account ${id} needs at least one allocation`);
  }
  let sum = 0;
  for (const a of allocations) {
    const r = params.assetReturns[a.assetClass];
    if (r === undefined) {
      throw new Error(`account ${id}: unknown asset class '${a.assetClass}'`);
    }
    if (!(a.weight > 0 && a.weight <= 1)) {
      throw new Error(`account ${id}: weight for '${a.assetClass}' out of (0,1]`);
    }
    sum += a.weight;
  }
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(`account ${id}: allocation weights must sum to 1, got ${sum}`);
  }
  const returns: number[] = [];
  for (let y = 0; y < params.horizonYears; y++) {
    let weighted = 0;
    for (const a of allocations) {
      const override = params.assetReturnsByYear?.[a.assetClass];
      const r = override && y < override.length ? override[y]! : params.assetReturns[a.assetClass]!;
      weighted += a.weight * r;
    }
    returns.push(weighted);
  }
  return returns;
}

function byPrioThenById(a: { prio: number; id: string }, b: { prio: number; id: string }): number {
  return a.prio - b.prio || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function incomeInYear(stream: IncomeStreamSpec, year: number): number {
  if (year < stream.startYear) return 0;
  if (stream.endYear !== undefined && year > stream.endYear) return 0;
  return stream.annualAmount * (1 + stream.growthReal) ** (year - stream.startYear);
}

function oneOffInYear(spend: OneOffSpendSpec, year: number): number {
  if (year < spend.firstYear) return 0;
  const since = year - spend.firstYear;
  if (spend.repeatEveryYears !== undefined) {
    if (since % spend.repeatEveryYears !== 0) return 0;
  } else if (since !== 0) {
    return 0;
  }
  return spend.amount * (1 + (spend.extraInflation ?? 0)) ** since;
}

export function projectPlan(params: ProjectionParams): ProjectionResult {
  if (!Number.isInteger(params.horizonYears) || params.horizonYears < 1) {
    throw new Error("horizonYears must be a positive integer");
  }
  if (!Number.isInteger(params.startYear)) throw new Error("startYear must be an integer");
  const ids = new Set<string>();
  for (const a of params.accounts) {
    if (ids.has(a.id)) throw new Error(`duplicate account id '${a.id}'`);
    ids.add(a.id);
  }

  const policy: WithdrawalPolicy = params.withdrawalPolicy ?? { kind: "fixed" };
  if (policy.kind === "guardrail") {
    if (!(policy.band > 0 && policy.band < 0.9)) throw new Error("guardrail band must be in (0, 0.9)");
    if (!(policy.step > 0 && policy.step <= 0.5)) throw new Error("guardrail step must be in (0, 0.5]");
  }
  const bufferYears = params.cashBufferYears ?? 0;
  if (!(bufferYears >= 0) || !Number.isFinite(bufferYears)) throw new Error("cashBufferYears must be a finite number >= 0");

  const prepared: PreparedAccount[] = params.accounts.map((spec) => {
    const rules = US_WRAPPER_PRESETS[spec.type];
    return {
      spec,
      rules,
      limit: spec.contributionLimit ?? rules.employeeContributionLimit,
      match: spec.match === undefined ? rules.employerMatch : spec.match,
      contributionPriority: spec.contributionPriority ?? 100,
      withdrawalPriority: spec.withdrawalPriority ?? 100,
      accountReturns: resolveAccountReturns(spec.allocations, params, spec.id),
      balance: spec.initialBalance,
    };
  });

  // Residual savings sink: first taxable account with no planned contribution,
  // else an implicit 0%-real cash reserve.
  const sink = prepared.find(
    (p) => p.spec.type === "taxable" && (p.spec.plannedContribution ?? 0) === 0,
  );
  let cashReserve = 0;

  const contributeOrder = [...prepared]
    .map((p) => ({ account: p, prio: p.contributionPriority, id: p.spec.id }))
    .sort(byPrioThenById)
    .map((e) => e.account);
  const withdrawOrder = [...prepared]
    .map((p) => ({ account: p, prio: p.withdrawalPriority, id: p.spec.id }))
    .sort(byPrioThenById)
    .map((e) => e.account);

  const liabilities = params.liabilities.map((l) => ({ spec: l, balance: l.balance }));
  const rows: YearRow[] = [];

  let spendIndex = 1;
  let guardBaseline: number | null = null;
  let prevAssets: number | null = null;
  let buffer = 0;

  for (let i = 1; i <= params.horizonYears; i++) {
    const year = params.startYear + i - 1;

    let investedStart = 0;
    for (const p of prepared) investedStart += p.balance;
    for (const p of prepared) p.balance *= 1 + p.accountReturns[i - 1]!;
    for (const l of liabilities) l.balance *= 1 + l.spec.realRate;
    let investedNow = 0;
    for (const p of prepared) investedNow += p.balance;
    const yearGrowth = investedStart > 1e-9 ? investedNow / investedStart : 1;

    const retired =
      params.spending.retirementStartYear !== null && year >= params.spending.retirementStartYear;
    if (retired && policy.kind === "guardrail") {
      if (guardBaseline === null) guardBaseline = investedStart + cashReserve + buffer;
      else if (prevAssets !== null) {
        if (prevAssets >= guardBaseline * (1 + policy.band)) spendIndex *= 1 + policy.step;
        else if (prevAssets <= guardBaseline * (1 - policy.band)) spendIndex *= 1 - policy.step;
      }
    }
    if (retired && bufferYears > 0) {
      const target = bufferYears * params.spending.annualRetirement;
      if ((year === params.spending.retirementStartYear || yearGrowth >= 1) && buffer < target) {
        let room = target - buffer;
        for (const p of withdrawOrder) {
          if (room <= 0) break;
          const move = Math.min(p.balance, room);
          if (move <= 0) continue;
          p.balance -= move;
          buffer += move;
          room -= move;
        }
      }
    }

    let income = 0;
    let salary = 0;
    for (const s of params.incomeStreams) {
      const amt = incomeInYear(s, year);
      income += amt;
      if (s.kind === "salary") salary += amt;
    }
    const oneOffSpends = params.oneOffSpends.reduce((sum, s) => sum + oneOffInYear(s, year), 0);

    let debtPayments = 0;
    for (const l of liabilities) {
      if (l.balance <= 0) continue;
      const pay = Math.min(l.spec.annualPayment, l.balance);
      l.balance -= pay;
      debtPayments += pay;
    }

    const { annualNow, annualRetirement } = params.spending;
    const spending =
      (retired ? annualRetirement * spendIndex : annualNow) * (params.spendingShocksByYear?.[i - 1] ?? 1);

    const netCashflow = income - spending - oneOffSpends - debtPayments;

    let contributions = 0;
    let employerMatch = 0;
    let withdrawals = 0;
    let unmetSpending = 0;

    if (netCashflow >= 0) {
      let available = netCashflow;
      for (const p of contributeOrder) {
        const planned = p.spec.plannedContribution ?? 0;
        if (planned <= 0 || available <= 0) continue;
        const contrib = Math.min(planned, p.limit, available);
        if (contrib <= 0) continue;
        p.balance += contrib;
        available -= contrib;
        contributions += contrib;
        if (p.match) {
          const cappedBase = Math.min(contrib, p.match.upToShareOfIncome * salary);
          const m = p.match.matchRate * cappedBase;
          p.balance += m;
          employerMatch += m;
        }
      }
      if (available > 0) {
        if (sink) sink.balance += available;
        else cashReserve += available;
      }
    } else {
      let need = -netCashflow;
      if (buffer > 0) {
        const take = Math.min(buffer, need);
        buffer -= take;
        need -= take;
        withdrawals += take;
      }
      if (cashReserve > 0) {
        const take = Math.min(cashReserve, need);
        cashReserve -= take;
        need -= take;
        withdrawals += take;
      }
      for (const p of withdrawOrder) {
        if (need <= 0) break;
        const take = Math.min(p.balance, need);
        if (take <= 0) continue;
        p.balance -= take;
        need -= take;
        withdrawals += take;
      }
      if (need > 1e-9) unmetSpending = need;
    }

    let totalAssets = cashReserve + buffer;
    const accountBalances: Record<string, number> = {};
    for (const p of prepared) {
      accountBalances[p.spec.id] = p.balance;
      totalAssets += p.balance;
    }
    let totalLiabilities = 0;
    for (const l of liabilities) totalLiabilities += Math.max(0, l.balance);

    rows.push({
      year,
      income,
      oneOffSpends,
      debtPayments,
      spending,
      netCashflow,
      contributions,
      employerMatch,
      withdrawals,
      unmetSpending,
      totalAssets,
      totalLiabilities,
      netWorth: totalAssets - totalLiabilities,
      accountBalances,
    });
    prevAssets = totalAssets - 0;
  }

  return { rows };
}
