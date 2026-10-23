// SPDX-License-Identifier: Apache-2.0
export { cholesky } from "./cholesky.ts";
export type { AssetAssumption, SimParams, SimResult } from "./model.ts";
export {
  percentileBands,
  quantileOfSorted,
  ruinProbability,
  samplingHalfWidth,
} from "./metrics.ts";
export type { Bands } from "./metrics.ts";
export { fillStandardNormals } from "./normal.ts";
export { deriveStreamSeed, rotl32, Xoshiro128ss } from "./rng.ts";
export { simulatePlan, simulateTrial } from "./simulate.ts";
export {
  isWrapperType,
  US_WRAPPER_PRESETS,
  wrapperRulesFor,
} from "./wrappers.ts";
export type { EmployerMatchRule, WrapperRules, WrapperType } from "./wrappers.ts";
export { projectPlan } from "./projector.ts";
export { assessGoal, assessGoals, fiAssessment, fiNumber, requiredAnnualSavings } from "./goals.ts";
export type { FiAssessment, GoalAssessment, GoalKind, GoalSpec } from "./goals.ts";
export type { AccountAllocation,
  AccountSpec,
  IncomeKind,
  IncomeStreamSpec,
  LiabilitySpec,
  OneOffSpendSpec,
  ProjectionParams,
  ProjectionResult,
  SpendingSpec,
  WithdrawalPolicy,
  YearRow,
} from "./projector.ts";
export { assumptionsHash, canonicalJson, fnv1aHex, generateReturns, validateMarket } from "./market.ts";
export type { AssetClassAssumption, MarketAssumptions, TrialReturnSet } from "./market.ts";
export { goalOutcome, mcSummary, SEQUENCE_YEARS, simulateMcTrial, simulatePlanMonteCarlo, stressWindowCount } from "./mcsim.ts";
export type { McGoalSummary, McResult, McSeqRisk, McSimParams, McSummary, McTrialRun, StressConfig } from "./mcsim.ts";
export { ssClaimFactor } from "./ss.ts";
export { controlVariateStats } from "./cv.ts";
export type { CvStat } from "./cv.ts";
