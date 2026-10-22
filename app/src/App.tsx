// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import type { AppDatabase } from "./db/sqlite.ts";
import { Accounts } from "./components/Accounts.tsx";
import { Backup } from "./components/Backup.tsx";
import { CashFlow } from "./components/CashFlow.tsx";
import { Household } from "./components/Household.tsx";
import { NetWorth } from "./components/NetWorth.tsx";

const TABS = [
  ["networth", "Net worth"],
  ["household", "Household"],
  ["accounts", "Accounts"],
  ["cashflow", "Cash flow"],
  ["backup", "Backup"],
] as const;

type Tab = (typeof TABS)[number][0];

export function App({ db }: { db: AppDatabase }) {
  const [tab, setTab] = useState<Tab>("networth");
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  const shared = { db, version, refresh };

  return (
    <>
      <header>
        <h1>FinPlanner</h1>
        <span className="tag">fully local · offline-only · projections & education — <strong>not financial advice</strong></span>
      </header>
      <nav>
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            data-testid={`nav-${id}`}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <main>
        {tab === "networth" && <NetWorth {...shared} />}
        {tab === "household" && <Household {...shared} />}
        {tab === "accounts" && <Accounts {...shared} />}
        {tab === "cashflow" && <CashFlow {...shared} />}
        {tab === "backup" && <Backup db={db} refresh={refresh} />}
      </main>
    </>
  );
}
