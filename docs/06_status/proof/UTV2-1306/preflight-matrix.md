# Retention Execution Preflight Matrix — UTV2-1306

**Generated:** 2026-06-25T06:45:00Z
**Executor:** Claude (orchestrator session)
**Project:** zfzdnfwdarxucxtaojxm
**Merge SHA:** ca71685d29a66c8640f211e85ab338a27e3d5540
**Schema inspection:** read-only SQL via Supabase MCP
**Lane type:** governance (T2) — no mutations performed

---

## 1. Table Inventory — Sizes and Structure

| Table | Total Size | Table Size | TOAST+Index | Approx Rows | Type |
|---|---|---|---|---|---|
| system_runs | **1,218 MB** | 732 MB | 487 MB | ~3.3M | regular |
| raw_payloads | **692 MB** | 6 MB | 686 MB (99%) | ~10.7K | regular |
| odds_snapshots | **426 MB** | 3.3 MB | 423 MB (99%) | ~5.5K | regular |
| game_results | 44 MB | 14 MB | 30 MB | ~105K | regular |
| provider_offer_history | **0 bytes** (partitioned) | — | — | — | partitioned (60 partitions) |

**Key findings:**
- `raw_payloads` and `odds_snapshots` are TOAST-dominated (>99% of size is TOAST) — standard DELETE will not reclaim most space without subsequent VACUUM FULL or pg_repack
- `system_runs` is the primary bloat vector per prior incident (UTV2-1294: 1.2 GB for 130 rows; now ~3.3M rows at 1.2 GB is corrected post-fix)
- `provider_offer_history` size shows as 0 in pg_class — all data lives in the 60 time-based partitions; must query via `pg_catalog.pg_inherits` for true size

---

## 2. Immutability Audit — Triggers That Block DELETE/UPDATE

| Table | Trigger | Event | Timing | Verdict |
|---|---|---|---|---|
| raw_payloads | `raw_payloads_no_delete` | DELETE | BEFORE | **BLOCKED — immutable** |
| raw_payloads | `raw_payloads_no_update` | UPDATE | BEFORE | **BLOCKED — immutable** |
| odds_snapshots | `trg_odds_snapshots_immutable` | DELETE | BEFORE | **BLOCKED — immutable** |
| odds_snapshots | `trg_odds_snapshots_immutable` | UPDATE | BEFORE | **BLOCKED — immutable** |
| system_runs | `system_runs_set_finished_at` | UPDATE | BEFORE | allowed (sets finished_at, not blocking) |
| game_results | — | — | — | no immutability trigger |
| provider_offer_history | — | — | — | no immutability trigger (partitions) |

**Conclusion:** `raw_payloads` and `odds_snapshots` cannot be DELETEd or UPDATEd via standard SQL. Any retention execution for these tables requires a **PM-gated Migration lane** to disable or drop the trigger first, or must use an archive-copy-and-leave pattern.

---

## 3. Foreign Key Dependency Map

| Table | Incoming FK from | Delete behavior |
|---|---|---|
| raw_payloads | `odds_snapshots.raw_payload_id` | FK RESTRICT (default) — DELETE on raw_payloads rows referenced by odds_snapshots will **FAIL** |
| system_runs | `provider_offer_history.source_run_id` | FK — DELETE on referenced system_runs rows will fail unless partition rows deleted first |
| game_results | `events.event_id` (outbound) + `participants.participant_id` (outbound) | game_results references events/participants; those rows must exist; game_results itself can be deleted |
| odds_snapshots | `odds_snapshots.prior_snapshot_id` (self-ref) | self-referential chain — order-dependent delete required |
| provider_offer_history | `providers.provider_key` (outbound) | must not delete providers while history rows exist |

**Execution order constraint:** If any future execution targets multiple tables, order must be:
1. odds_snapshots before raw_payloads (FK dependency)
2. provider_offer_history partitions before system_runs (FK dependency)
3. game_results is independent (no inbound FK discovered)

---

## 4. Execution Decision Matrix

| Table | DELETE rows | UPDATE rows | DDL (DROP/ALTER) | Archive (INSERT copy) | PM Gate Required |
|---|---|---|---|---|---|
| **system_runs** | ⚠️ CONDITIONAL | ✅ ALLOWED | ❌ FORBIDDEN (separate Migration lane) | ✅ ALLOWED | Yes — explicit WHERE + row count pre/post |
| **raw_payloads** | ❌ BLOCKED (trigger) | ❌ BLOCKED (trigger) | ❌ FORBIDDEN | ✅ ALLOWED (read + copy) | Yes — trigger must be disabled first (Migration lane) |
| **odds_snapshots** | ❌ BLOCKED (trigger) | ❌ BLOCKED (trigger) | ❌ FORBIDDEN | ✅ ALLOWED (read + copy) | Yes — trigger must be disabled first (Migration lane) |
| **game_results** | ✅ ALLOWED | ✅ ALLOWED | ❌ FORBIDDEN | ✅ ALLOWED | Yes — explicit WHERE + UNIQUE constraint awareness |
| **provider_offer_history** | ⚠️ CONDITIONAL | ✅ ALLOWED | ❌ FORBIDDEN | ✅ ALLOWED | Yes — snapshot_at required in WHERE for partition pruning |

**Legend:**
- ✅ ALLOWED: mechanically executable, still requires PM-gated preflight per row
- ⚠️ CONDITIONAL: allowed only with specific constraints (see notes below)
- ❌ BLOCKED: mechanically prevented by trigger or FK; requires separate Migration lane to unlock
- ❌ FORBIDDEN: out of scope for any execution lane; requires constitutional approval

**Conditions for CONDITIONAL tables:**
- `system_runs`: WHERE clause must include `status IN ('failed','cancelled')` AND `created_at < now() - interval '30 days'` minimum; must not delete rows referenced by active provider_offer_history partitions
- `provider_offer_history`: WHERE clause must include `snapshot_at < <cutoff>` to guarantee partition pruning (without it, 60-partition scan triggers statement_timeout per UTV2-1295 incident)

---

## 5. Pre-Execution Evidence Requirements

Before any future retention execution lane is opened, the following must be present as PM-gated artifacts:

| Requirement | Description |
|---|---|
| Row count pre-scan | SELECT COUNT(*) with exact WHERE clause, run and captured ≤ 24h before execution |
| EXPLAIN ANALYZE | Query plan showing partition pruning (for provider_offer_history) or expected index scan |
| Backup export confirmation | Object-store export or pg_dump of affected rows before DELETE (no rollback possible) |
| FK dependency clear | Confirm no active FK dependents exist in the scope of rows to be deleted |
| Trigger status check | Confirm immutability triggers are disabled (if raw_payloads or odds_snapshots) |
| PM_VERDICT | Explicit PM approval on the execution lane PR before any mutation |

---

## 6. Rollback and Abort Criteria

**Rollback:** DELETEs are irreversible without a backup export. Any execution lane must:
1. Write rows to an archive table or object-store export before DELETE
2. Verify export row count matches source count before proceeding

**Abort immediately if:**
- Query plan shows sequential scan on provider_offer_history (indicates missing snapshot_at filter)
- DELETE count exceeds pre-scan count by >5% (unexpected scope expansion)
- Any FK violation error appears
- statement_timeout fires
- DB autovacuum is not running on the target table (check pg_stat_user_tables.last_autovacuum)

---

## 7. Recommended Follow-Up Lanes

| Lane | Title | Tier | Prerequisite |
|---|---|---|---|
| UTV2-NEXT-A | Disable `raw_payloads_no_delete` trigger + archive oldest 60d raw_payloads | T1 | Migration lane, PM T1 approval, backup export |
| UTV2-NEXT-B | Disable `trg_odds_snapshots_immutable` + archive odds_snapshots pre-cutover | T1 | Migration lane, PM T1 approval, backup export, NEXT-A done |
| UTV2-NEXT-C | DELETE old system_runs rows (failed/cancelled, >30d) with FK-safe ordering | T2 | PM preflight pass, row count pre-scan, backup |
| UTV2-NEXT-D | DELETE old provider_offer_history partitions (snapshot_at < cutoff) | T2 | PM preflight pass, partition pruning proof, backup |

None of these lanes are authorized by this preflight. Each requires a fresh PM-gated lane start.

---

## 8. Guardrails Confirmed

- No DELETE, UPDATE, DDL, or data mutation performed in this lane
- No backfill
- No production deploy  
- No P3/P4/P5 certification or economic claims
- No Discord channel changes
