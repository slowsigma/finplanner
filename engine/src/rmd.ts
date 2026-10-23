// SPDX-License-Identifier: Apache-2.0
/**
 * Required Minimum Distribution rules (G2 golden-fixture anchor).
 *
 * Sourced from IRS Publication 590-B (2025 edition, for use in preparing
 * 2025 returns), Appendix B Table III "Uniform Lifetime", fetched 2026-10-23
 * from https://www.irs.gov/publications/p590b — see
 * shared-schema/src/assumptions.ts for the content hash + provenance entry.
 * The age-75 start for people born in 1960 or later is SECURE 2.0 Act §107
 * statute (first applies for 2035 distributions); Pub 590-B (2025 ed) itself
 * still describes only the age-73 rule.
 */

export interface RmdBasis {
  /** Account balance as of Dec 31 of the prior year. */
  balance: number;
  /** Age as of your birthday in the distribution year. */
  age: number;
}

/** Table III (Uniform Lifetime) applicable denominators, ages 72–119. */
export const UNIFORM_LIFETIME_DENOMINATORS: Readonly<Record<number, number>> = Object.freeze({
  72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1,
  80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4,
  88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9,
  96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4, 101: 6.0, 102: 5.6, 103: 5.2,
  104: 4.9, 105: 4.6, 106: 4.3, 107: 4.1, 108: 3.9, 109: 3.7, 110: 3.5, 111: 3.4,
  112: 3.3, 113: 3.1, 114: 3.0, 115: 2.9, 116: 2.8, 117: 2.7, 118: 2.5, 119: 2.3,
});

export const RMD_TAIL_DENOMINATOR = 2.0; // age 120 and over

export function uniformLifetimeDenominator(age: number): number {
  if (!Number.isInteger(age) || age < 72) throw new Error(`no RMD denominator below age 72 (got ${age})`);
  return UNIFORM_LIFETIME_DENOMINATORS[age] ?? RMD_TAIL_DENOMINATOR;
}

/** Required minimum distribution: prior-year-end balance ÷ applicable denominator. */
export function requiredMinimumDistribution({ balance, age }: RmdBasis): number {
  if (!(balance >= 0)) throw new Error(`RMD balance must be >= 0 (got ${balance})`);
  return balance / uniformLifetimeDenominator(age);
}

/**
 * First year RMDs are *required* to begin, by birth year:
 * - born ≤ 1950: legacy rules vary (70½–72); we return the 72 upper bound.
 * - born 1951–1959: age 73 — sourced from Pub 590-B (2025 ed).
 * - born ≥ 1960: age 75 — SECURE 2.0 §107.
 */
export function rmdRequiredBeginningAge(birthYear: number): 72 | 73 | 75 {
  if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > 2100) {
    throw new Error(`implausible birth year ${birthYear}`);
  }
  if (birthYear <= 1950) return 72;
  if (birthYear <= 1959) return 73;
  return 75;
}
