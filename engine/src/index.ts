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
export type {
  AccountAllocation,
  AccountSpec,
  IncomeKind,
  IncomeStreamSpec,
  LiabilitySpec,
  OneOffSpendSpec,
  ProjectionParams,
  ProjectionResult,
  SpendingSpec,
  YearRow,
} from "./projector.ts";
