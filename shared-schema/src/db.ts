// SPDX-License-Identifier: Apache-2.0
// Minimal SQL surface both runtimes satisfy: node:sqlite's DatabaseSync
// (tests/CI) and @sqlite.org/sqlite-wasm's Db (browser, OPFS-backed, D4).

export type BindValue = string | number | bigint | null | Uint8Array;

export interface SqlDatabase {
  /** Run one or more statements with no bindings (DDL, PRAGMA, BEGIN/COMMIT). */
  exec(sql: string): void;
  /** Run a single statement with bindings. */
  run(sql: string, ...params: BindValue[]): void;
  /** Run a query with bindings and return all rows. */
  all(sql: string, ...params: BindValue[]): Record<string, unknown>[];
  /** Run a query with bindings and return the first row, or undefined. */
  get(sql: string, ...params: BindValue[]): Record<string, unknown> | undefined;
}

export function requireColumn(row: Record<string, unknown> | undefined, column: string): number {
  const value = row?.[column];
  if (typeof value !== "number") throw new Error(`missing numeric column ${column}`);
  return value;
}
