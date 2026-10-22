// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import type { AppDatabase } from "../db/sqlite.ts";
import {
  addAccount,
  addAllocation,
  deleteAccount,
  deleteAllocation,
  listAccounts,
  listAllocations,
  listPersons,
} from "../db/repo.ts";
import { DEFAULT_ASSUMPTIONS } from "../plan/build.ts";
import { DeleteButton, Field, FormRow, Submit, money, pct } from "./ui.tsx";

const TYPES = [
  "taxable", "tax_deferred", "tax_free", "hsa", "529", "defined_benefit", "real_estate", "other",
] as const;

const ASSET_CLASSES = Object.keys(DEFAULT_ASSUMPTIONS.assetReturns);

export function Accounts({ db, version, refresh }: { db: AppDatabase; version: number; refresh: () => void }) {
  void version;
  const [error, setError] = useState("");
  const persons = listPersons(db);
  const accounts = listAccounts(db);
  const allocations = listAllocations(db);
  const allocSummary = (accountId: string) => {
    const rows = allocations.filter((r) => r.account_id === accountId);
    return rows.length === 0
      ? <span className="dim">default proxy</span>
      : rows.map((r) => `${r.asset_class.replaceAll("_", " ")} ${pct(r.weight)}`).join(" + ");
  };

  return (
    <>
      <section className="card">
        <h2>Accounts (A1)</h2>
        <table data-testid="accounts-table">
          <thead>
            <tr><th>Owner</th><th>Label</th><th>Type</th><th className="num">Balance</th><th>Allocation</th><th className="num">$/yr in</th><th className="num">Match</th><th>As of</th><th /></tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>{persons.find((p) => p.id === a.person_id)?.name ?? "?"}</td>
                <td>{a.label}</td>
                <td>{a.type.replaceAll("_", " ")}</td>
                <td className="num">{money(a.balance)}</td>
                <td>{allocSummary(a.id)}</td>
                <td className="num">{a.planned_contribution > 0 ? money(a.planned_contribution) : "—"}</td>
                <td className="num">{a.match_rate !== null ? `${pct(a.match_rate)} ≤ ${pct(a.match_up_to_share ?? 0.06)}` : "—"}</td>
                <td>{a.as_of_date}</td>
                <td>
                  <button
                    className="link"
                    type="button"
                    data-testid={`delete-account-${a.id}`}
                    onClick={() => {
                      setError("");
                      try {
                        deleteAccount(db, a.id);
                        refresh();
                      } catch (e) {
                        setError(String(e));
                      }
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {accounts.length === 0 && <tr><td colSpan={9} className="dim">No accounts yet.</td></tr>}
          </tbody>
        </table>
        {error && <p className="err">{error}</p>}
        {persons.length === 0 && <p className="note dim">Add adults under Household first.</p>}
        {persons.length > 0 && (
          <FormRow
            testid="add-account"
            onSubmit={(values) => {
              setError("");
              try {
                const planned = String(values.get("planned") || "");
                const limit = String(values.get("limit") || "");
                const match = String(values.get("match") || "");
                const matchShare = String(values.get("match_share") || "");
                addAccount(db, {
                  person_id: String(values.get("person_id")),
                  label: String(values.get("label")),
                  type: String(values.get("type")),
                  balance: Number(values.get("balance")),
                  as_of_date: String(values.get("as_of") || new Date().toISOString().slice(0, 10)),
                  planned_contribution: planned === "" ? 0 : Number(planned),
                  contribution_limit: limit === "" ? null : Number(limit),
                  match_rate: match === "" ? null : Number(match) / 100,
                  match_up_to_share: matchShare === "" ? null : Number(matchShare) / 100,
                });
                refresh();
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            <Field label="Owner">
              <select name="person_id" data-testid="account-owner">
                {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Label"><input type="text" name="label" required data-testid="account-label" /></Field>
            <Field label="Type">
              <select name="type" data-testid="account-type">
                {TYPES.map((t) => <option key={t} value={t}>{t.replaceAll("_", " ")}</option>)}
              </select>
            </Field>
            <Field label="Balance $"><input type="number" name="balance" required step="0.01" data-testid="account-balance" /></Field>
            <Field label="Contribute $/yr"><input type="number" name="planned" step="100" data-testid="account-planned" /></Field>
            <Field label="Limit $ (blank = default)"><input type="number" name="limit" step="100" data-testid="account-limit" /></Field>
            <Field label="Match % (blank = none)"><input type="number" name="match" step="1" data-testid="account-match" /></Field>
            <Field label="Match up to % salary"><input type="number" name="match_share" step="1" data-testid="account-match-share" /></Field>
            <Field label="As of"><input type="date" name="as_of" /></Field>
            <Submit label="Add account" />
          </FormRow>
        )}
      </section>

      {accounts.length > 0 && (
        <section className="card">
          <h2>Allocation slices (B1.2 — asset classes per account)</h2>
          <p className="note dim">
            Unmapped weight of an account is modeled as its proxy asset class (cash; real estate / bonds
            where obvious). Slice weights per account must total ≤ 100%.
          </p>
          <FormRow
            testid="add-allocation"
            onSubmit={(values) => {
              setError("");
              try {
                addAllocation(db, String(values.get("account_id")), String(values.get("asset_class")), Number(values.get("weight")));
                refresh();
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            <Field label="Account">
              <select name="account_id" data-testid="allocation-account">
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </Field>
            <Field label="Asset class">
              <select name="asset_class" data-testid="allocation-class">
                {ASSET_CLASSES.map((c) => <option key={c} value={c}>{c.replaceAll("_", " ")}</option>)}
              </select>
            </Field>
            <Field label="Weight %"><input type="number" name="weight" required min={1} max={100} data-testid="allocation-weight" /></Field>
            <Submit label="Add slice" />
          </FormRow>
          {allocations.length > 0 && (
            <table data-testid="allocations-table">
              <thead>
                <tr><th>Account</th><th>Asset class</th><th className="num">Weight</th><th /></tr>
              </thead>
              <tbody>
                {allocations.map((r) => (
                  <tr key={`${r.account_id}-${r.asset_class}`}>
                    <td>{accounts.find((a) => a.id === r.account_id)?.label ?? "?"}</td>
                    <td>{r.asset_class.replaceAll("_", " ")}</td>
                    <td className="num">{pct(r.weight)}</td>
                    <td>
                      <DeleteButton
                        testid={`delete-allocation-${r.account_id}-${r.asset_class}`}
                        onDelete={() => {
                          setError("");
                          try {
                            deleteAllocation(db, r.account_id, r.asset_class);
                            refresh();
                          } catch (e) {
                            setError(String(e));
                          }
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}
