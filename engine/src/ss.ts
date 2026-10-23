// SPDX-License-Identifier: Apache-2.0

/**
 * Social Security claiming adjustment (B2.4/D4). Multiplier on the
 * primary insurance amount (PIA at full retirement age) for claiming at a
 * given age, using the statutory reductions/increases: −5/9 of 1% per month
 * up to 36 months early, −5/12 of 1% per month beyond that (floor age 62),
 * and +2/3 of 1% per month delayed past FRA up to age 70.
 */
export function ssClaimFactor(claimAge: number, fraAge = 67): number {
  if (claimAge < 62 || claimAge > 70) throw new Error(`claim age ${claimAge} outside 62–70`);
  const months = Math.round((claimAge - fraAge) * 12);
  if (months >= 0) return 1 + (Math.min(months, (70 - fraAge) * 12) * 2) / 300;
  const early = -months;
  const cut = (Math.min(early, 36) * 5) / 9 / 100 + (Math.max(early - 36, 0) * 5) / 12 / 100;
  return 1 - cut;
}
