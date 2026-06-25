# Production Readiness Audit v3 — UTV2-1302

**Audited at:** 2026-06-25T03:45:00Z
**Revised with PM gap inputs:** 2026-06-25T13:00:00Z
**Main SHA:** a5c61d65 (original); current main HEAD: 53b91fce
**Executor:** Claude (verification lane)
**Scope:** Post-ingestion recovery launch blocker map

> **PM Revision Note (2026-06-25):** Six PM-side preliminary gap inputs applied to this audit.
> (1) CURRENT_STATE.md stale since 2026-06-10 — reflected as new item #9.
> (2) UTV2-1297 is instrumentation-only until tonight's runtime proof — item #5 updated.
> (3) DB Retention renamed to "Retention Execution Preflight" — items #4 and Next Lanes #3 updated.
> (4) DB-health tripwire §5 parity gap added — items #9 and #10.
> (5) Deploy SHA alignment raised from LOW to MEDIUM — item #8 updated.
> (6) Codex canary UTV2-1303 passed — Codex restored to two parallel T3 lanes; item #11 added.
> **Verdict remains YELLOW.**

---

## Production Readiness Verdict: YELLOW

Recovery sequence (UTV2-1294/1296/1298/1299/1300) restored ingestion flow and detection capability. No active incidents. However, P3/P4 certification gates remain open and outbox queue is elevated. Deploy SHA gap (production not at main HEAD) means two critical runtime fixes (watchdog, daemon-resident) are not yet running in production. Not RED (no hard blockers to deploy pipeline), not GREEN (certification, deploy gap, and queue health not resolved).

---

## Blocker Table

| # | Item | Severity | Owner | Next Lane / Action |
|---|------|----------|-------|--------------------|
| 1 | P3 empirical certification blocked — no CLV/edge proof rendered | HIGH | PM/Data | UTV2-1042 dispatch gate open; PM must decide accept/defer/fail before cert decision |
| 2 | P4 economic truth unproven — no realized pick corpus | HIGH | PM/Data | Requires live settled picks; currently CONDITIONAL_NOT_CERTIFIED |
| 3 | P5 frozen — burn-in blocked on P1–P4 certs + M10 Path A decision | HIGH | PM/Ops | Infra ready (UTV2-1014–1031 DONE); burn-in collection (UTV2-1041) can start now |
| 4 | Outbox: 503 dead-letter + 497 pending (300 >30min, oldest 359h) | MEDIUM | Ops | **Retention Execution Preflight** (schema-verified, read-only first) required before any batched DELETE per DB_MAINTENANCE_RETENTION_SPEC.md §4; PM-gated |
| 5 | UTV2-1297 finalized-repoll path — instrumentation merged, runtime proof pending | MEDIUM | Ops | **Instrumentation-only until tonight's runtime window validates the finalized-repoll path.** Proof bundle shows `result: not_run`. Watch tonight; append runtime telemetry when path fires. |
| 6 | Ingestor Staleness Alert CI failing on main (2026-06-25T01:51:56Z) | MEDIUM | Ops | Monitor threshold may need recalibration post-UTV2-1014 deploy |
| 7 | UTV2-1295 spec-only — durable partition/retention/write-path-isolation NOT implemented | MEDIUM | Claude/PM | Spec shipped (PR #1059); Retention Execution Preflight lane required before implementation |
| 8 | Deploy SHA gap — production at dcd649d5 (2026-06-10), main at 53b91fce (2026-06-25) | **MEDIUM** | Ops | **Production-readiness material, not a housekeeping issue.** UTV2-1286 watchdog + UTV2-1293 daemon-resident fixes are NOT on production — same failure modes remain live. PM must authorize deploy workflow run. |
| 9 | CURRENT_STATE.md stale since 2026-06-10 | MEDIUM | Claude/PM | 15-day staleness; multiple significant merges not reflected. T3 update lane required with PM approval as canonical snapshot update. |
| 10 | DB-health tripwire §5 parity gap | MEDIUM | Claude/PM | UTV2-1300 covers 3/5 hot tables; missing: `provider_offer_history` + `game_results`; missing: §5.5 TOAST bloat check; thresholds above spec for `raw_payloads` / `odds_snapshots`. T3 parity lane required. |
| 11 | Codex capacity restored — canary (UTV2-1303) + worktree-access fix (UTV2-1304) DONE | POSITIVE | Orchestrator | Restore Codex to two parallel T3 lanes (codex=2 in governor). |
| 12 | UTV2-1042 evidence snapshot stale (last: 2026-06-10T08:47:00Z) | LOW | Claude | Refresh data-gate-monitor snapshot; no cert claim until evidence verdict rendered |

---

## System Health Snapshot

| Metric | Value | Status |
|--------|-------|--------|
| Main SHA | 53b91fce | Current |
| Production deploy SHA | dcd649d5 (2026-06-10) | STALE — 15 days behind |
| Outbox pending | 497 rows (300 >30min, oldest 359h) | DEGRADED |
| Dead-letter | 503 rows | ELEVATED |
| Sent | 1,668 | — |
| Processing >5min | 0 | OK |
| Deferred pending (outside targets) | 195 rows (oldest 321h) | STALLED |
| Active lanes | UTV2-1301 (started), UTV2-1302 (started) | — |
| Open PRs | 0 | Clean |
| DB health monitor (UTV2-1300) | db-health-tripwire.yml present, 6h cron | PARTIAL (§5 parity gap) |
| CI (last 10 main runs) | 9/10 success, 1 failure (staleness alert) | YELLOW |
| Worker targets | discord:canary only | Limited |
| Hetzner deployment | 46.225.14.123, single-node | Active (pre-fix code) |
| Deploy workflow | .github/workflows/deploy.yml present | OK — needs trigger |
| Rollback | deploy/rollback.sh present | Not drilled |

---

## DB Health Tripwires (UTV2-1300)

- `db-health-tripwire.yml` present ✓
- Cron: every 6 hours ✓
- Hot tables covered: `system_runs`, `raw_payloads`, `odds_snapshots` (3/5 from §5 spec)
- **Gap: `provider_offer_history` + `game_results` not monitored** — both are in §5 scope; `provider_offer_history` caused June 2026 statement_timeout incident
- **Gap: §5.5 TOAST bloat estimate not implemented**
- **Gap: Size thresholds above spec** (`raw_payloads` 2048MB vs spec 300MB; `odds_snapshots` 1024MB vs spec 300MB)
- Last check output: N/A (no recent GHA run visible in ops:brief)

---

## UTV2-1042 Evidence Gate Status

- Gate 1 (pick_candidates post-cutover): MET (2,975)
- Gate 2 (closing_over_odds post-cutover): MET (2,607)
- Gate 3 (CLV join path): MET (126 picks)
- dispatch_gate: OPEN (PM decision 2026-06-10)
- Evidence verdict: NOT RENDERED
- Certification: BLOCKED — data-gated, no P3/CLV/ROI/edge claims permitted

---

## Guardrail Confirmations

| Constraint | Status |
|---|---|
| No P3 certification claimed | ✓ PASS |
| UTV2-1042 not marked Done | ✓ PASS |
| No CLV/ROI/edge claims | ✓ PASS |
| No public Discord enabled | ✓ PASS — discord:canary only |
| No DB mutation | ✓ PASS — read-only audit |
| No backfill | ✓ PASS |

---

## Next 6 Execution Lanes (ranked by production impact)

1. **Deploy to main HEAD** — PM authorization required. UTV2-1286 watchdog + UTV2-1293 daemon-resident are critical runtime fixes not yet on production. Same failure modes remain live.
2. **UTV2-1041 (Burn-in Collection, T1)** — All blockers resolved; 72h evidence collection can begin. Required for P5 unfreeze and runtime certification.
3. **Retention Execution Preflight (T2)** — Schema-verified, read-only first. Produce: current table sizes, dead tuple counts, rollback procedure, PM-signed preflight checklist. No batched DELETE until preflight is Done.
4. **DB-health Tripwire §5 Parity (T3, Codex)** — Add `provider_offer_history` + `game_results` to vacuum/size checks; correct thresholds; add TOAST bloat check. Known incident contributor currently unmonitored.
5. **CURRENT_STATE.md Refresh (T3, Codex)** — Update canonical snapshot with post-incident state. 15-day staleness creates false premises for orchestration.
6. **UTV2-1042 Evidence Verdict** — PM must render verdict (accept/defer/fail). Data gates MET since June 10; verdict pending. No cert claims until verdict rendered.

---

## Decision Authority

**PM decisions required:**
- Deploy workflow authorization (item #8 — treat as production-readiness, not housekeeping)
- Retention Execution Preflight authorization (item #4)
- UTV2-1042 evidence verdict (accept/defer/fail)
- P3/P4 certification timeline
- M10 Path A/B decision (gates P5 burn-in)
- CURRENT_STATE.md update authorization (item #9)

**Authorized immediately (no PM gate):**
- UTV2-1301 (Constitution Gap Audit v3) — in progress, T1 PM-review required for merge
- UTV2-1302 (this audit, revised) — in progress
- Codex concurrency restore to codex=2 T3 lanes (orchestrator config; no new lane required)
- UTV2-1041 (Burn-in Collection) — infra ready, can start on PM signal
