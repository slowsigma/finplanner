// SPDX-License-Identifier: Apache-2.0
// Versioned, forward-only migrations (D4, R5). Version N lives in
// PRAGMA user_version. Never edit an applied migration — add the next one.
// IDs are app-generated UUIDs (crypto.randomUUID) so exported rows are
// stable across devices.

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const BASELINE_V1 = `
CREATE TABLE meta (
  key   TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE households (
  id         TEXT NOT NULL PRIMARY KEY,
  label      TEXT NOT NULL DEFAULT 'My household',
  created_at TEXT NOT NULL
);

CREATE TABLE persons (
  id                      TEXT NOT NULL PRIMARY KEY,
  household_id            TEXT NOT NULL REFERENCES households(id),
  name                    TEXT NOT NULL,
  birth_year              INTEGER NOT NULL,
  sex                     TEXT NOT NULL CHECK (sex IN ('m','f')),
  planned_retirement_age  INTEGER,
  life_expectancy_age     INTEGER,
  earnings_growth_real    REAL
);

CREATE TABLE accounts (
  id          TEXT NOT NULL PRIMARY KEY,
  person_id   TEXT NOT NULL REFERENCES persons(id),
  label       TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN
                ('taxable','tax_deferred','tax_free','hsa','529',
                 'defined_benefit','real_estate','other')),
  balance     REAL NOT NULL,
  as_of_date  TEXT NOT NULL
);

CREATE TABLE account_allocations (
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  asset_class TEXT NOT NULL,
  weight      REAL NOT NULL CHECK (weight > 0 AND weight <= 1),
  PRIMARY KEY (account_id, asset_class)
);

CREATE TABLE liabilities (
  id             TEXT NOT NULL PRIMARY KEY,
  person_id      TEXT REFERENCES persons(id),
  label          TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('mortgage','student','auto','other')),
  balance        REAL NOT NULL,
  rate           REAL NOT NULL,
  annual_payment REAL NOT NULL,
  payoff_year    INTEGER
);

CREATE TABLE income_streams (
  id            TEXT NOT NULL PRIMARY KEY,
  person_id     TEXT NOT NULL REFERENCES persons(id),
  label         TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN
                  ('salary','social_security','pension','annuity','rental','other')),
  annual_amount REAL NOT NULL,
  growth_real   REAL NOT NULL DEFAULT 0,
  start_year    INTEGER NOT NULL,
  end_year      INTEGER,
  claiming_age  INTEGER
);

CREATE TABLE spending_profiles (
  household_id         TEXT NOT NULL PRIMARY KEY REFERENCES households(id),
  annual_now           REAL NOT NULL,
  annual_retirement    REAL NOT NULL,
  essential_share      REAL NOT NULL CHECK (essential_share >= 0 AND essential_share <= 1),
  retirement_start_age INTEGER
);

CREATE TABLE goals (
  id                    TEXT NOT NULL PRIMARY KEY,
  household_id          TEXT NOT NULL REFERENCES households(id),
  label                 TEXT NOT NULL,
  kind                  TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN
                          ('retire','college','fi','custom')),
  target_year           INTEGER,
  target_amount         REAL,
  annual_retirement_need REAL,
  success_probability   REAL NOT NULL DEFAULT 0.85
);

CREATE TABLE one_off_spends (
  id                    TEXT NOT NULL PRIMARY KEY,
  household_id          TEXT NOT NULL REFERENCES households(id),
  goal_id               TEXT REFERENCES goals(id),
  sinking_fund_account_id TEXT REFERENCES accounts(id),
  label                 TEXT NOT NULL,
  category              TEXT NOT NULL DEFAULT 'other',
  amount                REAL NOT NULL,
  first_year            INTEGER NOT NULL,
  repeat_every_years    INTEGER CHECK (repeat_every_years IS NULL OR repeat_every_years >= 1),
  extra_inflation       REAL NOT NULL DEFAULT 0
);

CREATE TABLE plans (
  id           TEXT NOT NULL PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  label        TEXT NOT NULL,
  savings_rate REAL,
  data_json    TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE assumptions_sets (
  id         TEXT NOT NULL PRIMARY KEY,
  label      TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  data_json  TEXT NOT NULL
);

CREATE TABLE net_worth_snapshots (
  id           TEXT NOT NULL PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  date         TEXT NOT NULL,
  assets       REAL NOT NULL,
  liabilities  REAL NOT NULL,
  net_worth    REAL NOT NULL
);

CREATE INDEX idx_snapshots_household_date ON net_worth_snapshots(household_id, date);
CREATE INDEX idx_accounts_person ON accounts(person_id);
CREATE INDEX idx_income_person ON income_streams(person_id);
`;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "baseline-v1", sql: BASELINE_V1 },
];

export const SCHEMA_VERSION: number = MIGRATIONS[MIGRATIONS.length - 1]!.version;
