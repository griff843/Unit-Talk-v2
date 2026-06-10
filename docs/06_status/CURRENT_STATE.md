# Current State — Unit Talk V2

> **CANONICAL STATUS ENTRYPOINT.** This document is the single authoritative snapshot of
> program state, gap status, active monitors, and current blockers. All other state-bearing
> docs in this repo are either authoritative on their specific sub-topic (see §Source of Truth
> Hierarchy) or have been marked SUPERSEDED / HISTORICAL.
>
> **Last verified:** 2026-06-10T04:35:00Z (UTC) — UTV2-1242 DONE, monitor v10, deploy alignment in progress (UTV2-1239)
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

**State:** DATA-GATE OPEN — dispatch PAUSED (production-readiness RED)

> ⚠️ **PAUSED, NOT DATA-GATED.** All three data-gate criteria are now MET (v10 monitor, 2026-06-10T00:55Z).
> Dispatch remains paused by production-readiness RED until deploy alignment (UTV2-1239) is resolved — or PM-waived.
> UTV2-1242 ingestor recovery DONE (891512f1). No CLV certification. No P3 certification. No edge/ROI claims.

Current gate status (as of v10 monitor, 2026-06-10T00:55Z):
- `pick_candidates` for post-cutover universe_ids: **2,609** (MET ✓)
- `closing_over_odds IS NOT NULL` for post-cutover market_universe: **2,602** (MET ✓)
- CLV join path: **125 picks** (MET ✓)

**UTV2-1042 dispatch gate: OPEN.** Dispatch paused by production-readiness RED. Do not claim CLV certified.

Evidence: `docs/06_status/proof/UTV2-1042/data-gate-monitor.json` (v10, SHA `ad3010fb`)

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
| Production readiness RED | **Blocking** | UTV2-1242 DONE (891512f1). Deploy alignment UTV2-1239 in progress — deploy run 27253256755 on dcd649d5. UTV2-1240 verification stability still open. |
| P3 empirical CLV/edge evidence | Certification | Data gate OPEN; P3 cert requires UTV2-1042 completion (paused by readiness RED) |
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

Post-cutover accumulation snapshot (as of v10 monitor, 2026-06-10T00:55Z):
- Provider offer cycles: 2 post-cutover SGO cycles (latest 2026-06-08T14:05:44Z — UTV2-1242 fix deployed, next cycle pending UTV2-1239 deploy)
- Pick candidates for post-cutover universe_ids: **2,609** (Gate 1 MET)
- Closing over odds (market_universe post-cutover): **2,602** (Gate 2 MET)
- CLV join path (picks → pick_candidates → market_universe with closing_over_odds): **125** (Gate 3 MET)
- Board scan: 39,541 candidates scanned, last at 2026-06-10T00:47Z
- sport_id attribution: fix confirmed live (UTV2-1228)

All three data-gate criteria are now MET. Empirical evidence accumulating but **no certification-grade proof available**.
UTV2-1042 dispatch paused by production-readiness RED (not data-gated).

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
| UTV2-1042 | CLV / edge empirical gate | Data gate OPEN — dispatch **paused** (production-readiness RED) |

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
