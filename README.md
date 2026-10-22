# FinPlanner

Long-term personal financial planning: net worth, multi-decade projections, retirement
readiness, and scenario analysis under uncertainty. Fully local, offline-only, no accounts,
no backend. Projections and education — not financial advice.

**Status: M1 (data model + PWA shell + G1/G3 gates green).** Planning docs live in this repo's `docs/`
directory (`FEATURE_SPEC.md`, `TECH_DECISIONS.md` — binding decisions D1–D14 — `LEGAL_TERMS_DRAFT.md`,
and `PLAN.md`, this repo's milestone gate plan).

## Layout

- `engine/` — TypeScript simulation engine (D2-C: TS first; Rust/WASM port only if the G0
  benchmark gate fails). The TS engine is the permanent reference implementation (D10).
- `app/` — PWA (M1: React + Vite + SQLite-over-OPFS).
- `shared-schema/` — versioned SQLite schema + migrations (M1).
- `docs/` — planning and legal docs (feature spec, binding tech decisions, milestone plan, terms draft).

## Commands

```sh
pnpm install
pnpm typecheck   # tsc across the workspace
pnpm test        # vitest: golden/property/determinism gates (D10)
pnpm bench       # engine G0 benchmark + fan-chart debug output -> engine/out/fan.csv
```

## Decisions taken during milestones

- **Tax-wrapper abstraction (M1)**: tax treatment is NOT a per-account flag. `accounts.type`
  is a closed enum (schema v1 CHECK); each type maps to a policy record inside
  `assumptions_sets.data_json.tax` (M2 formalizes it): contribution limit, employer-match
  model, deductibility of contributions, withdrawal taxation (`ordinary` |
  `qualified_tax_free` | triple-exemption for HSA), RMD and early-withdrawal rules. New
  wrappers arrive only via forward-only schema migrations (R5), never free-form user strings —
  the engine must always know a type's semantics to stay auditable (R3).

## Engineering invariants (do not regress)

- Determinism: same seed + assumptions ⇒ bit-identical results (R2/D9).
- Offline-only: zero runtime network requests — CSP + CI egress test arrive in M1 (D3).
- No backend, no auth, no aggregation (D7/D12/D8).
