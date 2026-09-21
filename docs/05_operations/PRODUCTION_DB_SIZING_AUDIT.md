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

## 6. Still to measure on production — the audit's required outputs

All **UNMEASURED**:

1. total database size;
2. top relations by total bytes;
3. row counts (estimated, exact only where load-bearing);
4. partition sizes — particularly `provider_offer_history_pYYYYMMDD`;
5. oldest and newest window per high-growth relation;
6. which relations are growing fastest;
7. autovacuum / analyze state, **after** an `ANALYZE`;
8. dead tuples and bloat indicators, where safely measurable;
9. current hot-retention violations;
10. the nine questions in `FIRST_ARCHIVE_CANDIDATE_PACKET.md` §3.

## 7. Related

- `docs/05_operations/WAREHOUSE_ARCHIVE_CONTRACT.md` — what leaves the hot database and how
- `docs/05_operations/FIRST_ARCHIVE_CANDIDATE_PACKET.md` — the first candidate, and why it is not yet recommended
- `docs/05_operations/SGO_REACTIVATION_GATE.md` — what must be true before heavy ingestion
- `docs/02_architecture/HISTORICAL_MARKET_DATA_WAREHOUSE.md` §3–§4 — the 2026-06-11 measurement and the retention table
