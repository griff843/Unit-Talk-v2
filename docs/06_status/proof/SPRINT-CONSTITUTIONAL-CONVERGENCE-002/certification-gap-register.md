# Certification Gap Register — Proof Pointer

> 2026-06-02. Authoritative ledger: **`docs/00_constitution/CERTIFICATION_GAP_REGISTER.md`**. Snapshot below.

| Gap | Status | Resolution / next action |
|---|---|---|
| D-CONST-1 Program numbering | **PM_RATIFIED** | §18.3 canonical; stale refs annotated |
| D-CONST-2 Activation state | **PM_RATIFIED** | P3 active / P4 conditional / P5 frozen |
| D-CONST-3 Missing cert records (P1 Linear-only, P4 none, P5 none) | **OPEN** | SPRINT-CERTIFICATION-STATE-RECONCILIATION-003 |
| D-CONST-4 Proof gate string-bound | **OPEN** | SPRINT-PROOF-GATE-EXECUTION-BOUND-004 |
| D-CONST-5 Edge as market echo | **OPEN** | P3 remediation after convergence |
| D-CONST-6 Ingestion stale | **OPEN** | runtime hardening + no-cost/mock/replay freshness proof |
| D-CONST-7 `database.types.ts` drift | **OPEN** | regen + non-skippable parity |
| D-CONST-8 doc fail-open vs code fail-closed | **OPEN** | correct two doc lines |

**Only D-CONST-1 and D-CONST-2 are resolved (by PM ruling). D-CONST-3..8 remain open. No certification advanced.**
