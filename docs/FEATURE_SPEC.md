# Personal Financial Planning App — Feature Specification

Version: 0.1 (draft)
Date: 2026-10-20
Status: pre-implementation scoping document

---

## 1. Product Vision

A long-term financial planning tool for individuals and households: net-worth tracking,
multi-decade projections, retirement readiness, and scenario analysis under uncertainty.

Explicitly **not** a monthly budgeting / expense-tracking app. The unit of planning is the
decade, not the month. The core question the product answers:

> "Given what I have and what I save, will my money last through the life I'm planning —
> what could break the plan, and what does insuring against that cost?"

Two questions the engine must be able to answer separately:

1. **Monte Carlo question** — *will it last?* (probability of success over the horizon)
2. **Sequence-of-returns question** — *what kills the plan even when average returns are
   fine, and how do I mitigate it?*

## 2. Target Users

- Primary: individuals/households aged ~25–55, salaried, with employer retirement plans
  and at least one tax-advantaged account; planning horizon 10–45 years.
- Secondary: pre-FIRE/early-retirement planners (FIRE mode users); couples coordinating
  two income/retirement profiles.
- US-first account/tax model (401k, Traditional/Roth IRA, HSA, 529, Social Security,
  RMDs). Non-US tax wrappers are a post-v1 consideration behind an abstraction layer.

## 3. Scope Summary

| In scope                                                                               | Out of scope                                                             |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Household net worth statement                                                          | Monthly envelope/categorical budgeting                                   |
| Multi-decade inflation-adjusted projections                                            | Bill pay, expense categorization UX                                      |
| Monte Carlo probability-of-success engine                                              | Trade execution / brokerage integration                                  |
| Sequence-of-returns risk analysis & mitigation                                         | Individual stock picking / signals                                       |
| Tax-aware accumulation & withdrawal modeling                                           | Actual tax preparation/filing                                            |
| Retirement income planning (SS, pensions, withdrawals, RMDs)                           | Personalized "advice" that triggers RIA status (see §10)                 |
| Goal & scenario what-if analysis                                                       | Debt consolidation offers, product sales                                 |
| Allocation drift / rebalance alerts                                                    | Portfolio management on the user's behalf                                |
| Life-event milestone planning (college, home, career gaps)                             |                                                                          |
| Dependent-care & special-needs planning: analysis, readiness, cost modeling (Module F) | Legal drafting of trusts/wills/guardianship (UPL — refer to specialists) |
| Estate/beneficiary tracking (phase 2+)                                                 | Trust administration / serving as trustee                                |

## 4. Domain Model (foundation)

Mirrors the professional planning process: **Assess → Set goals → Build plan → Execute →
Monitor/rebalance**, as a repeating loop.

Key entities:

- **Household** — one or two adults; each with age, planned retirement age, life-expectancy
  assumption, earnings profile.
- **Account** — owned by a person; type (taxable, tax-deferred, tax-free, HSA, 529,
  defined-benefit, real estate, other), balance, holdings or a single asset-class proxy,
  contribution/withdrawal rules.
- **Liability** — mortgage, student loan, etc.; balance, rate, payment, payoff date.
- **Income stream** — salary (growth assumption), SS/pension/annuity (with claiming-age
  rules), rental/passive. Note: in total-wealth views, the PV of future earnings acts like
  a bond-like "human capital" asset — this is the theory behind age-based glide paths and
  should be at least acknowledged in allocation displays.
- **Spending profile** — annual (not monthly) spending today, planned spending in
  retirement, essential vs. discretionary split (used by withdrawal-policy features).
- **Scheduled one-off spend** — dated, inflation-indexed out-of-band purchase, one-time or
  recurring on a cycle: car replacement every ~6 yrs, big trips/gap years, weddings, roof/
  HVAC, down payments, relocation. Distinct from *ongoing* spending (above) and from
  *unplanned* shocks (B2.7). Each links to the goal it serves and/or a sinking fund, so the
  engine checks "is this vacation actually funded in that year, or does it quietly cannibalize
  retirement?" Optional per-category inflation (vehicles/travel ≠ CPI).
- **Goal** — long-term target: "retire at 62 with $120k/yr", "college fund by 2034",
  "FI date"; success defined as a probability threshold.
- **Plan** — savings rate, target asset allocation, glide path, withdrawal policy,
  mitigation levers; the object a simulation runs against.
- **Assumptions set** — capital-market assumptions (see §6.1), inflation, tax law
  parameters, life expectancy; fully user-editable with sensible defaults.

## 5. Module A — Household Data & Net Worth (MVP)

| ID  | Feature                                                                                                                                                                                                                                                                            | Priority                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| A1  | Personal balance sheet: assets (accounts, real estate, vehicles, crypto, other) and liabilities → net worth                                                                                                                                                                        | MVP                                        |
| A2  | Income statement at projection granularity: annual income by stream, annual spending (essential/discretionary), savings rate                                                                                                                                                       | MVP                                        |
| A3  | Manual entry + CSV/OFX import. **No bank aggregation/API connections — dropped entirely (D8 accepted)** | MVP |
| A4  | Net-worth history and trend chart                                                                                                                                                                                                                                                  | MVP                                        |
| A5  | Household view: merged finances for couples, per-person views                                                                                                                                                                                                                      | MVP                                        |
| A6  | Document vault / estate & beneficiary tracking: per-account beneficiary designations (**these override wills — prompt review on life events: marriage, divorce, birth, death**), will/trust, financial POA + healthcare directive (incapacity planning), ERISA spousal protections | Phase 2                                    |
| A7  | Insurance-gap checklist (life, disability, **LTC**: ~70% of 65+ need some care; ADL trigger, elimination period, benefit cap, hybrid life/LTC products; Medicaid spend-down ~$2k assets as the unmanaged fallback) — LTC expected cost feeds the B2.7 spending-shock model         | Phase 2 checklist; LTC shock model phase 2 |

## 6. Module B — Projection & Monte Carlo Engine (MVP; core investment)

### B.1 Deterministic core
- B1.1 Real-terms (inflation-adjusted) year-by-year projection of net worth and cash flow
  across all accounts to the planning horizon (default: life expectancy + 5 years).
- B1.2 Account-level growth with per-asset-class returns; contribution limits and employer
  match rules per account type.
- B1.3 Tax projection: simplified marginal-bracket model; tax-advantaged contribution
  and withdrawal rules; RMDs; Social Security taxation estimate.
- B1.4 Time-value-of-money primitives everywhere (no "nominal $ in 2055" displayed without
  a real-terms toggle).
- B1.5 **Scheduled one-off spends in the cash-flow schedule**: every dated/periodic
  out-of-band purchase (B2 objects above) flows through the projection in real terms and is
  shown on the waterfall, per-year view, and goal-fundedness check — big-ticket plans must
  be visible where they land, not absorbed into an annual spending average.

### B.2 Monte Carlo simulation (first-class feature)
- B2.1 **Trial engine**: N trials (default 10,000), per-trial sampling of annual returns per
  asset class from configurable distributions — options: normal, historical bootstrap
  (resample rolling historical windows), regime-switching; correlated across asset classes.
- B2.2 **Capital-market assumptions manager**: editable expected return, volatility, and
  correlations per asset class; inflation assumption; defaults labeled as defaults, with
  source notes. Results must never be a black box: every number traceable to assumptions.
- B2.3 **Success metric, per goal**: % of trials where (a) household never runs out of money
  before end of horizon, (b) each goal is fully funded, (c) optional floor constraint
  ("essential spending never falls below $X"). Report P50 / P10 / P90 outcome bands.
- B2.4 **Live what-if sliders**: savings rate, retirement age, SS claiming age, retirement
  spending, home sale/purchase, inheritance, career-gap years — each re-runs the sim
  (target < 2 s for 10k trials; cache & incremental re-simulation acceptable).
- B2.5 **Longevity uncertainty**: sample lifespans per adult from sex-conditional period/
  cohort mortality tables (research shows retirees systematically underestimate longevity —
  median 65-year-old lives into late 80s/early 90s); default horizon to age 95; include
  survivor-income rules (e.g., 67% SS survivor benefit) and spousal joint longevity.
- B2.6 **Historical-stress replays (deterministic overlay)**: replay the plan against
  historical sequences (1929, 2000–2009, 2008, plus rolling 10-year starts) as a
  non-statistical companion to the Monte Carlo output.
- B2.7 **Stochastic spending shocks**: liabilities are random too — sample uninsured
  medical/LTC events, home/car repairs, job-loss gaps. Research (Pye) shows plausible
  emergency assumptions cut the sustainable withdrawal rate from ~4% to ~3%, so a
  returns-only simulation overstates success. Essential vs. discretionary split (see §4)
  sets which spending is cuttable when a shock hits.
- B2.8 **Engine techniques (implementation)**: simulate correlated per-asset-class returns
  via correlated normal draws (GBM) or historical bootstrap; use variance reduction
  (antithetic variates, control variates) and Sobol low-discrepancy sequences to hit the
  performance budget — plain MC error shrinks only as O(N^−½), so quadrupling trials
  merely halves error. Path-dependent withdrawal rules (guardrails, buckets) are precisely
  where simulation beats analytic solutions.

## 7. Module C — Sequence-of-Returns Risk & Mitigation (MVP analysis, phased mitigations)

### C.1 Awareness features
| ID | Feature | Priority |
|---|---|---|
| C1 | Fan chart: percentile bands of net worth / portfolio by age across trials | MVP |
| C2 | **Retirement-risk-zone view**: highlight years ~5 pre- to ~10 post-retirement; show equity exposure in that window | MVP |
| C3 | **Sequence-risk score**: success-rate delta between favorable and unfavorable early-retirement return sequences (e.g., P10 vs P90 first-decade returns, others held constant); plain-language explanation | MVP |
| C4 | Worst-N sequences table: "the 10 sequences that broke your plan most", with the drawdown year and the withdrawal that forced equity sales | Phase 2 |

### C.2 Mitigation levers (each is a modelable policy + a comparison report)
| ID | Lever | Modeling behavior | Priority |
|---|---|---|---|
| M1 | **Cash / short-duration buffer ("bucket" strategy)** | Withdraw spending from a 1–3-year reserve first; replenish from portfolio only in non-decline years; reserve size user-set in years-of-spending | MVP |
| M2 | **Dynamic withdrawal policy** | Fixed 4%+inflation vs. guardrails (spending only changes if portfolio drifts >±10–20% vs. baseline) vs. percent-of-portfolio; policy is part of the Plan object and applies inside every trial | MVP (fixed + guardrails), phase 2 (percent-of-portfolio, hybrid) |
| M3 | **Flexible retirement date rule** | "Retire only when portfolio ≥ X × spending" or "work one extra year after a bad-market year"; evaluated in-trial | Phase 2 |
| M4 | **Glide path / de-risking window** | Allocation tapers from growth to defensive over N years before and M years after retirement date; replaces static target allocation near the risk zone | Phase 2 |
| M5 | **Guaranteed-income floor** | SS/pension/annuity sized to cover essential spending; portfolio funds discretionary only; affects sequence sensitivity directly; include deferred-income-annuity/QLAC options (defer to ~85, IRS caps ~25% of IRA/$130k, RMD-exempt) for longevity tail coverage | MVP (modeling), phase 2 (claiming-optimizer UI, QLAC modeling) |
| M6 | **Tax-aware withdrawal ordering** | Account drawdown order (taxable → deferred → Roth, with bracket-fill and Roth-conversion logic in bad years) so down years don't force realize-at-a-loss or bracket spikes | Phase 2 |
| M7 | **Bond ladder / dedicated income portfolio ("self-annuitization")** | Cash-flow-matched Treasury/CD ladder (dedicated portfolio theory): income sleeve (e.g., 5–8 yr ladder, TIPS for the inflation hedge) funds planned withdrawals; growth sleeve replenishes it. Hold-to-maturity removes market risk from the matched years. Constraints to model: no callable bonds, investment-grade only, phantom-income tax in taxable accounts | Phase 2 |

### C.3 Mitigation comparison report (key differentiator)
- C3.1 Side-by-side runs of the *same* plan with/without each active lever:
  probability of success, P10 worst-case terminal wealth and minimum spending, and
  **expected median lifetime spending** (the cost of insurance).
- C3.2 Per-lever marginal value: "the 2-year buffer costs ~$14k median lifetime spending
  and buys +11 pts of success probability" — always both sides of the tradeoff.

## 8. Module D — Goals, Retirement & Income Planning (MVP subset)

| ID | Feature | Priority |
|---|---|---|
| D1 | Goal objects with target date/amount and per-goal probability of success | MVP |
| D2 | On-track tracking: expected-vs-actual net worth at checkpoints; savings-rate needed to stay on track | MVP |
| D3 | **FI number & FI date**: 25× annual spending (4% rule, Bengen/Trinity) with inflation-adjusted projection; user-adjustable withdrawal-rate assumption. Framing: SWR is a *plan, not a contract* — historical worst 30-yr window supported ~3.5%, Bengen's average was ~7%; present as probabilities, and nudge toward dynamic policies (M2) for sequence safety | MVP |
| D4 | **SS claiming analysis**: benefit at 62/FRA/70, breakeven vs. portfolio drawdown interaction, survivor impact | MVP simplified (benefit table input), phase 2 (earnings-record import) |
| D5 | Pension/DB and annuity income modeling, incl. survivor options | MVP simple |
| D6 | Account drawdown ordering & Roth conversion analysis (ties to M6); **stepped-up-basis awareness** for heirs (Roth/deferred balance interacts with estate basis planning) | Phase 2 |
| D7 | Life-event milestones: college funding (**529 savings & prepaid plans, K–12 $10k/yr, $10k lifetime student-loan repayment, SECURE 2.0 $35k lifetime 529→Roth rollover, 5-yr gift front-load election, non-qualified 10% earnings penalty, FAFSA parent-asset treatment**), big-ticket one-off spends via §4 objects + sinking funds, career gaps, part-time retirement income | Phase 2 |
| D8 | Debt payoff vs. invest comparison (mortgage/student loans) | Phase 2 |

## 9. Module E — Asset Allocation & Monitoring (Phase 2)

| ID | Feature | Priority |
|---|---|---|
| E1 | Target allocation vs. current; drift and rebalance-band alerts | Phase 2 |
| E2 | Risk-profile questionnaire → suggested allocation (educational, non-advice framing) | Phase 2 |
| E3 | Glide-path editor (ties to M4) | Phase 2 |
| E4 | Rebalancing *recommendations* (informative; no execution) | Phase 2 |
| E5 | Annual review report: goal progress, success-probability drift since last year, actions | Phase 2 |
| E6 | **Asset location analysis** (distinct from allocation): tax-inefficient assets (bonds, REITs, active funds) in tax-deferred shelters, tax-efficient equity in taxable; show as opportunity with trade-off context (liquidity needs, match structure, penalties explain why most households are suboptimally located — over 25-yr horizons the compounding differential can reach ~18%) | Phase 2 |

## 10. Module F — Special Needs & Lifelong Dependent Care (differentiator)

The gap in consumer tools: planning for a dependent whose needs outlast the plan owner —
the plan must run on a *death-clock*, not a *life-clock*, and benefits systems punish the
exact assets (inheritances, settlements) meant to secure the dependent's future.

US-only module (see D8): ABLE = IRC §529A (tax law); SSI = Social Security Act Title XVI
and Medicaid = Title XIX benefit-eligibility law; SNT = 42 U.S.C. §1396p(d)(4). Non-US
disability-benefit regimes differ structurally — do not extrapolate.

| ID | Feature | Priority |
|---|---|---|
| F1 | **Dependent profile**: disability/condition, current means-tested benefits (SSI, Medicaid, SNAP, housing), age-of-onset (drives ABLE eligibility: onset before 46 as of 2026), work status vs SGA threshold, living arrangement | Phase 2 |
| F2 | **Benefit-cliff simulator**: model the $2,000 SSI resource limit (frozen since 1989) and income rules — lump-sum inheritance zeroes benefits in month received; deeming of parental income while parents live; in-kind support (paying adult child's rent/food) cuts SSI; marriage and employment (SGA) cliff events; SSI loss cascading to Medicaid/SNAP/housing | Phase 2 |
| F3 | **Inheritance-channel comparison**: direct bequest vs third-party special needs trust vs ABLE vs pooled trust — side-by-side benefit-retention and lifetime-supplement outcomes; ABLE mechanics (gift-tax-exclusion annual cap ~$19k, 529→ABLE rollover, first $100k SSI-exempt then cash suspension, QDE categories); SNT modeled as "supplement not replace": funds what SSI ($994/mo max, 2026) doesn't cover | Phase 2 |
| F4 | **Post-caregiver horizon**: run the decumulation projection past the parents' joint survival (caregiver joint-longevity scenarios); successor trustee/guardian succession as a tracked plan object; separation of trustee vs guardian roles + periodic review reminders (documented guardianship-abuse failures argue for oversight UX) | Phase 2 |
| F5 | **Life-event reminder calendar**: child's 18th birthday (SSA adult re-adjudication terminates benefits in ~1/3 of cases; Section 301 work-incentive preservation is widely unknown), guardianship petition at age of majority (parents are NOT automatic guardians of adult children), ABLE open-by/onset deadlines, beneficiary-designation review on parent wills, reporting deadlines (SSA 10-day inheritance report) | Phase 2 |
| F6 | **Boundary: education + quantification + specialist referral only** (special-needs attorney, pooled-trust directories, ABLE state-program directory). No drafting, no trustee service. Professional-cost transparency: quantify typical attorney/pooled-trust admin fees (source: Special Needs Alliance / state fee schedules — currently a research gap) | Phase 2 |
| F7 | **Generalization — event-driven contingency layer**: same machinery serves earner disability (income loss + insurance gap), early widowhood, chronic illness: a `LifeEvent` on the Household triggers benefit, income, insurance, and legal-document consequences in the projection — contingency planning beyond market randomness, which generic tools lack | Phase 2 |

## 11. Regulatory & Positioning Constraints (design-level, not legal advice)

- The app provides **projections, education, and scenario analysis**, not personalized
  securities advice. Output framing: "given your inputs and assumptions, this model says…"
  with clear disclaimers. Avoid language like "you should buy/hold X". This boundary is
  what separates a tool from an unregistered investment adviser (US: Advisers Act) —
  revisit with counsel before any feature that recommends specific securities or
  allocation *for* a user.
- ~~Aggregation integrations (Plaid et al.) carry their own ToS and data-handling
  duties.~~ Moot: bank aggregation dropped entirely (D8); no aggregator ToS entanglement.
- No execution of trades, no custody, no taking of financial power of attorney.
- Module F touches legal instruments: stay on the education/quantification/referral side of
  the unauthorized-practice-of-law line (no document drafting, no state-specific legal
  conclusions); benefit-eligibility modeling must carry prominent "informational only,
  verify with SSA/state rules" disclaimers — SSI is recomputed monthly and even SSA flags
  its own payment-accuracy problem.

### 11.1 Terms of use & consent gate (MVP; decision D14)

Open source under Apache-2.0 (D13) disclaims warranty for the *code* but says nothing to
the end user; the app itself must obtain agreement:

| ID   | Feature | Priority |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| ToU1 | **First-run agreement screen**: full-screen ToU + disclaimer (no warranty/limitation of liability; "not financial or legal advice"; use at your own risk; consult qualified professionals before acting). Scroll-to-enable, explicit "I agree" to proceed; no implicit consent. | MVP |
| ToU2 | **Recorded acceptance**: agreement stored locally with date + ToU version; re-presented on major ToU version bumps; viewable/re-readable anytime from settings. | MVP |
| ToU3 | **Persistent notices**: standing "projections, not advice" footer on all simulation/projection output; heightened inline disclaimers on tax, Social Security, and Module F outputs. | MVP |

Final legal language to be drafted/reviewed by counsel before public beta (see
TECH_DECISIONS.md D14 follow-up).

## 12. Non-Functional Requirements

- **Performance**: 10k-trial simulation < 2 s interactive, < 30 s cold on mobile-class
  hardware (vectorized/compiled sim core; web worker or native module).
- **Determinism & auditability**: any displayed result reproducible from
  (plan, assumptions, RNG seed); assumptions diffing between plan versions.
- **Privacy/security**: **fully local and offline-only (accepted decision D3)** — data
  never leaves the device and the app makes **no network requests at runtime** (no
  telemetry, analytics, CDNs, or update pings; air-gap capable). Encrypted
  export/import files are the backup/transfer mechanism. Enforced via strict CSP and
  CI egress tests (TECH_DECISIONS D3).
- **No hidden assumptions**: every default (returns, inflation, mortality, SS rules, tax
  brackets) visible, versioned, and editable. Defaults act as nudges (TDF lesson: simple
  defaults get followed) — make the default assumption set the conservative, defensible one.
- **Behavioral countermeasures as requirements** (behavioral-finance literature): present
  probabilities not point forecasts; show volatility in context (drawdown tables like the
  stock/bond comparison); never surface chase-the-winner rankings; design for panic-year
  reassurance (sequence-risk view explains *why* holding is the plan); commitment devices
  (plan-of-action checklists for a -30% year).

## 13. Suggested Build Order

1. **Engine spike**: deterministic projection + Monte Carlo core with fixed inputs,
   fan-chart output. This de-risks the whole product.
2. Data model + manual entry + net-worth view (Module A manual slice).
3. Accumulation projection + basic goals/on-track (B.1, D1–D3).
4. Monte Carlo + sliders + success metrics (B.2).
5. Sequence-risk views + fixed/guardrail withdrawal + cash buffer + guaranteed floor
   (C.1, M1, M2, M5) → first public beta.
6. Mitigation comparison report (C.3), withdrawal ordering, glide path, SS optimizer,
   allocation/monitoring, remaining phase-2 items. (Aggregation removed — D8.)

## 14. Open Questions

- ~~Web, mobile, or local-first desktop?~~ **Decided: local-only/offline PWA-first (D3, D6).**
- Single-country (US) confirm, or abstract the tax wrapper layer from day 1?
- ~~Data source strategy~~ Decided: manual + CSV/OFX import only; bank aggregation
  dropped entirely (D8).
- Does an education-only risk questionnaire keep us clearly on the tool side of the
  adviser line? (Legal review before E2.)
- Freemium split: projection engine compute is the expensive feature — pricing model?
- Module F is high-trust, high-effort, underserved: launch it as a headline differentiator
  for a niche, or hold it as phase-2 depth behind the core planner? First-party vs
  third-party/pooled SNT taxonomy and payback rules still need non-Wikipedia validation
  (42 U.S.C. §1396p(d)(4)(A)/(B)/(C)).
- ~~Stack~~ **All tech-stack decisions D1–D14 ACCEPTED — see `TECH_DECISIONS.md` v1.0.**

## 15. Research Sources (v0.1)

Wikipedia (fetched 2026-10): Financial planning, Personal finance, Retirement planning,
Retirement spend-down (Safe withdrawal rate), Financial independence, Asset management,
Asset allocation, Required minimum distribution, Monte Carlo methods in finance,
Longevity risk, Dedicated portfolio theory, Lifecycle fund (target-date fund), Trinity
study, Estate planning, Asset location, Behavioral finance, Long-term care insurance,
Certified Financial Planner, 529 plan, Special needs trust, ABLE account, Supplemental
Security Income, Legal guardian. Inaccessible: Investopedia (402),
investor.gov/financial-planning (404), Sequence-of-returns (404 — concept covered via
Trinity/retirement-spend-down material), HSA article (404 — HSA rules need independent
validation from IRS sources before modeling).
