// SPDX-License-Identifier: Apache-2.0
// M3 Monte Carlo over the M2 waterfall (B2.3): every trial drives the exact
// deterministic projectPlan() with per-year sampled real returns — one model,
// two layers of truth (D10 explainability: any trial replays deterministically).
// Antithetic variates via paired streams (B2.8). Seeded per-trial streams (D9).

import type { Bands } from "./metrics.ts";
import { quantileOfSorted, samplingHalfWidth } from "./metrics.ts";
import { controlVariateStats, type CvStat } from "./cv.ts";
import { generateReturns, validateMarket, type MarketAssumptions } from "./market.ts";
import { fillStandardNormals } from "./normal.ts";
import { deriveStreamSeed, Xoshiro128ss } from "./rng.ts";
import { fiNumber, type GoalSpec } from "./goals.ts";
import type { ProjectionParams, ProjectionResult, YearRow } from "./projector.ts";
import { projectPlan } from "./projector.ts";

export interface StressConfig {
  /**
   * Historical real net returns per market class (index 0 = first historical
   * year). Every class of the market used for the window must appear with the
   * same length ≥ windowYears. Data provenance is the app's concern (D13).
   */
  seriesByClass: Readonly<Record<string, readonly number[]>>;
  /** Replay window length in years; also caps the trial horizon. */
  windowYears: number;
  /** "all" = every rolling start (deterministic trial count); "bootstrap" = seeded resample. */
  mode: "all" | "bootstrap";
}

export interface McSimParams {
  projection: ProjectionParams;
  market: MarketAssumptions;
  /** Goals evaluated per trial; retire/FI goals use withdrawalRate. */
  goals: readonly GoalSpec[];
  withdrawalRate: number;
  seed: number;
  trials: number;
  /** Pair trial streams with their negated draws (default true, B2.8). */
  antithetic?: boolean;
  /**
   * Share of retirement spending considered essential (e.g. 0.7). A trial
   * breaches the floor only when unmet spending exceeds the discretionary
   * part, i.e. even cutting all discretionary spend cannot close the gap.
   */
  essentialShare?: number;
  /**
   * Base death calendar year per person under the (unvalidated) expectancy
   * table (B2.5). The trial horizon ends at the LAST sampled survivor death.
   */
  deaths?: readonly number[];
  /**
   * Std-dev years around each person's expectancy per trial (B2.5).
   * 0/undefined keeps the horizon deterministic; ruin past the sampled death
   * year is not counted.
   */
  longevitySdYears?: number;
  /** Annual lognormal spending-shock sigma (B2.7); 0/undefined = none. */
  spendingSigma?: number;
  /** Historical replay (B2.6); replaces iid return draws for the window. */
  stress?: StressConfig;
}

export interface McResult {
  trials: number;
  years: number;
  startYear: number;
  antithetic: boolean;
  /** trial-major year-end net worth, length trials × years. */
  netWorth: Float64Array;
  /** First year with unmet spending per trial, 0 = never. */
  ruinYear: Int32Array;
  /** 1 = essential-spending floor breached. */
  floorBreach: Uint8Array;
  /** trial × goals, 1 = funded. */
  goalFunded: Uint8Array;
  /** trial × goals real-dollar shortfall at assessment point (NaN = n/a). */
  goalShortfall: Float64Array;
  goalIds: readonly string[];
  /**
   * Last planned year per trial (B2.5 sampled death; = horizon end when
   * longevity sampling is off). netWorth entries after it are NaN.
   */
  endYear: Int32Array;
  /** B2.8 control-variate stats (null in stress replay; null when the design is degenerate). */
  terminalCv?: CvStat;
  successCv?: CvStat;
}

function normals(seed: number, streamIndex: number, count: number): Float64Array {
  const rng = new Xoshiro128ss(deriveStreamSeed(seed, streamIndex));
  const out = new Float64Array(count);
  fillStandardNormals(rng, out);
  return out;
}

function rowAt(rows: readonly YearRow[], year: number | null | undefined): YearRow | undefined {
  if (year === null || year === undefined) return undefined;
  return rows.find((r) => r.year === year);
}

export function goalOutcome(
  rows: readonly YearRow[],
  goal: GoalSpec,
  withdrawalRate: number,
): { funded: boolean; shortfall: number } {
  if (goal.kind === "fi") {
    const number = fiNumber(goal.annualRetirementNeed ?? 0, withdrawalRate);
    let funded = false;
    for (let i = 0; i < rows.length; i++) {
      if (rows.slice(i).every((r) => r.netWorth >= number && r.unmetSpending === 0)) {
        funded = true;
        break;
      }
    }
    const peak = rows.reduce((m, r) => Math.max(m, r.netWorth), -Infinity);
    return { funded, shortfall: funded ? 0 : Math.max(0, number - peak) };
  }
  if (goal.targetYear === null || goal.targetYear === undefined) {
    return { funded: false, shortfall: Number.NaN };
  }
  const row = rowAt(rows, goal.targetYear) ?? rows[rows.length - 1];
  const projected = row ? row.netWorth : 0;
  if (goal.targetAmount === null || goal.targetAmount === undefined) {
    return { funded: false, shortfall: Number.NaN };
  }
  const target =
    goal.kind === "retire" && (goal.annualRetirementNeed ?? 0) > 0
      ? (goal.annualRetirementNeed as number) / withdrawalRate
      : goal.targetAmount;
  const shortfall = Math.max(0, target - projected);
  if (shortfall > 0) return { funded: false, shortfall };
  if (goal.kind === "retire") {
    const sustainable = rows.filter((r) => r.year >= goal.targetYear!).every((r) => r.unmetSpending === 0);
    return { funded: sustainable, shortfall: 0 };
  }
  return { funded: true, shortfall: 0 };
}

export interface McTrialRun {
  result: ProjectionResult;
  /** Calendar year of this trial's last planned year (inclusive). */
  endYear: number;
  /** Cumulative log(1+r) per market class over the trial (B2.8 CV design). */
  logGrowth: Float64Array;
  /** Exact expectation of logGrowth under the lognormal model. */
  logGrowthMean: Float64Array;
}

/** Number of rolling starts; also validates coverage/uniformity. */
export function stressWindowCount(stress: StressConfig, market: MarketAssumptions): number {
  let len = -1;
  for (const c of market.classes) {
    const s = stress.seriesByClass[c.name];
    if (!s || s.length === 0) throw new Error(`stress history missing class '${c.name}'`);
    if (len === -1) len = s.length;
    else if (s.length !== len) throw new Error("stress histories must all have the same length");
  }
  if (!Number.isInteger(stress.windowYears) || stress.windowYears < 1) {
    throw new Error("stress windowYears must be a positive integer");
  }
  if (len < stress.windowYears) throw new Error(`history of ${len} years shorter than window ${stress.windowYears}`);
  return len - stress.windowYears + 1;
}

/** Replay a single seeded trial (B2.3 explainability). */
export function simulateMcTrial(p: McSimParams, trial: number): McTrialRun {
  const antithetic = p.antithetic ?? true;
  const streamIndex = antithetic ? trial >> 1 : trial;
  const flip = antithetic ? (trial & 1) === 1 : false;
  const sign = flip ? -1 : 1;
  const horizonEnd = p.projection.startYear + p.projection.horizonYears - 1;
  let endYear = p.stress
    ? Math.min(horizonEnd, p.projection.startYear + p.stress.windowYears - 1)
    : horizonEnd;
  const longevitySd = p.longevitySdYears ?? 0;
  if (p.deaths && p.deaths.length > 0 && longevitySd > 0) {
    const z = normals(p.seed, 9000 + streamIndex, p.deaths.length);
    let survivor = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < p.deaths.length; i++) {
      survivor = Math.max(survivor, Math.round(p.deaths[i]! + longevitySd * z[i]! * sign));
    }
    endYear = Math.min(endYear, Math.max(p.projection.startYear, survivor));
  }
  const yearsTrial = Math.max(1, endYear - p.projection.startYear + 1);
  const sigma = p.spendingSigma ?? 0;
  let shocks: number[] | undefined;
  if (sigma > 0) {
    const x = normals(p.seed, 9100 + streamIndex, yearsTrial);
    shocks = new Array<number>(yearsTrial);
    for (let y = 0; y < yearsTrial; y++) {
      shocks[y] = Math.exp(sigma * x[y]! * sign - 0.5 * sigma * sigma);
    }
  }
  const { byClass } = generateReturns(p.market, p.seed, streamIndex, yearsTrial, flip);
  if (p.stress) {
    const len = p.market.classes.map((c) => p.stress!.seriesByClass[c.name]!.length).reduce((m, l) => Math.min(m, l), Infinity);
    const starts = len - p.stress.windowYears + 1;
    const start =
      p.stress.mode === "all"
        ? trial % starts
        : Math.floor(new Xoshiro128ss(deriveStreamSeed(p.seed, 9200 + streamIndex)).nextFloat() * starts);
    for (const c of p.market.classes) {
      const hist = p.stress.seriesByClass[c.name]!;
      const s = byClass[c.name]!;
      for (let y = 0; y < yearsTrial; y++) s[y] = hist[start + y]!;
    }
  }
  const k = p.market.classes.length;
  const logGrowth = new Float64Array(k);
  const logGrowthMean = new Float64Array(k);
  for (let j = 0; j < k; j++) {
    const c = p.market.classes[j]!;
    const series = byClass[c.name]!;
    let g = 0;
    for (let y = 0; y < yearsTrial; y++) g += Math.log1p(series[y]!);
    logGrowth[j] = g;
    logGrowthMean[j] = yearsTrial * (Math.log1p(c.meanReal) - 0.5 * c.volReal * c.volReal);
  }
  return {
    result: projectPlan({
      ...p.projection,
      horizonYears: yearsTrial,
      assetReturnsByYear: byClass,
      spendingShocksByYear: shocks,
    }),
    endYear,
    logGrowth,
    logGrowthMean,
  };
}

export function simulatePlanMonteCarlo(p: McSimParams): McResult {
  validateMarket(p.market);
  if (!Number.isInteger(p.trials) || p.trials < 1) throw new Error("trials must be a positive integer");
  const stressStarts = p.stress ? stressWindowCount(p.stress, p.market) : 0;
  const antithetic = p.antithetic ?? true;
  const trials = p.stress?.mode === "all" ? stressStarts : p.trials;
  if (antithetic && trials % 2 !== 0) throw new Error("trials must be even when antithetic variates are on");
  const years = p.stress ? Math.min(p.projection.horizonYears, p.stress.windowYears) : p.projection.horizonYears;
  const startYear = p.projection.startYear;
  const maxEnd = startYear + years - 1;
  const result: McResult = {
    trials,
    years,
    startYear,
    antithetic,
    netWorth: new Float64Array(trials * years).fill(Number.NaN),
    ruinYear: new Int32Array(trials),
    floorBreach: new Uint8Array(trials),
    goalFunded: new Uint8Array(trials * p.goals.length),
    goalShortfall: new Float64Array(trials * p.goals.length).fill(Number.NaN),
    goalIds: p.goals.map((g) => g.id),
    endYear: new Int32Array(trials).fill(maxEnd),
  };
  const essentialShare = p.essentialShare ?? 0;
  const k = p.market.classes.length;
  const cvOn = !p.stress && k > 0;
  const design = cvOn ? new Float64Array(trials * k) : new Float64Array(0);
  const designMean = cvOn ? new Float64Array(trials * k) : new Float64Array(0);
  const successIndicator = new Uint8Array(trials);
  for (let t = 0; t < trials; t++) {
    const run = simulateMcTrial(p, t);
    result.endYear[t] = run.endYear;
    if (cvOn) {
      for (let j = 0; j < k; j++) {
        design[t * k + j] = run.logGrowth[j]!;
        designMean[t * k + j] = run.logGrowthMean[j]!;
      }
    }
    const yEnd = run.endYear - startYear + 1;
    for (let y = 0; y < yEnd; y++) {
      const row = run.result.rows[y]!;
      result.netWorth[t * years + y] = row.netWorth;
      if (result.ruinYear[t] === 0 && row.unmetSpending > 1e-9) {
        result.ruinYear[t] = row.year;
        const discretionary = row.spending * (1 - essentialShare);
        if (row.unmetSpending > discretionary + 1e-9) result.floorBreach[t] = 1;
      }
    }
    let allGoals = true;
    for (let g = 0; g < p.goals.length; g++) {
      const outcome = goalOutcome(run.result.rows, p.goals[g]!, p.withdrawalRate);
      result.goalFunded[t * p.goals.length + g] = outcome.funded ? 1 : 0;
      result.goalShortfall[t * p.goals.length + g] = outcome.shortfall;
      if (!outcome.funded) allGoals = false;
    }
    if (result.ruinYear[t] === 0 && allGoals) successIndicator[t] = 1;
  }
  if (cvOn) {
    const terminal = new Float64Array(trials);
    for (let t = 0; t < trials; t++) terminal[t] = result.netWorth[t * years + (result.endYear[t]! - startYear)]!;
    result.terminalCv = controlVariateStats(terminal, trials, design, designMean, k);
    result.successCv = controlVariateStats(successIndicator, trials, design, designMean, k);
  }
  return result;
}

export interface McGoalSummary {
  id: string;
  label: string;
  fundedRate: number;
  halfWidth: number;
  /** Median real-dollar shortfall across trials (0 when funded). */
  medianShortfall: number;
}

export interface McSummary {
  trials: number;
  years: number;
  ruinRate: number;
  ruinHalfWidth: number;
  floorBreachRate: number;
  floorHalfWidth: number;
  /** No ruin AND every goal funded. */
  successRate: number;
  successHalfWidth: number;
  goals: McGoalSummary[];
  /** Fan-chart bands (median + requested quantiles) of year-end net worth. */
  bands: Bands;
}

export function mcSummary(result: McResult, goalLabels?: Readonly<Record<string, string>>, quantiles: readonly number[] = [0.1, 0.25, 0.5, 0.75, 0.9]): McSummary {
  const { trials, years } = result;
  let ruined = 0;
  let floored = 0;
  let success = 0;
  for (let t = 0; t < trials; t++) {
    if (result.ruinYear[t] !== 0) ruined++;
    else if (result.floorBreach[t] !== 0) floored++;
    let allGoals = true;
    for (let g = 0; g < result.goalIds.length; g++) {
      if (result.goalFunded[t * result.goalIds.length + g] === 0) allGoals = false;
    }
    if (result.ruinYear[t] === 0 && allGoals) success++;
  }
  const goals: McGoalSummary[] = result.goalIds.map((id, g) => {
    let funded = 0;
    const shortfalls: number[] = [];
    for (let t = 0; t < trials; t++) {
      if (result.goalFunded[t * result.goalIds.length + g] === 1) funded++;
      const s = result.goalShortfall[t * result.goalIds.length + g]!;
      if (Number.isFinite(s)) shortfalls.push(s);
    }
    shortfalls.sort((a, b) => a - b);
    return {
      id,
      label: goalLabels?.[id] ?? id,
      fundedRate: funded / trials,
      halfWidth: samplingHalfWidth(funded / trials, trials),
      medianShortfall: shortfalls.length > 0 ? quantileOfSorted(Float64Array.from(shortfalls), 0.5) : 0,
    };
  });
  const column: number[] = [];
  const year: number[] = [];
  const byQuantile = quantiles.map(() => new Array<number>(years));
  for (let y = 0; y < years; y++) {
    year.push(result.startYear + y);
    column.length = 0;
    for (let t = 0; t < trials; t++) {
      const v = result.netWorth[t * years + y]!;
      if (Number.isFinite(v)) column.push(v);
    }
    const sorted = Float64Array.from(column).sort();
    for (let qi = 0; qi < quantiles.length; qi++) {
      byQuantile[qi]![y] = sorted.length > 0 ? quantileOfSorted(sorted, quantiles[qi]!) : Number.NaN;
    }
  }
  const ruinRate = ruined / trials;
  const floorBreachRate = floored / trials;
  const successRate = success / trials;
  return {
    trials,
    years,
    ruinRate,
    ruinHalfWidth: samplingHalfWidth(ruinRate, trials),
    floorBreachRate,
    floorHalfWidth: samplingHalfWidth(floorBreachRate, trials),
    successRate,
    successHalfWidth: samplingHalfWidth(successRate, trials),
    goals,
    bands: { year, byQuantile },
  };
}
