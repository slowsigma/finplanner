// SPDX-License-Identifier: Apache-2.0
// Lower-triangular Cholesky factor of a symmetric positive-definite
// (correlation) matrix stored row-major in a flat Float64Array.

export function cholesky(matrix: Float64Array, n: number): Float64Array {
  if (matrix.length !== n * n) throw new Error(`expected ${n * n} entries, got ${matrix.length}`);
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = matrix[i * n + j]!;
      for (let k = 0; k < j; k++) sum -= L[i * n + k]! * L[j * n + k]!;
      if (i === j) {
        if (sum <= 0) throw new Error(`matrix is not positive definite at index ${i}`);
        L[i * n + i] = Math.sqrt(sum);
      } else {
        L[i * n + j] = sum / L[j * n + j]!;
      }
    }
  }
  return L;
}
