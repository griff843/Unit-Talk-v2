# Current State — Unit Talk V2

> **CANONICAL STATUS ENTRYPOINT.** This document is the single authoritative snapshot of
> program state, gap status, active monitors, and current blockers. All other state-bearing
> docs in this repo are either authoritative on their specific sub-topic (see §Source of Truth
> Hierarchy) or have been marked SUPERSEDED / HISTORICAL.
>
> **Last verified:** 2026-06-25T17:08:00Z (UTC) — UTV2-1315 markClosingLines fix deployed; ingestor clean cycle confirmed; readiness verdict **GREEN** (0 blocking failures). No program certification state advanced.
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

## Post-Incident Constitutional Gap Register (G-CONST-9 through G-CONST-13)

Source: `docs/06_status/proof/UTV2-1301/audit-v3.md` and
`docs/06_status/proof/UTV2-1302/audit-v3.md`.

| Gap | Status | Required Action |
|---|---|---|
| **G-CONST-9** — CURRENT_STATE.md stale since 2026-06-10 | `CLOSED` | UTV2-1307 (YELLOW update) + UTV2-1316 (GREEN update, this lane). |
| **G-CONST-10** — UTV2-1297 finalized-repoll runtime proof incomplete | `CONDITIONAL` | Keep UTV2-1297 instrumentation-only until runtime telemetry validates the path. |
| **G-CONST-11** — Retention execution preflight gate undefined | `OPEN` | Create PM-gated, read-only retention preflight before any batched DELETE, partition execution, or retention mutation. (UTV2-1306 spec complete; execution PM-gated.) |
| **G-CONST-12** — DB-health tripwire Section 5 parity gap | `CLOSED` | UTV2-1308 (PR merged 2026-06-25): tripwire monitor now covers full ratified Section 5 surface including `provider_offer_history`, `game_results`, TOAST bloat. |
| **G-CONST-13** — Production deploy SHA behind main | `CLOSED` | UTV2-1311 (PR merged 2026-06-25) + UTV2-1315 deploy run 28186314440 — prod SHA `d313ad95` = main HEAD. |
| **G-CONST-CODEX** — Codex capacity restored | `RESOLVED` | Codex canary (UTV2-1303) and danger-full-access fix (UTV2-1304) passed; restore two safe parallel T3 lanes. |

---

## Active Monitors

### UTV2-1042 — Empirical CLV / Data Gate

**State:** DATA-GATE OPEN — dispatch OPEN; evidence verdict not rendered

> **DISPATCH OPEN.** PM lifted the production-readiness-RED pause. Readiness re-audit verdict: YELLOW.
> Prior RED blockers resolved (UTV2-1239 DONE, UTV2-1242 DONE, production at dcd649d5).
> UTV2-1042 authorized as empirical evidence evaluation lane — honest pass/fail/defer outcome required.
> No CLV certification. No P3 certification. No edge/ROI/STRONG/ELITE claims.

Most recent recorded data-gate snapshot remains the June 10 monitor; UTV2-1302 flags that evidence
snapshot as stale and requires refresh before any certification decision.

Current recorded gate status:
- `pick_candidates` for post-cutover universe_ids: **2,975** (MET)
- `closing_over_odds IS NOT NULL` for post-cutover market_universe: **2,607** (MET)
- CLV join path: **126 picks** (MET)

**dispatch_gate: OPEN · paused: false**

Evidence: `docs/06_status/proof/UTV2-1042/data-gate-monitor.json` (v11, SGO snapshot 2026-06-10T05:38:13Z)
and UTV2-1302 readiness audit.

Accepted YELLOW residuals (PM-acknowledged):
- Health scripts count governance brake rows as failures (fix: UTV2-1248)
- `pipeline:health` delivery_freshness contradicted by live DB truth (fix: UTV2-1249)
- 199 stale_pending_operator_review rows are accepted governance queue, not system failures

### UTV2-1231 — Data-Gate Accumulation Monitor

**State:** STOP CONDITION MET — superseded by UTV2-1042 evidence verdict requirement

Cron job `c9ae211f` fires every 4 hours at :17 past. All three data-gate stop conditions are
met (v10 snapshot, 2026-06-10T00:55Z). UTV2-1242 ingestor recovery DONE — hung run cleared,
bounded queries deployed. SGO ingestor stall resolved pending UTV2-1239 deploy. Monitor remains
active to confirm continued post-cutover accumulation after next ingestor cycle.

---

## Production Readiness: GREEN

**Verdict as of 2026-06-25T17:08:00Z — 0 blocking failures.**

| Dimension | Status | Evidence |
|---|---|---|
| deploy_sha_alignment | **PASS** | prod `d313ad95` = main HEAD (deploy run 28186314440) |
| ingestor_health | **PASS** | clean cycle 2026-06-25T17:01:48Z, 3s (UTV2-1315 markClosingLines fix) |
| worker_outbox_health | **PASS** | 0 true stuck rows; 594 pending = Phase 7A governance holds (attempt_count=0) |
| dead_letter_count | **PASS** | 946 DL rows, ALL attempt_count=0 (governance holds, not retry-exhausted) |
| db_tripwires | **PASS** | G-CONST-12 closed (UTV2-1308); G-CONST-13 closed (UTV2-1311) |
| constitution_convergence | FAIL (non-blocking) | ~68% vs 80% threshold; `blocking: false` per policy |

Ledger: `docs/06_status/readiness/readiness-score.json` · Baseline: `docs/06_status/readiness/READINESS-GREEN-BASELINE-2026-06-25.md`

---

## Current Blockers

**No production-readiness blockers.** The remaining open items are certification gates and PM-deferred work:

| Blocker | Category | Notes |
|---|---|---|
| P3 empirical CLV/edge evidence | Certification | Data gate OPEN; dispatch OPEN (PM lift 2026-06-10). Latest evidence snapshot is stale; P3 cert requires refreshed UTV2-1042 honest pass/fail/defer outcome. |
| P4 economic truth unproven | Certification | No realized CLV / attribution data; economic certification requires live settled pick corpus |
| P5 freeze | Activation | FROZEN until burn-in PASS + P1–P4 certs + M10 Path A. Treasury/capital/scaling work forbidden. |
| P1 re-cert deadline | Time-gated | `proof_lineage` + `freshness` domains auto-degrade 2026-08-25; re-cert prep authorized |
| UTV2-1297 runtime proof | Verification | Finalized-repoll instrumentation merged; runtime proof pending. Treat as instrumentation-only until path telemetry validates it. |
| Retention execution preflight | DB operations | G-CONST-11 open: spec complete (UTV2-1306), no execution authorized until PM-gated preflight. |
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

Most recent recorded post-cutover accumulation snapshot:
- SGO snapshot advanced to 2026-06-10T05:38:13Z (5 cycles post-UTV2-1242)
- Pick candidates for post-cutover universe_ids: **2,975** (Gate 1 MET)
- Closing over odds (market_universe post-cutover): **2,607** (Gate 2 MET)
- CLV join path (picks → pick_candidates → market_universe with closing_over_odds): **126** (Gate 3 MET)
- sport_id attribution: fix confirmed live (UTV2-1228)

All three data-gate criteria were recorded as MET. **dispatch_gate: OPEN · paused: false** (PM decision 2026-06-10).
UTV2-1302 flags the snapshot as stale; no certification-grade proof or evidence verdict has been rendered.

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
| UTV2-1042 | CLV / edge empirical gate | Data gate OPEN — dispatch **OPEN**; evidence verdict pending and snapshot refresh needed |
| UTV2-1248 | Health scripts — governance brake false negatives | Authorized follow-up lane |
| UTV2-1249 | Pipeline health — fix delivery_freshness metric | Authorized follow-up lane |
| UTV2-1297 | Finalized-repoll throughput instrumentation | Merged; runtime proof pending |
| UTV2-1307 | CURRENT_STATE refresh (YELLOW) | Done — closed G-CONST-9 at YELLOW state |
| UTV2-1316 | CURRENT_STATE refresh (GREEN) | Done — updated to GREEN after UTV2-1315 deploy confirmation |

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
