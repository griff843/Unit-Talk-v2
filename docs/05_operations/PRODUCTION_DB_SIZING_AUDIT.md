# Production Database Sizing and Retention Audit

**Status:** Procedure active; **the production measurement is UNMEASURED.**
**Lane:** WORK-2026092101 · read-only throughout · **no mutation from the audit**

Production `zfzdnfwdarxucxtaojxm` was `RESTORING` for the entire duration of this lane
(confirmed 2026-09-21). The audit was therefore **rehearsed against staging**
`xskgrzbteyqdufktjrjx` and is ready to run against production the moment it is
`ACTIVE_HEALTHY`. Staging numbers are a rehearsal of the instrument, not a claim about production.

---

## 1. How to run it

```bash
# Read-only. Pins the session read-only before its first read.
UNIT_TALK_WAREHOUSE_SOURCE_DSN='<read-only production DSN>' \
  pnpm -s warehouse audit --top 40 > docs/06_status/warehouse/db-audit-$(date -u +%F).json
```

With declared hot windows:

```bash
pnpm -s warehouse audit --rules <(cat <<'JSON'
[
  {"schema":"public","relation":"provider_offer_history","timeColumn":"snapshot_at","hotRetentionDays":45},
  {"schema":"public","relation":"raw_payloads","timeColumn":"created_at","hotRetentionDays":21},
  {"schema":"public","relation":"system_runs","timeColumn":"started_at","hotRetentionDays":90},
  {"schema":"public","relation":"audit_log","timeColumn":"created_at","hotRetentionDays":365}
]
JSON
)
```

## 2. Why it is safe to point at a recovering production database

- The first statement issued is `SET default_transaction_read_only = on`, before any read.
- Every subsequent statement is a constant `SELECT` defined in `scripts/warehouse/db-audit.ts`.
  A test asserts that each begins with `SELECT` and contains no write keyword.
- The only non-constant statement is `timeWindowSql`, parameterised by three identifiers that must
  match `^[a-z_][a-z0-9_]*$`; anything else is **refused, not escaped**.
- The queries are catalog reads (`pg_class`, `pg_stat_all_tables`, `pg_stat_user_tables`,
  `pg_constraint`, `pg_inherits`) plus a bounded `min()/max()/count(*)` where a time column is
  declared. They take no lock that blocks a writer.
- The report carries `read_only: true` and `mutated: false`.

## 3. What it reports

| Section | Content |
|---|---|
| `database` | total size, in bytes and pretty |
| `relations` | top N by `pg_total_relation_size`, with heap / index / toast split, `reltuples`, live and dead tuples, and last vacuum/analyze |
| `partitions` | every partition's size and estimated rows, parent-qualified |
| `autovacuum` | dead-tuple counts and percentages, vacuum and autovacuum counts |
| `foreign_keys` | every FK, which is what makes an inbound-reference question answerable |
| `retention` | per declared rule: oldest, newest, exact rows, age in days, and whether the hot window is violated |
| `notes` | including the reset-statistics warning below |

## 4. The trap this audit is built to avoid

A restored database reports **zero live and zero dead tuples for every relation**, which is
indistinguishable from a perfectly vacuumed database if you only read the numbers. The rehearsal
below hit exactly this.

`runDbAudit` detects the all-zero case and emits a note saying statistics were reset, that bloat
and vacuum urgency cannot be read from that run, and that `reltuples` is also stale until `ANALYZE`
has run. A test asserts the note fires.

**Consequence for production:** the first post-restore audit will not be able to make a bloat claim.
Run `ANALYZE` (an operator action) and re-run the audit before treating vacuum state as measured.

## 5. Rehearsal — staging `xskgrzbteyqdufktjrjx`, 2026-09-21

Total: **517 MB** (542,624,915 bytes).

| Relation | Total | `reltuples` | live | dead |
|---|---|---|---|---|
| `pick_promotion_history` | 200 MB | 109,386 | 0 | 0 |
| `audit_log` | 100 MB | 179,102 | 0 | 0 |
| `picks` | 71 MB | 94,577 | 0 | 0 |
| `submissions` | 42 MB | 87,765 | 0 | 0 |
| `pick_lifecycle` | 33 MB | 122,180 | 0 | 0 |
| `settlement_records` | 20 MB | 36,117 | 0 | 0 |
| `submission_events` | 9,576 kB | 29,206 | 0 | 0 |
| `execution_intents` | 4,560 kB | 8,094 | 0 | 0 |
| `provider_offer_current` | 1,024 kB | 1,351 | 0 | 0 |

Every relation reads 0 live / 0 dead — the reset-statistics case, exactly as §4 describes. Staging
also holds no meaningful provider offer history, which is why it can rehearse the instrument but
cannot rehearse the *finding*.

## 6. Production measurement — `zfzdnfwdarxucxtaojxm`, 2026-09-23 ~04:35Z

Read-only, through catalog and statistics views; nothing was written, and no `ANALYZE` was run
(it is a maintenance write). PostgreSQL 17.6. **The postmaster restarted at 2026-09-23 01:46:41Z**
after the restore, so every `pg_stat_*` counter below covers roughly three hours — this is the §4
trap, and it is why row counts are taken from `reltuples` and date ranges from the data itself.

| # | Required output | Measured |
|---|---|---|
| 1 | Total database size | **18 GB** |
| 2 | Top relations by total bytes | `provider_offer_history` 8,106 MB (60 partitions) · `provider_offers_legacy_quarantine` 6,531 MB (heap 2,433 / index 4,097) · `system_runs` 1,307 MB · `raw_payloads` 694 MB (684 MB toast) · `odds_snapshots` 427 MB · `provider_offer_current` 401 MB · `pick_promotion_history` 238 MB · `pick_candidates` 195 MB · `audit_log` 142 MB · `syndicate_board` 114 MB · `picks` 91 MB |
| 3 | Row counts (estimated) | `provider_offer_history` ≈ 13.86 M · quarantine ≈ 8.19 M · `system_runs` ≈ 3.53 M |
| 4 | Partition sizes | 60 daily UTC partitions `p20260502`–`p20260630` on `snapshot_at timestamptz NOT NULL`. **Only 25 are non-empty**: 05-11, 05-12, 05-13, 05-17, 05-18, 05-21, 06-07, 06-08, 06-10…06-13, 06-17…06-30. Largest `p20260624` 1,613 MB / ≈ 2.74 M rows; 06-26…06-30 ≈ 0.9–1.1 GB each; `p20260619` ≈ 4 MB / 7,948 rows |
| 5 | Oldest / newest window | `provider_offer_history` 2026-05-11 → 2026-06-30; quarantine `snapshot_at` 2026-04-23 → 2026-04-29 |
| 6 | Fastest growing | **none** — nothing has landed in `provider_offer_history` since 2026-06-30; ingestion is parked (SGO owner-deferred) |
| 7 | Autovacuum / analyze state after `ANALYZE` | **UNMEASURED by design** — `ANALYZE` was not run; counters reset at restart |
| 8 | Dead tuples / bloat | **UNMEASURED** — dead-tuple counters reset at restart; the quarantine's index is 1.7× its heap, which is the only bloat indicator readable without a write |
| 9 | Hot-retention violations | **every non-empty `provider_offer_history` partition** — all data predates `today − 45` (the conveyor's `hotRetentionDays`). This is archive backlog, not a prune authorization |
| 10 | `FIRST_ARCHIVE_CANDIDATE_PACKET.md` §3 | answered there, 2026-09-23 |

### The armed nightly prune — found, never succeeded

pg_cron **job 5 `nightly-retention-prune`** (`0 3 * * *`, active) runs one command that calls
`summarize_provider_offer_history_partition(now − 8d)`, `drop_old_provider_offer_history_partitions(7)`,
`prune_provider_offers_bounded(7, 5000, 20)`, and then `DELETE`s on `audit_log` (> 90 d),
`alert_detections` (> 30 d), `submission_events` (> 90 d), delivered outbox (> 7 d), receipts
(> 7 d) and `line_snapshots` (> 180 d).

**All 136 recorded runs (2026-05-10 → 2026-09-23) failed**, each on `audit_log is immutable`
(trigger `guard_audit_log_immutability`), so every run rolled back as a unit. The evidence that
nothing was deleted is in the data: all 60 partitions back to 2026-05-02 survive and the
quarantine's rows are intact. The run at 03:00Z on 2026-09-23 accounts for the `n_tup_del = 100000`
on the quarantine — deleted, then rolled back.

This is a live prune that is safe **only because an unrelated trigger happens to make it fail**.
Fix the trigger, or reorder the statements, and it starts dropping partitions that have never been
archived. Deactivating it (`cron.unschedule`/`cron.alter_job … active := false`) is a production
change and is reserved to Griff; it is surfaced, not performed.

### What this means for the conveyor

The scheduled run archives the window `today − 46` days. On 2026-09-23 that is 2026-08-08, which
has no partition — so the schedule alone would archive **nothing that exists**. The existing
history is reachable only through `workflow_dispatch` with `window_date`. Every non-empty day is
under `MAX_WINDOW_ROWS` (20 M).

## 7. Related

- `docs/05_operations/WAREHOUSE_ARCHIVE_CONTRACT.md` — what leaves the hot database and how
- `docs/05_operations/FIRST_ARCHIVE_CANDIDATE_PACKET.md` — the first candidate, and why it is not yet recommended
- `docs/05_operations/SGO_REACTIVATION_GATE.md` — what must be true before heavy ingestion
- `docs/02_architecture/HISTORICAL_MARKET_DATA_WAREHOUSE.md` §3–§4 — the 2026-06-11 measurement and the retention table
