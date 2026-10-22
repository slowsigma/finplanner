// SPDX-License-Identifier: Apache-2.0
// D15: the engine never branches on account-type strings. All US tax-wrapper
// specifics live in this data table, resolved to WrapperRules per account.
// Non-US support later = new presets here + a schema migration, no engine
// logic rewrite. Tax behavior fields (B1.3) will extend WrapperRules.

export type WrapperType =
  | "taxable"
  | "tax_deferred"
  | "tax_free"
  | "hsa"
  | "529"
  | "defined_benefit"
  | "real_estate"
  | "other";

export interface EmployerMatchRule {
  /** Cents matched per employee dollar, e.g. 0.5 = 50c on the dollar. */
  matchRate: number;
  /** Match applies only to contributions up to this share of the year's salary income. */
  upToShareOfIncome: number;
}

export interface WrapperRules {
  type: WrapperType;
  /** Annual employee/owner contribution cap in today's dollars (limits index with
   *  inflation, so they are flat in real terms). Infinity = no cap. Employer
   *  match dollars do not count against this cap (deferral-only limit). */
  employeeContributionLimit: number;
  employerMatch: EmployerMatchRule | null;
  /** Provenance of the numbers; every finite limit needs a sourced value before
   *  beta per PLAN §15 cross-cutting "Validation data" workstream. */
  sourceNote: string;
}

const UNVALIDATED =
  "PLACEHOLDER (2025-era figure, unvalidated) — IRS-sourced value required before beta (PLAN §15, FEATURE_SPEC §14 HSA row)";

export const US_WRAPPER_PRESETS: Readonly<Record<WrapperType, WrapperRules>> = {
  taxable: {
    type: "taxable",
    employeeContributionLimit: Number.POSITIVE_INFINITY,
    employerMatch: null,
    sourceNote: "uncapped by construction",
  },
  tax_deferred: {
    type: "tax_deferred",
    employeeContributionLimit: 23_500,
    employerMatch: null,
    sourceNote: UNVALIDATED,
  },
  tax_free: {
    type: "tax_free",
    employeeContributionLimit: 7_000,
    employerMatch: null,
    sourceNote: UNVALIDATED,
  },
  hsa: {
    type: "hsa",
    employeeContributionLimit: 8_300,
    employerMatch: null,
    sourceNote: `${UNVALIDATED} — family tier; rules validated against IRS sources pending`,
  },
  "529": {
    type: "529",
    employeeContributionLimit: Number.POSITIVE_INFINITY,
    employerMatch: null,
    sourceNote: "no federal dollar limit; per-beneficiary state limits and gift-tax elections out of scope v1",
  },
  defined_benefit: {
    type: "defined_benefit",
    employeeContributionLimit: Number.POSITIVE_INFINITY,
    employerMatch: null,
    sourceNote: "no employee contributions modeled; DB accrual enters as an income stream",
  },
  real_estate: {
    type: "real_estate",
    employeeContributionLimit: Number.POSITIVE_INFINITY,
    employerMatch: null,
    sourceNote: "catch-all contributions (e.g. renovations); mortgage carried in liabilities",
  },
  other: {
    type: "other",
    employeeContributionLimit: Number.POSITIVE_INFINITY,
    employerMatch: null,
    sourceNote: "uncapped catch-all",
  },
};

export function isWrapperType(value: string): value is WrapperType {
  return Object.hasOwn(US_WRAPPER_PRESETS, value);
}

export function wrapperRulesFor(
  type: WrapperType,
  overrides?: Partial<Pick<WrapperRules, "employeeContributionLimit" | "employerMatch">>,
): WrapperRules {
  const base = US_WRAPPER_PRESETS[type];
  return overrides ? { ...base, ...overrides } : { ...base };
}
