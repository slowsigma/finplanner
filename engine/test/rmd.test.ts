// SPDX-License-Identifier: Apache-2.0
// G2 golden fixtures for RMD math — numbers taken directly from worked
// examples in IRS Pub 590-B (2025 ed) (see engine/src/rmd.ts provenance).
import { describe, expect, it } from "vitest";
import {
  rmdRequiredBeginningAge,
  requiredMinimumDistribution,
  uniformLifetimeDenominator,
} from "../src/rmd.ts";

describe("Pub 590-B golden examples", () => {
  it("matches the $100,000 at age 75 example ($4,065)", () => {
    expect(uniformLifetimeDenominator(75)).toBe(24.6);
    expect(requiredMinimumDistribution({ balance: 100_000, age: 75 })).toBeCloseTo(4_065.04, 2);
  });

  it("matches Justin: $38,400 at 73 -> $1,450; $34,800 -> $1,313", () => {
    expect(requiredMinimumDistribution({ balance: 38_400, age: 73 })).toBeCloseTo(1_449.06, 2);
    expect(requiredMinimumDistribution({ balance: 34_800, age: 73 })).toBeCloseTo(1_313.21, 2);
  });

  it("table endpoints and tail: 72 -> 27.4, 115 -> 2.9, 130 -> 2.0", () => {
    expect(uniformLifetimeDenominator(72)).toBe(27.4);
    expect(uniformLifetimeDenominator(115)).toBe(2.9);
    expect(uniformLifetimeDenominator(119)).toBe(2.3);
    expect(uniformLifetimeDenominator(130)).toBe(2.0);
    expect(() => uniformLifetimeDenominator(71)).toThrow(/below age 72/);
    expect(() => requiredMinimumDistribution({ balance: -1, age: 75 })).toThrow();
  });
});

describe("required beginning age", () => {
  it("1950 legacy cap -> 72; 1951–1959 -> 73 (Pub 590-B); 1960+ -> 75 (SECURE 2.0)", () => {
    expect(rmdRequiredBeginningAge(1948)).toBe(72);
    expect(rmdRequiredBeginningAge(1955)).toBe(73);
    expect(rmdRequiredBeginningAge(1959)).toBe(73);
    expect(rmdRequiredBeginningAge(1960)).toBe(75);
    expect(rmdRequiredBeginningAge(1988)).toBe(75);
    expect(() => rmdRequiredBeginningAge(1899)).toThrow();
  });
});
