// SPDX-License-Identifier: Apache-2.0
// Gate G0 (PLAN.md): 10k trials × 60 yrs × 6 asset classes in < 500 ms —
// the D2 benchmark gate (3x margin under R1). Also prints fan-chart bands
// as the M0 debug output (FEATURE_SPEC §13 step 1).

import { mkdirSync, writeFileSync } from "node:fs";
import { percentileBands, ruinProbability, samplingHalfWidth } from "../src/metrics.ts";
import type { SimParams } from "../src/model.ts";
import { simulatePlan } from "../src/simulate.ts";

const params: SimParams = {
  initialBalance: 250_000,
  annualContribution: 20_000,
  accumulationYears: 35,
  decumulationYears: 25,
  annualWithdrawal: 90_000,
  assets: [
    { meanReal: 0.075, volReal: 0.17, weight: 0.30 }, // US equity
    { meanReal: 0.075, volReal: 0.19, weight: 0.15 }, // intl equity
    { meanReal: 0.080, volReal: 0.21, weight: 0.05 }, // EM equity
    { meanReal: 0.015, volReal: 0.06, weight: 0.25 }, // corp bonds
    { meanReal: 0.012, volReal: 0.07, weight: 0.15 }, // TIPS
    { meanReal: 0.060, volReal: 0.19, weight: 0.10 }, // REITs
  ],
  correlations: [
    1.0, 0.9, 0.85, 0.10, 0.15, 0.5,
    0.9, 1.0, 0.80, 0.10, 0.15, 0.45,
    0.85, 0.8, 1.0, 0.05, 0.10, 0.45,
    0.1, 0.1, 0.05, 1.0, 0.80, 0.20,
    0.15, 0.15, 0.1, 0.8, 1.0, 0.20,
    0.5, 0.45, 0.45, 0.2, 0.2, 1.0,
  ],
  seed: 1,
  trials: 10_000,
};

const { trials, ...base } = params;
const N = trials;
console.log(`G0: ${N.toLocaleString()} trials × 60 yrs × 6 asset classes`);

// warmup (JIT)
simulatePlan({ ...base, trials: 500 });

const runs: number[] = [];
for (let i = 0; i < 5; i++) {
  const start = performance.now();
  const result = simulatePlan(params);
  runs.push(performance.now() - start);
  if (i === 4) {
    const quantiles = [0.05, 0.5, 0.95];
    const bands = percentileBands(result, quantiles);
    mkdirSync(new URL("../out/", import.meta.url), { recursive: true });
    const rows = ["year,p05,p50,p95"];
    for (let y = 0; y <= result.years; y++) {
      rows.push(`${y},${bands.byQuantile[0]![y]!.toFixed(2)},${bands.byQuantile[1]![y]!.toFixed(2)},${bands.byQuantile[2]![y]!.toFixed(2)}`);
    }
    writeFileSync(new URL("../out/fan.csv", import.meta.url), rows.join("\n") + "\n");
    const ruin = ruinProbability(result);
    const ci = samplingHalfWidth(ruin, N);
    const last = result.years;
    console.log(`  terminal real wealth P5/P50/P95: ${bands.byQuantile[0]![last]!.toFixed(0)} / ${bands.byQuantile[1]![last]!.toFixed(0)} / ${bands.byQuantile[2]![last]!.toFixed(0)}`);
    console.log(`  ruin probability: ${(ruin * 100).toFixed(1)}% ± ${(ci * 100).toFixed(1)}%`);
    console.log(`  fan bands written to out/fan.csv`);
  }
}

const min = Math.min(...runs);
const median = runs.slice().sort((a, b) => a - b)[Math.floor(runs.length / 2)]!;
console.log(`  ms per run: min ${min.toFixed(1)}, median ${median.toFixed(1)}`);
console.log(`  [${min.toFixed(0)} ms] ${min < 500 ? "PASS" : "FAIL"} — G0 threshold 500 ms (note: CI must re-run this on a throttled mid-range phone profile per D2/D11)`);
process.exitCode = min < 500 ? 0 : 1;
