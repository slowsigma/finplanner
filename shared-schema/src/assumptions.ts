// SPDX-License-Identifier: Apache-2.0
/**
 * Provenance registry for every shipped model input (D3: the app is offline,
 * so each default set is frozen here with its source, fetch date, and content
 * hash — "where did this number come from" is answerable without network).
 * status: sourced = fetched + hashed; unverified = plausible from memory,
 * fetch blocked; placeholder = deliberate stand-in awaiting a real series.
 */

export interface AssumptionProvenance {
  id: string;
  label: string;
  status: "sourced" | "unverified" | "placeholder";
  /** Publication or dataset the values were taken from. */
  source: string;
  publicationYear: number | null;
  fetchedAt: string | null;
  contentSha256: string | null;
  note: string;
}

export const IRS_PUB590B_2025 = {
  id: "irs-pub590b-2025",
  label: "RMD start ages + Uniform Lifetime Table (engine/src/rmd.ts)",
  status: "sourced",
  source: "https://www.irs.gov/publications/p590b",
  publicationYear: 2025,
  fetchedAt: "2026-10-23",
  contentSha256: "361386571606add619496df52587dc0c5393965732db66a465f88b84607e601d",
  note:
    "Pub 590-B (2025 ed, for 2025 returns); contentSha256 covers the fetched " +
    "text rendering, not the agency PDF. Age-75 start for birth years ≥ 1960 is " +
    "SECURE 2.0 §107 statute, not restated in this edition.",
} satisfies AssumptionProvenance;

export const SSA_OACT_2026 = {
  id: "ssa-oact-2026",
  label: "SSA AWE / taxable maximum / COLA dollar constants",
  status: "unverified",
  source: "https://www.ssa.gov/oact/cola/ (HTTP 403 from the build environment, incl. web-proxy path)",
  publicationYear: null,
  fetchedAt: null,
  contentSha256: null,
  note:
    "engine/src/ss.ts uses only the statutory 90/32/15 PIA factors and the FRA " +
    "table (law, not data) so no unverified dollar constants ship. Re-fetch at " +
    "G2 refresh; record COLA/AWE/taxable-max as sourced entries then.",
} satisfies AssumptionProvenance;

export const MARKET_1970_2024_PLACEHOLDER = {
  id: "market-us-1970-2024-placeholder",
  label: "DEFAULT_ASSUMPTIONS real-return/volatility set (app/src/plan/build.ts)",
  status: "placeholder",
  source: "none — from-memory values pending a fetched 1970–2024 US series",
  publicationYear: null,
  fetchedAt: null,
  contentSha256: null,
  note:
    "Labeled as unvalidated in-app (assumptions.note surfaces on every plan). " +
    "Bengen/Trinity golden fixtures stay blocked until this set is sourced.",
} satisfies AssumptionProvenance;

export const ASSUMPTION_PROVENANCE: readonly AssumptionProvenance[] = Object.freeze([
  IRS_PUB590B_2025,
  SSA_OACT_2026,
  MARKET_1970_2024_PLACEHOLDER,
]);
