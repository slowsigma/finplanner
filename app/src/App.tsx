// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import type { AppDatabase } from "./db/sqlite.ts";
import { Accounts } from "./components/Accounts.tsx";
import { Backup } from "./components/Backup.tsx";
import { CashFlow } from "./components/CashFlow.tsx";
import { Household } from "./components/Household.tsx";
import { NetWorth } from "./components/NetWorth.tsx";
import { Plan } from "./components/Plan.tsx";
import { Goals } from "./components/Goals.tsx";
import { MonteCarlo } from "./components/MonteCarlo.tsx";
import { ImportTab } from "./components/ImportTab.tsx";
import { TOU_FOOTER, TermsGate, TermsSettingsCard, touAccepted } from "./components/Terms.tsx";

const TABS = [
  ["networth", "Net worth"],
  ["household", "Household"],
  ["accounts", "Accounts"],
  ["cashflow", "Cash flow"],
  ["plan", "Plan"],
  ["goals", "Goals"],
  ["risk", "Risk"],
  ["import", "Import"],
  ["backup", "Backup"],
] as const;

type Tab = (typeof TABS)[number][0];

export function App({ db }: { db: AppDatabase }) {
  const [tab, setTab] = useState<Tab>("networth");
  const [version, setVersion] = useState(0);
  const [accepted, setAccepted] = useState(() => touAccepted(db));
  const refresh = () => setVersion((v) => v + 1);
  const shared = { db, version, refresh };

  if (!accepted) return <TermsGate db={db} onAccept={() => setAccepted(true)} />;

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
        {tab === "plan" && <Plan {...shared} />}
        {tab === "goals" && <Goals {...shared} />}
        {tab === "risk" && <MonteCarlo {...shared} />}
        {tab === "import" && <ImportTab />}
        {tab === "backup" && (
          <>
            <Backup db={db} refresh={refresh} />
            <TermsSettingsCard db={db} onReset={() => setAccepted(false)} />
          </>
        )}
      </main>
      <footer data-testid="tou-footer">{TOU_FOOTER}</footer>
    </>
  );
}
