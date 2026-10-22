// SPDX-License-Identifier: Apache-2.0
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  configureConnection,
  currentSchemaVersion,
  migrate,
  SCHEMA_VERSION,
} from "../src/index.ts";
import { wrapNodeSqlite } from "./nodeAdapter.ts";

describe("migration runner (D4/R5)", () => {
  it("migrates a fresh database to the current version, idempotently", () => {
    const db = wrapNodeSqlite(new DatabaseSync(":memory:"));
    expect(currentSchemaVersion(db)).toBe(0);
    expect(migrate(db)).toBe(SCHEMA_VERSION);
    expect(migrate(db)).toBe(SCHEMA_VERSION);
    const names = db
      .all("SELECT name FROM sqlite_master WHERE type = 'table'")
      .map((r) => r["name"]);
    for (const table of ["persons", "accounts", "goals", "one_off_spends", "assumptions_sets"]) {
      expect(names).toContain(table);
    }
  });

  it("refuses a database from a future app version (never downgrade/corrupt)", () => {
    const db = wrapNodeSqlite(new DatabaseSync(":memory:"));
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    expect(() => migrate(db)).toThrow(/newer than this build/);
  });

  it("enforces CHECK constraints and foreign keys", () => {
    const db = wrapNodeSqlite(new DatabaseSync(":memory:"));
    migrate(db);
    configureConnection(db);
    db.run("INSERT INTO households (id, created_at) VALUES (?, ?)", "h", "2026-01-01T00:00:00Z");
    expect(() =>
      db.run(
        "INSERT INTO persons (id, household_id, name, birth_year, sex) VALUES (?, ?, ?, ?, ?)",
        "p", "h", "X", 1990, "x",
      ),
    ).toThrow(/CHECK constraint/);
    expect(() =>
      db.run(
        "INSERT INTO persons (id, household_id, name, birth_year, sex) VALUES (?, ?, ?, ?, ?)",
        "p", "missing", "X", 1990, "f",
      ),
    ).toThrow(/FOREIGN KEY constraint/);
  });

  it("rolls back a failed migration and leaves the version unchanged", () => {
    const db = wrapNodeSqlite(new DatabaseSync(":memory:"));
    db.exec(
      `CREATE TABLE households (id TEXT PRIMARY KEY, label TEXT, created_at TEXT);
       PRAGMA user_version = 0`,
    );
    // baseline-v1 will fail on the pre-existing households table
    expect(() => migrate(db)).toThrow(/migration v1 .* failed/);
    expect(currentSchemaVersion(db)).toBe(0);
  });
});
