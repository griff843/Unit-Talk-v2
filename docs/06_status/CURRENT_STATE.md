# Current State — Unit Talk V2

> **CANONICAL STATUS ENTRYPOINT.** This document is the single authoritative snapshot of
> program state, gap status, active monitors, and current blockers. All other state-bearing
> docs in this repo are either authoritative on their specific sub-topic (see §Source of Truth
> Hierarchy) or have been marked SUPERSEDED / HISTORICAL.
>
> **Last verified:** 2026-06-10T08:00:00Z (UTC) — UTV2-1042 dispatch pause LIFTED (PM decision), readiness YELLOW, 0 active lanes
>
> **Constitutional authority:** `docs/00_constitution/UNIT_TALK_CONSTITUTION_V1.md` §18.3 ·
> `docs/00_constitution/CANONICAL_PROGRAM_STATE.md` (PM-ratified 2026-06-02)

---

## Program States

| Program | Constitutional Name (§18.3) | Status | Notes |
|---|---|---|---|
| **P1** | Truth Convergence | **ACTIVE_CERTIFIED** | Frozen-surface SHA `9600938`; re-cert deadline **2026-08-25** |
| **P2** | Governance Convergence | **ACTIVE_CERTIFIED** | INIT-2.x certification runtime; 229 live tests |
| **P3** | Decision Integrity Convergence | **ACTIVE_NOT_CERTIFIED** | Work authorized; **NOT certified** — empirical CLV/edge evidence pending UTV2-1042 |
| **P4** | Execution & Economic Truth Convergence | **CONDITIONAL_NOT_CERTIFIED** | Execution real; **NOT certified** — economic truth (CLV/attribution) requires realized data |
| **P5** | Institutional Runtime Convergence | **FROZEN_NOT_CERTIFIED** | **FROZEN** — burn-in PASS + P1–P4 certs + M10 Path A required; capital/treasury/scaling work forbidden |

Canonical source: `docs/00_constitution/CANONICAL_PROGRAM_STATE.md`

---

## Constitutional Drift Register (D-CONST-1 through D-CONST-8)

| Gap | Status | Resolution |
|---|---|---|
| **D-CONST-1** — Program numbering drift | `PM_RATIFIED` | §18.3 numbering canonical: P1 Truth · P2 Governance · P3 Decision Integrity · P4 Execution & Economic Truth · P5 Institutional Runtime. Banners applied; full rename deferred. |
| **D-CONST-2** — P3/P4/P5 activation state ambiguity | `PM_RATIFIED` | Canonical: P3 ACTIVE_NOT_CERTIFIED · P4 CONDITIONAL_NOT_CERTIFIED · P5 FROZEN_NOT_CERTIFIED. Stale "P1–P4 certified SATISFIED" claims superseded. |
| **D-CONST-3** — Missing canonical cert records | `RESOLVED` | UTV2-1195 (PR #950, 2026-06-02) — P1/P4 cert docs created; §18.3 numbering normalized. |
| **D-CONST-4** — Proof gate string-bound, not execution-bound | `RESOLVED` | UTV2-1196 (PR #954, 2026-06-04) — proof gate execution-bound; `t1-proof-gate` requires TAP output; DB-trigger proofs fail closed. |
| **D-CONST-5** — Edge as market echo | `RESOLVED` (structural) | UTV2-1220 (PR #983, 2026-06-07) — five stat-based feature modules wired into `computeStatProjection`. Empirical CLV/edge proof deferred to UTV2-1042 (data-gated). **P3 remains ACTIVE_NOT_CERTIFIED.** |
| **D-CONST-6** — Ingestion stale / runtime freshness drift | `RESOLVED` | UTV2-1227 (PR #985, 2026-06-07, SHA `d7b03595`) — SGO API key set; `SYNDICATE_MACHINE_ENABLED=true` added; pipeline active. Board scan evidence: 9,893 scored candidates, 63 board candidates, 432 syndicate_board rows. D-CONST-6 resolution unlocks empirical evidence accumulation; does **not** prove CLV/edge. |
| **D-CONST-7** — `database.types.ts` drift | `RESOLVED` | UTV2-1198 (PR #957, 2026-06-04) — types regenerated; `execution_intents` and `settlement_corrections` present. |
| **D-CONST-8** — Docs say fail-open, code is fail-closed | `RESOLVED` | UTV2-1199 (PR #956, 2026-06-04) — `packages/db/CLAUDE.md` and `packages/contracts/CLAUDE.md` corrected; no code changed. |

Full ledger: `docs/00_constitution/CERTIFICATION_GAP_REGISTER.md`

---

## Active Monitors

### UTV2-1042 — Empirical CLV / Data Gate

**State:** DATA-GATE OPEN — dispatch OPEN (PM decision 2026-06-10)

> **DISPATCH OPEN.** PM lifted the production-readiness-RED pause. Readiness re-audit verdict: YELLOW.
> Prior RED blockers resolved (UTV2-1239 DONE, UTV2-1242 DONE, production at dcd649d5).
> UTV2-1042 authorized as empirical evidence evaluation lane — honest pass/fail/defer outcome required.
> No CLV certification. No P3 certification. No edge/ROI/STRONG/ELITE claims.

Current gate status (as of v11 monitor, 2026-06-10T05:38:13Z):
- `pick_candidates` for post-cutover universe_ids: **2,964** (MET ✓)
- `closing_over_odds IS NOT NULL` for post-cutover market_universe: **2,606** (MET ✓)
- CLV join path: **126 picks** (MET ✓)

**dispatch_gate: OPEN · paused: false**

Evidence: `docs/06_status/proof/UTV2-1042/data-gate-monitor.json` (v11, SGO snapshot 2026-06-10T05:38:13Z)

Accepted YELLOW residuals (PM-acknowledged):
- Health scripts count governance brake rows as failures (fix: UTV2-1248)
- `pipeline:health` delivery_freshness contradicted by live DB truth (fix: UTV2-1249)
- 199 stale_pending_operator_review rows are accepted governance queue, not system failures

### UTV2-1231 — Data-Gate Accumulation Monitor

**State:** STOP CONDITION MET — cron may be cancelled

Cron job `c9ae211f` fires every 4 hours at :17 past. All three data-gate stop conditions are
met (v10 snapshot, 2026-06-10T00:55Z). UTV2-1242 ingestor recovery DONE — hung run cleared,
bounded queries deployed. SGO ingestor stall resolved pending UTV2-1239 deploy. Monitor remains
active to confirm continued post-cutover accumulation after next ingestor cycle.

---

## Current Blockers

| Blocker | Category | Notes |
|---|---|---|
| Production readiness YELLOW | **Partial** | UTV2-1242 DONE (891512f1). UTV2-1239 DONE — production now at dcd649d5 (deploy run 27253256755, smoke PASS 2026-06-10T04:41Z). Health script false negatives tracked in UTV2-1248/UTV2-1249. |
| P3 empirical CLV/edge evidence | Certification | Data gate OPEN; dispatch OPEN (PM lift 2026-06-10). P3 cert requires UTV2-1042 honest pass/fail outcome. |
| P4 economic truth unproven | Certification | No realized CLV / attribution data; economic certification requires live settled pick corpus |
| P5 freeze | Activation | FROZEN until burn-in PASS + P1–P4 certs + M10 Path A. Treasury/capital/scaling work forbidden. |
| P1 re-cert deadline | Time-gated | `proof_lineage` + `freshness` domains auto-degrade 2026-08-25; re-cert prep authorized |
| UTV2-884 / UTV2-885 | Feature work | Paused — no dispatch |
| P3 certification claim | Hard constraint | Forbidden until empirical evidence passes gate |
| ROI / CLV / edge claims | Hard constraint | Forbidden under P3 ACTIVE_NOT_CERTIFIED + P4 CONDITIONAL_NOT_CERTIFIED |

---

## P5 Freeze Constraints (binding)

While P5 is `FROZEN_NOT_CERTIFIED`, all of the following are **forbidden**:
1. Treasury work
2. Capital scaling
3. Live capital deployment
4. Burn-in-derived capital claims without a burn-in PASS report
5. Customer-money readiness claims

P5-A adversarial detector code (UTV2-1147–1149) is merged — that is **historical code**, not an
unfreeze. P5 stays frozen until burn-in PASS + certification (§4.17, §20.6).

---

## Forbidden Claims

The following claims must **not** be made until the named gates are met:
- P3 certification — requires empirical CLV/edge evidence (UTV2-1042 data-gate)
- Proven economic edge — requires P4 certification
- Verified ROI — requires P4 certification
- CLV certification — requires live settled pick corpus
- P5 unfreeze — requires P1–P4 certified + burn-in PASS + M10 Path A
- Production-readiness assertion — not within scope of any current lane

---

## Live Data Evidence Status

**Pipeline activated:** 2026-06-07 (D-CONST-6 resolution — SGO first successful ingest 13:38:28Z)

Post-cutover accumulation snapshot (as of v11 monitor, 2026-06-10T05:38:13Z):
- SGO snapshot advanced to 2026-06-10T05:38:13Z (5 cycles post-UTV2-1242)
- Pick candidates for post-cutover universe_ids: **2,964** (Gate 1 MET)
- Closing over odds (market_universe post-cutover): **2,606** (Gate 2 MET)
- CLV join path (picks → pick_candidates → market_universe with closing_over_odds): **126** (Gate 3 MET)
- sport_id attribution: fix confirmed live (UTV2-1228)

All three data-gate criteria MET. **dispatch_gate: OPEN · paused: false** (PM decision 2026-06-10).
No certification-grade proof available — UTV2-1042 runs as empirical evidence evaluation.

---

## Source-of-Truth Hierarchy

| Rank | Source | Authoritative For |
|---|---|---|
| 1 | **GitHub `main`** | Shipped code, merge SHAs, CI on merge |
| 2 | **Proof bundle** (tied to merge SHA) | Completion evidence |
| 3 | **Lane manifest** (`docs/06_status/lanes/*.json`) | Active lane state |
| 4 | **Linear** | Workflow intent, tier label, ownership |
| 5 | **Chat / memory / agent claims** | Context only — never authoritative |

Program state authority: `docs/00_constitution/CANONICAL_PROGRAM_STATE.md`
Gap register authority: `docs/00_constitution/CERTIFICATION_GAP_REGISTER.md`
Cert records: `docs/06_status/programs/PROGRAM_{1,2,3,4}_CERTIFICATION.md` + `PROGRAM_5_ACTIVATION.md`

---

## Current Feature Work Status

| Issue | Title | State |
|---|---|---|
| UTV2-884 | Discord Member DM Routing | Paused — do not dispatch |
| UTV2-885 | Discord Game-Thread Routing | Paused — do not dispatch |
| UTV2-1032 | DEVELOPING label proof run | Data-gated: needs 50+ real-edge picks |
| UTV2-1042 | CLV / edge empirical gate | Data gate OPEN — dispatch **OPEN** (PM lift 2026-06-10, readiness YELLOW) |
| UTV2-1248 | Health scripts — governance brake false negatives | Authorized follow-up lane |
| UTV2-1249 | Pipeline health — fix delivery_freshness metric | Authorized follow-up lane |

P3 work (scoring truth, feature audits, injury/status guards, calibration) is authorized.
P4 work (execution hardening, dead-letter remediation, settlement proof scaffolding) is conditional.

---

## How to Update This Document

This document must be updated at:
- Any PM certification decision (P3, P4, P5 or re-cert)
- Any change to UTV2-1042 or UTV2-1231 gate status
- Any change to P5 freeze conditions
- Any new D-CONST gap or gap resolution
- Significant blocker changes

Do **not** record ephemeral sprint/lane details here — those belong in lane manifests and Linear.
