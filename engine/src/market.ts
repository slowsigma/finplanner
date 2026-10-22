// SPDX-License-Identifier: Apache-2.0
// Capital-market assumption sets (B2.2, D9/R3): named real-return classes with
// volatility + correlation matrix, plus a content hash so every stored
// scenario run pins the exact assumption version it was produced with.
// Returns are lognormal on real terms — same convention as the M0 spike:
//   growth factor = (1 + meanReal) * exp(vol*z - vol²/2)
// so mean of the real *log* return equals log(1 + meanReal) - v²/2.

import { cholesky } from "./cholesky.ts";
import { fillStandardNormals } from "./normal.ts";
import { deriveStreamSeed, Xoshiro128ss } from "./rng.ts";

export interface AssetClassAssumption {
  name: string;
  /** Arithmetic mean annual real return, e.g. 0.075. */
  meanReal: number;
  /** Volatility of the annual real *log* return, e.g. 0.17. */
  volReal: number;
}

export interface MarketAssumptions {
  classes: readonly AssetClassAssumption[];
  /** Row-major n×n correlation matrix of real log returns. */
  correlations: readonly number[];
}

export function validateMarket(market: MarketAssumptions): void {
  const n = market.classes.length;
  if (n === 0) throw new Error("at least one asset class required");
  if (market.correlations.length !== n * n) {
    throw new Error(`correlations must have ${n * n} entries, got ${market.correlations.length}`);
  }
  const names = new Set<string>();
  for (const c of market.classes) {
    if (names.has(c.name)) throw new Error(`duplicate asset class '${c.name}'`);
    names.add(c.name);
    if (!Number.isFinite(c.meanReal) || c.meanReal <= -1) {
      throw new Error(`class ${c.name}: meanReal must be > -1, got ${c.meanReal}`);
    }
    if (!Number.isFinite(c.volReal) || c.volReal < 0) {
      throw new Error(`class ${c.name}: volReal must be >= 0, got ${c.volReal}`);
    }
  }
  cholesky(Float64Array.from(market.correlations), n);
}

/** Canonical JSON: object keys sorted, so hashes are order-stable. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(",")}}`;
}

/** FNV-1a 64-bit-ish hash (two 32-bit lanes) rendered as 16 hex chars. */
export function fnv1aHex(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = (Math.imul(h2 + c, 0x85ebca6b) ^ (h2 >>> 13)) | 0;
  }
  return ((h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0")).slice(0, 16);
}

/** Content hash of any assumption payload — store with every scenario run (R3). */
export function assumptionsHash(assumptions: unknown): string {
  return fnv1aHex(canonicalJson(assumptions));
}

export interface TrialReturnSet {
  /** Per-class real returns, index 0 = first projection year. */
  byClass: Record<string, number[]>;
}

/**
 * One trial's correlated annual real returns. Antithetic variates (B2.8):
 * pass the same streamIndex twice with opposite `flip` to draw paired paths.
 */
export function generateReturns(
  market: MarketAssumptions,
  seed: number,
  streamIndex: number,
  years: number,
  flip = false,
): TrialReturnSet {
  validateMarket(market);
  const n = market.classes.length;
  const L = cholesky(Float64Array.from(market.correlations), n);
  const rng = new Xoshiro128ss(deriveStreamSeed(seed, streamIndex));
  const z = new Float64Array(n);
  const byClass: Record<string, number[]> = {};
  for (const c of market.classes) byClass[c.name] = new Array<number>(years);
  for (let y = 0; y < years; y++) {
    fillStandardNormals(rng, z);
    for (let i = 0; i < n; i++) {
      const c = market.classes[i]!;
      let corr = 0;
      const row = i * n;
      for (let j = 0; j <= i; j++) corr += L[row + j]! * z[j]!;
      if (flip) corr = -corr;
      const v = c.volReal;
      byClass[c.name]![y] = (1 + c.meanReal) * Math.exp(v * corr - 0.5 * v * v) - 1;
    }
  }
  return { byClass };
}
