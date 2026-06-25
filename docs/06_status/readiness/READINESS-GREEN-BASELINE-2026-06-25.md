# Production Readiness GREEN Baseline — 2026-06-25

**Established:** 2026-06-25T17:08:00Z  
**Established by:** UTV2-1315 markClosingLines fix deploy + ingestor clean cycle confirmation  
**Readiness ledger:** `docs/06_status/readiness/readiness-score.json`

---

## Baseline Coordinates

| Field | Value |
|---|---|
| **main SHA** | `cbeefdc3e238bef4268d0acd2cd8b67618ebaf08` |
| **prod SHA** | `d313ad95787040463ffb02379e94075a75756de3` |
| **Deploy run** | `28186314440` (succeeded 2026-06-25T17:00:xx) |
| **Readiness verdict** | **GREEN** |
| **Blockers** | 0 |
| **Open non-blocking gaps** | 1 (`constitution_convergence`) |

---

## Ingestor Clean Cycle Evidence

| Field | Value |
|---|---|
| **Cycle timestamp** | `2026-06-25T17:01:48Z` |
| **Duration** | 3 seconds |
| **Outcome** | `succeeded` |
| **Pre-fix behavior** | 90–200s → `statement_timeout` (all 8 post-key-rotation cycles) |
| **Fix applied** | UTV2-1315 — added `.gte('snapshot_at', windowStart)` lower bound to `markClosingLines` SELECT; limits Postgres partition scan from 60+ partitions to ~2 |

---

## Dimension Status at Baseline

| Dimension | Status | Notes |
|---|---|---|
| `deploy_sha_alignment` | **PASS** | prod `d313ad95` = main HEAD |
| `ingestor_health` | **PASS** | clean cycle 17:01:48Z, 3s |
| `worker_outbox_health` | **PASS** | 0 true stuck rows; 594 pending = Phase 7A governance holds (attempt_count=0) |
| `dead_letter_count` | **PASS** | 946 DL rows, ALL attempt_count=0 (governance holds, not retry-exhausted) |
| `db_tripwires` | **PASS** | G-CONST-12 closed (UTV2-1308); G-CONST-13 closed (UTV2-1311); G-CONST-11 PM-deferred |
| `pnpm_verify` | **PASS** | CI green on PR #1076 merge SHA `321638ab` |
| `proof_coverage` | **PASS** | 8 SHA-bound proof bundles on main |
| `constitution_convergence` | FAIL (non-blocking) | ~68% vs 80% threshold; `blocking: false` per policy |

---

## Forbidden Claims (still in force at this baseline)

The following claims are **forbidden** regardless of this GREEN verdict:

- P3 certification — requires empirical CLV/edge evidence (UTV2-1042 data-gate)
- Proven economic edge / ROI / CLV claims — requires P4 certification
- P5 unfreeze — requires P1–P4 certified + burn-in PASS + M10 Path A
- Discord public launch enablement — PM-blocked; no Discord open without explicit approval
- Production-readiness-implies-launch claim — GREEN = no blocking operational failures; does NOT mean launch-ready

---

## What GREEN Means Here

**GREEN = 0 blocking operational failures.** Specifically:

- Ingestor is cycling cleanly (no statement_timeout on markClosingLines)
- Production is deployed at main HEAD
- Outbox has no true delivery failures (governance holds are not failures)
- Dead-letter queue has no retry-exhausted rows
- No critical DB tripwires active

**GREEN does NOT mean:**

- Launch-ready (requires separate Launch Gate definition — UTV2-1318)
- P3/P4/P5 certified
- Discord delivery enabled
- CLV/edge proven

---

## Regression Baseline Use

This document is the reference point for the readiness regression gate (UTV2-1317). If any future PR causes the readiness-score.json verdict to regress from GREEN:

1. The regression gate CI check will fire
2. A new fix lane must be opened
3. This baseline document records the starting state to return to

Do not update this file when the score is refreshed — it is a point-in-time snapshot. Future GREEN re-establishments create new baseline files with their own timestamps.
