// SPDX-License-Identifier: Apache-2.0
// Social Security claiming factors (B2.4/D4) vs statutory reduction/increase
// schedule at FRA 67.

import { describe, expect, it } from "vitest";
import { ssClaimFactor } from "../src/index.ts";

describe("ssClaimFactor", () => {
  it("matches the statutory schedule", () => {
    expect(ssClaimFactor(67)).toBeCloseTo(1, 10);
    expect(ssClaimFactor(62)).toBeCloseTo(0.7, 10);
    expect(ssClaimFactor(70)).toBeCloseTo(1.24, 10);
    expect(ssClaimFactor(65)).toBeCloseTo(1 - (24 * 5) / 9 / 100, 10);
    expect(ssClaimFactor(69)).toBeCloseTo(1 + (24 * 2) / 300, 10);
  });

  it("honors an alternate FRA", () => {
    expect(ssClaimFactor(70, 66)).toBeCloseTo(1 + (48 * 2) / 300, 10);
  });

  it("rejects claiming ages outside 62–70", () => {
    expect(() => ssClaimFactor(61)).toThrow(/62–70/);
    expect(() => ssClaimFactor(71)).toThrow(/62–70/);
  });
});
