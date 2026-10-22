// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useRef, useState } from "react";
import type { GoalSpec, McSimParams, ProjectionParams, StressConfig } from "@finplanner/engine";
import { mcSummary, simulatePlanMonteCarlo } from "@finplanner/engine";
import type { AppDatabase } from "../db/sqlite.ts";
import { getSpending, listGoals, saveScenarioRun, updateDefaultAssumptions } from "../db/repo.ts";
import { buildPlan } from "../plan/build.ts";
import { FormRow, money, pct, Submit } from "./ui.tsx";

const QUANTILES = [0.1, 0.25, 0.5, 0.75, 0.9];
const SEED0 = 20261022;

/**
 * Well-known stress windows as REAL annual returns in percent. FROM-MEMORY
 * PLACEHOLDERS pending a validated source (Shiller/Dimson is blocked on this
 * box, B1.3 note) — edit freely; the engine ships no data of its own.
 */
const STRESS_PRESETS: Record<string, { eq: number[]; bond: number[] }> = {
  "1929–1932 (Great Depression)": { eq: [-2, -28, 26, -8], bond: [2.5, 17, 8, 3] },
  "1973–1974 (stagflation)": { eq: [-21, -34], bond: [-2.5, -2] },
  "2000–2002 (dot-com bust)": { eq: [-12, -14, -23], bond: [5.5, 6, 6] },
  "2008 (global financial crisis)": { eq: [-37], bond: [8] },
};

function parseReturnsPct(text: string): number[] {
  return (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map((s) => Number(s) / 100);
}

function Slider(props: {
  testid: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider">
      <span>{props.label}</span>
      <input
        type="range"
        data-testid={props.testid}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <span className="num">{props.format(props.value)}</span>
    </label>
  );
}

export function MonteCarlo({ db, version, refresh }: { db: AppDatabase; version: number; refresh: () => void }) {
  const view = useMemo(() => buildPlan(db), [db, version]);
  const [extraSavings, setExtraSavings] = useState(0);
  const [retireShift, setRetireShift] = useState(0);
  const [retSpendPct, setRetSpendPct] = useState(100);
  const [trials, setTrials] = useState(500);
  const [longSd, setLongSd] = useState(4);
  const [shockPct, setShockPct] = useState(5);
  const [stressMode, setStressMode] = useState<"iid" | "all" | "bootstrap">("iid");
  const [stressWindow, setStressWindow] = useState(10);
  const [stressText, setStressText] = useState<Record<string, string>>({});
  const [seedOffset, setSeedOffset] = useState(0);
  const [saved, setSaved] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);

  const goals: GoalSpec[] = useMemo(
    () =>
      listGoals(db).map((g) => ({
        id: g.id,
        label: g.label,
        kind: g.kind as GoalSpec["kind"],
        targetYear: g.target_year,
        targetAmount: g.target_amount,
        annualRetirementNeed: g.annual_retirement_need,
      })),
    [db, version],
  );

  const run = useMemo(() => {
    if ("error" in view) return null;
    const base = view.params;
    const projection: ProjectionParams = {
      ...base,
      incomeStreams:
        extraSavings > 0
          ? [
              ...base.incomeStreams,
              { id: "mc-extra-savings", kind: "other" as const, annualAmount: extraSavings, growthReal: 0, startYear: base.startYear },
            ]
          : base.incomeStreams,
      spending: {
        annualNow: base.spending.annualNow,
        annualRetirement: base.spending.annualRetirement * (retSpendPct / 100),
        retirementStartYear:
          base.spending.retirementStartYear === null ? null : base.spending.retirementStartYear + retireShift,
      },
    };
    let stress: StressConfig | undefined;
    if (stressMode !== "iid") {
      const seriesByClass: Record<string, readonly number[]> = {};
      for (const c of view.market.classes) {
        const nums = parseReturnsPct(stressText[c.name] ?? "");
        if (nums.length === 0)
          return {
            error: `Paste real % returns for '${view.assumptions.assets.find((x) => x.name === c.name)?.label ?? c.name}' (B2.6) or switch replay off.`,
          };
        seriesByClass[c.name] = nums;
      }
      stress = { seriesByClass, windowYears: stressWindow, mode: stressMode };
    }
    const essentialShare = getSpending(db)?.essential_share ?? 0.7;
    const params: McSimParams = {
      projection,
      market: view.market,
      goals,
      withdrawalRate: view.assumptions.withdrawalRate ?? 0.04,
      seed: (SEED0 + seedOffset) | 0,
      trials,
      // Rolling-start replay has a fixed (possibly odd) window count; pairing
      // applies to iid/bootstrap only.
      antithetic: stressMode === "all" ? false : undefined,
      essentialShare: essentialShare > 1 ? essentialShare / 100 : essentialShare,
      deaths: view.deathYears,
      longevitySdYears: longSd,
      spendingSigma: shockPct / 100,
      stress,
    };
    try {
      const t0 = performance.now();
      const result = simulatePlanMonteCarlo(params);
      const summary = mcSummary(
        result,
        Object.fromEntries(goals.map((g) => [g.id, g.label])),
        QUANTILES,
      );
      return { result, summary, ms: performance.now() - t0, params, marketHash: view.marketHash };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [view, db, goals, extraSavings, retireShift, retSpendPct, trials, longSd, shockPct, stressMode, stressWindow, stressText, seedOffset]);

  const bands = run && !("error" in run) ? run.summary.bands : undefined;
  useEffect(() => {
    const el = canvas.current;
    if (!el || !bands || bands.year.length < 2) return;
    const dpr = window.devicePixelRatio || 1;
    const width = el.clientWidth * dpr;
    const height = el.clientHeight * dpr;
    el.width = width;
    el.height = height;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const [p10raw, p25raw, p50raw, p75raw, p90raw] = bands.byQuantile;
    // Longevity censoring leaves NaN suffixes (B2.5): draw the finite prefix.
    let n = bands.year.length;
    while (n > 0 && !(Number.isFinite(p10raw![n - 1]!) && Number.isFinite(p90raw![n - 1]!))) n--;
    if (n < 2) return;
    const p10 = p10raw!.slice(0, n);
    const p25 = p25raw!.slice(0, n);
    const p50 = p50raw!.slice(0, n);
    const p75 = p75raw!.slice(0, n);
    const p90 = p90raw!.slice(0, n);
    const min = Math.min(0, ...p10);
    const max = Math.max(...p90);
    const pad = 12 * dpr;
    const x = (i: number) => pad + (i / (n - 1)) * (width - 2 * pad);
    const y = (v: number) => height - pad - ((v - min) / (max - min || 1)) * (height - 2 * pad);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#666";
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(pad, y(0));
    ctx.lineTo(width - pad, y(0));
    ctx.stroke();
    const band = (lo: number[], hi: number[], fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      lo.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
      for (let i = hi.length - 1; i >= 0; i--) ctx.lineTo(x(i), y(hi[i]!));
      ctx.closePath();
      ctx.fill();
    };
    band(p10, p90, "rgba(68, 147, 248, 0.15)");
    band(p25, p75, "rgba(68, 147, 248, 0.3)");
    ctx.strokeStyle = "#4493f8";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    p50.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
    ctx.stroke();
  }, [bands]);

  if ("error" in view) {
    return (
      <section className="card">
        <h2>Monte Carlo (B2)</h2>
        <p className="dim" data-testid="risk-empty">{view.error}</p>
      </section>
    );
  }
  const classes = view.market.classes;
  const classLabel: Record<string, string> = Object.fromEntries(view.assumptions.assets.map((c) => [c.name, c.label]));
  const s = run && !("error" in run) ? run.summary : null;
  const cv = run && !("error" in run) ? run.result.terminalCv : undefined;

  const applyPreset = (name: string) => {
    const preset = STRESS_PRESETS[name];
    if (!preset) return;
    const next: Record<string, string> = {};
    for (const c of classes) {
      const series = c.name === "bonds" ? preset.bond : c.name === "cash" ? preset.eq.map(() => 0.5) : preset.eq;
      next[c.name] = series.join(", ");
    }
    setStressText(next);
    setStressWindow(Math.min(stressWindow, preset.eq.length));
  };

  return (
    <>
      <section className="card">
        <h2>Monte Carlo risk simulation (B2) — real dollars, {s ? s.trials : "…"} seeded paths</h2>
        <div className="sliders">
          <Slider testid="slider-extra-savings" label="Extra savings $/yr" min={0} max={20000} step={500}
            value={extraSavings} format={(v) => money(v)} onChange={setExtraSavings} />
          <Slider testid="slider-retire-shift" label="Retire later by" min={0} max={10} step={1}
            value={retireShift} format={(v) => `${v} yr`} onChange={setRetireShift} />
          <Slider testid="slider-ret-spend" label="Retirement spending" min={50} max={150} step={5}
            value={retSpendPct} format={(v) => `${v}%`} onChange={setRetSpendPct} />
          <Slider testid="slider-longsd" label="Longevity ± σ" min={0} max={8} step={0.5}
            value={longSd} format={(v) => `${v} yr`} onChange={setLongSd} />
          <Slider testid="slider-shock" label="Spending shocks σ" min={0} max={15} step={1}
            value={shockPct} format={(v) => `${v}%`} onChange={setShockPct} />
          <label className="slider">
            <span>Trials</span>
            <select data-testid="risk-trials" value={trials} onChange={(e) => setTrials(Number(e.target.value))}>
              <option value={250}>250</option>
              <option value={500}>500</option>
              <option value={1000}>1000</option>
            </select>
          </label>
        </div>
        {run && "error" in run && <p className="err" data-testid="risk-error">{run.error}</p>}
        {s && (
          <>
            <p className="big" data-testid="risk-success">
              {pct(s.successRate)} of paths fund every goal
              <span className="dim"> ± {pct(s.successHalfWidth)}</span>
            </p>
            <p className="dim" data-testid="risk-ruin">
              out-of-money: {pct(s.ruinRate + s.floorBreachRate)} · essential-spending floor breached: {pct(s.floorBreachRate)}
            </p>
            {cv && cv.varianceRatio < 0.99 && (
              <p className="dim" data-testid="risk-cv">
                CV-adjusted terminal wealth {money(cv.adjustedMean)} ± {money(cv.adjustedHalfWidth)}
                {" "}(raw ± {money(cv.rawHalfWidth)}, variance ×{cv.varianceRatio.toFixed(2)})
              </p>
            )}
            {goals.length > 0 && (
              <table data-testid="risk-goals-table">
                <thead>
                  <tr><th>Goal</th><th className="num">Funded</th><th className="num">Median shortfall</th></tr>
                </thead>
                <tbody>
                  {s.goals.map((g) => (
                    <tr key={g.id}>
                      <td>{g.label}</td>
                      <td className="num" data-testid={`risk-goal-${g.id}`}>{pct(g.fundedRate)} ± {pct(g.halfWidth)}</td>
                      <td className="num">{g.medianShortfall > 0 ? money(g.medianShortfall) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <canvas ref={canvas} data-testid="risk-chart" />
          </>
        )}
        <p className="note dim" data-testid="risk-note">
          Fan: P10–P90 (dark P25–P75) of year-end net worth. Probabilities carry ± sampling error;
          antithetic pairs + control variates (B2.8) tighten them — Sobol sequences were skipped
          (dimension ≈ years × classes is too high). Re-seed only via the button — results are
          reproducible (seed {run && !("error" in run) ? run.params.seed : "?"}, assumptions{" "}
          {view.marketHash}, <span data-testid="risk-ms">{run && !("error" in run) ? Math.round(run.ms) : "–"} ms</span>).
          Projections & education, not financial advice.
        </p>
        <div className="inline">
          <button className="primary" type="button" data-testid="risk-reseed" onClick={() => { setSeedOffset((o) => o + 1); setSaved(""); }}>
            Re-seed
          </button>
          <button
            className="primary"
            type="button"
            data-testid="risk-save-run"
            disabled={!s}
            onClick={() => {
              if (!s || !run || "error" in run) return;
              saveScenarioRun(db, `MC ${new Date().toISOString().slice(0, 10)}`, {
                seed: run.params.seed,
                trials: run.params.trials,
                sliders: { extraSavings, retireShift, retSpendPct, longSd, shockPct, stressMode, stressWindow },
                assumptionsHash: run.marketHash,
                essentialShare: run.params.essentialShare,
                result: { ruinRate: s.ruinRate, floorBreachRate: s.floorBreachRate, successRate: s.successRate, goals: s.goals },
              });
              setSaved("run saved with assumption hash " + run.marketHash);
            }}
          >
            Save run
          </button>
        </div>
        {saved && <p className="dim" data-testid="risk-saved">{saved}</p>}
      </section>

      <section className="card">
        <h2>Historical stress replay (B2.6)</h2>
        <div className="sliders">
          <label className="slider">
            <span>Returns</span>
            <select data-testid="stress-mode" value={stressMode} onChange={(e) => setStressMode(e.target.value as typeof stressMode)}>
              <option value="iid">Assumed i.i.d. draws</option>
              <option value="all">Replay every window (rolling starts)</option>
              <option value="bootstrap">Block bootstrap from history</option>
            </select>
          </label>
          <label className="slider">
            <span>Window</span>
            <select data-testid="stress-window" value={stressWindow} onChange={(e) => setStressWindow(Number(e.target.value))}>
              {[1, 3, 5, 10, 15, 20, 30].map((w) => (
                <option key={w} value={w}>{w} yr</option>
              ))}
            </select>
          </label>
          <label className="slider">
            <span>Preset (unvalidated)</span>
            <select data-testid="stress-preset" defaultValue="" onChange={(e) => applyPreset(e.target.value)}>
              <option value="">— paste your own —</option>
              {Object.keys(STRESS_PRESETS).map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>
        </div>
        {stressMode !== "iid" && (
          <div className="stress-paste">
            {classes.map((c) => (
              <label key={c.name} className="slider">
                <span>{classLabel[c.name] ?? c.name} real %</span>
                <input
                  data-testid={`stress-history-${c.name}`}
                  type="text"
                  style={{ width: 280 }}
                  placeholder="-9, 21, -24, …"
                  value={stressText[c.name] ?? ""}
                  onChange={(e) => setStressText((s2) => ({ ...s2, [c.name]: e.target.value }))}
                />
              </label>
            ))}
          </div>
        )}
        <p className="note dim">
          Stress windows are from-memory placeholders (B1.3 sources are unreachable from this machine) —
          replace with sourced data and note the provenance before relying on them.
        </p>
      </section>

      <section className="card">
        <h2>Capital-market assumptions (B2.2) — real returns, unvalidated placeholders</h2>
        <AssumptionsEditor db={db} version={version} refresh={refresh} />
      </section>
    </>
  );
}

function AssumptionsEditor({ db, version, refresh }: { db: AppDatabase; version: number; refresh: () => void }) {
  const view = useMemo(() => buildPlan(db), [db, version]);
  if ("error" in view) return null;
  const a = view.assumptions;
  return (
    <>
      <FormRow
        testid="edit-assumptions"
        onSubmit={(values) => {
          const assets = a.assets.map((c) => ({
            ...c,
            meanReal: Number(values.get(`mean_${c.name}`) ?? "") / 100,
            volReal: Number(values.get(`vol_${c.name}`) ?? "") / 100,
          }));
          const pairs = { ...a.correlationPairs };
          for (const k of Object.keys(pairs)) {
            pairs[k] = Number(values.get(`corr_${k.replaceAll("|", "_")}`) ?? "") / 100;
          }
          updateDefaultAssumptions(db, { ...a, assetReturns: Object.fromEntries(assets.map((x) => [x.name, x.meanReal])), assets, correlationPairs: pairs });
          refresh();
        }}
      >
        {a.assets.map((c) => (
          <label key={c.name} className="slider">
            <span>{c.label} mean/vol %</span>
            <input data-testid={`assum-mean-${c.name}`} type="number" step={0.1} name={`mean_${c.name}`} defaultValue={(c.meanReal * 100).toFixed(1)} />
            <input data-testid={`assum-vol-${c.name}`} type="number" step={0.5} min={0} name={`vol_${c.name}`} defaultValue={(c.volReal * 100).toFixed(1)} />
          </label>
        ))}
        {Object.entries(a.correlationPairs).map(([k, v]) => (
          <label key={k} className="slider">
            <span>corr {k.replaceAll("|", " ↔ ").replaceAll("_", " ")}</span>
            <input type="number" step={5} min={-100} max={100} name={`corr_${k.replaceAll("|", "_")}`} defaultValue={(v * 100).toFixed(0)} />
          </label>
        ))}
        <Submit label="Save assumptions" />
      </FormRow>
      <p className="note dim">
        Current set hash {view.marketHash} — stored with every saved run so numbers stay reproducible.
      </p>
    </>
  );
}
