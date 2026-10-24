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
  planned_contribution: number;
  contribution_limit: number | null;
  match_rate: number | null;
  match_up_to_share: number | null;
}

export interface AllocationRow {
  account_id: string;
  asset_class: string;
  weight: number;
}

export interface OneOffRow {
  id: string;
  label: string;
  category: string;
  amount: number;
  first_year: number;
  repeat_every_years: number | null;
  extra_inflation: number;
}

export interface AssumptionsRow {
  id: string;
  label: string;
  data_json: string;
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
    `INSERT INTO accounts (id, person_id, label, type, balance, as_of_date,
       planned_contribution, contribution_limit, match_rate, match_up_to_share)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    uuid(), a.person_id, a.label, a.type, a.balance, a.as_of_date,
    a.planned_contribution, a.contribution_limit, a.match_rate, a.match_up_to_share,
  );
}

export function listAllocations(db: AppDatabase): AllocationRow[] {
  return db.sql.all("SELECT * FROM account_allocations ORDER BY rowid") as unknown as AllocationRow[];
}

export function addAllocation(db: AppDatabase, accountId: string, assetClass: string, weightPct: number): void {
  const rows = listAllocations(db).filter((r) => r.account_id === accountId);
  const used = rows.reduce((s, r) => s + r.weight, 0);
  const weight = weightPct / 100;
  if (used + weight > 1 + 1e-9) throw new Error(`allocations would exceed 100% (used ${(used * 100).toFixed(0)}%)`);
  if (rows.some((r) => r.asset_class === assetClass)) throw new Error(`${assetClass} already in this allocation`);
  runMut(db,
    "INSERT INTO account_allocations (account_id, asset_class, weight) VALUES (?, ?, ?)",
    accountId, assetClass, weight,
  );
}

export function deleteAllocation(db: AppDatabase, accountId: string, assetClass: string): void {
  runMut(db, "DELETE FROM account_allocations WHERE account_id = ? AND asset_class = ?", accountId, assetClass);
}

export function listOneOffSpends(db: AppDatabase): OneOffRow[] {
  return db.sql.all("SELECT * FROM one_off_spends ORDER BY first_year, rowid") as unknown as OneOffRow[];
}

export function addOneOffSpend(db: AppDatabase, o: Omit<OneOffRow, "id">): void {
  const household = householdId(db);
  if (!household) throw new Error("household required");
  runMut(db,
    `INSERT INTO one_off_spends (id, household_id, label, category, amount, first_year, repeat_every_years, extra_inflation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    uuid(), household, o.label, o.category, o.amount, o.first_year, o.repeat_every_years, o.extra_inflation,
  );
}

export function deleteOneOffSpend(db: AppDatabase, id: string): void {
  runMut(db, "DELETE FROM one_off_spends WHERE id = ?", id);
}

export interface GoalRow {
  id: string;
  label: string;
  kind: string;
  target_year: number | null;
  target_amount: number | null;
  annual_retirement_need: number | null;
  success_probability: number;
}

export function listGoals(db: AppDatabase): GoalRow[] {
  return db.sql.all("SELECT * FROM goals ORDER BY target_year, rowid") as unknown as GoalRow[];
}

export function addGoal(db: AppDatabase, g: Omit<GoalRow, "id" | "success_probability">): void {
  const household = householdId(db);
  if (!household) throw new Error("household required");
  runMut(db,
    `INSERT INTO goals (id, household_id, label, kind, target_year, target_amount, annual_retirement_need)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    uuid(), household, g.label, g.kind, g.target_year, g.target_amount, g.annual_retirement_need,
  );
}

export function deleteGoal(db: AppDatabase, id: string): void {
  runMut(db, "DELETE FROM goals WHERE id = ?", id);
}

export function getDefaultAssumptions(db: AppDatabase): AssumptionsRow | undefined {
  return db.sql.get("SELECT * FROM assumptions_sets WHERE is_default = 1 LIMIT 1") as unknown as
    | AssumptionsRow
    | undefined;
}

export function seedDefaultAssumptions(db: AppDatabase, data: unknown): void {
  if (getDefaultAssumptions(db)) return;
  runMut(db,
    "INSERT INTO assumptions_sets (id, label, is_default, data_json) VALUES (?, ?, 1, ?)",
    uuid(), "Default (unvalidated)", JSON.stringify(data),
  );
}

export function updateDefaultAssumptions(db: AppDatabase, data: unknown): void {
  runMut(db, "UPDATE assumptions_sets SET data_json = ? WHERE is_default = 1", JSON.stringify(data));
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

export interface TouAcceptanceRow {
  version: string;
  accepted_at: string;
  source: string;
}

/** ToU2: local acceptance record per ToU version. */
export function listTouAcceptance(db: AppDatabase): TouAcceptanceRow[] {
  return db.sql.all("SELECT * FROM tou_acceptance ORDER BY accepted_at") as unknown as TouAcceptanceRow[];
}

export function recordTouAcceptance(db: AppDatabase, version: string, source = "clickwrap"): void {
  runMut(
    db,
    "INSERT INTO tou_acceptance (version, accepted_at, source) VALUES (?, ?, ?) ON CONFLICT(version) DO UPDATE SET accepted_at = excluded.accepted_at",
    version, new Date().toISOString(), source,
  );
}

export function clearTouAcceptance(db: AppDatabase): void {
  runMut(db, "DELETE FROM tou_acceptance");
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

export interface ScenarioRunRow {
  id: string;
  label: string;
  savings_rate: number | null;
  data_json: string;
}

/** Store one Monte Carlo scenario run incl. assumption-set hash (B2.2, R3). */
export function saveScenarioRun(db: AppDatabase, label: string, data: unknown, savingsRate: number | null = null): string {
  const household = householdId(db);
  if (!household) throw new Error("household required");
  const id = uuid();
  runMut(db, "INSERT INTO plans (id, household_id, label, savings_rate, data_json) VALUES (?, ?, ?, ?, ?)",
    id, household, label, savingsRate, JSON.stringify(data));
  return id;
}

export function listScenarioRuns(db: AppDatabase, limit = 10): ScenarioRunRow[] {
  return db.sql.all(
    "SELECT id, label, savings_rate, data_json FROM plans ORDER BY rowid DESC LIMIT ?",
    limit,
  ) as unknown as ScenarioRunRow[];
}

// ---------------------------------------------------------------- snapshots (M4.5, D13)

export interface PlanSnapshotRow {
  id: string;
  household_id: string;
  name: string;
  created_at: string;
  param_version: number;
  plan_json: string;
}

const SNAPSHOT_CAP = 50;

export function savePlanSnapshot(
  db: AppDatabase,
  snap: { name: string; paramVersion: number; planJson: string },
): string {
  const id = uuid();
  runMut(
    db,
    `INSERT INTO plan_snapshots (id, household_id, name, created_at, param_version, plan_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id, householdId(db) ?? "", snap.name, new Date().toISOString(), snap.paramVersion, snap.planJson,
  );
  runMut(
    db,
    `DELETE FROM plan_snapshots WHERE id NOT IN (
       SELECT id FROM plan_snapshots ORDER BY created_at DESC LIMIT ?)`,
    SNAPSHOT_CAP,
  );
  return id;
}

export function listPlanSnapshots(db: AppDatabase): PlanSnapshotRow[] {
  return db.sql.all(
    "SELECT * FROM plan_snapshots ORDER BY created_at DESC",
  ) as unknown as PlanSnapshotRow[];
}

export function deletePlanSnapshot(db: AppDatabase, id: string): void {
  runMut(db, "DELETE FROM plan_snapshots WHERE id = ?", id);
}
