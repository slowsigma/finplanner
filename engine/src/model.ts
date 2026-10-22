// SPDX-License-Identifier: Apache-2.0
// M0 spike model: single household, real (inflation-adjusted) terms,
// static allocation with annual rebalancing, no taxes (FEATURE_SPEC B1.1).

export interface AssetAssumption {
  /** Arithmetic mean annual real return, e.g. 0.075 for 7.5%. */
  meanReal: number;
  /** Annual volatility of log real returns. */
  volReal: number;
  /** Static portfolio weight; all weights must sum to 1. */
  weight: number;
}

export interface SimParams {
  initialBalance: number;
  /** Real terms, year-end, applied during the accumulation phase only. */
  annualContribution: number;
  accumulationYears: number;
  decumulationYears: number;
  /** Real terms, year-end, applied during the decumulation phase only. */
  annualWithdrawal: number;
  assets: readonly AssetAssumption[];
  /** Row-major n×n correlation matrix of real log returns. */
  correlations: readonly number[];
  seed: number;
  trials: number;
}

export interface SimResult {
  trials: number;
  years: number;
  /** Flattened real-terms year-end balances: paths[trial * (years+1) + year]. Year 0 is the initial balance. */
  paths: Float64Array;
}
