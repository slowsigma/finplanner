# FinPlanner — Implementation Plan

Version: 0.1
Date: 2026-10-22
Status: working plan; derives from `FEATURE_SPEC.md` (what) and `TECH_DECISIONS.md` v1.0 (how, all D1–D14 ACCEPTED and binding)

Companion to the other two docs: this is the **when and in what order**. Milestones follow
FEATURE_SPEC §13 build order; each has an exit gate that must pass before the next starts.
Spec IDs (A1, B2.4, M1, ToU1…) and decision IDs (D3, D9…) are used throughout — this plan
never restates them, only sequences them.

---

## Guiding constraints (from accepted decisions — not re-openable here)

- Offline-only, zero runtime network requests; enforced by CSP + CI egress test (D3)
- No backend, no auth, no aggregation — ever, under current decisions (D7, D12, D8)
- Engine v0 in pure TypeScript; Rust/WASM port only if the benchmark gate fails (D2)
- pnpm + Turborepo monorepo: `engine/`, `app/`, `shared-schema/` (D11)
- Apache-2.0 + LICENSE/NOTICE/SPDX headers from commit one (D13)
- Engine correctness is the product: golden/property/differential tests are CI gates (D10)

## Open questions that block specific milestones (from FEATURE_SPEC §14)

| Question                                                                  | Blocks              | Resolve by                             |
| ------------------------------------------------------------------------- | ------------------- | -------------------------------------- |
| Tax-wrapper abstraction: US-only hard-coding vs. layer from day 1         | M2 data model       | **RESOLVED 2026-10-22 → D15** (US-only schema, `WrapperRules` layer in engine) |
| Module F: headline differentiator vs. phase-2 depth                       | M5 scope, marketing | decide at M4 exit                      |
| ToU final language (counsel review, `[BRACKETS]` in LEGAL_TERMS_DRAFT.md) | public beta (M5)    | start counsel outreach at M3           |
| HSA rules source validation (IRS, not Wikipedia)                          | B1.3 tax model      | before M2 tax work                     |

---

## M0 — Repo & engine spike (de-risk everything)

Goal: prove the simulation core is fast enough and correct enough to found the product on.
No UI beyond a debug chart.

- Monorepo scaffold: pnpm + Turborepo; `engine/`, `app/`, `shared-schema/` (empty) (D11)
- Apache-2.0 `LICENSE`, `NOTICE`, SPDX headers, CI skeleton (GitHub Actions) (D13, D11)
- Engine v0 (TS): deterministic year-by-year projection — real-terms net worth + cash flow
  (B1.1), single household, static allocation, no taxes yet
- MC trial engine: seedable PCG/xoshiro, per-trial streams from (master seed, trial index),
  correlated normal draws across asset classes (D9, B2.1)
- Fan-chart debug output (canvas) proving P5/P50/P95 band extraction
- **Gate G0**: 10k trials × 60 yrs × 6 asset classes re-runs in **< 500 ms** on a throttled
  mid-range phone profile in CI (3x margin under R1). Fail ⇒ open a D2 decision entry to
  port the hot loop to Rust/WASM — do not silently switch.
- **Gate G0b**: flat-world closed-form annuity identity test passes; same seed ⇒ bit-identical
  results across runs and platforms (R2).

## M1 — Data model, storage, shell app

Goal: a real (if empty) app that persists data forever and can't phone home.

- `shared-schema/`: versioned SQLite schema over the §4 domain model (Household, Account,
  Liability, IncomeStream, SpendingProfile, ScheduledOneOffSpend, Goal, Plan,
  AssumptionsSet); forward-only migration runner (D4, R5)
- SQLite-wasm over OPFS integration in `app/`; encrypted export/import file = the backup
  and multi-device story (D3, D4)
- React 19 + Vite + PWA scaffold; service worker offline-cache-only; CSP
  `default-src 'self'`, everything bundled same-origin (D5, D6, D3)
- **CI egress test (D3): Playwright aborting all non-same-origin routes — any attempted
  request fails the build.** Turns on now, not at beta; every later milestone inherits it.
- Manual entry UI: household, accounts, liabilities, income/spending (A1, A2, A5)
- Net-worth statement + history/trend chart (A4; D3-scales/canvas per D5)
- **Gate G1**: fresh install → enter a 2-adult household with 5 accounts → export → wipe →
  re-import → identical data; egress test green; schema v1 frozen enough that M2 can build
  projections on it.
- Decide the tax-wrapper abstraction question here, before the AssumptionsSet schema settles.

## M2 — Accumulation projection + basic goals

Goal: the deterministic plan becomes useful before any randomness.

- Account-level growth, per-asset-class returns, contribution limits + employer match (B1.2)
- Simplified marginal-bracket tax model: tax-advantaged contributions/withdrawals, RMDs,
  SS taxation estimate (B1.3) — HSA rules validated against IRS sources first
- Real-terms toggle everywhere; no naked nominal future dollars (B1.4)
- Scheduled one-off spends flowing through the waterfall and per-year view (B1.5, §4 entity)
- Goals with target date/amount; on-track tracking: expected-vs-actual at checkpoints,
  required savings rate (D1, D2)
- FI number & FI date with user-adjustable SWR, "plan not contract" framing (D3-of-§8/D3)
- CSV/OFX parse-only import (A3)
- **Gate G2**: golden fixtures — Bengen/Trinity withdrawal rates reproduced, RMD schedule
  fixtures exact (D10); property test: more savings ⇒ weakly more success.

## M3 — Monte Carlo as a product feature

Goal: sliders + success metrics; the spec's core question answerable interactively.

- Success metrics per goal: ruin / goal-funded / essential-spending floor; P10/P50/P90 (B2.3)
- Live what-if sliders: savings rate, retirement age, SS claiming age, retirement spending,
  career-gap years — each re-running the sim; cache/incremental re-sim allowed (B2.4)
- Capital-market assumptions manager: editable return/vol/correlation/inflation with source
  notes; assumption-set version hash stored with every scenario (B2.2, D9, R3)
- Variance reduction: antithetic variates, control variates, Sobol (B2.8, D9)
- Longevity sampling: sex-conditional mortality tables, default horizon age 95, survivor
  rules, joint spousal longevity (B2.5)
- Stochastic spending shocks: medical/LTC/repair/job-loss; essential/discretionary cut rules (B2.7)
- Historical-stress replays: 1929 / 2000–2009 / 2008 / rolling 10-yr starts (B2.6)
- Fan chart, retirement-risk-zone view, sequence-risk score (C1, C2, C3)
- **Gate G3**: R1 holds inside the app UI (< 2 s slider re-run, throttled-device CI perf
  gate per D11); seeded snapshot regression suite locked in — any changed number in CI must
  be investigated, never rebased away (D10); reported p̂ shown with its sampling CI.

## M4 — Mitigations + consent + first public beta

Goal: the differentiating comparison report, legally-shipped product.

- Withdrawal policies in-trial: fixed + guardrails (M2-of-§7); cash/short-duration buffer
  policy (M1); guaranteed-income floor modeling (M5); SS claiming table-input analysis
  (D4); simple pension/annuity modeling (D5)
- Mitigation comparison report: same plan ±each lever — success probability, P10 terminal
  wealth/min spending, expected median lifetime spending; per-lever marginal value (C3.1, C3.2)
- ToU1–ToU3: first-run clickwrap gate, locally recorded acceptance (date + ToU version),
  persistent "projections, not advice" footer + heightened tax/SS notices (§11.1, D14)
  — **requires counsel-approved text from LEGAL_TERMS_DRAFT.md; the public-beta blocker.**
- Behavior/NFR polish: probabilities not point forecasts, drawdown context tables, panic-year
  plan-of-action checklist (§12)
- Repo public, GitHub Release with static files (D11, D13)
- **Gate G4 (beta)**: clickwrap + recorded acceptance + egress tests pass in a fresh-profile
  Playwright run; ToU text counsel-approved; versioned release notes.

## M5 — Phase-2 depth (post-beta, prioritizable backlog)

Sequenced by value/risk, each its own release:

1. Tax-aware withdrawal ordering + Roth conversion/bracket-fill logic (M6, D6)
2. Flexible retirement-date rule + glide-path editor (M3, M4, E3); percent-of-portfolio
   withdrawal policy
3. Bond ladder / dedicated income portfolio model (M7)
4. Worst-N broken-sequences table (C4); SS claiming optimizer (earnings-record import)
5. Allocation drift/rebalance alerts, risk questionnaire (needs legal review), asset
   location analysis (E1–E6)
6. Life-event milestones: 529/college, sinking funds, debt-vs-invest comparison (D7, D8)
7. Estate/beneficiary vault + insurance-gap checklist incl. LTC (A6, A7)
8. **Module F** (F1–F7): benefit-cliff simulator, inheritance-channel comparison,
   post-caregiver horizon, event-driven `LifeEvent` contingency layer — decide at M4 exit
   whether it headlines a niche launch or ships as depth behind the planner; UPL boundary
   holds: education + quantification + referral only (F6, §11)

## Cross-cutting workstreams (start early, never a milestone)

- **Legal**: counsel outreach for ToU text by M3 (beta blocker at M4); §11 adviser-line
  review before any E2-type feature; SSA/Module F disclaimers per F6.
- **Validation data**: replace Wikipedia-era defaults (§15) with sourced, versioned default
  assumption sets before beta — they are product content, not trivia.
- **Docs**: this plan updates at each gate; new decisions go to TECH_DECISIONS.md decision
  log, never into code silently.

## Estimate shape

M0 ≈ weeks (pure de-risking). M1–M3 are the bulk of the MVP; M4 is beta. No dates are set —
gates, not calendars, decide progression.
