// SPDX-License-Identifier: Apache-2.0
// Seedable PRNG per TECH_DECISIONS D9: never Math.random; per-trial streams
// derived from (master seed, trial index) so a single path can be re-sampled.

export function rotl32(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

function mix32(a: number): number {
  a = (a + 0x9e3779b9) | 0;
  let t = a ^ (a >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t = t ^ (t >>> 15);
  t = Math.imul(t, 0x735a2d97);
  return (t ^ (t >>> 15)) >>> 0;
}

export function deriveStreamSeed(masterSeed: number, streamIndex: number): number {
  return mix32((masterSeed ^ Math.imul(streamIndex + 1, 0x85ebca6b)) | 0);
}

export class Xoshiro128ss {
  readonly s: Uint32Array;

  constructor(seed: number) {
    this.s = new Uint32Array(4);
    let a = seed | 0;
    for (let i = 0; i < 4; i++) {
      a = (a + 0x9e3779b9) | 0;
      let t = a ^ (a >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735a2d97);
      this.s[i] = (t ^ (t >>> 15)) >>> 0;
    }
    if ((this.s[0]! | this.s[1]! | this.s[2]! | this.s[3]!) === 0) this.s[0] = 0x9e3779b9;
  }

  nextU32(): number {
    const s = this.s;
    const result = Math.imul(rotl32(Math.imul(s[1]!, 5), 7), 9) >>> 0;
    const t = s[1]! << 9;
    s[2]! ^= s[0]!;
    s[3]! ^= s[1]!;
    s[1]! ^= s[2]!;
    s[0]! ^= s[3]!;
    s[2]! ^= t;
    s[3]! = rotl32(s[3]!, 11);
    return result;
  }

  nextFloat(): number {
    return this.nextU32() * 2 ** -32;
  }
}
