// SPDX-License-Identifier: Apache-2.0
import { configureConnection, migrate, type BindValue } from "@finplanner/shared-schema";
import { AppDatabase } from "./sqlite.ts";
import { opfsRead } from "./persist.ts";

export interface PersonRow {
  id: string;
  household_id: string;
  name: string;
  birth_year: number;
  sex: string;
  planned_retirement_age: number | null;
  life_expectancy_age: number | null;
  earnings_growth_real: number | null;
}

export interface AccountRow {
  id: string;
  person_id: string;
  label: string;
  type: string;
  balance: number;
  as_of_date: string;
}

export interface LiabilityRow {
  id: string;
  person_id: string | null;
  label: string;
  type: string;
  balance: number;
  rate: number;
  annual_payment: number;
  payoff_year: number | null;
}

export interface IncomeRow {
  id: string;
  person_id: string;
  label: string;
  kind: string;
  annual_amount: number;
  growth_real: number;
  start_year: number;
  end_year: number | null;
  claiming_age: number | null;
}

export interface SnapshotRow {
  id: string;
  date: string;
  assets: number;
  liabilities: number;
  net_worth: number;
}

export interface SpendingRow {
  annual_now: number;
  annual_retirement: number;
  essential_share: number;
  retirement_start_age: number | null;
}

export interface NetWorthNow {
  assets: number;
  liabilities: number;
  netWorth: number;
}

const uuid = () => crypto.randomUUID();

/** Write-through helper: every mutation schedules an OPFS snapshot. */
function runMut(db: AppDatabase, sql: string, ...params: BindValue[]): void {
  db.sql.run(sql, ...params);
  void db.persist().catch((error: unknown) => console.error("persist failed:", error));
}

export async function openAppDb(): Promise<AppDatabase> {
  if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false);
  const db = await AppDatabase.open();
  if (!db.persistent) console.warn("OPFS unavailable in this browser — data will not survive the session");
  configureConnection(db.sql);
  const snapshot = await opfsRead();
  if (snapshot) {
    try {
      db.import(snapshot);
    } catch (error) {
      console.error("stored snapshot failed to load, starting from a clean database:", error);
    }
  }
  migrate(db.sql);
  return db;
}

export async function emptyTemplate(): Promise<Uint8Array> {
  const scratch = await AppDatabase.open();
  migrate(scratch.sql);
  return scratch.serialize();
}

export function householdId(db: AppDatabase): string | undefined {
  return db.sql.get("SELECT id FROM households ORDER BY rowid LIMIT 1")?.["id"] as string | undefined;
}

export function createHousehold(db: AppDatabase, label: string): string {
  const id = uuid();
  runMut(db, 
    "INSERT INTO households (id, label, created_at) VALUES (?, ?, ?)",
    id,
    label,
    new Date().toISOString(),
  );
  return id;
}

export function householdLabel(db: AppDatabase): string {
  return (db.sql.get("SELECT label FROM households LIMIT 1")?.["label"] as string) ?? "";
}

export function listPersons(db: AppDatabase): PersonRow[] {
  return db.sql.all("SELECT * FROM persons ORDER BY rowid") as unknown as PersonRow[];
}

export function addPerson(
  db: AppDatabase,
  householdId: string,
  p: Pick<PersonRow, "name" | "birth_year" | "sex" | "planned_retirement_age">,
): void {
  runMut(db, 
    "INSERT INTO persons (id, household_id, name, birth_year, sex, planned_retirement_age) VALUES (?, ?, ?, ?, ?, ?)",
    uuid(), householdId, p.name, p.birth_year, p.sex, p.planned_retirement_age,
  );
}

export function deletePerson(db: AppDatabase, id: string): void {
  runMut(db, "DELETE FROM persons WHERE id = ?", id);
}

export function listAccounts(db: AppDatabase): AccountRow[] {
  return db.sql.all("SELECT * FROM accounts ORDER BY rowid") as unknown as AccountRow[];
}

export function addAccount(db: AppDatabase, a: Omit<AccountRow, "id">): void {
  runMut(db, 
    "INSERT INTO accounts (id, person_id, label, type, balance, as_of_date) VALUES (?, ?, ?, ?, ?, ?)",
    uuid(), a.person_id, a.label, a.type, a.balance, a.as_of_date,
  );
}

export function deleteAccount(db: AppDatabase, id: string): void {
  runMut(db, "DELETE FROM accounts WHERE id = ?", id);
}

export function listLiabilities(db: AppDatabase): LiabilityRow[] {
  return db.sql.all("SELECT * FROM liabilities ORDER BY rowid") as unknown as LiabilityRow[];
}

export function addLiability(db: AppDatabase, l: Omit<LiabilityRow, "id">): void {
  runMut(db, 
    "INSERT INTO liabilities (id, person_id, label, type, balance, rate, annual_payment, payoff_year) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    uuid(), l.person_id, l.label, l.type, l.balance, l.rate, l.annual_payment, l.payoff_year,
  );
}

export function deleteLiability(db: AppDatabase, id: string): void {
  runMut(db, "DELETE FROM liabilities WHERE id = ?", id);
}

export function listIncome(db: AppDatabase): IncomeRow[] {
  return db.sql.all("SELECT * FROM income_streams ORDER BY rowid") as unknown as IncomeRow[];
}

export function addIncome(db: AppDatabase, i: Omit<IncomeRow, "id">): void {
  runMut(db, 
    "INSERT INTO income_streams (id, person_id, label, kind, annual_amount, growth_real, start_year, end_year, claiming_age) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    uuid(), i.person_id, i.label, i.kind, i.annual_amount, i.growth_real, i.start_year, i.end_year, i.claiming_age,
  );
}

export function deleteIncome(db: AppDatabase, id: string): void {
  runMut(db, "DELETE FROM income_streams WHERE id = ?", id);
}

export function getSpending(db: AppDatabase): SpendingRow | undefined {
  const row = db.sql.get("SELECT * FROM spending_profiles LIMIT 1");
  return row as unknown as SpendingRow | undefined;
}

export function upsertSpending(db: AppDatabase, s: SpendingRow): void {
  const household = householdId(db);
  if (!household) throw new Error("household required");
  runMut(db, 
    `INSERT INTO spending_profiles (household_id, annual_now, annual_retirement, essential_share, retirement_start_age)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(household_id) DO UPDATE SET
       annual_now = excluded.annual_now,
       annual_retirement = excluded.annual_retirement,
       essential_share = excluded.essential_share,
       retirement_start_age = excluded.retirement_start_age`,
    household, s.annual_now, s.annual_retirement, s.essential_share, s.retirement_start_age,
  );
}

export function netWorthNow(db: AppDatabase): NetWorthNow {
  const assets = (db.sql.get("SELECT COALESCE(SUM(balance), 0) AS total FROM accounts")?.["total"] as number) ?? 0;
  const liabilities = (db.sql.get("SELECT COALESCE(SUM(balance), 0) AS total FROM liabilities")?.["total"] as number) ?? 0;
  return { assets, liabilities, netWorth: assets - liabilities };
}

export function listSnapshots(db: AppDatabase): SnapshotRow[] {
  return db.sql.all("SELECT * FROM net_worth_snapshots ORDER BY date") as unknown as SnapshotRow[];
}

export function recordSnapshot(db: AppDatabase, date = new Date().toISOString().slice(0, 10)): void {
  const household = householdId(db);
  if (!household) throw new Error("household required");
  const now = netWorthNow(db);
  runMut(db, 
    "INSERT INTO net_worth_snapshots (id, household_id, date, assets, liabilities, net_worth) VALUES (?, ?, ?, ?, ?, ?)",
    uuid(), household, date, now.assets, now.liabilities, now.netWorth,
  );
}
