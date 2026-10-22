// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import type { AppDatabase } from "../db/sqlite.ts";
import { addAccount, deleteAccount, listAccounts, listPersons } from "../db/repo.ts";
import { DeleteButton, Field, FormRow, Submit, money } from "./ui.tsx";

const TYPES = [
  "taxable", "tax_deferred", "tax_free", "hsa", "529", "defined_benefit", "real_estate", "other",
] as const;

export function Accounts({ db, version, refresh }: { db: AppDatabase; version: number; refresh: () => void }) {
  void version;
  const [error, setError] = useState("");
  const persons = listPersons(db);
  const accounts = listAccounts(db);

  return (
    <section className="card">
      <h2>Accounts (A1)</h2>
      <table data-testid="accounts-table">
        <thead>
          <tr><th>Owner</th><th>Label</th><th>Type</th><th className="num">Balance</th><th>As of</th><th /></tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id}>
              <td>{persons.find((p) => p.id === a.person_id)?.name ?? "?"}</td>
              <td>{a.label}</td>
              <td>{a.type.replaceAll("_", " ")}</td>
              <td className="num">{money(a.balance)}</td>
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
          {accounts.length === 0 && <tr><td colSpan={6} className="dim">No accounts yet.</td></tr>}
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
              addAccount(db, {
                person_id: String(values.get("person_id")),
                label: String(values.get("label")),
                type: String(values.get("type")),
                balance: Number(values.get("balance")),
                as_of_date: String(values.get("as_of") || new Date().toISOString().slice(0, 10)),
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
          <Field label="As of"><input type="date" name="as_of" /></Field>
          <Submit label="Add account" />
        </FormRow>
      )}
    </section>
  );
}
