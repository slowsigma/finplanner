// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import type { AppDatabase } from "../db/sqlite.ts";
import {
  addLiability,
  deleteLiability,
  householdId,
  listAccounts,
  listLiabilities,
  listPersons,
  listSnapshots,
  netWorthNow,
  recordSnapshot,
} from "../db/repo.ts";
import { DeleteButton, Field, FormRow, Submit, money } from "./ui.tsx";

export function NetWorth({ db, version, refresh }: { db: AppDatabase; version: number; refresh: () => void }) {
  const [error, setError] = useState("");
  void version;
  const household = householdId(db);
  const persons = new Map(listPersons(db).map((p) => [p.id, p.name]));
  const accounts = listAccounts(db);
  const liabilities = listLiabilities(db);
  const now = netWorthNow(db);
  const snapshots = listSnapshots(db);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el || snapshots.length < 2) return;
    const dpr = window.devicePixelRatio || 1;
    const width = el.clientWidth * dpr;
    const height = el.clientHeight * dpr;
    el.width = width;
    el.height = height;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const values = snapshots.map((s) => s.net_worth);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = 12 * dpr;
    const x = (i: number) => pad + (i / (snapshots.length - 1)) * (width - 2 * pad);
    const y = (v: number) => height - pad - ((v - min) / (max - min || 1)) * (height - 2 * pad);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#4493f8";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    values.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
    ctx.stroke();
    for (const [i, v] of values.entries()) {
      ctx.fillStyle = "#4493f8";
      ctx.beginPath();
      ctx.arc(x(i), y(v), 3 * dpr, 0, 2 * Math.PI);
      ctx.fill();
    }
  }, [snapshots.length]);

  const guard = (fn: () => void) => {
    setError("");
    try {
      fn();
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const byOwner = new Map<string, { assets: number; rows: number }>();
  for (const a of accounts) {
    const entry = byOwner.get(a.person_id) ?? { assets: 0, rows: 0 };
    entry.assets += a.balance;
    entry.rows += 1;
    byOwner.set(a.person_id, entry);
  }

  return (
    <>
      <section className="card">
        <h2>Net worth — today</h2>
        <p className="big" data-testid="net-worth-total">{money(now.netWorth)}</p>
        <p className="dim">
          {money(now.assets)} assets − {money(now.liabilities)} liabilities (real terms)
        </p>
        {error && <p className="err">{error}</p>}
        <FormRow
          testid="record-snapshot"
          onSubmit={() => {
            try {
              recordSnapshot(db);
              refresh();
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          <Field label="Record today's balance as a history point">&nbsp;</Field>
          <Submit label="Record snapshot" />
        </FormRow>
      </section>

      <section className="card">
        <h2>Assets</h2>
        <table data-testid="assets-table">
          <thead>
            <tr><th>Owner</th><th>Account</th><th>Type</th><th className="num">Balance</th></tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>{persons.get(a.person_id) ?? "?"}</td>
                <td>{a.label}</td>
                <td>{a.type.replaceAll("_", " ")}</td>
                <td className="num">{money(a.balance)}</td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr><td colSpan={4} className="dim">No accounts yet — add some under Accounts.</td></tr>
            )}
            {[...byOwner.entries()].map(([ownerId, v]) => (
              <tr key={`owner-${ownerId}`} className="total">
                <td colSpan={3}>{persons.get(ownerId) ?? "?"} — total</td>
                <td className="num">{money(v.assets)}</td>
              </tr>
            ))}
            <tr className="total">
              <td colSpan={3}>Household assets</td>
              <td className="num">{money(now.assets)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Liabilities (A1)</h2>
        <table data-testid="liabilities-table">
          <thead>
            <tr><th>Owner</th><th>Label</th><th>Type</th><th className="num">Balance</th><th className="num">Rate</th><th className="num">Annual payment</th><th /></tr>
          </thead>
          <tbody>
            {liabilities.map((l) => (
              <tr key={l.id}>
                <td>{l.person_id ? persons.get(l.person_id) ?? "?" : "Household"}</td>
                <td>{l.label}</td>
                <td>{l.type.replaceAll("_", " ")}</td>
                <td className="num">{money(l.balance)}</td>
                <td className="num">{(l.rate * 100).toFixed(1)}%</td>
                <td className="num">{money(l.annual_payment)}</td>
                <td><DeleteButton testid={`delete-liability-${l.id}`} onDelete={() => guard(() => deleteLiability(db, l.id))} /></td>
              </tr>
            ))}
            {liabilities.length === 0 && (
              <tr><td colSpan={7} className="dim">No liabilities yet — mortgages, student loans, autos.</td></tr>
            )}
            <tr className="total">
              <td colSpan={3}>Household liabilities</td>
              <td className="num">{money(now.liabilities)}</td>
              <td colSpan={3} />
            </tr>
          </tbody>
        </table>
        {household !== undefined && (
          <FormRow
            testid="add-liability"
            onSubmit={(values) =>
              guard(() => {
                const owner = String(values.get("owner") || "");
                addLiability(db, {
                  person_id: owner === "" ? null : owner,
                  label: String(values.get("label")),
                  type: String(values.get("type")),
                  balance: Number(values.get("balance")),
                  rate: Number(values.get("rate")) / 100,
                  annual_payment: Number(values.get("annual_payment")),
                  payoff_year: null,
                });
              })
            }
          >
            <Field label="Owner">
              <select name="owner" data-testid="liability-owner">
                <option value="">Household</option>
                {[...persons.entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </Field>
            <Field label="Label"><input type="text" name="label" required data-testid="liability-label" /></Field>
            <Field label="Type">
              <select name="type" data-testid="liability-type">
                {["mortgage", "student", "auto", "other"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Balance $"><input type="number" name="balance" required min={0} data-testid="liability-balance" /></Field>
            <Field label="Rate %"><input type="number" name="rate" required min={0} step="0.1" data-testid="liability-rate" /></Field>
            <Field label="Annual payment $"><input type="number" name="annual_payment" required min={0} data-testid="liability-payment" /></Field>
            <Submit label="Add liability" />
          </FormRow>
        )}
        <p className="note dim">
          Liability balances reduce net worth; annual payments are included in the deterministic and Monte Carlo projections.
        </p>
      </section>

      <section className="card">
        <h2>History ({snapshots.length} snapshot{snapshots.length === 1 ? "" : "s"})</h2>
        {snapshots.length >= 2 ? (
          <canvas ref={canvas} data-testid="trend-chart" />
        ) : (
          <p className="note dim">Record at least two snapshots to see the trend (A4).</p>
        )}
        {snapshots.length > 0 && (
          <table>
            <thead>
              <tr><th>Date</th><th className="num">Net worth</th></tr>
            </thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.id}>
                  <td>{s.date}</td>
                  <td className={s.net_worth >= 0 ? "num pos" : "num neg"}>{money(s.net_worth)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {household === undefined && <p className="note">Set up your household first (Household tab).</p>}
    </>
  );
}
