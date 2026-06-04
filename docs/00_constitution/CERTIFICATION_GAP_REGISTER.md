# Certification Gap Register

> SPRINT-CONSTITUTIONAL-CONVERGENCE-002 · 2026-06-02. Updated 2026-06-04 (D-CONST-4, D-CONST-7, D-CONST-8 resolved).
> Canonical ledger of constitutional certification gaps. D-CONST-1 through D-CONST-4 resolved; D-CONST-7/D-CONST-8 resolved 2026-06-04; D-CONST-5 and D-CONST-6 remain OPEN.

## D-CONST-1 — Program numbering drift
- **Status:** `PM_RATIFIED`
- **Resolution:** Constitution §18.3 numbering is canonical — P1 Truth, P2 Governance, P3 Decision Integrity, P4 Execution & Economic Truth, P5 Institutional Runtime.
- **Remaining work:** update / annotate stale references that use conflicting definitions (e.g. `PROGRAM_2_CERTIFICATION.md` "Program 2 = WS-1.x", `CERT_BOARD.md`). Banners applied this sprint; full renaming deferred to SPRINT-CERTIFICATION-STATE-RECONCILIATION-003.

## D-CONST-2 — P3/P4/P5 activation state ambiguity
- **Status:** `PM_RATIFIED`
- **Resolution:** **P3 active, P4 conditional, P5 frozen.** Canonical statuses: P1 ACTIVE_CERTIFIED · P2 ACTIVE_CERTIFIED · P3 ACTIVE_NOT_CERTIFIED · P4 CONDITIONAL_NOT_CERTIFIED · P5 FROZEN_NOT_CERTIFIED (`CANONICAL_PROGRAM_STATE.md`).
- **Remaining work:** update / annotate stale references that claim "P3 certified" / "P4 certified" / "P1–P4 certified SATISFIED" (`PROGRAM_3_CERTIFICATION.md`, `PROGRAM_5_ACTIVATION.md`, `CERT_BOARD.md`) and reconcile Linear operational state. Banners applied this sprint.

## D-CONST-3 — Missing canonical certification records
- **Status:** `RESOLVED`
- **Resolved by:** UTV2-1195 (PR #950, 2026-06-02) — P1/P4 canonical cert records created, §18.3 numbering normalized, stale-claim reconciliation merged.
- **Details:** P1 cert doc created, P4 cert doc created, stale P3/P4/P5 claim banners applied. P5 remains frozen/uncertified (correct).
- **Remaining:** P5 certification deferred (frozen per D-CONST-2 PM ratification). No further D-CONST-3 action required.

## D-CONST-4 — Proof gate string-bound not execution-bound
- **Status:** `RESOLVED`
- **Resolved by:** UTV2-1196 (PR #954, 2026-06-04) — proof gate made execution-bound; `t1-proof-gate` now requires TAP node:test output pattern, not string presence; DB-trigger proofs fail closed when service role key absent.

## D-CONST-5 — Edge as market echo
- **Status:** `OPEN`
- **Detail:** scoring is structurally a market-consensus echo; zero realized profitability/CLV evidence.
- **Required next action:** P3 Decision Integrity remediation **after** constitutional convergence (do not implement scoring features in this sprint).

## D-CONST-6 — Ingestion stale / runtime freshness drift
- **Status:** `OPEN`
- **Detail:** live provider freshness ~11.7d stale — the §22 "daemon looping empty while healthy" anti-pattern.
- **Required next action:** runtime hardening + ingestion restoration **when SGO is intentionally reactivated or mocked for no-cost proof** (do not activate SGO in this sprint).

## D-CONST-7 — `database.types.ts` drift
- **Status:** `RESOLVED`
- **Resolved by:** UTV2-1198 (PR #957, 2026-06-04) — `packages/db/src/database.types.ts` regenerated from live Supabase; `execution_intents` and `settlement_corrections` now present in generated types. Also reconciled missing `artifact_sha` migration in live DB history.

## D-CONST-8 — Docs say fail-open but code is fail-closed
- **Status:** `RESOLVED`
- **Resolved by:** `SPRINT-D-CONST-8-FAIL-CLOSED-DOC-RECONCILIATION` · 2026-06-04 · UTV2-1199
- **Files corrected:**
  - `packages/db/CLAUDE.md` — removed "fail-open" claim; added fail-closed invariants section; `assertFieldAuthority()` behavior now accurately documented
  - `packages/contracts/CLAUDE.md` — added explicit Fail-Closed Authority Contract section describing blocking enforcement semantics
- **No code changed** — this was documentation reconciliation only. `writer-authority.ts` was already fail-closed; the docs now accurately reflect that behavior.
- **Code was authoritative** — under the constitutional truth hierarchy, code wins. The documentation drift was stale description, not a code defect.

## Summary
| Gap | Status |
|---|---|
| D-CONST-1 Program numbering | **PM_RATIFIED** |
| D-CONST-2 Activation state | **PM_RATIFIED** |
| D-CONST-3 Missing cert records | **RESOLVED** (UTV2-1195, PR #950) |
| D-CONST-4 Proof gate string-bound | **RESOLVED** (UTV2-1196, PR #954) |
| D-CONST-5 Edge as echo | OPEN |
| D-CONST-6 Ingestion stale | OPEN |
| D-CONST-7 types drift | **RESOLVED** (UTV2-1198, PR #957) |
| D-CONST-8 doc fail-open | **RESOLVED** (UTV2-1199, PR #956) |
