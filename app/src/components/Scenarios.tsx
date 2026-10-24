// SPDX-License-Identifier: Apache-2.0
// M4.5 (D13): snapshot the current plan's parameter set and diff any two
// snapshots. Everything is local; comparisons run against stored payloads,
// never live tables, so an old snapshot keeps meaning what it meant.
import { useMemo, useState } from "react";
import type { PlanView } from "../plan/build.ts";
import type { AppDatabase } from "../db/sqlite.ts";
import {
  deletePlanSnapshot,
  listPlanSnapshots,
  savePlanSnapshot,
} from "../db/repo.ts";
import { diffFlattened } from "../plan/diff.ts";
import {
  PLAN_SNAPSHOT_VERSION,
  captureSnapshotPayload,
  parseSnapshotPayload,
} from "../plan/snapshot.ts";
import { Field, FormRow, Submit, money } from "./ui.tsx";

const MAX_DIFF_ROWS = 60;

const fmt = (v: unknown): string => (v === undefined ? "—" : JSON.stringify(v) ?? "");
const dry = (year: number | null): string => (year === null ? "never" : String(year));

export function Scenarios({ db, view }: { db: AppDatabase; view: PlanView }) {
  const [refresh, setRefresh] = useState(0);
  const [selA, setSelA] = useState("");
  const [selB, setSelB] = useState("");
  const snapshots = useMemo(() => listPlanSnapshots(db), [db, refresh]);

  const byId = new Map(snapshots.map((s) => [s.id, s]));
  const a = (selA && byId.get(selA)) || snapshots[0];
  const b = (selB && byId.get(selB)) || snapshots[1];
  const pa = a && parseSnapshotPayload(a.plan_json);
  const pb = b && parseSnapshotPayload(b.plan_json);
  const payloadErr = (pa && "error" in pa && pa.error) || (pb && "error" in pb && pb.error);
  const diff = pa && pb && !("error" in pa) && !("error" in pb) && a?.id !== b?.id
    ? diffFlattened(
        { params: pa.params, market: pa.market, deathYear: pa.deathYear },
        { params: pb.params, market: pb.market, deathYear: pb.deathYear },
      )
    : null;

  const option = (s: (typeof snapshots)[number]) => <option key={s.id} value={s.id}>{s.name}</option>;

  return (
    <section className="card" data-testid="scenario-card">
      <h2>Scenario snapshots</h2>
      <FormRow
        testid="scenario-form"
        onSubmit={(values) => {
          const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
          savePlanSnapshot(db, {
            name: String(values.get("name") || `Plan ${stamp}`),
            paramVersion: PLAN_SNAPSHOT_VERSION,
            planJson: JSON.stringify(captureSnapshotPayload(view)),
          });
          setSelA("");
          setSelB("");
          setRefresh((r) => r + 1);
        }}
      >
        <Field label="Name">
          <input type="text" name="name" placeholder="Before job change" data-testid="scenario-name" />
        </Field>
        <Submit label="Snapshot plan" />
      </FormRow>
      <p className="dim">
        Captures the exact parameter set behind the projection above — latest 50 snapshots kept, on this device only.
      </p>
      {snapshots.length === 0 ? (
        <p className="dim" data-testid="scenario-empty">No snapshots yet.</p>
      ) : (
        <>
          <table data-testid="scenario-table">
            <thead>
              <tr><th>Name</th><th>Captured</th><th className="num">Terminal</th><th>Runs dry</th><th /></tr>
            </thead>
            <tbody>
              {snapshots.map((s) => {
                const p = parseSnapshotPayload(s.plan_json);
                return (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className="dim">{s.created_at.slice(0, 16).replace("T", " ")}</td>
                    <td className="num" data-testid={`terminal-${s.name}`}>{!("error" in p) ? money(p.summary.terminal) : "—"}</td>
                    <td>{!("error" in p) ? dry(p.summary.runoutYear) : "—"}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => { deletePlanSnapshot(db, s.id); setRefresh((r) => r + 1); }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div>
            <Field label="Compare A">
              <select data-testid="scenario-a" value={a?.id ?? ""} onChange={(e) => setSelA(e.target.value)}>
                {snapshots.map(option)}
              </select>
            </Field>
            <Field label="with B">
              <select data-testid="scenario-b" value={b?.id ?? ""} onChange={(e) => setSelB(e.target.value)}>
                {snapshots.map(option)}
              </select>
            </Field>
          </div>
          {payloadErr ? (
            <p className="err" data-testid="scenario-error">{payloadErr}</p>
          ) : a?.id === b?.id ? (
            <p className="dim">Pick two different snapshots to see what changed.</p>
          ) : diff && pa && pb && !("error" in pa) && !("error" in pb) ? (
            <div data-testid="scenario-diff">
              <h3>A · {a!.name} → B · {b!.name}</h3>
              <table data-testid="scenario-summary">
                <tbody>
                  <tr>
                    <th>Terminal net worth</th>
                    <td className="num">{money(pa.summary.terminal)}</td>
                    <td className="num">{money(pb.summary.terminal)}</td>
                    <td className="num" data-testid="scenario-delta">{money(pb.summary.terminal - pa.summary.terminal)}</td>
                  </tr>
                  <tr>
                    <th>Runs dry</th>
                    <td>{dry(pa.summary.runoutYear)}</td>
                    <td>{dry(pb.summary.runoutYear)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
              {diff.length === 0 ? (
                <p className="dim">Parameter sets are identical.</p>
              ) : (
                <table data-testid="scenario-diff-table">
                  <thead>
                    <tr><th>Parameter</th><th>A</th><th>B</th></tr>
                  </thead>
                  <tbody>
                    {diff.slice(0, MAX_DIFF_ROWS).map((d) => (
                      <tr key={d.path}>
                        <td><code>{d.path}</code></td>
                        <td>{fmt(d.before)}</td>
                        <td>{fmt(d.after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {diff.length > MAX_DIFF_ROWS && (
                <p className="dim">…and {diff.length - MAX_DIFF_ROWS} more changed parameters.</p>
              )}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
