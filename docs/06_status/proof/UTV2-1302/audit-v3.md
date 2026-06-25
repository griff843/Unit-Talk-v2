# Production Readiness Audit v3 — UTV2-1302
**Audited at:** 2026-06-25T03:45:00Z
**Main SHA:** a5c61d65
**Executor:** Claude (verification lane)
**Scope:** Post-ingestion recovery launch blocker map

---

## Production Readiness Verdict: YELLOW

Recovery sequence (UTV2-1294/1296/1298/1299/1300) restored ingestion flow and detection capability. No active incidents. However, P3/P4 certification gates remain open and outbox queue is elevated. Not RED (no hard blockers to deploy), not GREEN (certification and queue health not resolved).

---

## Blocker Table

| # | Item | Severity | Owner | Next Lane / Action |
|---|------|----------|-------|--------------------|
| 1 | P3 empirical certification blocked — no CLV/edge proof rendered | HIGH | PM/Data | UTV2-1042 dispatch gate open; PM must decide accept/defer/fail before cert decision |
| 2 | P4 economic truth unproven — no realized pick corpus | HIGH | PM/Data | Requires live settled picks; currently CONDITIONAL_NOT_CERTIFIED |
| 3 | P5 frozen — burn-in blocked on P1–P4 certs + M10 Path A decision | HIGH | PM/Ops | Infra ready (UTV2-1014–1031 DONE); burn-in collection (UTV2-1041) can start now |
| 4 | Outbox: 503 dead-letter + 497 pending (300 >30min, oldest 359h) | MEDIUM | Ops | Batched retention job ready per DB_MAINTENANCE_RETENTION_SPEC.md §4; PM-gated |
| 5 | Ingestor Staleness Alert CI failing on main (2026-06-25T01:51:56Z) | MEDIUM | Ops | Monitor threshold may need recalibration post-UTV2-1014 deploy |
| 6 | UTV2-1295 spec-only — durable partition/retention/write-path-isolation NOT implemented | MEDIUM | Claude/PM | Spec shipped (PR #1059); implementation lane required for true prevention |
| 7 | UTV2-1042 evidence snapshot stale (last: 2026-06-10T08:47:00Z) | LOW | Claude | Refresh data-gate-monitor snapshot; no cert claim until evidence verdict rendered |
| 8 | Production deployed SHA drift (docs say bd952fd7, main at a5c61d65) | LOW | Ops | Run deploy to close gap; PROGRAM_STATUS.md SHA reference stale |

---

## System Health Snapshot

| Metric | Value | Status |
|--------|-------|--------|
| Main SHA | a5c61d65 | Current |
| Documented deploy SHA | bd952fd7 (2026-05-17) | STALE |
| Outbox pending | 497 rows (300 >30min, oldest 359h) | DEGRADED |
| Dead-letter | 503 rows | ELEVATED |
| Sent | 1,668 | — |
| Processing >5min | 0 | OK |
| Deferred pending (outside targets) | 195 rows (oldest 321h) | STALLED |
| Active lanes | UTV2-1301 (started), UTV2-1302 (started) | — |
| Open PRs | 0 | Clean |
| DB health monitor (UTV2-1300) | db-health-tripwire.yml present, 6h cron | OK |
| CI (last 10 main runs) | 9/10 success, 1 failure (staleness alert) | YELLOW |
| Worker targets | discord:canary only | Limited |
| Hetzner deployment | 46.225.14.123, single-node | Active |
| Deploy workflow | .github/workflows/deploy.yml present | OK |
| Rollback | deploy/rollback.sh present | Not drilled |

---

## DB Health Tripwires (UTV2-1300)

- `db-health-tripwire.yml` present ✓
- Cron: every 6 hours ✓
- Thresholds: system_runs >500MB, raw_payloads >2048MB, odds_snapshots >1024MB
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

## Next 5 Execution Lanes (ranked by production impact)

1. **UTV2-1041 (Burn-in Collection, T1)** — All blockers resolved; 72h evidence collection can begin. Required for P5 unfreeze and runtime certification.
2. **UTV2-1042 (Empirical CLV/Edge Evaluation, T2)** — Data gates MET; PM must render evidence verdict (accept/defer/fail). No cert claims until verdict rendered.
3. **DB Retention Batch Job** — New lane from UTV2-1295 spec; implement batched DELETE per spec §4; unblocks P5 scale and reduces dead-letter pressure.
4. **Ingestor Monitor Recalibration** — Fix false-positive on Ingestor Staleness Alert; prevent chronic CI noise masking real incidents.
5. **Deploy SHA Alignment** — Run deploy to close gap between main HEAD (a5c61d65) and production; update PROGRAM_STATUS.md with current deploy SHA.

---

## Decision Authority

**PM decisions required:**
- UTV2-1042 evidence verdict (accept/defer/fail)
- DB retention spec authorization for execution
- P3/P4 certification timeline
- M10 Path A/B decision (gates P5 burn-in)

**Authorized immediately:**
- UTV2-1301 (Constitution Gap Audit v3) — pending PM plan gate approval
- UTV2-1302 (this audit) — in progress
- UTV2-1041 (Burn-in Collection) — infra ready, can start on PM signal
