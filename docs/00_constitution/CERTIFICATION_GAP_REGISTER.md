# Certification Gap Register

> SPRINT-CONSTITUTIONAL-CONVERGENCE-002 · 2026-06-02.
> Canonical ledger of constitutional certification gaps. D-CONST-1 and D-CONST-2 are PM-ratified; D-CONST-3 through D-CONST-8 remain OPEN. This sprint **advances no certification.**

## D-CONST-1 — Program numbering drift
- **Status:** `PM_RATIFIED`
- **Resolution:** Constitution §18.3 numbering is canonical — P1 Truth, P2 Governance, P3 Decision Integrity, P4 Execution & Economic Truth, P5 Institutional Runtime.
- **Remaining work:** update / annotate stale references that use conflicting definitions (e.g. `PROGRAM_2_CERTIFICATION.md` "Program 2 = WS-1.x", `CERT_BOARD.md`). Banners applied this sprint; full renaming deferred to SPRINT-CERTIFICATION-STATE-RECONCILIATION-003.

## D-CONST-2 — P3/P4/P5 activation state ambiguity
- **Status:** `PM_RATIFIED`
- **Resolution:** **P3 active, P4 conditional, P5 frozen.** Canonical statuses: P1 ACTIVE_CERTIFIED · P2 ACTIVE_CERTIFIED · P3 ACTIVE_NOT_CERTIFIED · P4 CONDITIONAL_NOT_CERTIFIED · P5 FROZEN_NOT_CERTIFIED (`CANONICAL_PROGRAM_STATE.md`).
- **Remaining work:** update / annotate stale references that claim "P3 certified" / "P4 certified" / "P1–P4 certified SATISFIED" (`PROGRAM_3_CERTIFICATION.md`, `PROGRAM_5_ACTIVATION.md`, `CERT_BOARD.md`) and reconcile Linear operational state. Banners applied this sprint.

## D-CONST-3 — Missing canonical certification records
- **Status:** `OPEN`
- **Details:**
  - **P1** certification exists outside canonical repo docs (Linear `PROGRAM_1_FROZEN_SURFACE` + repo proof JSON) — asymmetrically represented; no `docs/06_status/programs/PROGRAM_1_CERTIFICATION.md`.
  - **P4** has **no** canonical repo certification doc (only scattered `chore(program-4)` lane-manifest annotations).
  - **P5** has no certification and remains frozen.
- **Required next action:** `SPRINT-CERTIFICATION-STATE-RECONCILIATION-003`

## D-CONST-4 — Proof gate string-bound not execution-bound
- **Status:** `OPEN`
- **Detail:** `t1-proof-gate` greps the literal string `"test:db"`; DB-trigger proofs skip silently without `SUPABASE_SERVICE_ROLE_KEY`.
- **Required next action:** `SPRINT-PROOF-GATE-EXECUTION-BOUND-004`

## D-CONST-5 — Edge as market echo
- **Status:** `OPEN`
- **Detail:** scoring is structurally a market-consensus echo; zero realized profitability/CLV evidence.
- **Required next action:** P3 Decision Integrity remediation **after** constitutional convergence (do not implement scoring features in this sprint).

## D-CONST-6 — Ingestion stale / runtime freshness drift
- **Status:** `OPEN`
- **Detail:** live provider freshness ~11.7d stale — the §22 "daemon looping empty while healthy" anti-pattern.
- **Required next action:** runtime hardening + ingestion restoration **when SGO is intentionally reactivated or mocked for no-cost proof** (do not activate SGO in this sprint).

## D-CONST-7 — `database.types.ts` drift
- **Status:** `OPEN`
- **Detail:** `execution_intents` + `settlement_corrections` exist live but are absent from generated types; parity gate may skip when `SUPABASE_DB_URL` unset.
- **Required next action:** regenerate types + make parity non-skippable (folds into SPRINT-CERTIFICATION-STATE-RECONCILIATION-003 or proof-gate sprint).

## D-CONST-8 — Docs say fail-open but code is fail-closed
- **Status:** `OPEN`
- **Detail:** `packages/db/CLAUDE.md` + `packages/contracts/CLAUDE.md` state "fail-open" where `writer-authority.ts` is fail-closed. Code wins (truth hierarchy); docs are stale.
- **Required next action:** correct the two doc lines (low-risk doc fix; can ride any P2 governance-hardening sprint).

## Summary
| Gap | Status |
|---|---|
| D-CONST-1 Program numbering | **PM_RATIFIED** |
| D-CONST-2 Activation state | **PM_RATIFIED** |
| D-CONST-3 Missing cert records | OPEN |
| D-CONST-4 Proof gate string-bound | OPEN |
| D-CONST-5 Edge as echo | OPEN |
| D-CONST-6 Ingestion stale | OPEN |
| D-CONST-7 types drift | OPEN |
| D-CONST-8 doc fail-open | OPEN |
