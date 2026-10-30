// SPDX-License-Identifier: Apache-2.0
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  configureConnection,
  currentSchemaVersion,
  migrate,
  MIGRATIONS,
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

  it("upgrades an old v1 export without losing data (R5 backup compatibility)", () => {
    const db = wrapNodeSqlite(new DatabaseSync(":memory:"));
    db.exec(MIGRATIONS[0]!.sql);
    db.exec("PRAGMA user_version = 1");
    db.run("INSERT INTO households (id, label, created_at) VALUES (?, ?, ?)", "h1", "Old", "2026-01-01T00:00:00Z");
    db.run(
      "INSERT INTO persons (id, household_id, name, birth_year, sex) VALUES (?, ?, ?, ?, ?)",
      "p1", "h1", "Alex", 1988, "f",
    );
    db.run(
      "INSERT INTO accounts (id, person_id, label, type, balance, as_of_date) VALUES (?, ?, ?, ?, ?, ?)",
      "a1", "p1", "401k", "tax_deferred", 100_000, "2026-01-01",
    );
    expect(migrate(db)).toBe(SCHEMA_VERSION);
    expect(currentSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(db.get("SELECT label FROM households WHERE id = ?", "h1")?.["label"]).toBe("Old");
    expect(db.get("SELECT balance FROM accounts WHERE id = ?", "a1")?.["balance"]).toBe(100_000);
    const accountColumns = db.all("PRAGMA table_info(accounts)").map((r) => r["name"]);
    expect(accountColumns).toContain("planned_contribution");
    const names = db.all("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r["name"]);
    expect(names).toContain("tou_acceptance");
    expect(names).toContain("plan_snapshots");
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
