// SPDX-License-Identifier: Apache-2.0
// M4.5 (D13): snapshot payload versioning + structural diff helpers.
import { describe, expect, it } from "vitest";
import { diffFlattened, flattenLeaves } from "../src/plan/diff.ts";
import { PLAN_SNAPSHOT_VERSION, parseSnapshotPayload } from "../src/plan/snapshot.ts";

describe("flattenLeaves", () => {
  it("keeps nested scalars at dotted/bracketed paths; empty containers vanish", () => {
    expect(flattenLeaves({ a: { b: 1 }, list: [], obj: {} })).toEqual({ "a.b": 1 });
  });
});

describe("diffFlattened", () => {
  const params = {
    startYear: 2026,
    accounts: [{ id: "x", balance: 100_000, label: "401k" }],
    streams: [],
  };

  it("reports only genuinely changed paths", () => {
    const changed = structuredClone(params);
    changed.accounts[0]!.balance = 90_000;
    const d = diffFlattened(params, changed);
    expect(d.map((e) => e.path)).toEqual(["accounts[0].balance"]);
    expect(d[0]).toMatchObject({ before: 100_000, after: 90_000 });
  });

  it("shows added array items as present-vs-absent", () => {
    const added = structuredClone(params);
    added.streams.push({ label: "Consulting", annual_amount: 10_000 });
    const d = diffFlattened(params, added);
    expect(d.map((e) => e.path)).toEqual(["streams[0].annual_amount", "streams[0].label"]);
    expect(d[0]).toMatchObject({ before: undefined, after: 10_000 });
  });

  it("added keys inside containers appear as absent-to-value, identical trees diff empty", () => {
    const d = diffFlattened({ x: {} }, { x: { a: 1 } });
    expect(d.map((e) => e.path)).toEqual(["x.a"]);
    expect(diffFlattened({ x: { a: 1 } }, { x: { a: 1 } })).toEqual([]);
  });
});

describe("parseSnapshotPayload", () => {
  it("rejects garbage and future payloads without crashing the diff UI", () => {
    expect(parseSnapshotPayload("nope{").error).toMatch(/unreadable/);
    const future = JSON.stringify({ version: PLAN_SNAPSHOT_VERSION + 1 });
    expect(parseSnapshotPayload(future).error).toMatch(/newer version/);
    expect(parseSnapshotPayload(JSON.stringify({ version: 0 })).error).toMatch(/unsupported/);
  });
});
