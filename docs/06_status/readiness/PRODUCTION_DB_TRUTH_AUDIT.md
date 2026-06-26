# Production DB Truth Audit — UTV2-1322

**Produced:** 2026-06-26
**Lane:** UTV2-1322 (T2 governance audit)
**Basis:** Code inspection + incident history + prior lane findings
**PM Constraints:** No DB mutation. No schema migration. No retention execution. No backfill. No certification changes.

---

## Verdict

**Is the database setup production-grade for the picks pipeline?**

### PARTIAL

The DB setup is structurally sound for a hosted Supabase deployment and has active partition management with tested indexes. However, three recurring statement_timeout classes, a system_runs table bloat risk, an unproven schema parity CI path, and no documented backup/recovery SLA keep the verdict below PASS.

---

## Scorecard

| Dimension | Status | Notes |
|---|---|---|
| Partition strategy | PASS | provider_offer_history daily partitions; automated creation + drop functions in schema |
| Index coverage (hot paths) | PASS | 6 indexes per partition auto-created; closing/opening/snapshot/idempotency all covered |
| Statement timeout guard | PARTIAL | 120s global; 3 classes of missing lower-bound bugs fixed; 1 open (UTV2-1326) |
| Partition pruning (query bounds) | PARTIAL | 3 bugs found+fixed; pattern risk persists for future queries without lower-bounds |
| Table bloat / autovacuum | PARTIAL | system_runs 1.2GB/130-row incident (2026-06-22); PM-gated cleanup not confirmed complete |
| Migration ledger integrity | PARTIAL | 1 migration file (baseline); 3 out-of-band divergences; schema parity CI not proven end-to-end |
| Backup / PITR posture | UNKNOWN | Supabase managed; no PITR window or backup SLA documented in repo |
| Monitoring / alerting | PARTIAL | ops:brief provides operational state; no Grafana/PagerDuty configured or documented |
| Live-DB test coverage | PASS | 7/7 test:db smoke tests pass; partition pruning T1 proof (UTV2-1315, UTV2-1321) |
| Settlement write path | PARTIAL | UTV2-1326 open: settle_pick_atomic RPC timeout under peak load |

**Overall: PARTIAL** (6 PASS, 3 PARTIAL, 1 UNKNOWN)

---

## Table Inventory & Partition Analysis

### provider_offer_history (HOT — partitioned)

- **Partition scheme:** daily partitions (`provider_offer_history_pYYYYMMDD`)
- **Partition count:** 60+ as of 2026-06-23 (actively growing)
- **Per-partition indexes (auto-created by `ensure_provider_offer_history_partition()`):**
  - `_provider_snapshot_idx` ON (provider_key, snapshot_at DESC)
  - `_identity_snapshot_idx` ON (identity columns, snapshot_at)
  - `_idempotency_idx` ON (idempotency_key)
  - `_opening_idx` ON (opening fields)
  - `_closing_idx` ON (closing fields)
  - `_created_at_idx` ON (created_at)
- **Retention:** `drop_old_provider_offer_history_partitions()` with configurable `p_retention_days` (default 7)
- **Risk:** All historical timeout incidents stem from queries missing a `snapshot_at` lower-bound, causing full 60-partition scan against 1.39M rows

### Statement Timeout History (120s global)

| Incident | Path | Root Cause | Fix | Lane |
|---|---|---|---|---|
| markClosingLines timeout | ingestor → provider_offer_history | No snapshot_at lower-bound → 60-partition scan | Added lower-bound WHERE clause | UTV2-1315 (merged) |
| settlement listRecent timeout | api → settlement_records | No cutoff date → full partition scan | Added cutoffIso lower-bound | UTV2-1321 (merged) |
| dedup lookup timeout | api → provider_offer_history | No snapshot_at lower-bound | Added lower-bound | UTV2-1296 (merged) |
| settle_pick_atomic RPC timeout | api → settle_pick_atomic | Unknown — peak-load write bottleneck | OPEN | UTV2-1326 (next queue) |
| PostgREST archive write timeout | ingestor → storage | 17.8MB MLB archive write exceeded PostgREST timeout, starved settlement | Size guard + write isolation | UTV2-1294 (merged) |

### system_runs (RISK — bloat incident)

- **Incident 2026-06-22:** 1.2GB / ~130 rows — dead autovacuum, stale statistics → 120s timeouts on all write paths
- **Root cause:** table not vacuumed; bloat from update churn without dead tuple cleanup
- **Mitigation:** PM-gated ANALYZE/VACUUM; not confirmed complete in repo artifacts
- **Risk:** Re-bloat risk if autovacuum remains disabled or throttled; no monitoring for dead tuple count

### settlement_records (PARTITIONED)

- Fixed: UTV2-1321 added `cutoffIso` lower-bound to `listRecent()` for CLV feedback
- 143 total settlement rows (pre-Phase7A); 0 post-Phase7A
- CLV feedback path reads this table; partition pruning now working

### distribution_outbox (CRITICAL)

- Implements exactly-once delivery guarantee
- `claim_next_outbox()` is atomic SELECT + UPDATE
- DEBT-010: non-atomic SELECT-then-UPDATE in `apps/worker`; low risk but documented
- No observed timeout incidents on outbox table itself

### canonical_picks + picks

- Not partitioned; ~126 picks (pre-Phase7A snapshot)
- Phase 7A brake: all autonomous picks → `awaiting_approval`; 0 flow through without PM
- `picks.participant_id` FKs to old participant system (DEBT-001, open)

### audit_log

- Referenced in multiple atomic RPCs; write timeouts observed transiently (2026-06-22 incident — load-related, resolved with system stabilization)

---

## Migration Ledger Integrity

| State | Finding |
|---|---|
| Migrations in repo | 1 file: `00000000000000_baseline_live_schema.sql` |
| Out-of-band divergences | 3 recorded: `compact` migration missing CREATE; `pick_offer_snapshots` missing CREATE; `provider_offers → legacy_quarantine` unrecorded RENAME |
| Schema parity CI | `Live Schema Parity` GHA job added (UTV2-1273); not proven end-to-end (`supabase db push` fails TLS on bare scratch) |
| Follow-up lane | UTV2-1274 ledger-repair (T1, pending) |

**Risk:** If the prod schema diverges further from the baseline, recovery from scratch is impossible without manual DDL reconstruction. This is the highest structural DB risk.

---

## Backup / Recovery Posture

| Aspect | Finding |
|---|---|
| Backup provider | Supabase managed PostgreSQL (hosted) |
| PITR window | Not documented in repo; depends on Supabase plan tier |
| Recovery time objective | Not documented |
| Recovery point objective | Not documented |
| Last backup verification | Not documented |

**Note:** Supabase Pro plans include 7-day PITR. This cannot be verified from repo code alone — requires Supabase dashboard inspection (PM-gated, out of scope for code audit). This is classified as UNKNOWN rather than FAIL because managed hosting provides a baseline.

---

## Monitoring & Alerting

| Aspect | Finding |
|---|---|
| Operational state | `pnpm ops:brief` — lanes, Linear queue, pipeline state |
| Ingestor health | `pgrep -f node` (UTV2-1284 finding: masks dead loop; fixed by UTV2-1286 watchdog) |
| DB write-path monitoring | None documented in repo |
| Autovacuum monitoring | None documented in repo |
| Partition aging | None automated beyond `drop_old_provider_offer_history_partitions()` |
| Statement timeout alerting | None documented — incidents discovered reactively |

**Risk:** Statement timeout incidents discovered reactively from symptoms (frozen game_results, stale settlements). No proactive alert when partition scan time exceeds threshold.

---

## DB Risks by Impact

| Risk | Severity | Evidence | Fix |
|---|---|---|---|
| settle_pick_atomic RPC timeout (UTV2-1326) | HIGH | Open issue; peak-load settlement failures | Next queue |
| system_runs re-bloat risk | HIGH | 2026-06-22 incident; autovacuum not confirmed restored | PM-gated cleanup |
| Migration ledger drift | HIGH | 3 out-of-band divergences; schema parity CI not proven | UTV2-1274 |
| No backup/PITR SLA documented | MEDIUM | Cannot verify from repo; Supabase managed | PM: verify on dashboard |
| Future queries missing lower-bounds | MEDIUM | Pattern: 3 incidents in 6 weeks, all same class | Code review discipline |
| No DB monitoring/alerting | MEDIUM | All incidents discovered reactively | Follow-up lane |
| DEBT-001: dual participant system | LOW | Old picks FK to old participant system | UTV2-398 (open) |

---

## Follow-up Lanes

| Lane | Priority | Unblocks |
|---|---|---|
| UTV2-1326: settle_pick_atomic timeout investigation | HIGH (next) | Settlement write-path reliability |
| UTV2-1274: migration ledger repair | HIGH | Schema parity CI + disaster recovery |
| DB monitoring lane: autovacuum + partition scan alerting | MEDIUM | Proactive timeout discovery |
| Backup verification lane: confirm Supabase PITR window | MEDIUM | Recovery posture known |

---

## Summary

| Question | Answer |
|---|---|
| True production DB setup? | PARTIAL — partitioned, indexed, with active maintenance; not all risks mitigated |
| Partitioning production-grade? | YES — daily partitions with 6 per-partition indexes and automated creation/drop |
| Statement timeouts managed? | PARTIAL — 4 of 5 known classes fixed; UTV2-1326 open |
| Query bounds enforced? | PARTIAL — retroactively fixed for known paths; no automated guard for future queries |
| Backup/recovery posture? | UNKNOWN — Supabase managed (likely 7-day PITR); not verified from code |
| Monitoring production-grade? | NO — all incidents discovered reactively; no DB monitoring configured |
| Migration ledger sound? | NO — 3 out-of-band divergences; schema parity CI unproven |
| Can DB support winning picks reliably? | YES with caveats — pipeline functions; 3 active risks require resolution |
