# FinPlanner — Technology Stack & Architecture Decisions

Version: 1.0
Date: 2026-10-21
Status: **All decisions (D1–D14) ACCEPTED — this document is the binding record.**
As the record of record: once a decision is made it is marked `ACCEPTED` here (with date
and rationale); code that contradicts an accepted decision is a bug, and changing one
requires a `SUPERSEDED` entry, not a silent rewrite.

Companion to `FEATURE_SPEC.md`. The spec's hard requirements that constrain stack choice:

- R1: 10k-trial Monte Carlo re-run in **< 2 s** with live sliders (spec B2.4)
- R2: full determinism/reproducibility of any scenario (seed + assumption version)
- R3: results traceable to assumptions (no black box) (spec B2.2)
- R4: sensitive financial data; privacy posture must survive any hosting model
- R5: long-lived data: a plan spans 50+ years; format rot is a product failure
- R6: engine must eventually support path-dependent withdrawal policies, stochastic
  shocks, mortality sampling, variance reduction (spec B2.7/B2.8)

Status legend: `PROPOSED` (this doc) → `ACCEPTED` (owner sign-off) → `SUPERSEDED` by Dx.

## Decision summary

| ID  | Question                              | Recommendation                                                                               | Status                                  |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------- |
| D1  | Where does the simulation engine run? | **Client-side only — server path dropped** (supersedes C)                                    | ACCEPTED (2026-10-21)                   |
| D2  | Simulation core language              | Rust core → WASM; pure-TS spike as gate (option C)                | ACCEPTED (2026-10-21) |
| D3  | Data residency & sync model           | **Fully local & offline-only; zero network requests at runtime**  | ACCEPTED (2026-10-21) |
| D4  | Local storage substrate               | SQLite over OPFS (sqlite-wasm) + versioned schema                 | ACCEPTED (2026-10-21) |
| D5  | Web framework / rendering             | TypeScript + React; canvas for fan charts                         | ACCEPTED (2026-10-21) |
| D6  | Client platform strategy              | Responsive PWA first; no native mobile at MVP                     | ACCEPTED (2026-10-21) |
| D7  | Backend scope & shape                 | **No backend at all** (supersedes thin-service plan)                                         | ACCEPTED (2026-10-21)                   |
| D8  | Account aggregation                   | **Manual + CSV/OFX import only; bank aggregation dropped entirely** | ACCEPTED (2026-10-21) |
| D9  | RNG & MC numerics specifics           | Seedable PCG/xoshiro; Sobol; deterministic reduce                                            | ACCEPTED (2026-10-21)                   |
| D10 | Engine validation & QA strategy       | Golden tests vs published studies + statistical CI checks                                    | ACCEPTED (2026-10-21)                   |
| D11 | Hosting, CI, monorepo tooling         | pnpm + Turborepo; static file distribution only (per D3/D7); minimal CI                     | ACCEPTED (2026-10-21)                   |
| D12 | Auth & account model                  | **None — no accounts, ever, while offline-only D3 stands** (supersedes)                      | ACCEPTED (2026-10-21)                   |
| D13 | Licensing & openness posture          | **Whole project open source under Apache-2.0** (supersedes MIT)                              | ACCEPTED (2026-10-21, revised same day) |
| D14 | Terms of use, disclaimers & consent   | Clickwrap first-run agreement + persistent "not advice" notices                              | ACCEPTED (2026-10-21)                   |
| D15 | Tax-wrapper abstraction               | US-only wrapper types in schema v1; engine coded against internal `WrapperRules` layer      | ACCEPTED (2026-10-22)                   |

---

## D1 — Simulation compute location

Options:
- **A. Client-side only (WASM/JS in browser).** Zero server compute cost; per-user cost
  ∝ 0 for us; private by construction (assumptions never leave device); offline works.
  Limits: low-end phones, 100k+ trial "cinema mode" runs.
- **B. Server-side only.** Uniform performance, but per-user compute cost on every slider
  tick (serverless bills scale badly with <2 s loops × N users), uploads the most sensitive
  data, and kills offline. Directly fights R4.
- **C. Hybrid (recommended): client default, server option** for huge runs / shared plan
  reports, using the *same* engine binary (via Node/WASM on server, WASM in browser) so
  results are bit-comparable (R2).

**Recommendation: C, with the client path built first.** Server execution is an
after-PMF luxury, not an MVP dependency.

**RESOLVED (2026-10-21): A — client-side only.** Supersedes recommendation C: per the
offline-only decision (D3), there is no server path at all — in MVP or later. The
same-engine bit-comparability argument (R2) becomes moot-but-harmless: one engine, one
place it runs.

## D2 — Simulation core language

Options:
- **A. Pure TypeScript** with `Float64Array`, no GC churn per trial. Fastest to build;
  single codebase. 10k trials × ~60 yrs × ~6 asset classes ≈ ~3.6M draws — trivially
  feasible even without SIMD; variance reduction (spec B2.8) further cuts needed N.
  Risk: 50x-what-if and Sobol/threads paths get awkward near browser limits.
- **B. Rust core, compiled to WASM** (browser + Node + future native). 10–100x headroom,
  `wasm-simd`/threads, one engine reused everywhere. Cost: build complexity, slower
  iteration, harder hiring/contributing.
- **C. Two-tier: TS first, Rust port of hot loop if benchmark fails** (recommended).
  Gate: build engine v0 in TS during the spec's build-order step 1; if 10k-trial re-run
  exceeds 500 ms on a mid-range phone (3x margin under R1), port the inner loop to Rust.
  Keep the TS engine as reference implementation for differential testing.

**ACCEPTED (2026-10-21): option C.** Build engine v0 in TypeScript; port the hot loop to
Rust/WASM only if the 10k-trial benchmark gate (>500 ms on a mid-range phone) fails.
TS reference engine retained permanently for differential testing (D10).

## D3 — Data residency & sync

Options:
- **A. Cloud-first** (all data in our Postgres): simplest UX across devices; maximum
  privacy burden (breach blast radius, retention duties, aggregation-ToS entanglement).
- **B. Local-first, sync later (recommended).** MVP: data lives in the browser (OPFS),
  with encrypted export/import file as the escape hatch and "backup" story. Sync (E2EE)
  ships with the paid tier when there's revenue to fund doing it right. Matches R4/R5;
  kills most compliance surface at MVP.
- **C. Self-host BYO-server:** appeals to the same privacy-minded early users but is a
  support burden; revisit only if that segment shows up explicitly.

**DECIDED (2026-10-21): fully local, offline-only — stronger than option B.** All data
stays on the user's device; the app makes **no network requests of any kind at runtime**
(air-gap capable: no telemetry, no analytics, no CDNs, no remote fonts, no update pings,
no license checks). Distribution may be internet-based (download/update via browser or
package), but once loaded the app must run fully disconnected. Escape hatch = encrypted
export/import files (also how multi-device "sync" works, manually, forever, unless a
future decision supersedes this).

Enforcement as engineering requirements:
- CSP `default-src 'self'` (+ no `connect-src` escapes); no remote URLs in the bundle;
  all assets/worker scripts same-origin.
- CI egress test: Playwright with all network routes aborted except same-origin —
  any request attempt fails the build.
- PWA/service-worker (D6) used only for offline caching, never for fetch-through.
- Update flow = user-initiated download/reinstall; data survives via D4 storage + exports.

## D4 — Local storage substrate

Options: SQLite-in-browser (`sqlite-wasm`/wa-sqlite over OPFS) — recommended: real
queries, relational fit (accounts, transactions, goals, milestones), easy export, future
portability to native shells; vs IndexedDB/`idb-keyval` (simpler, weaker query story); vs
localStorage (non-starter at this data size). Schema versioned + forward-only migrations
(R5: a 2027 export must open in 2040).

**ACCEPTED (2026-10-21).** SQLite over OPFS (wa-sqlite/sqlite-wasm), versioned schema with
forward-only migrations; the same file format doubles as the encrypted export/import
container (D3's backup story) and future native-shell port target (D6).

## D5 — Web framework & charts

Recommendation: **TypeScript + React 19 + Vite**; charts hand-rolled with **D3 scales +
canvas** (Monte Carlo fan charts with 10k paths are canvas territory; SVG dies there),
`@observablehq/plots` or `visx` for the routine charts. React over Svelte/Solid purely on
hiring/ecosystem grounds — the app is chart-and-form heavy, not framework-sensitive.

**ACCEPTED (2026-10-21).** All chart libraries and fonts bundled same-origin — no CDNs
(D3 offline-only).

## D6 — Client platform

PWA-first (installable, offline via service worker + OPFS persistence — fits D3). No
native mobile at MVP; revisit with **Capacitor wrap first, React Native later** only if
mobile revenue justifies. Desktop app (Tauri) is a power-user option later, reusing the
same WASM engine.

**ACCEPTED (2026-10-21).** PWA service worker is offline-cache-only (never fetch-through,
per D3); installs fully disconnected after first load. Capacitor/Tauri remain
post-PMF, optional, and would also be fully offline apps.

## D7 — Backend

MVP backend surface deliberately tiny: static hosting + (if D12 auth is enabled) account
records only. When sync/aggregation/billing arrive: **one boring server** — Postgres +
HTTP service (**Hono or Fastify, Node**; or Rust/axum if D2-C landed and team fits),
row-level encryption, no microservices. Avoid heavyweight BaaS (Supabase/Firebase) until
the E2EE-sync design is settled — retrofitting E2EE onto a document-sync BaaS is a known
trap.

**RESOLVED (2026-10-21): no backend, at all, ever (under this decision).** Supersedes the
"thin service later" plan: hosting is purely static file distribution (or none — local
files). No sync, no billing server, no auth server (see D12), no aggregation proxy. If
monetization is ever pursued, it must not require phone-home; license/billing UX (if any)
would need its own superseding decision.

## D8 — Account aggregation

- MVP: **manual entry + CSV/OFX import** (parse-only, never stores bank credentials) —
  honest scope, no ToS entanglement, works for the projection-critical data (balances,
  contribution rates).
- Phase 2: **Plaid** (default, ecosystem depth) vs Teller/MX (open-banking, cheaper at
  scale). Constraint to verify before committing: aggregator ToS around storing derived
  data and re-delivery, which interacts with D3/D7.
- **RESOLVED (2026-10-21): option (a) — aggregation dropped permanently.** No bank
  connections, online companion tool, or aggregator relationship of any kind, ever, under
  this decision. Data enters via manual entry and file import (CSV/OFX, parse-only). Any
  future revival would require superseding both this and D3.

## D9 — RNG & numerics

- Seedable, fast, decent-quality PRNG (**PCG32/xoshiro2+**), never `Math.random` (R2).
- Sobol/LDS + antithetic variates per spec B2.8; per-trial RNG streams derived from
  (master seed, trial index) so a single path can be re-sampled and inspected — a debug
  and explainability feature (R3).
- Deterministic reduction order for aggregates (P10/P50/P90 via sorted quantiles of
  per-trial terminal/minimum values); store the assumption-set version hash with every
  saved scenario.

**ACCEPTED (2026-10-21).**

## D10 — Validation & QA (the engine *is* the product; it must be unimpeachable)

- **Golden tests** vs published results: Bengen/Trinity withdrawal rates, flat-world
  closed-form annuity identities, RMD schedule fixtures.
- **Property tests**: more savings ⇒ weakly more success; adding a guaranteed floor ⇒
  weakly less sequence-risk loss; convergence toward analytic means as N grows.
- **Differential tests**: TS reference vs WASM engine bit-equality; seeded snapshot
  regression for every release (never "fix" a changed number — investigate it).
- Statistical tolerance: report success-probability confidence intervals (R2 ties
  reported p̂ to its ± sampling error).

**ACCEPTED (2026-10-21).** These become CI gates, not aspirations: golden fixtures,
property tests, seeded snapshot regressions, and (once D2-C triggers) TS-vs-WASM
bit-equality all run on every commit. Being Apache-2.0 (D13), the test suite doubles as
the public auditability story.

## D11 — Tooling & infra

pnpm + Turborepo monorepo (`engine/`, `app/`, `shared-schema/`), Vitest + Playwright,
GitHub Actions CI, deploy: Fly.io or a single VPS + Caddy. If Rust: cargo + `wasm-pack`,
profile-guided runs on a throttled CI device for R1 regression gating.

**ACCEPTED (2026-10-21), with hosting amended by D3/D7:** no Fly/VPS server exists —
"deploy" means publishing static release files (GitHub Releases + optional static page or
package managers). pnpm + Turborepo monorepo (`engine/`, `app/`, `shared-schema/`),
Vitest + Playwright (incl. the D3 egress test), GitHub Actions CI, and throttled-device
R1 perf gating stand as written.

## D12 — Auth & accounts

Local-only MVP needs none; add only when sync/billing arrives. Recommendation then:
**passkeys + email magic link (Auth.js self-hosted)**; Clerk only if we'd rather buy
than run it. Passwords are never the primary factor.

**RESOLVED (2026-10-21): none.** With D3 offline-only and D7 no-backend, there is nothing
to authenticate to — no accounts, no auth library, ever, unless D3/D7 are superseded.

## D13 — Openness posture

Genuinely an owner-values decision, listed so it's made explicitly:
- A. Fully closed source.
- B. Open engine (validation = marketing: "auditable planner"), closed app. *This turns
  D10 into an acquisition asset; special-needs/skeptical users care.*
- C. AGPL everything.

**DECIDED (2026-10-21, revised same day): entire project open source under Apache-2.0.**
Initially decided as MIT; superseded same day by Apache-2.0 — same permissive posture,
but adds an explicit patent grant + retaliation clause, a NOTICE mechanism that carries
disclaimers through forks (supports D14), and withholds trademark rights (protects the
product name). Fully open (app + engine + schema), permissive rather than copyleft — a
fourth option, distinct from A/B/C above. Implications: D10's validation story becomes a
trust asset in full; monorepo (D11) ships under Apache-2.0; add `LICENSE` (Apache-2.0) +
`NOTICE` + SPDX headers (`Apache-2.0`) at repo init.

## D14 — Terms of use, liability disclaimers & consent UX

Options:
- **A. Rely on the license's warranty disclaimer alone.** Apache-2.0 (like MIT) disclaims
  all warranties and liability, protecting the copyright holders for the *software*, and
  its NOTICE mechanism makes disclaimers propagate through forks. But it's a license, not
  consumer terms: it doesn't address financial-advice expectations, isn't shown to users,
  and a fork can still alter in-app notices.
- **B. Apache-2.0 + product-level consent (ACCEPTED).** A first-run clickwrap screen plus
  persistent disclaimers (see FEATURE_SPEC §11, ToU1–ToU3).
- **C. Custom EULA layered on an open-source license.** Restrictive terms are incompatible
  with an open-source license and the OSD — rejected. The shield is disclaimers/warnings,
  not use restrictions; anyone may fork and remove the screen, and that's accepted.

Product-level mechanics (feature spec ToU1–ToU3):
- **First-run gate:** ToU + financial/legal disclaimer shown before first use; explicit
  "I agree" required; acceptance recorded locally with date + ToU version; re-presented
  on major ToU version bumps.
- **Persistent surfaces:** "projections, not advice — consult a qualified professional"
  footer on every simulation output; prominent per-output notices where the model could
  plausibly substitute for professional judgment (tax, SS, Module F).
- **Language must be drafted by a lawyer**: conspicuous (all-caps) disclaimers, UCC
  implied-warranty disclaimers, liability limitation, no-professional-services statement,
  and jurisdiction fit. This decision records *what* we commit to, not the text.

Follow-up: lawyer review of ToU/disclaimer text. v0.1 draft (`LEGAL_TERMS_DRAFT.md`) was
web-researched against standard "not financial advice" clauses, UCC conspicuous-
disclaimer conventions, and Apache-2.0 §§15–16. **2026-10-23 update:** the owner elected
to ship `LEGAL_TERMS.md` v1.0 owner-approved (party: Philip Fucich d/b/a FinPlanner;
governing law: Texas; contact: slowsigma@hotmail.com) with the "NOT reviewed by an
attorney" label kept conspicuous in-app; counsel review is now a recommended post-beta
follow-up rather than a public-beta gate.

---

## D15 — Tax-wrapper abstraction (M1 open question, resolved before M2)

The M2 tax model (B1.3) needs a stance on how account types map to tax behavior. Schema v1
CHECK-constrains `accounts.type` to US types (`taxable`, `tax_deferred`, `tax_free`, `hsa`,
`529`, `defined_benefit`, `real_estate`, `other`).

Options:
- **A. Hard-code US all the way.** Engine tax logic switches on the raw type strings.
  Fastest now; non-US support later means touching tax logic everywhere. Rejected.
- **B. Generic wrapper table now.** Migrate schema to behavior flags
  (tax-on-contribution / growth / withdrawal) with US presets seeded. Most general, but
  delays the M2 core and freezes a taxonomy we have no second-jurisdiction data to validate.
  Rejected.
- **C. US-only in schema, layered in the engine (ACCEPTED).** Keep schema v1 unchanged.
  The engine never branches on account-type strings directly; it resolves each account to an
  internal `WrapperRules` object (contribution limits, employer-match rules, and — from the
  B1.3 tax work — contribution/growth/withdrawal tax behavior). All US specifics live in
  one rules-definition module.

Rationale: correctness velocity for MVP (US-focused per FEATURE_SPEC §2/§15) without
baking type strings into engine logic. Non-US later = new `WrapperRules` definitions + a
schema migration adding types — no tax-logic rewrite. HSA rules still get IRS-source
validation before B1.3 (per §14 plan table); when validated rules differ from defaults, the
rules module is the single place they change.

---

## Decision log

*(Append entries as decisions are made.)*

| Date | ID | Decision | Rationale |
|------|----|----------|-----------|
| 2026-10-21 | D13 | Entire project open source, MIT license | Owner decision: full openness, permissive license. Supersedes the A/B/C options presented; engine-level auditability (D10) and all code ship under MIT. **SUPERSEDED same day by Apache-2.0 entry below.** |
| 2026-10-21 | D13 (rev) | SUPERSEDES MIT → Apache-2.0 | Same permissive openness; Apache-2.0 adds explicit patent grant, NOTICE propagation of disclaimers (supports D14), and no trademark grant (protects product name). |
| 2026-10-21 | D14 | Clickwrap first-run ToU agreement + persistent "not advice" / liability disclaimers | Open source (D13) requires explicit user agreement to terms; the license covers code-level warranty disclaimer only. Users must acknowledge: no liability, use with caution, seek legal/financial advice before acting. Feature spec ToU1–ToU3; lawyer to draft final language. |
| 2026-10-21 | D3 | Fully local & offline-only: all data on-device, zero runtime network requests (air-gap capable); distribution via download OK | Owner decision. Stronger than local-first option B; encrypted export/import files are the permanent backup/transfer story. Enforced by CSP + CI egress tests. |
| 2026-10-21 | D1 (rev) | SUPERSEDES hybrid-C → client-side only | No server fallback can exist under offline-only D3; R2 bit-comparability moot with a single execution venue. |
| 2026-10-21 | D7 (rev) | SUPERSEDES thin-service-later → no backend ever (under D3) | Offline-only leaves no legitimate backend surface; sync/billing/auth all dropped. Monetization would need a superseding decision. |
| 2026-10-21 | D12 (rev) | SUPERSEDES Auth.js/Clerk plan → no auth at all | Nothing to authenticate to without a backend (D7) or sync (D3). |
| 2026-10-21 | D8 | FLAGGED, not decided | Plaid/aggregation requires runtime internet, contradicting D3. Options logged (drop / opt-in online companion / revisit). Owner call pending. |
| 2026-10-21 | D8 (rev) | Closes own flag: **bank aggregation dropped entirely** — no aggregator, no online companion, ever (under this decision) | Owner decision. Data entry is manual + CSV/OFX import only; consistent with offline-only D3. |
| 2026-10-21 | D2 | ACCEPTED as recommended (option C: TS first, Rust hot-loop port on benchmark gate) | Owner sign-off on presented recommendation. |
| 2026-10-21 | D4 | ACCEPTED as recommended (SQLite over OPFS, versioned forward-only schema) | Owner sign-off; export container + native-port target noted. |
| 2026-10-21 | D5 | ACCEPTED as recommended (TS + React + Vite; D3-scales/canvas charts) | Owner sign-off; all assets bundled same-origin per D3. |
| 2026-10-21 | D6 | ACCEPTED as recommended (PWA-first; SW = offline-cache-only; Capacitor/Tauri post-PMF) | Owner sign-off. |
| 2026-10-21 | D9 | ACCEPTED as recommended (seedable PCG/xoshiro, Sobol + antithetic, deterministic reduce, per-trial streams) | Owner sign-off. |
| 2026-10-21 | D10 | ACCEPTED as recommended (golden/property/differential tests, seeded snapshots, CI reporting of sampling CIs) | Owner sign-off; tests run as CI gates. |
| 2026-10-21 | D11 | ACCEPTED as recommended, amended: static file distribution only (no Fly/VPS — no servers under D3/D7); pnpm+Turborepo, Vitest+Playwright, GH Actions, throttled perf gating | Owner sign-off; hosting amendment forced by D3/D7, logged rather than silently rewritten. |
| 2026-10-22 | D15 | Tax-wrapper: US-only types stay in schema v1; engine codes against internal `WrapperRules` layer; type strings never branched in engine logic | Resolves M1 open question before M2 tax work (B1.3). Non-US later = new rules definitions + schema migration, no tax-logic rewrite. IRS-source validation for HSA/limits still required before beta (§15). |
