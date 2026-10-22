// SPDX-License-Identifier: Apache-2.0
import type { DatabaseSync } from "node:sqlite";
import type { BindValue, SqlDatabase } from "../src/index.ts";

type Arg = string | number | bigint | null | Uint8Array;

export function wrapNodeSqlite(db: DatabaseSync): SqlDatabase {
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, ...params: BindValue[]) => {
      db.prepare(sql).run(...(params as Arg[]));
    },
    all: (sql, ...params: BindValue[]) =>
      (db.prepare(sql).all(...(params as Arg[])) as object[]).map((r) => ({ ...r })),
    get: (sql, ...params: BindValue[]) => {
      const row = db.prepare(sql).get(...(params as Arg[])) as object | undefined;
      return row ? { ...row } : undefined;
    },
  };
}

export const TABLES = [
  "meta",
  "households",
  "persons",
  "accounts",
  "account_allocations",
  "liabilities",
  "income_streams",
  "spending_profiles",
  "goals",
  "one_off_spends",
  "plans",
  "assumptions_sets",
  "net_worth_snapshots",
] as const;

export function dumpAll(db: SqlDatabase): Record<string, Record<string, unknown>[]> {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const table of TABLES) {
    out[table] = db.all(`SELECT * FROM ${table} ORDER BY rowid`);
  }
  return out;
}

/** G1 fixture: 2-adult household, 5 accounts, 1 liability, 3 income streams, spending, goal. */
export function seedDemoHousehold(db: SqlDatabase): void {
  db.run(
    "INSERT INTO households (id, label, created_at) VALUES (?, ?, ?)",
    "h1",
    "Demo household",
    "2026-10-22T00:00:00Z",
  );
  db.run(
    `INSERT INTO persons (id, household_id, name, birth_year, sex, planned_retirement_age, life_expectancy_age, earnings_growth_real)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    "p1", "h1", "Alex", 1988, "f", 62, 95, 0.02,
  );
  db.run(
    `INSERT INTO persons (id, household_id, name, birth_year, sex, planned_retirement_age, life_expectancy_age, earnings_growth_real)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    "p2", "h1", "Sam", 1986, "m", 64, 92, 0.015,
  );
  const accounts: [string, string, string, number, string][] = [
    ["a1", "p1", "Employer 401k", 142_000, "2026-10-01"],
    ["a2", "p1", "Brokerage", 85_500, "2026-10-01"],
    ["a3", "p2", "Roth IRA", 61_200, "2026-10-01"],
    ["a4", "h1", "High-yield savings", 30_000, "2026-10-01"],
    ["a5", "h1", "Primary residence", 410_000, "2026-10-01"],
  ];
  for (const [id, personId, label, balance, asOf] of accounts) {
    const type = id === "a1" ? "tax_deferred" : id === "a2" ? "taxable" : id === "a3" ? "tax_free" : id === "a4" ? "other" : "real_estate";
    const owner = personId === "h1" ? "p1" : personId;
    db.run(
      "INSERT INTO accounts (id, person_id, label, type, balance, as_of_date) VALUES (?, ?, ?, ?, ?, ?)",
      id, owner, label, type, balance, asOf,
    );
  }
  db.run(
    "INSERT INTO account_allocations (account_id, asset_class, weight) VALUES (?, ?, ?)",
    "a1", "us_equity", 0.8,
  );
  db.run(
    "INSERT INTO account_allocations (account_id, asset_class, weight) VALUES (?, ?, ?)",
    "a1", "bonds", 0.2,
  );
  db.run(
    `INSERT INTO liabilities (id, person_id, label, type, balance, rate, annual_payment, payoff_year)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    "l1", null, "Mortgage", "mortgage", 285_000, 0.055, 32_400, 2041,
  );
  db.run(
    `INSERT INTO income_streams (id, person_id, label, kind, annual_amount, growth_real, start_year, end_year, claiming_age)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "i1", "p1", "Salary", "salary", 120_000, 0.02, 2026, null, null,
  );
  db.run(
    `INSERT INTO income_streams (id, person_id, label, kind, annual_amount, growth_real, start_year, end_year, claiming_age)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "i2", "p2", "Salary", "salary", 98_000, 0.015, 2026, null, null,
  );
  db.run(
    `INSERT INTO income_streams (id, person_id, label, kind, annual_amount, growth_real, start_year, end_year, claiming_age)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "i3", "p1", "Social Security", "social_security", 24_000, 0, 2050, null, 67,
  );
  db.run(
    `INSERT INTO spending_profiles (household_id, annual_now, annual_retirement, essential_share, retirement_start_age)
     VALUES (?, ?, ?, ?, ?)`,
    "h1", 96_000, 78_000, 0.65, 62,
  );
  db.run(
    `INSERT INTO goals (id, household_id, label, kind, target_year, target_amount, annual_retirement_need, success_probability)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    "g1", "h1", "Retire at 62", "retire", 2050, null, 78_000, 0.85,
  );
  db.run(
    `INSERT INTO net_worth_snapshots (id, household_id, date, assets, liabilities, net_worth)
     VALUES (?, ?, ?, ?, ?, ?)`,
    "s1", "h1", "2026-10-01", 728_700, 285_000, 443_700,
  );
}
