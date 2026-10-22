// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useRef } from "react";
import type { AppDatabase } from "../db/sqlite.ts";
import { buildPlan } from "../plan/build.ts";
import { money } from "./ui.tsx";

export function Plan({ db, version }: { db: AppDatabase; version: number; refresh: () => void }) {
  const view = useMemo(() => buildPlan(db), [db, version]);
  const canvas = useRef<HTMLCanvasElement>(null);

  const rows = "result" in view ? view.result.rows : [];
  useEffect(() => {
    const el = canvas.current;
    if (!el || rows.length < 2) return;
    const dpr = window.devicePixelRatio || 1;
    const width = el.clientWidth * dpr;
    const height = el.clientHeight * dpr;
    el.width = width;
    el.height = height;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const values = rows.map((r) => r.netWorth);
    const min = Math.min(0, ...values);
    const max = Math.max(...values);
    const pad = 12 * dpr;
    const x = (i: number) => pad + (i / (rows.length - 1)) * (width - 2 * pad);
    const y = (v: number) => height - pad - ((v - min) / (max - min || 1)) * (height - 2 * pad);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#666";
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(pad, y(0));
    ctx.lineTo(width - pad, y(0));
    ctx.stroke();
    ctx.strokeStyle = "#4493f8";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    values.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
    ctx.stroke();
  }, [rows]);

  if ("error" in view) {
    return (
      <section className="card">
        <h2>Deterministic projection (B1)</h2>
        <p className="dim" data-testid="plan-empty">{view.error}</p>
      </section>
    );
  }

  const runout = rows.find((r) => r.unmetSpending > 0);
  const totalIn = rows.reduce((s, r) => s + r.contributions + r.employerMatch, 0);
  const last = rows[rows.length - 1]!;

  return (
    <>
      <section className="card">
        <h2>Deterministic projection (B1) — real (today's) dollars</h2>
        <p className="big" data-testid="plan-terminal">{money(last.netWorth)}</p>
        <p className="dim" data-testid="plan-summary">
          projected net worth in {last.year} · {money(totalIn)} contributed over the horizon
          {runout ? "" : " · no projected shortfall"}
        </p>
        {runout && (
          <p className="err" data-testid="plan-runout">
            Projected out of money in {runout.year} (B1 runs dry; spending unmet thereafter).
          </p>
        )}
        {view.notes.map((n) => (
          <p key={n} className="note dim">{n}</p>
        ))}
        <canvas ref={canvas} data-testid="plan-chart" />
      </section>

      <section className="card">
        <h2>Year-by-year waterfall (B1.1, B1.5)</h2>
        <table data-testid="plan-table">
          <thead>
            <tr>
              <th>Year</th>
              <th className="num">Income</th>
              <th className="num">Spending</th>
              <th className="num">One-off</th>
              <th className="num">Debt pay</th>
              <th className="num">Contrib.</th>
              <th className="num">Match</th>
              <th className="num">Net worth</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year} className={r.unmetSpending > 0 ? "neg" : undefined}>
                <td>{r.year}</td>
                <td className="num">{money(r.income)}</td>
                <td className="num">{money(r.spending)}</td>
                <td className="num">{r.oneOffSpends > 0 ? money(r.oneOffSpends) : "—"}</td>
                <td className="num">{r.debtPayments > 0 ? money(r.debtPayments) : "—"}</td>
                <td className="num">{r.contributions > 0 ? money(r.contributions) : "—"}</td>
                <td className="num">{r.employerMatch > 0 ? money(r.employerMatch) : "—"}</td>
                <td className={r.netWorth >= 0 ? "num pos" : "num neg"}>{money(r.netWorth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note dim">
          Projections, not advice — deterministic expected-growth view, no Monte Carlo yet (M3).
        </p>
      </section>
    </>
  );
}
