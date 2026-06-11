# UTV2-1236 Constitution Gap Audit v2

merge_sha: d21dc3e14c143c100ce023a9c80310752c70a002
audited_at: 2026-06-11

## D-CONST Gap Verdicts

| Gap | Status | Evidence | Notes |
|-----|--------|----------|-------|
| D-CONST-1 | RESOLVED (PM_RATIFIED) | `CANONICAL_PROGRAM_STATE.md` (PM-ratified 2026-06-02); `CERTIFICATION_GAP_REGISTER.md`; banners applied to `PROGRAM_2_CERTIFICATION.md`, `CERT_BOARD.md`, `PROGRAM_5_ACTIVATION.md` | §18.3 numbering canonical: P1 Truth · P2 Governance · P3 Decision Integrity · P4 Execution & Economic Truth · P5 Institutional Runtime. Remaining stale references carry supersession banners. Full rename deferred. |
| D-CONST-2 | RESOLVED (PM_RATIFIED) | `CANONICAL_PROGRAM_STATE.md` (PM-ratified 2026-06-02); `CERTIFICATION_GAP_REGISTER.md`; banners applied to `PROGRAM_3_CERTIFICATION.md`, `PROGRAM_5_ACTIVATION.md`, `CERT_BOARD.md` | Canonical: P3 ACTIVE_NOT_CERTIFIED · P4 CONDITIONAL_NOT_CERTIFIED · P5 FROZEN_NOT_CERTIFIED. `PROGRAM_3_CERTIFICATION.md` header still reads "Status: CERTIFIED" but carries explicit supersession banner. `PROGRAM_5_ACTIVATION.md` P1–P4 gate entries carry explicit strikethrough + supersession notice. |
| D-CONST-3 | RESOLVED | UTV2-1195 (PR #950, merge SHA `a123b160`, 2026-06-02) — P1 cert doc (`PROGRAM_1_CERTIFICATION.md`) and P4 cert doc (`PROGRAM_4_CERTIFICATION.md`) created; §18.3 numbering normalized; stale-claim banners applied | P1 cert: ACTIVE_CERTIFIED, frozen-surface SHA `9600938`, re-cert deadline 2026-08-25. P4 cert: CONDITIONAL_NOT_CERTIFIED, all 12 INIT-4.x issues truth-check PASS. Confirmed on main via `git log`. |
| D-CONST-4 | RESOLVED | UTV2-1196 (PR #954, 2026-06-04); `t1-proof-gate.yml` verified: C2 runs `pnpm ci:db-smoke` as execution step (not grep); C4 requires 40-char SHA in proof files; lane manifest required before merge | `t1-proof-gate.yml` reviewed directly — DB-trigger proofs run fail-closed when `CI_REQUIRE_DB_SMOKE=true`. `lane-check.yml` enforces path authority from lane manifest. Proof gate is now execution-bound, not string-match-bound. |
| D-CONST-5 | RESOLVED (structural) | UTV2-1220 (PR #983, merge SHA `b399cdf7`, 2026-06-07) — five stat-based feature modules (matchup-context, player-form, opportunity, efficiency, game-context) wired into `computeStatProjection`; `CERTIFICATION_GAP_REGISTER.md` updated | Structural resolution confirmed on main via `git log`. Scoring is no longer a pure market-consensus echo. Empirical CLV/edge proof explicitly deferred to UTV2-1042 (data-gated). **P3 remains ACTIVE_NOT_CERTIFIED** — audit confirms no P3 certification claim anywhere in current-state docs. |
| D-CONST-6 | RESOLVED | UTV2-1227 (PR #985, merge SHA `d7b03595`, 2026-06-07) — SGO API key set in GitHub secrets; `SYNDICATE_MACHINE_ENABLED=true` added to `deploy.yml`; pipeline active. Board scan evidence: 9,893 scored candidates, 63 board candidates, 432 syndicate_board rows | Confirmed on main via `git log`. Pipeline active post-deploy. Does NOT prove CLV/edge; UTV2-1042 remains data-gated. `CERTIFICATION_GAP_REGISTER.md` updated to reflect full resolution. |
| D-CONST-7 | RESOLVED | UTV2-1198 (PR #957, 2026-06-04) — `packages/db/src/database.types.ts` regenerated; `execution_intents` and `settlement_corrections` present. `CERTIFICATION_GAP_REGISTER.md` updated | Confirmed on main via `git log`. |
| D-CONST-8 | RESOLVED | UTV2-1199 (PR #956, 2026-06-04) — `packages/db/CLAUDE.md` and `packages/contracts/CLAUDE.md` corrected. Verified directly: `packages/db/CLAUDE.md` now reads "fail-closed — assertFieldAuthority() throws"; `packages/contracts/CLAUDE.md` has explicit "Fail-Closed Authority Contract" section | No code changed — doc-only drift. Code was already fail-closed. Directly read both files to confirm. |

## Program State Verdicts

| Program | Expected | Actual (CURRENT_STATE.md + CANONICAL_PROGRAM_STATE.md) | Match |
|---------|----------|--------|-------|
| P1 Truth Convergence | ACTIVE_CERTIFIED | ACTIVE_CERTIFIED — frozen-surface SHA `9600938`, re-cert deadline 2026-08-25 | PASS |
| P2 Governance Convergence | ACTIVE_CERTIFIED | ACTIVE_CERTIFIED — INIT-2.x certification runtime, 229 live tests | PASS |
| P3 Decision Integrity | ACTIVE_NOT_CERTIFIED | ACTIVE_NOT_CERTIFIED — empirical CLV/edge evidence pending UTV2-1042 | PASS |
| P4 Execution & Economic Truth | CONDITIONAL_NOT_CERTIFIED | CONDITIONAL_NOT_CERTIFIED — execution real, economics unproven | PASS |
| P5 Institutional Runtime | FROZEN_NOT_CERTIFIED | FROZEN_NOT_CERTIFIED — burn-in PASS + P1–P4 certs + M10 Path A required | PASS |

Both `CURRENT_STATE.md` and `CANONICAL_PROGRAM_STATE.md` agree on all five program states. No conflict found.

## Drift Findings

### DF-1: CONSTITUTIONAL_DRIFT_AUDIT.md is stale (LOW SEVERITY — expected)

`docs/00_constitution/CONSTITUTIONAL_DRIFT_AUDIT.md` was created 2026-06-02 at HEAD `a0614837`. It still shows D-CONST-3 through D-CONST-7 as OPEN. The authoritative ledger (`CERTIFICATION_GAP_REGISTER.md`, updated 2026-06-07) shows all eight gaps RESOLVED or PM_RATIFIED. This document predates the resolutions. It carries no supersession banner, but it is a historical audit snapshot, not an active authority. It does not contradict the canonical register.

**Risk:** Low. A reader consulting only this file could be confused. No stale claim in this file is authoritative under the truth hierarchy.

### DF-2: PROGRAM_3_CERTIFICATION.md header still reads "Status: CERTIFIED" (KNOWN DRIFT — BANNERED)

The body of `PROGRAM_3_CERTIFICATION.md` contains a PM Certification Declaration ("PROGRAM 3 CERTIFIED — Date: 2026-06-01"). This claim is superseded by the constitutional reconciliation notice banner at the top of the file, which explicitly states this "certified" header is historical and that the canonical status is ACTIVE_NOT_CERTIFIED per `CANONICAL_PROGRAM_STATE.md`. The banner is in place. No stale claim is unguarded.

**Risk:** Medium visibility, Low authority risk. The banner explicitly supersedes the body claim. No document that is rank-1 through rank-3 in the truth hierarchy makes a stale P3 certification claim.

### DF-3: PROGRAM_5_ACTIVATION.md "SATISFIED" gate language (KNOWN DRIFT — BANNERED + STRICKEN)

`PROGRAM_5_ACTIVATION.md` §5 and §8 contain language "SATISFIED 2026-06-01" for P1–P4 gates. These entries carry explicit strikethrough and a constitutional reconciliation notice banner that negates the stale claim. P5 remains FROZEN_NOT_CERTIFIED per canonical state.

**Risk:** Low. Supersession banner and strikethrough in place. Canonical state is unambiguous.

### DF-4: CERT_BOARD.md "P1–P4 certified SATISFIED" entry (KNOWN DRIFT — BANNERED)

`CERT_BOARD.md` is marked SUPERSEDED/HISTORICAL with a constitutional reconciliation banner explicitly stating the "P1–P4 certified gate ... NOT satisfied" and "P5 remains FROZEN." No actionable certification authority derives from this file.

**Risk:** Low. Canonical state docs are authoritative.

### DF-5: No unguarded P3 certification claims, no P5 unfreeze language, no Redis/Temporal production promotion

- All P3 certification claims in non-superseded docs are explicitly qualified as ACTIVE_NOT_CERTIFIED.
- P5 unfreeze language: the only references found are explicit statements of the unfreeze *requirements*, not claims of unfreeze. `CURRENT_STATE.md` §P5 Freeze Constraints and `CANONICAL_PROGRAM_STATE.md` both correctly describe FROZEN_NOT_CERTIFIED.
- Redis/Temporal: references found only in `production_readiness_checklist.md` context — both are explicitly **DEFERRED TO SYNDICATE GATE**, not promoted into current production readiness.
- CLV/ROI/edge claims: `CURRENT_STATE.md` explicitly lists "Proven economic edge — requires P4 certification" and "CLV certification — requires live settled pick corpus" as forbidden claims. `MODEL_EDGE_ACCEPTANCE_STANDARD.md` gates all edge labels on hard statistical thresholds. No unauthorized edge/CLV/ROI claim found.
- "Production-ready" claims: `CURRENT_STATE.md` explicitly states "Production-readiness assertion — not within scope of any current lane." Readiness is stated as YELLOW, not production-ready.

## Follow-up Lanes Required

### FU-1: CONSTITUTIONAL_DRIFT_AUDIT.md needs supersession banner (recommended, not blocking)

`docs/00_constitution/CONSTITUTIONAL_DRIFT_AUDIT.md` should receive a SUPERSEDED/HISTORICAL banner (matching the pattern applied to `PROGRAM_STATUS.md`, `PROGRAM_2_CERTIFICATION.md`, `PROGRAM_3_CERTIFICATION.md`, etc.) to prevent reader confusion. The document's gap list is now a historical snapshot, not a live register. The authoritative register is `CERTIFICATION_GAP_REGISTER.md`.

**Recommended follow-up lane:** T3 governance lane to add supersession banner to `CONSTITUTIONAL_DRIFT_AUDIT.md`. Not blocking lane closure.

### FU-2: PROGRAM_3_CERTIFICATION.md "Status: CERTIFIED" header (known, tracked)

The file header still reads `Status: CERTIFIED`. The supersession banner covers this, but ideally the header itself should be updated to `Status: HISTORICAL (ACTIVE_NOT_CERTIFIED per canonical state)`. This was deferred to `SPRINT-CERTIFICATION-STATE-RECONCILIATION-003` per `CERTIFICATION_GAP_REGISTER.md` D-CONST-2 remaining work note.

**Recommended follow-up lane:** T3 governance lane for full stale-reference rename. Already identified in D-CONST-2 remaining work. Not blocking.

### FU-3: P1 re-certification prep (time-gated, tracked)

`CURRENT_STATE.md` notes re-cert deadline 2026-08-25 for P1 `proof_lineage` + `freshness` domains. A re-certification prep lane is authorized but not yet open.

**Recommended follow-up lane:** T1 governance lane for P1 re-cert prep before 2026-08-25. Not blocking current audit.

## Overall Verdict

PASS — All 8 D-CONST gaps are at their expected resolution states (D-CONST-1/2 PM_RATIFIED; D-CONST-3 through D-CONST-8 RESOLVED). All 5 program state verdicts match expected canonical states. No unguarded P3 certification claims, no P5 unfreeze language, no unauthorized CLV/ROI/edge claims, and no production-readiness overreach found in current-state documents. Three low-priority follow-up lanes identified (none blocking).
