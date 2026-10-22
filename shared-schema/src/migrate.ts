// SPDX-License-Identifier: Apache-2.0
import type { SqlDatabase } from "./db.ts";
import { requireColumn } from "./db.ts";
import { MIGRATIONS, SCHEMA_VERSION } from "./migrations.ts";

export function currentSchemaVersion(db: SqlDatabase): number {
  return requireColumn(db.get("PRAGMA user_version"), "user_version");
}

/**
 * Forward-only migration runner (D4, R5). Idempotent. Refuses to run against
 * a database newer than this build understands — an old app must never
 * silently corrupt a file written by a newer one.
 */
export function migrate(db: SqlDatabase, target: number = SCHEMA_VERSION): number {
  const from = currentSchemaVersion(db);
  if (from > SCHEMA_VERSION) {
    throw new Error(
      `database schema v${from} is newer than this build understands (v${SCHEMA_VERSION}); update the app`,
    );
  }
  if (target < from) throw new Error(`cannot downgrade from v${from} to v${target}`);
  for (const migration of MIGRATIONS) {
    if (migration.version <= from || migration.version > target) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`migration v${migration.version} (${migration.name}) failed: ${String(error)}`);
    }
  }
  return currentSchemaVersion(db);
}

/** Foreign keys are per-connection in SQLite; every app connection opts in here. */
export function configureConnection(db: SqlDatabase): void {
  db.exec("PRAGMA foreign_keys = ON");
}
