// SPDX-License-Identifier: Apache-2.0
import { cholesky } from "./cholesky.ts";
import type { SimParams, SimResult } from "./model.ts";
import { fillStandardNormals } from "./normal.ts";
import { deriveStreamSeed, Xoshiro128ss } from "./rng.ts";

interface EngineState {
  params: SimParams;
  n: number;
  years: number;
  stride: number;
  L: Float64Array;
  mean: Float64Array;
  vol: Float64Array;
  w: Float64Array;
}

function prepare(params: SimParams): EngineState {
  const n = params.assets.length;
  if (n === 0) throw new Error("at least one asset class required");
  if (params.correlations.length !== n * n) {
    throw new Error(`correlations must have ${n * n} entries, got ${params.correlations.length}`);
  }
  if (!Number.isInteger(params.accumulationYears) || !Number.isInteger(params.decumulationYears)) {
    throw new Error("year counts must be integers");
  }
  const mean = new Float64Array(n);
  const vol = new Float64Array(n);
  const w = new Float64Array(n);
  let weightSum = 0;
  for (let i = 0; i < n; i++) {
    const a = params.assets[i]!;
    mean[i] = a.meanReal;
    vol[i] = a.volReal;
    w[i] = a.weight;
    weightSum += a.weight;
  }
  if (Math.abs(weightSum - 1) > 1e-9) throw new Error(`weights must sum to 1, got ${weightSum}`);
  return {
    params,
    n,
    years: params.accumulationYears + params.decumulationYears,
    stride: params.accumulationYears + params.decumulationYears + 1,
    L: cholesky(Float64Array.from(params.correlations), n),
    mean,
    vol,
    w,
  };
}

function runTrial(state: EngineState, trial: number, out: Float64Array): void {
  const { params, n, years, stride, L, mean, vol, w } = state;
  const rng = new Xoshiro128ss(deriveStreamSeed(params.seed, trial));
  const z = new Float64Array(n);
  const bal = new Float64Array(n);
  for (let i = 0; i < n; i++) bal[i] = params.initialBalance * w[i]!;
  out[0] = params.initialBalance;
  for (let y = 1, base = 1; y <= years; y++, base++) {
    fillStandardNormals(rng, z);
    let total = 0;
    for (let i = 0; i < n; i++) {
      let corr = 0;
      const row = i * n;
      for (let j = 0; j <= i; j++) corr += L[row + j]! * z[j]!;
      const v = vol[i]!;
      bal[i] = bal[i]! * (1 + mean[i]!) * Math.exp(v * corr - 0.5 * v * v);
      total += bal[i]!;
    }
    total += y <= params.accumulationYears ? params.annualContribution : -params.annualWithdrawal;
    if (total <= 0) {
      out.fill(0, base, stride);
      return;
    }
    for (let i = 0; i < n; i++) bal[i] = total * w[i]!;
    out[base] = total;
  }
}

export function simulatePlan(params: SimParams): SimResult {
  const state = prepare(params);
  if (params.trials < 1) throw new Error("trials must be >= 1");
  const paths = new Float64Array(params.trials * state.stride);
  const scratch = new Float64Array(state.stride);
  for (let t = 0; t < params.trials; t++) {
    const offset = t * state.stride;
    runTrial(state, t, scratch);
    paths.set(scratch, offset);
  }
  return { trials: params.trials, years: state.years, paths };
}

/** Re-simulate a single trial path (D9 debug/explainability feature: inspect any one path). */
export function simulateTrial(params: SimParams, trial: number): Float64Array {
  const state = prepare(params);
  const out = new Float64Array(state.stride);
  runTrial(state, trial, out);
  return out;
}
