// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import type { AppDatabase } from "../db/sqlite.ts";
import {
  addIncome,
  addOneOffSpend,
  deleteIncome,
  deleteOneOffSpend,
  getSpending,
  householdId,
  listIncome,
  listOneOffSpends,
  listPersons,
  upsertSpending,
} from "../db/repo.ts";
import { DeleteButton, Field, FormRow, Submit, money, pct } from "./ui.tsx";

const KINDS = ["salary", "social_security", "pension", "annuity", "rental", "other"] as const;

export function CashFlow({ db, version, refresh }: { db: AppDatabase; version: number; refresh: () => void }) {
  void version;
  const [error, setError] = useState("");
  const persons = listPersons(db);
  const income = listIncome(db);
  const oneOffs = listOneOffSpends(db);
  const spending = getSpending(db);
  const household = householdId(db);
  const currentYear = new Date().getFullYear();
  const totalIncome = income
    .filter((i) => i.kind === "salary" || i.kind === "rental" || i.kind === "other")
    .reduce((s, i) => s + i.annual_amount, 0);
  const savingsRate = spending && totalIncome > 0 ? (totalIncome - spending.annual_now) / totalIncome : null;

  return (
    <>
      <section className="card">
        <h2>Spending (A2)</h2>
        {spending ? (
          <p data-testid="spending-summary">
            {money(spending.annual_now)}/yr now · {money(spending.annual_retirement)}/yr in retirement ·{" "}
            {pct(spending.essential_share)} essential
            {savingsRate !== null && <> · savings rate <strong>{pct(savingsRate)}</strong></>}
          </p>
        ) : (
          <p className="dim">Not set yet.</p>
        )}
        {persons.length > 0 && (
          <FormRow
            testid="set-spending"
            onSubmit={(values) =>
              tryRun(() =>
                upsertSpending(db, {
                  annual_now: Number(values.get("annual_now")),
                  annual_retirement: Number(values.get("annual_retirement")),
                  essential_share: Number(values.get("essential_share")) / 100,
                  retirement_start_age: null,
                }),
              )
            }
          >
            <Field label="Now $/yr"><input type="number" name="annual_now" required data-testid="spend-now" /></Field>
            <Field label="Retirement $/yr"><input type="number" name="annual_retirement" required data-testid="spend-ret" /></Field>
            <Field label="Essential %"><input type="number" name="essential_share" required min={0} max={100} data-testid="spend-essential" /></Field>
            <Submit label="Save spending" />
          </FormRow>
        )}
      </section>
      <section className="card">
        <h2>Income streams (A2)</h2>
        <table data-testid="income-table">
          <thead>
            <tr><th>Person</th><th>Label</th><th>Kind</th><th className="num">$/yr</th><th className="num">Growth</th><th /></tr>
          </thead>
          <tbody>
            {income.map((i) => (
              <tr key={i.id}>
                <td>{persons.find((p) => p.id === i.person_id)?.name ?? "?"}</td>
                <td>{i.label}</td>
                <td>{i.kind.replaceAll("_", " ")}</td>
                <td className="num">{money(i.annual_amount)}</td>
                <td className="num">{pct(i.growth_real)}</td>
                <td><DeleteButton testid={`delete-income-${i.id}`} onDelete={() => tryRun(() => deleteIncome(db, i.id))} /></td>
              </tr>
            ))}
            {income.length === 0 && <tr><td colSpan={6} className="dim">No income streams yet.</td></tr>}
          </tbody>
        </table>
        {error && <p className="err">{error}</p>}
        {persons.length > 0 && (
          <FormRow
            testid="add-income"
            onSubmit={(values) =>
              tryRun(() =>
                addIncome(db, {
                  person_id: String(values.get("person_id")),
                  label: String(values.get("label")),
                  kind: String(values.get("kind")),
                  annual_amount: Number(values.get("annual_amount")),
                  growth_real: Number(values.get("growth") || 0) / 100,
                  start_year: new Date().getFullYear(),
                  end_year: null,
                  claiming_age: null,
                }),
              )
            }
          >
            <Field label="Person">
              <select name="person_id">
                {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Label"><input type="text" name="label" required data-testid="income-label" /></Field>
            <Field label="Kind">
              <select name="kind" data-testid="income-kind">
                {KINDS.map((k) => <option key={k} value={k}>{k.replaceAll("_", " ")}</option>)}
              </select>
            </Field>
            <Field label="$ per year"><input type="number" name="annual_amount" required data-testid="income-amount" /></Field>
            <Field label="Real growth %"><input type="number" name="growth" step="0.1" data-testid="income-growth" /></Field>
            <Submit label="Add income" />
          </FormRow>
        )}
      </section>
      <section className="card">
        <h2>Scheduled one-off spends (B1.5)</h2>
        <table data-testid="oneoff-table">
          <thead>
            <tr><th>Label</th><th className="num">$ (in first year)</th><th>First year</th><th>Repeat</th><th className="num">Extra infl.</th><th /></tr>
          </thead>
          <tbody>
            {oneOffs.map((o) => (
              <tr key={o.id}>
                <td>{o.label}</td>
                <td className="num">{money(o.amount)}</td>
                <td>{o.first_year}</td>
                <td>{o.repeat_every_years !== null ? `every ${o.repeat_every_years} yrs` : "once"}</td>
                <td className="num">{pct(o.extra_inflation)}</td>
                <td><DeleteButton testid={`delete-oneoff-${o.id}`} onDelete={() => tryRun(() => deleteOneOffSpend(db, o.id))} /></td>
              </tr>
            ))}
            {oneOffs.length === 0 && <tr><td colSpan={6} className="dim">None yet — cars, roofs, weddings, gap years…</td></tr>}
          </tbody>
        </table>
        {household !== undefined && (
          <FormRow
            testid="add-oneoff"
            onSubmit={(values) =>
              tryRun(() => {
                const repeat = String(values.get("repeat") || "");
                addOneOffSpend(db, {
                  label: String(values.get("label")),
                  category: String(values.get("category") || "other"),
                  amount: Number(values.get("amount")),
                  first_year: Number(values.get("first_year")),
                  repeat_every_years: repeat === "" ? null : Number(repeat),
                  extra_inflation: Number(values.get("extra_inflation") || 0) / 100,
                });
              })
            }
          >
            <Field label="Label"><input type="text" name="label" required data-testid="oneoff-label" /></Field>
            <Field label="Category">
              <select name="category">
                {["vehicle", "travel", "home", "education", "wedding", "medical", "other"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Amount $"><input type="number" name="amount" required data-testid="oneoff-amount" /></Field>
            <Field label="First year"><input type="number" name="first_year" required min={currentYear} step="1" defaultValue={currentYear} data-testid="oneoff-year" /></Field>
            <Field label="Repeat every yrs (blank = once)"><input type="number" name="repeat" min={1} step="1" data-testid="oneoff-repeat" /></Field>
            <Field label="Extra inflation %"><input type="number" name="extra_inflation" step="0.1" data-testid="oneoff-inflation" /></Field>
            <Submit label="Add one-off" />
          </FormRow>
        )}
      </section>
    </>
  );

  function tryRun(fn: () => void): void {
    setError("");
    try {
      fn();
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }
}
