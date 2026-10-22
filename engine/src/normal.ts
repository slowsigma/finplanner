// SPDX-License-Identifier: Apache-2.0
import { Xoshiro128ss } from "./rng.ts";

const TWO_PI = 2 * Math.PI;
const MIN_POSITIVE = 1e-300;

export function fillStandardNormals(rng: Xoshiro128ss, out: Float64Array): void {
  const pairs = Math.floor(out.length / 2);
  for (let k = 0; k < pairs; k++) {
    let u1 = rng.nextFloat();
    if (u1 < MIN_POSITIVE) u1 = MIN_POSITIVE;
    const u2 = rng.nextFloat();
    const r = Math.sqrt(-2 * Math.log(u1));
    out[2 * k] = r * Math.cos(TWO_PI * u2);
    out[2 * k + 1] = r * Math.sin(TWO_PI * u2);
  }
  if (out.length % 2 === 1) {
    let u1 = rng.nextFloat();
    if (u1 < MIN_POSITIVE) u1 = MIN_POSITIVE;
    out[out.length - 1] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(TWO_PI * rng.nextFloat());
  }
}
