// SPDX-License-Identifier: Apache-2.0
// M4.5 (D13): plan snapshots are self-contained parameter payloads — the
// diff never reads live tables, so snapshots stay comparable forever. The
// payload carries an explicit version (param_version column mirrors it) so a
// future reader can reject shapes it can't interpret.

import { projectPlan, type MarketAssumptions, type ProjectionParams } from "@finplanner/engine";
import type { PlanView } from "./build.ts";

export const PLAN_SNAPSHOT_VERSION = 1;

export interface PlanSnapshotPayload {
  version: number;
  params: ProjectionParams;
  market: MarketAssumptions;
  deathYear: number;
  summary: PlanSnapshotSummary;
}

export interface PlanSnapshotSummary {
  terminal: number;
  runoutYear: number | null;
}

export function captureSnapshotPayload(view: PlanView): PlanSnapshotPayload {
  const params = structuredClone(view.params);
  return {
    version: PLAN_SNAPSHOT_VERSION,
    params,
    market: structuredClone(view.market),
    deathYear: view.deathYear,
    summary: summarizeProjection(params),
  };
}

export function summarizeProjection(params: ProjectionParams): PlanSnapshotSummary {
  const rows = projectPlan(params).rows;
  const runout = rows.find((r) => r.unmetSpending > 0);
  return { terminal: rows[rows.length - 1]!.netWorth, runoutYear: runout?.year ?? null };
}

export function parseSnapshotPayload(planJson: string): PlanSnapshotPayload | { error: string } {
  let payload: PlanSnapshotPayload;
  try {
    payload = JSON.parse(planJson) as PlanSnapshotPayload;
  } catch {
    return { error: "snapshot JSON unreadable" };
  }
  if (payload.version > PLAN_SNAPSHOT_VERSION) {
    return { error: `snapshot written by a newer version (v${payload.version})` };
  }
  if (payload.version !== PLAN_SNAPSHOT_VERSION) {
    return { error: `unsupported snapshot version v${payload.version}` };
  }
  return payload;
}
