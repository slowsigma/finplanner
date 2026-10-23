// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { ASSUMPTION_PROVENANCE } from "../src/assumptions.ts";

describe("assumption provenance registry", () => {
  it("every entry is fully labeled with a unique id", () => {
    const ids = ASSUMPTION_PROVENANCE.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of ASSUMPTION_PROVENANCE) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.source.length).toBeGreaterThan(0);
      expect(p.note.length).toBeGreaterThan(0);
      if (p.status === "sourced") {
        expect(p.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(p.contentSha256).toMatch(/^[0-9a-f]{64}$/);
      } else {
        expect(p.contentSha256).toBeNull();
      }
    }
  });

  it("exactly one sourced set today; everything else is honestly flagged", () => {
    const sourced = ASSUMPTION_PROVENANCE.filter((p) => p.status === "sourced");
    expect(sourced.map((p) => p.id)).toEqual(["irs-pub590b-2025"]);
  });
});
