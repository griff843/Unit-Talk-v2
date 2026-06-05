## Summary

UTV2-1205 adds a DB-level CHECK constraint (`chk_fair_prob_both_or_neither`) to the `market_universe` table. The constraint enforces that `fair_over_prob` and `fair_under_prob` are either both NULL or both non-NULL, closing the DB-boundary gap that the Wave 3 service-layer guard (UTV2-1202) enforces at scoring time. This migration ensures stale or partial data cannot enter the table via the ingestor path.

Branch: `codex/utv2-1205-db-constraint-both-fair-probability-sides`
Branch HEAD SHA: `b27f061cc6b6b9a5a58a20c66af8a3df9a0efc98`

## Evidence

### Pre-migration safety check

```sql
SELECT COUNT(*) FROM market_universe
WHERE (fair_over_prob IS NULL) != (fair_under_prob IS NULL);
```

Result: `0` — zero violating rows. Constraint safe to add.

### Migration applied

File: `supabase/migrations/20260605001_utv2_1205_market_universe_fair_prob_constraint.sql`
Applied via Supabase MCP to project `zfzdnfwdarxucxtaojxm`. Result: `success: true`.

### Constraint confirmed in live DB

```sql
SELECT constraint_name, constraint_type, check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc USING (constraint_catalog, constraint_schema, constraint_name)
WHERE tc.table_name = 'market_universe'
  AND tc.constraint_name = 'chk_fair_prob_both_or_neither';
```

Result:
```
constraint_name: chk_fair_prob_both_or_neither
constraint_type: CHECK
check_clause: (((fair_over_prob IS NULL) AND (fair_under_prob IS NULL)) OR ((fair_over_prob IS NOT NULL) AND (fair_under_prob IS NOT NULL)))
```

### pnpm test:db output (TAP)

```
TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  ---
  duration_ms: 20424.788126
  ...
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ---
  duration_ms: 19724.905792
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 20386.092411
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ---
  duration_ms: 21834.151497
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 654.463586
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 21556.455615
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 20045.024141
  ...
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 125257.354999
```

## Verification

| Check | Result |
|---|---|
| Pre-migration violating rows | 0 (SAFE) |
| Migration applied (live Supabase) | PASS |
| Constraint present in information_schema | CONFIRMED |
| pnpm test:db | PASS — 7/7 tests |
| pnpm verify | PENDING (CI will confirm) |
| Rollback path | `ALTER TABLE market_universe DROP CONSTRAINT IF EXISTS chk_fair_prob_both_or_neither;` |

**Verdict: T1 evidence COMPLETE. Awaiting PM `t1-approved` label before merge.**
