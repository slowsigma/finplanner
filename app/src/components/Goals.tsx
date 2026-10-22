// SPDX-License-Identifier: Apache-2.0
// D1–D3: goal objects, on-track tracking with required-savings gap, and the
// FI number/date from the deterministic projection. SWR is user-adjustable;
// framing is "plan, not contract".

import { useMemo, useState } from "react";
import { assessGoals, fiAssessment } from "@finplanner/engine";
import type { AppDatabase } from "../db/sqlite.ts";
import { addGoal, deleteGoal, getSpending, listGoals, updateDefaultAssumptions } from "../db/repo.ts";
import { buildPlan } from "../plan/build.ts";
import { DeleteButton, Field, FormRow, Submit, money } from "./ui.tsx";

const KINDS = ["retire", "college", "fi", "custom"] as const;

export function Goals({ db, version, refresh }: { db: AppDatabase; version: number; refresh: () => void }) {
  void version;
  const [error, setError] = useState("");
  const view = useMemo(() => buildPlan(db), [db, version]);
  const goals = listGoals(db);
  const spending = getSpending(db);

  const plan = "result" in view ? view : null;
  const withdrawalRate = plan?.assumptions.withdrawalRate ?? 0.04;
  const fi = plan
    ? fiAssessment(plan.result.rows, spending?.annual_retirement ?? 0, withdrawalRate)
    : null;
  const assessments = plan
    ? assessGoals(
        plan.result.rows,
        goals.map((g) => ({
          id: g.id,
          label: g.label,
          kind: g.kind as "retire" | "college" | "fi" | "custom",
          targetYear: g.target_year,
          targetAmount: g.target_amount,
          annualRetirementNeed:
            g.annual_retirement_need ?? (g.kind === "fi" ? spending?.annual_retirement ?? 0 : null),
        })),
        {
          withdrawalRate,
          blendedRealReturn: plan.assumptions.blendedRealReturn ?? 0.05,
        },
      )
    : [];

  return (
    <>
      {fi && fi.annualRetirementSpend > 0 && (
        <section className="card">
          <h2>Financial independence (D3)</h2>
          <p className="big" data-testid="fi-number">{money(fi.fiNumber)}</p>
          <p className="dim" data-testid="fi-date">
            FI number = {money(fi.annualRetirementSpend)}/yr retirement spending ÷ {(withdrawalRate * 100).toFixed(1)}% SWR ·{" "}
            {fi.fiDate !== null ? `projected FI in ${fi.fiDate}` : "not reached within the modeled lifetime"}
          </p>
          <FormRow
            testid="set-swr"
            onSubmit={(values) => {
              setError("");
              try {
                const pct = Number(values.get("swr"));
                if (!(pct >= 1 && pct <= 10)) throw new Error("withdrawal rate must be between 1% and 10%");
                if (!plan) throw new Error("plan unavailable");
                updateDefaultAssumptions(db, { ...plan.assumptions, withdrawalRate: pct / 100 });
                refresh();
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            <Field label="Withdrawal rate %"><input type="number" name="swr" required step="0.1" min={1} max={10} defaultValue={(withdrawalRate * 100).toFixed(1)} data-testid="fi-swr" /></Field>
            <Submit label="Set SWR" />
          </FormRow>
          <p className="note dim">
            The SWR is a plan, not a contract: the historical worst 30-year window sustained ≈3.5%,
            Bengen's average first-year rate was ≈7%. Treat the FI date as a planning anchor, and
            dynamic withdrawal policies (M4) as the sequence-safety layer.
          </p>
        </section>
      )}

      <section className="card">
        <h2>Goals (D1, D2)</h2>
        <table data-testid="goals-table">
          <thead>
            <tr><th>Goal</th><th>Kind</th><th>Target year</th><th className="num">Target</th><th className="num">Projected</th><th>Status</th><th className="num">Need $/yr more</th><th /></tr>
          </thead>
          <tbody>
            {assessments.map((a) => (
              <tr key={a.id}>
                <td>{a.label}</td>
                <td>{a.kind}</td>
                <td>{a.targetYear ?? "—"}</td>
                <td className="num">{a.targetAmount !== null ? money(a.targetAmount) : "—"}</td>
                <td className="num">{a.projectedAtTarget !== null ? money(a.projectedAtTarget) : "—"}</td>
                <td className={a.onTrack ? "pos" : "neg"} data-testid={`goal-status-${a.id}`}>
                  {a.onTrack ? "on track" : "off track"}
                </td>
                <td className="num">{(a.requiredAnnualSavings ?? 0) > 0 ? money(a.requiredAnnualSavings ?? 0) : "—"}</td>
                <td>
                  <DeleteButton
                    testid={`delete-goal-${a.id}`}
                    onDelete={() => {
                      setError("");
                      try {
                        deleteGoal(db, a.id);
                        refresh();
                      } catch (e) {
                        setError(String(e));
                      }
                    }}
                  />
                </td>
              </tr>
            ))}
            {goals.length === 0 && <tr><td colSpan={8} className="dim">No goals yet — retirement, college, a house down payment…</td></tr>}
          </tbody>
        </table>
        {assessments.length > 0 && (
          <p className="note dim">
            Goals compete for the same pool: custom/college goals are checked against total projected
            net worth at the target year, not a dedicated account.
          </p>
        )}
        {error && <p className="err">{error}</p>}
        <FormRow
          testid="add-goal"
          onSubmit={(values) => {
            setError("");
            try {
              const year = String(values.get("target_year") || "");
              const amount = String(values.get("target_amount") || "");
              const need = String(values.get("annual_need") || "");
              addGoal(db, {
                label: String(values.get("label")),
                kind: String(values.get("kind")),
                target_year: year === "" ? null : Number(year),
                target_amount: amount === "" ? null : Number(amount),
                annual_retirement_need: need === "" ? null : Number(need),
              });
              refresh();
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          <Field label="Label"><input type="text" name="label" required data-testid="goal-label" /></Field>
          <Field label="Kind">
            <select name="kind" data-testid="goal-kind">
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </Field>
          <Field label="Target year"><input type="number" name="target_year" step="1" data-testid="goal-year" /></Field>
          <Field label="Target $"><input type="number" name="target_amount" step="1000" data-testid="goal-amount" /></Field>
          <Field label="Retirement need $/yr (retire/FI)"><input type="number" name="annual_need" step="1000" data-testid="goal-need" /></Field>
          <Submit label="Add goal" />
        </FormRow>
      </section>
    </>
  );
}
