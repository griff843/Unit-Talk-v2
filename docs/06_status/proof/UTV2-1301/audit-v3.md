# Constitution Gap Audit v3 — UTV2-1301

**Audited at:** 2026-06-25T13:00:00Z
**Main SHA (at audit time):** 53b91fce39f828e8af0206cb34b546d8214e9651
**Executor:** Claude (governance lane, T1)
**Scope:** Post-ingestion incident constitutional gap assessment — production state, June 2026

---

## Audit Verdict: YELLOW

No program-level RED. Constitutional gaps G-CONST-9 through G-CONST-13 identified; none require immediate work stoppage. G-CONST-9 (canonical state staleness) and G-CONST-13 (deploy SHA gap) require prompt PM acknowledgment and action. G-CONST-11 (retention preflight gate) and G-CONST-12 (DB-health tripwire §5 parity) require follow-up lanes. Codex capacity finding (G-CONST-CODEX) is positive: restore to two safe parallel lanes.

---

## Prior Gap Register (D-CONST-1 through D-CONST-8)

All eight drift gaps from the v1/v2 register remain in their resolved or ratified states. No regression detected.

| Gap | Status | Confirmed By |
|-----|--------|--------------|
| D-CONST-1 — Program numbering drift | PM_RATIFIED | §18.3 numbering canonical; banners applied |
| D-CONST-2 — P3/P4/P5 activation ambiguity | PM_RATIFIED | Canonical states documented |
| D-CONST-3 — Missing P1/P4 cert records | RESOLVED | UTV2-1195, PR #950 |
| D-CONST-4 — Proof gate string-bound not execution-bound | RESOLVED | UTV2-1196, PR #954 |
| D-CONST-5 — Edge as market echo | RESOLVED (structural) | UTV2-1220, PR #983; empirical proof deferred |
| D-CONST-6 — Ingestion stale / runtime freshness drift | RESOLVED | UTV2-1227, PR #985 |
| D-CONST-7 — database.types.ts drift | RESOLVED | UTV2-1198, PR #957 |
| D-CONST-8 — Docs say fail-open, code is fail-closed | RESOLVED | UTV2-1199, PR #956 |

---

## New Gaps — Post-Ingestion Incident (June 2026)

### G-CONST-9: Canonical State Document Staleness

**Status:** OPEN — requires PM acknowledgment + scheduled update lane

**Finding:** `docs/06_status/CURRENT_STATE.md` is the designated canonical status entrypoint ("CANONICAL STATUS ENTRYPOINT" header). It was last verified at `2026-06-10T08:00:00Z` — 15 days ago as of this audit. Multiple significant changes have occurred since (UTV2-1286 watchdog deploy, UTV2-1293 daemon-resident fix, UTV2-1295 retention spec, UTV2-1297 finalized-repoll instrumentation, UTV2-1300 DB-health tripwire, UTV2-1303 Codex canary, UTV2-1304 danger-full-access fix), none of which are reflected in the canonical snapshot.

**Constitutional relevance:** A stale canonical state document allows false premises to persist in orchestration. The document's own header states it is "the single authoritative snapshot" — that claim is false while stale.

**Risk:** MEDIUM. No active cert claims corrupted. Risk is to orchestration accuracy and PM decision quality.

**Resolution path:** T3 lane to update CURRENT_STATE.md with post-incident state. PM must approve as canonical snapshot update.

---

### G-CONST-10: UTV2-1297 Runtime Proof Incomplete

**Status:** CONDITIONAL — proof pending tonight's runtime window

**Finding:** UTV2-1297 (finalized-repoll throughput instrumentation) merged at SHA `736d0d41` on 2026-06-24. The proof bundle `docs/06_status/proof/UTV2-1297/runtime-verification.md` shows `result: not_run` with placeholder text: "Generated foundation artifact. Replace or append command output when runtime proof is executed."

**Constitutional relevance:** T2 lanes require "type-check + test + issue-specific" verification. The issue-specific artifact for an instrumentation lane is runtime telemetry showing the instrumented path was exercised. That proof has not yet been executed.

**PM input (2026-06-25):** "UTV2-1297 is instrumentation-only until tonight's runtime proof validates the finalized-repoll path."

**Risk:** LOW-MEDIUM. Code is correct and merged; the missing artifact is evidence, not a fix. If tonight's runtime window doesn't produce proof, the lane is technically incomplete.

**Resolution path:** Runtime watch tonight. If the finalized-repoll path fires and produces telemetry, append to `runtime-verification.md`. If not, escalate to PM as a discovery miss.

---

### G-CONST-11: Retention Execution Preflight Gate Undefined

**Status:** OPEN — requires PM-gated preflight before any execution action

**Finding:** UTV2-1295 (retention/partition/write-path architecture spec) merged at SHA `92124569`. The spec defines execution actions in §§1–4 (batched DELETE, archival, partition management). The spec explicitly labels these "PM-gated" and "PM approval required." However, no preflight gate artifact, preflight checklist, or schema-verified read-only probe sequence has been defined between spec ratification and execution.

**PM input (2026-06-25):** "DB retention must not jump straight to batched DELETE; first create schema-verified retention execution preflight."

**Constitutional relevance:** Core invariant 10 — "Fail closed — never silent fallback." Jumping from a spec to a DELETE without a read-only preflight is a fail-open pattern. The invariant requires explicit gates. Additionally, invariant 11 — "If a rule can be enforced mechanically, it must not live only in prose" — is not yet met for retention execution; it exists only as prose in the spec.

**Risk:** HIGH if execution proceeds without preflight. MEDIUM currently (no execution lane opened yet).

**Resolution path:** New T2 lane — "Retention Execution Preflight" — must produce: (1) schema-verified read-only snapshot of target tables (current sizes, row counts, dead tuple counts), (2) pre-execution checklist signed off by PM, (3) rollback procedure documented. No DELETE until this lane is Done.

---

### G-CONST-12: DB-Health Tripwire §5 Partial Parity

**Status:** OPEN — follow-up T3 lane required

**Finding:** UTV2-1300 (DB-health tripwire, merged `d81f2018`) implements GHA cron monitoring from §5 of `DB_MAINTENANCE_RETENTION_SPEC.md`. Coverage audit against spec:

| §5 Check | Spec Requirement | UTV2-1300 Coverage | Gap |
|----------|-----------------|-------------------|-----|
| §5.2 — Autovacuum Staleness | All hot tables: `system_runs`, `raw_payloads`, `odds_snapshots`, `provider_offer_history`, `game_results` | `system_runs`, `raw_payloads`, `odds_snapshots` only | `provider_offer_history` + `game_results` missing |
| §5.3 — Table Size Growth Rate | Same 5 tables; thresholds: `system_runs` 500MB, `raw_payloads` 300MB, `odds_snapshots` 300MB | 3 tables; thresholds: `raw_payloads` 2048MB, `odds_snapshots` 1024MB | 2 tables missing; `raw_payloads`/`odds_snapshots` thresholds 6.8× / 3.4× above spec |
| §5.4 — Statement Timeout Error Rate | pg_stat_statements or log parsing | Supabase log API | Partial — no pg_stat_statements; threshold: 5 occurrences vs spec 3/hour |
| §5.5 — TOAST Bloat Estimate | `raw_payloads` + `odds_snapshots` TOAST ratio alert | NOT IMPLEMENTED | Full check missing |
| §5.6 — Ingestor/Pipeline Health | Reference Track A monitor only (no duplication) | N/A — correctly excluded | No gap |

**Constitutional relevance:** `provider_offer_history` (60 partitions, 1.39M rows) caused a `statement_timeout` incident in June 2026 due to missing `snapshot_at` partition pruning. It is an identified hot table with a known incident history. Excluding it from autovacuum and size monitoring is a parity gap with direct incident risk.

**Risk:** MEDIUM. The monitor is better than none. But the gap means the known incident contributor is unmonitored.

**Resolution path:** T3 lane — "DB-health tripwire §5 parity expansion" — add `provider_offer_history` + `game_results` to vacuum/size checks, correct size thresholds per spec, add §5.5 TOAST bloat check.

---

### G-CONST-13: Deploy SHA Alignment — Production Not at Main

**Status:** OPEN — production-readiness concern; requires PM decision

**Finding:** Production (Hetzner 46.225.14.123) was last deployed at SHA `dcd649d5` on 2026-06-10. Current main HEAD is `53b91fce` (2026-06-25). The deploy gap includes at minimum:

| Merged SHA | Description |
|------------|-------------|
| multiple | UTV2-1286 watchdog fix — prevents ingestor wedging post-Supabase outage |
| multiple | UTV2-1293 daemon-resident MAX_CYCLES fix — prevents ingestor stall after N cycles |
| `92124569` | UTV2-1295 retention spec — PM-gated; no execution risk but spec not on prod |
| `736d0d41` | UTV2-1297 finalized-repoll instrumentation — telemetry not running on prod |
| `d81f2018` | UTV2-1300 DB-health tripwire — monitor GHA; runs independently of prod deploy |
| `ee4046ea` | UTV2-1303 Codex canary proof — doc only |
| `53b91fce` | UTV2-1304 danger-full-access fix — ops tooling only |

**PM input (2026-06-25):** "Deploy SHA alignment should be treated as production-readiness material, not a low-priority doc issue, if prod is not at current main."

**Constitutional relevance:** The watchdog fix (UTV2-1286) and daemon-resident fix (UTV2-1293) are active runtime protection that are NOT on production. Production is running pre-fix code. The June 2026 incidents (5.5h ingestor wedge, 40h game_results freeze) were partly caused by conditions these fixes address. Without the deploy, the same failure modes remain live.

**Risk:** HIGH for the runtime fixes. MEDIUM overall (fixes merged but not deployed = partial mitigation only).

**Resolution path:** PM decision: trigger deploy workflow against main HEAD. Treat as production-readiness priority (MEDIUM+), not housekeeping.

---

### G-CONST-CODEX: Codex Capacity — Positive Finding

**Status:** RESOLVED — restore Codex to two parallel T3 lanes

**Finding:** UTV2-1303 (Codex full-cycle canary) proved that Codex can complete a full lane lifecycle end-to-end using the canonical dispatch wrapper. UTV2-1304 (danger-full-access fix) resolved the blocker that was preventing Codex commit/push in worktrees. Both lanes merged cleanly with no incident.

**Constitutional relevance:** The Codex capacity was previously constrained pending the canary. With canary passed and the worktree access fix in place, the concurrency governor can safely allow two Codex T3 lanes in parallel.

**PM input (2026-06-25):** "Codex canary UTV2-1303 passed; restore Codex to two safe parallel lanes."

**Resolution:** Orchestrator action — update concurrency config to allow `codex=2` for T3 lanes. No code gate change; this is a governor setting.

---

## Program State Conformance (§18.3)

| Program | State | Conformance | Notes |
|---------|-------|-------------|-------|
| P1 — Truth Convergence | ACTIVE_CERTIFIED | OK | Frozen-surface SHA `9600938`; re-cert deadline 2026-08-25 (within window) |
| P2 — Governance Convergence | ACTIVE_CERTIFIED | OK | Phase 7A governance brake operational; 229 live tests pass |
| P3 — Decision Integrity | ACTIVE_NOT_CERTIFIED | OK (unchanged) | CLV/edge empirical proof pending UTV2-1042; no regression |
| P4 — Economic Truth | CONDITIONAL_NOT_CERTIFIED | OK (unchanged) | Requires realized pick corpus; accumulation restored post-incident |
| P5 — Institutional Runtime | FROZEN_NOT_CERTIFIED | OK (unchanged) | Frozen pending P1–P4 certs + M10 Path A; infra ready |

No program-level cert regression detected. The June 2026 incidents temporarily disrupted data accumulation (P3/P4 evidence window) but did not corrupt certification states. Watchdog + daemon-resident fixes restore accumulation continuity.

---

## Incident Impact Summary

| Incident | Date | Resolution | Constitutional Impact |
|----------|------|------------|----------------------|
| Ingestor wedge — 5.5h post-Supabase 521 | 2026-06-20 | UTV2-1286 watchdog fix (merged, not deployed) | G-CONST-13 (deploy gap) |
| Supabase write-path bloat — 40h game_results freeze | 2026-06-22 | UTV2-1293 + UTV2-1294 (merged); retention spec ratified | G-CONST-11 (preflight gap), G-CONST-13 |
| statement_timeout on provider_offer_history | 2026-06-23 | No code fix; spec documents it; monitor gap | G-CONST-12 (parity gap) |

---

## Gap Priority Summary

| Gap | Risk | PM Action Required | Follow-up Lane |
|-----|------|--------------------|----------------|
| G-CONST-9 — CURRENT_STATE staleness | MEDIUM | Acknowledge; authorize update lane | T3 — CURRENT_STATE.md refresh |
| G-CONST-10 — UTV2-1297 runtime proof | LOW-MEDIUM | Monitor tonight's window | Append runtime proof when available |
| G-CONST-11 — Retention preflight gate | HIGH (if executed) | Authorize preflight lane before any DELETE | T2 — Retention Execution Preflight |
| G-CONST-12 — DB-health tripwire parity | MEDIUM | Authorize T3 parity lane | T3 — Tripwire §5 parity expansion |
| G-CONST-13 — Deploy SHA gap | HIGH (runtime fixes) | Deploy to main HEAD | Ops: trigger deploy workflow |
| G-CONST-CODEX — Codex capacity | POSITIVE | Restore Codex to codex=2 | Orchestrator config update |

---

## Guardrail Confirmations

| Constraint | Status |
|---|---|
| No P3 certification claimed | ✓ PASS |
| UTV2-1042 not marked Done | ✓ PASS |
| No CLV/ROI/edge claims | ✓ PASS |
| No public Discord enabled | ✓ PASS |
| No DB mutation | ✓ PASS — read-only audit |
| No live backfill | ✓ PASS |
| No >48h backlog mutation | ✓ PASS |
