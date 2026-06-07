# Certification Gap Register

> SPRINT-CONSTITUTIONAL-CONVERGENCE-002 · 2026-06-02. Updated 2026-06-07 (D-CONST-5 structurally resolved by UTV2-1220, PR #983; D-CONST-6 fully resolved by UTV2-1227, deploy SHA d7b03595).
> Canonical ledger of constitutional certification gaps. D-CONST-1 through D-CONST-8 resolved (D-CONST-6 fully resolved 2026-06-07).

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
- **Status:** `RESOLVED` (structural) — 2026-06-07
- **Resolved by:** UTV2-1220 (PR #983) — Wave 5 (UTV2-1211–1215) wired five stat-based feature modules (matchup-context, player-form, opportunity, efficiency, game-context) into `computeStatProjection`. Scoring is no longer a pure market-consensus echo.
- **Wave merge SHAs:** UTV2-1211: e21b6999 · UTV2-1212: c1e7d9a9 · UTV2-1213: aa3a7c8d · UTV2-1214: b561bd71 · UTV2-1215: a8d3a105
- **Evidence bundle SHAs:** UTV2-1217: 98552597 (CLV evidence) · UTV2-1218: 00eaa61c (R2 determinism) · UTV2-1219: 43ed4621 (V-R4 fault injection)
- **Empirical evidence deferred:** UTV2-1217 found insufficient graded production volume (corpus is synthetic/smoke-test, sport_id=NULL). CLV/edge empirical certification deferred to UTV2-1042 (state:data-gated).
- **P3 status:** ACTIVE_NOT_CERTIFIED (unchanged — structural resolution does not advance P3 certification).
- **Validation gaps tracked:** 4 NaN/zero boundary gaps from UTV2-1219 deferred to hardening follow-up; 1 (negative variance clamp) accepted as correct defensive behavior.

## D-CONST-6 — Ingestion stale / runtime freshness drift
- **Status:** `RESOLVED` — 2026-06-07
- **Resolved by (ingestion):** UTV2-1227 (2026-06-07) — SGO key set in GitHub secrets; workflow fixes committed; `stage:freshness` Offers FRESH at age ~4m; Market Universe FRESH (355 rows, Wave-5 materializer running).
- **Resolved by (downstream activation):** UTV2-1227 PR #985, merge SHA `d7b035958c3c96a802ffc27684ac8e6ab08a2e8f` — added `SYNDICATE_MACHINE_ENABLED=true` to `.github/workflows/deploy.yml` production env section. Board scan was gated on this flag (default false); pipeline was producing zero candidates/scoring/board for the full 17-day outage.
- **Post-deploy pipeline evidence (freshly no-op with evidence):** `pick_candidates.updated_at = 2026-06-07T18:16:31Z`; 9,893 scored candidates active; 63 board candidates (`is_board_candidate=true`) updated at 18:16:19–18:16:31Z; `syndicate_board` 432 rows, 24 board_runs. Board scan operates via UPDATE path (`onConflict: 'universe_id'`) — `stage:freshness` probe uses `created_at` (frozen May 20) not `updated_at`; pipeline activity confirmed by direct DB evidence.
- **Evidence:** `docs/06_status/proof/D-CONST-6/`, `docs/06_status/proof/UTV2-1227/evidence.json`
- **Root cause was:** (1) SGO_API_KEY absent from GitHub secrets at 2026-05-21 deploy — ingestor silently skipped all SGO cycles for ~17 days; (2) `SYNDICATE_MACHINE_ENABLED` never set in any deploy.yml commit — board scan ran with `enabled:false` for entire pipeline history.
- **Note:** `P3 remains ACTIVE_NOT_CERTIFIED`. D-CONST-6 resolution unlocks real post-Wave-5 evidence accumulation; it does not itself prove CLV/edge. `UTV2-1042` remains data-gated.

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
| D-CONST-5 Edge as echo | **RESOLVED** structural (UTV2-1220, PR #983) — empirical deferred to UTV2-1042 |
| D-CONST-6 Ingestion stale | **RESOLVED** (UTV2-1227, PR #985, 2026-06-07) — full pipeline activated, downstream evidence confirmed |
| D-CONST-7 types drift | **RESOLVED** (UTV2-1198, PR #957) |
| D-CONST-8 doc fail-open | **RESOLVED** (UTV2-1199, PR #956) |
