// SPDX-License-Identifier: Apache-2.0
// M3 Monte Carlo gates (B2.3, B2.8, D9, D10): seeded determinism, flat-world
// identity vs the deterministic waterfall, antithetic symmetry, statistical
// sanity, monotonicity in savings, and a locked snapshot fixture.

import { describe, expect, it } from "vitest";
import {
  assumptionsHash,
  generateReturns,
  mcSummary,
  projectPlan,
  samplingHalfWidth,
  simulateMcTrial,
  simulatePlanMonteCarlo,
  validateMarket,
  type MarketAssumptions,
  type McSimParams,
  type ProjectionParams,
} from "../src/index.ts";

const START = 2026;

function baseProjection(overrides: Partial<ProjectionParams> = {}): ProjectionParams {
  return {
    startYear: START,
    horizonYears: 20,
    accounts: [
      {
        id: "broker",
        type: "taxable",
        initialBalance: 100_000,
        allocations: [{ assetClass: "us_equity", weight: 1 }],
      },
    ],
    assetReturns: { us_equity: 0.075 },
    incomeStreams: [],
    liabilities: [],
    oneOffSpends: [],
    spending: { annualNow: 0, annualRetirement: 0, retirementStartYear: null },
    ...overrides,
  };
}

function market(volReal: number, meanReal = 0.075): MarketAssumptions {
  return {
    classes: [{ name: "us_equity", meanReal, volReal }],
    correlations: [1],
  };
}

describe("market assumptions", () => {
  it("rejects invalid correlation matrices and params", () => {
    expect(() => validateMarket({ classes: [], correlations: [] })).toThrow();
    expect(() =>
      validateMarket({
        classes: [
          { name: "a", meanReal: 0.05, volReal: 0.1 },
          { name: "b", meanReal: 0.05, volReal: 0.1 },
        ],
        correlations: [1, 2, 2, 1],
      }),
    ).toThrow();
    expect(() => validateMarket(market(-0.1))).toThrow(/volReal/);
  });

  it("hashes assumptions content-order-insensitively", () => {
    const a = assumptionsHash({ x: 1, y: [1, 2], z: { b: 2, a: 1 } });
    const b = assumptionsHash({ z: { a: 1, b: 2 }, y: [1, 2], x: 1 });
    expect(a).toBe(b);
    expect(assumptionsHash({ x: 1 })).not.toBe(a);
  });

  it("antithetic pair is a mirror image of the same stream", () => {
    const m = market(0.2, 0);
    const a = generateReturns(m, 99, 7, 5, false).byClass.us_equity!;
    const aAgain = generateReturns(m, 99, 7, 5, false).byClass.us_equity!;
    const b = generateReturns(m, 99, 7, 5, true).byClass.us_equity!;
    expect(a.join(",")).toBe(aAgain.join(","));
    expect(a.join(",")).not.toBe(b.join(","));
    // Same stream, mirrored noise: growth factors are inverse around the flat path.
    for (let y = 0; y < 5; y++) {
      expect((1 + a[y]!) * (1 + b[y]!)).toBeCloseTo((1 + 0) ** 2 * Math.exp(-0.2 * 0.2), 10);
    }
  });
});

describe("simulatePlanMonteCarlo", () => {
  const params = (over: Partial<McSimParams> = {}): McSimParams => ({
    projection: baseProjection(),
    market: market(0.18),
    goals: [],
    withdrawalRate: 0.04,
    seed: 12345,
    trials: 64,
    ...over,
  });

  it("flat world (vol=0) replays the deterministic projection exactly", () => {
    const projection = baseProjection({
      incomeStreams: [{ id: "s", kind: "salary", annualAmount: 100_000, growthReal: 0, startYear: START }],
      spending: { annualNow: 70_000, annualRetirement: 70_000, retirementStartYear: null },
    });
    const res = simulatePlanMonteCarlo(
      params({ projection, market: market(0), trials: 8 }),
    );
    for (let t = 0; t < 8; t++) {
      const trial = simulateMcTrial(params({ projection, market: market(0), trials: 8 }), t);
      const last = res.netWorth[t * 20 + 19]!;
      expect(Math.abs(last - trial.result.rows[19]!.netWorth)).toBeLessThan(1e-6);
    }
  });

  it("antithetic pairs bracket the deterministic path geometrically", () => {
    const years = 15;
    const vol = 0.18;
    const mean = 0.07;
    const res = simulatePlanMonteCarlo(
      params({
        projection: baseProjection({ horizonYears: years }),
        market: market(vol, mean),
        trials: 2,
      }),
    );
    const a = res.netWorth[years - 1]!;
    const b = res.netWorth[2 * years - 1]!;
    const theory = 100_000 * ((1 + mean) * Math.exp(-0.5 * vol * vol)) ** years;
    expect(Math.sqrt(a * b) / theory).toBeCloseTo(1, 9);
    expect(a).not.toBe(b);
  });

  it("is deterministic per seed and differs across seeds", () => {
    const p = params({ trials: 32 });
    const r1 = simulatePlanMonteCarlo(p);
    const r2 = simulatePlanMonteCarlo(p);
    expect(Array.from(r1.netWorth)).toEqual(Array.from(r2.netWorth));
    const r3 = simulatePlanMonteCarlo({ ...p, seed: 999 });
    expect(Array.from(r3.netWorth.slice(r3.netWorth.length - 32 * 20, r3.netWorth.length - 32 * 20 + 3))).not.toEqual(
      Array.from(r1.netWorth.slice(r1.netWorth.length - 640, r1.netWorth.length - 640 + 3)),
    );
  });

  it("requires even trials when antithetic is on", () => {
    expect(() => simulatePlanMonteCarlo(params({ trials: 7 }))).toThrow(/even/);
    expect(() => simulatePlanMonteCarlo(params({ trials: 7, antithetic: false }))).not.toThrow();
  });

  it("median fan-chart path tracks lognormal theory for pure market growth", () => {
    const years = 40;
    const res = simulatePlanMonteCarlo(
      params({
        projection: baseProjection({ horizonYears: years }),
        market: market(0.2, 0),
        trials: 4000,
      }),
    );
    const summary = mcSummary(res, undefined, [0.5]);
    const theory = 100_000 * (1 + 0) ** years * Math.exp(-0.5 * 0.2 * 0.2 * years);
    expect(summary.bands.byQuantile[0]![years - 1]!).toBeCloseTo(theory, -3);
    expect(Math.abs(summary.bands.byQuantile[0]![years - 1]! / theory - 1)).toBeLessThan(0.06);
    expect(summary.ruinRate).toBe(0);
  });

  it("is trial-wise monotone in savings under common random numbers", () => {
    const richer = params({
      projection: baseProjection({
        accounts: [
          {
            id: "broker",
            type: "taxable",
            initialBalance: 100_000,
            allocations: [{ assetClass: "us_equity", weight: 1 }],
          },
        ],
        incomeStreams: [{ id: "s", kind: "salary", annualAmount: 110_000, growthReal: 0, startYear: START }],
        spending: { annualNow: 50_000, annualRetirement: 50_000, retirementStartYear: null },
      }),
      trials: 200,
    });
    const poorer = params({
      projection: {
        ...richer.projection,
        incomeStreams: [{ id: "s", kind: "salary", annualAmount: 100_000, growthReal: 0, startYear: START }],
      },
      trials: 200,
    });
    const hi = simulatePlanMonteCarlo(richer);
    const lo = simulatePlanMonteCarlo(poorer);
    for (let t = 0; t < 200; t++) {
      expect(hi.netWorth[t * 20 + 19]!).toBeGreaterThanOrEqual(lo.netWorth[t * 20 + 19]! - 1e-6);
    }
    expect(mcSummary(hi).successRate).toBeGreaterThanOrEqual(mcSummary(lo).successRate);
  });

  it("reports goal funding rates and shortfalls", () => {
    const projection = baseProjection({
      incomeStreams: [{ id: "s", kind: "salary", annualAmount: 100_000, growthReal: 0, startYear: START }],
      spending: { annualNow: 50_000, annualRetirement: 50_000, retirementStartYear: null },
    });
    const res = simulatePlanMonteCarlo(
      params({
        projection,
        trials: 200,
        goals: [
          { id: "free", label: "Free", kind: "custom", targetYear: START + 10, targetAmount: 0 },
          { id: "impossible", label: "Impossible", kind: "custom", targetYear: START + 10, targetAmount: 1e12 },
          { id: "mid", label: "Mid", kind: "custom", targetYear: START + 10, targetAmount: 800_000 },
        ],
      }),
    );
    const summary = mcSummary(res, { free: "Free", impossible: "Impossible", mid: "Mid" });
    expect(summary.goals[0]!.fundedRate).toBe(1);
    expect(summary.goals[0]!.medianShortfall).toBe(0);
    expect(summary.goals[1]!.fundedRate).toBe(0);
    expect(summary.goals[1]!.medianShortfall).toBeGreaterThan(0);
    expect(summary.goals[1]!.medianShortfall).toBeLessThan(1e12);
    expect(summary.goals[2]!.fundedRate).toBeGreaterThan(0);
    expect(summary.goals[2]!.fundedRate).toBeLessThan(1);
    expect(summary.successRate).toBe(0);
  });

  it("detects ruin and essential-floor breach under heavy decumulation", () => {
    const projection = baseProjection({
      horizonYears: 60,
      accounts: [
        {
          id: "broker",
          type: "taxable",
          initialBalance: 100_000,
          allocations: [{ assetClass: "us_equity", weight: 1 }],
        },
      ],
      spending: { annualNow: 80_000, annualRetirement: 80_000, retirementStartYear: null },
    });
    const res = simulatePlanMonteCarlo(
      params({ projection, market: market(0.18), trials: 400, essentialShare: 0.7 }),
    );
    const summary = mcSummary(res);
    expect(summary.ruinRate + summary.floorBreachRate).toBeGreaterThan(0.5);
    expect(summary.floorBreachRate).toBeLessThanOrEqual(1 - summary.ruinRate + 1e-12);
    let anyRuin = 0;
    for (let t = 0; t < res.trials; t++) {
      if (res.ruinYear[t] !== 0) {
        anyRuin++;
        expect(res.ruinYear[t]).toBeGreaterThanOrEqual(START);
      }
    }
    expect(anyRuin).toBeGreaterThan(0);
    expect(summary.ruinHalfWidth).toBeCloseTo(samplingHalfWidth(summary.ruinRate, 400), 12);
  });

  it("locks a seeded snapshot (D10: changed numbers must be investigated, not rebased)", () => {
    const res = simulatePlanMonteCarlo(
      params({
        trials: 256,
        projection: baseProjection({
          horizonYears: 50,
          incomeStreams: [{ id: "s", kind: "salary", annualAmount: 120_000, growthReal: 0.01, startYear: START }],
          spending: { annualNow: 60_000, annualRetirement: 55_000, retirementStartYear: START + 25 },
        }),
        goals: [{ id: "g1", label: "Retire at 62", kind: "custom", targetYear: START + 25, targetAmount: 900_000 }],
      }),
    );
    const s = mcSummary(res);
    expect({
      ruinRate: +s.ruinRate.toFixed(4),
      successRate: +s.successRate.toFixed(4),
      goalFundedRate: +s.goals[0]!.fundedRate.toFixed(4),
      p10End: Math.round(s.bands.byQuantile[0]![49]!),
      p50End: Math.round(s.bands.byQuantile[2]![49]!),
      p90End: Math.round(s.bands.byQuantile[4]![49]!),
    }).toMatchInlineSnapshot(`
      {
        "goalFundedRate": 1,
        "p10End": 7592577,
        "p50End": 24175617,
        "p90End": 95420074,
        "ruinRate": 0,
        "successRate": 1,
      }
    `);
  });
});

describe("longevity sampling (B2.5) and spending shocks (B2.7)", () => {
  const base = (over: Partial<McSimParams> = {}): McSimParams => ({
    projection: baseProjection(),
    market: market(0),
    goals: [],
    withdrawalRate: 0.04,
    seed: 777,
    trials: 64,
    ...over,
  });

  it("defaults keep prior behavior: full horizon, no censoring", () => {
    const r = simulatePlanMonteCarlo(base({ trials: 8 }));
    expect(new Set(Array.from(r.endYear))).toEqual(new Set([START + 19]));
    expect(r.netWorth.every(Number.isFinite)).toBe(true);
  });

  it("longevity sd varies trial horizons deterministically and censors netWorth past death", () => {
    const p = base({
      trials: 64,
      projection: baseProjection({ horizonYears: 40 }),
      deaths: [START + 34],
      longevitySdYears: 5,
    });
    const r1 = simulatePlanMonteCarlo(p);
    const r2 = simulatePlanMonteCarlo(p);
    expect(Array.from(r1.endYear)).toEqual(Array.from(r2.endYear));
    expect(new Set(r1.endYear).size).toBeGreaterThan(3);
    expect(Math.min(...r1.endYear)).toBeGreaterThanOrEqual(START);
    expect(Math.max(...r1.endYear)).toBeLessThanOrEqual(START + 39);
    const shortened = Array.from(r1.endYear).findIndex((e) => e < START + 39);
    expect(shortened).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(r1.netWorth[shortened * 40 + 39])).toBe(true);
    expect(Number.isFinite(r1.netWorth[shortened * 40 + (r1.endYear[shortened]! - START)])).toBe(true);
    for (const t of r1.endYear.keys()) {
      if (r1.ruinYear[t] !== 0) expect(r1.ruinYear[t]).toBeLessThanOrEqual(r1.endYear[t]!);
    }
  });

  it("spending shocks change paths deterministically and stay near mean-neutral", () => {
    const projection = baseProjection({
      accounts: [
        { id: "broker", type: "taxable", initialBalance: 2_000_000, allocations: [{ assetClass: "us_equity", weight: 1 }] },
      ],
      spending: { annualNow: 10_000, annualRetirement: 10_000, retirementStartYear: null },
    });
    const silent = simulatePlanMonteCarlo(base({ trials: 8, projection }));
    const shocked = simulatePlanMonteCarlo(base({ trials: 8, projection, spendingSigma: 0.08 }));
    expect(shocked.netWorth[7 * 20 + 19]).not.toBeCloseTo(silent.netWorth[7 * 20 + 19]!, 6);
    expect(Array.from(simulatePlanMonteCarlo(base({ trials: 8, projection, spendingSigma: 0.08 })).netWorth)).toEqual(
      Array.from(shocked.netWorth),
    );

    const many = simulatePlanMonteCarlo(base({ trials: 2000, projection, spendingSigma: 0.08 }));
    const flat = simulatePlanMonteCarlo(base({ trials: 2000, projection }));
    const meanOf = (r: typeof many) => {
      let s = 0;
      for (let t = 0; t < r.trials; t++) s += r.netWorth[t * r.years + r.years - 1]!;
      return s / r.trials;
    };
    expect(Math.abs(meanOf(many) / meanOf(flat) - 1)).toBeLessThan(0.05);
  });

  it("longevity + shocks together still replay a trial via simulateMcTrial", () => {
    const p = base({
      trials: 4,
      deaths: [START + 30],
      longevitySdYears: 4,
      spendingSigma: 0.05,
      projection: baseProjection({ horizonYears: 40 }),
    });
    const r = simulatePlanMonteCarlo(p);
    const trial = simulateMcTrial(p, 3);
    expect(trial.endYear).toBe(r.endYear[3]);
    const lastY = trial.result.rows.length - 1;
    expect(trial.result.rows[lastY]!.netWorth).toBeCloseTo(r.netWorth[3 * 40 + lastY]!, 6);
  });
});

describe("joint spousal longevity (B2.5)", () => {
  const mk = (deaths: readonly number[], sd: number): McSimParams => ({
    projection: baseProjection({ horizonYears: 40 }),
    market: market(0),
    goals: [],
    withdrawalRate: 0.04,
    seed: 4242,
    trials: 64,
    deaths,
    longevitySdYears: sd,
  });

  it("horizon ends at the LAST survivor, not the first death", () => {
    const r = simulatePlanMonteCarlo(mk([START + 25, START + 35], 0.01));
    for (const e of r.endYear) {
      expect(e).toBeGreaterThanOrEqual(START + 34);
      expect(e).toBeLessThanOrEqual(START + 36);
    }
  });

  it("death draws share the antithetic trial stream (mirrored pairs)", () => {
    const r = simulatePlanMonteCarlo(mk([START + 25, START + 35], 6));
    expect(new Set(r.endYear).size).toBeGreaterThan(3);
    expect(Math.max(...r.endYear)).toBeLessThanOrEqual(START + 39);
    // Single survivor keeps the max-operator asymmetry out of the mirror check.
    const antithetic = simulatePlanMonteCarlo({ ...mk([START + 20], 3), antithetic: true });
    for (let pair = 0; pair < 32; pair++) {
      const a = antithetic.endYear[2 * pair]! - (START + 20);
      const b = antithetic.endYear[2 * pair + 1]! - (START + 20);
      expect(a + b).toBeGreaterThanOrEqual(-1);
      expect(a + b).toBeLessThanOrEqual(1);
    }
  });
});

describe("control variates (B2.8)", () => {
  const mk = (vol: number): McSimParams => ({
    projection: baseProjection({
      horizonYears: 40,
      incomeStreams: [{ id: "s", kind: "salary", annualAmount: 100_000, growthReal: 0, startYear: START }],
      spending: { annualNow: 40_000, annualRetirement: 35_000, retirementStartYear: START + 30 },
    }),
    market: market(vol, 0.07),
    goals: [],
    withdrawalRate: 0.04,
    seed: 9001,
    trials: 2000,
  });

  it("shrinks terminal-wealth uncertainty without moving the mean", () => {
    const r = simulatePlanMonteCarlo(mk(0.18));
    const cv = r.terminalCv!;
    expect(cv.varianceRatio).toBeLessThan(0.5);
    expect(cv.adjustedHalfWidth).toBeLessThan(cv.rawHalfWidth * 0.8);
    expect(Math.abs(cv.adjustedMean - cv.rawMean)).toBeLessThan(3 * cv.rawHalfWidth);
    expect(r.successCv!.varianceRatio).toBeLessThanOrEqual(1);
  });

  it("degenerate (flat) design falls back to raw stats", () => {
    const r = simulatePlanMonteCarlo(mk(0));
    const cv = r.terminalCv!;
    expect(cv.adjustedMean).toBeCloseTo(cv.rawMean, 6);
    expect(cv.varianceRatio).toBe(1);
  });
});

describe("stress replay (B2.6)", () => {
  const HISTORY = [-0.09, 0.21, -0.24, 0.03, 0.15, 0.08, -0.14, 0.26, 0.01, -0.06, 0.11, 0.04];
  const stressOf = (mode: "all" | "bootstrap", windowYears: number) => ({
    seriesByClass: { us_equity: HISTORY },
    windowYears,
    mode,
  });
  const mk = (over: Partial<McSimParams> = {}): McSimParams => ({
    projection: baseProjection({ horizonYears: 40 }),
    market: market(0.02, 0.5),
    goals: [],
    withdrawalRate: 0.04,
    seed: 5150,
    trials: 8,
    stress: stressOf("all", 5),
    ...over,
  });

  it("'all' replays every rolling window exactly, ignoring market means", () => {
    const r = simulatePlanMonteCarlo(mk());
    expect(r.trials).toBe(HISTORY.length - 5 + 1);
    expect(r.years).toBe(5);
    expect(new Set(r.endYear)).toEqual(new Set([START + 4]));
    for (let t = 0; t < r.trials; t++) {
      const direct = projectPlan({
        ...mk().projection,
        horizonYears: 5,
        assetReturnsByYear: { us_equity: HISTORY.slice(t, t + 5) },
      });
      expect(r.netWorth[t * 5 + 4]).toBeCloseTo(direct.rows[4]!.netWorth, 6);
    }
    // market mean/vol irrelevant under replay:
    const r2 = simulatePlanMonteCarlo({ ...mk(), market: market(0.2, -0.02) });
    expect(Array.from(r2.netWorth)).toEqual(Array.from(r.netWorth));
  });

  it("bootstrap resamples windows, seeded and reproducible", () => {
    const p = mk({ stress: stressOf("bootstrap", 5), trials: 64 });
    const r1 = simulatePlanMonteCarlo(p);
    const r2 = simulatePlanMonteCarlo(p);
    expect(r1.trials).toBe(64);
    expect(Array.from(r1.netWorth)).toEqual(Array.from(r2.netWorth));
    const distinct = new Set<string>();
    for (let t = 0; t < r1.trials; t++) distinct.add(r1.netWorth.subarray(t * 5, t * 5 + 5).join(","));
    expect(distinct.size).toBeGreaterThan(1);
    expect(distinct.size).toBeLessThanOrEqual(HISTORY.length - 5 + 1);
    expect(r1.terminalCv).toBeUndefined();
  });

  it("validates coverage and window size", () => {
    expect(() =>
      simulatePlanMonteCarlo({ ...mk(), stress: { seriesByClass: { other: HISTORY }, windowYears: 5, mode: "all" } }),
    ).toThrow(/missing class/);
    expect(() => simulatePlanMonteCarlo(mk({ stress: stressOf("all", 20) }))).toThrow(/shorter than window/);
  });
});

describe("sequence-risk score (C3)", () => {
  it("is null when every path succeeds", () => {
    const p: McSimParams = {
      projection: baseProjection(),
      market: market(0.18),
      goals: [],
      withdrawalRate: 0.04,
      seed: 7,
      trials: 128,
      essentialShare: 0,
    };
    const s = mcSummary(simulatePlanMonteCarlo(p));
    expect(s.successRate).toBe(1);
    expect(s.seqRisk).toBeNull();
  });

  it("failures cluster in below-median early markets for a drawdown plan", () => {
    const p: McSimParams = {
      projection: baseProjection({
        horizonYears: 30,
        accounts: [
          { id: "broker", type: "taxable", initialBalance: 150_000, allocations: [{ assetClass: "us_equity", weight: 1 }] },
        ],
        assetReturns: { us_equity: 0.05 },
        spending: { annualNow: 9_000, annualRetirement: 9_000, retirementStartYear: START },
      }),
      market: market(0.28, 0.05),
      goals: [],
      withdrawalRate: 0.04,
      seed: 11,
      trials: 2000,
      essentialShare: 0.7,
    };
    const r = simulatePlanMonteCarlo(p);
    const s = mcSummary(r);
    expect(s.seqRisk).not.toBeNull();
    expect(s.seqRisk!.failedTrials).toBeGreaterThan(20);
    expect(s.seqRisk!.failedTrials).toBeLessThan(r.trials - 20);
    // Without sequence sensitivity the share would hover at 0.5.
    expect(s.seqRisk!.failEarlyShare).toBeGreaterThan(0.6);
    expect(s.seqRisk!.earlyYears).toBe(10);
    const s2 = mcSummary(simulatePlanMonteCarlo(p));
    expect(s2.seqRisk).toEqual(s.seqRisk);
  });
});
