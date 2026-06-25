# Verification Log — UTV2-1306

**Lane:** UTV2-1306 — G-CONST-11 Retention Execution Preflight
**Tier:** T2 | **Lane type:** governance | **Executor:** claude
**Branch:** griffadavi/utv2-1306-g-const-11-retention-execution-preflight-schema-verified
**Commit SHA:** ca71685d29a66c8640f211e85ab338a27e3d5540
**Merge SHA:** ca71685d29a66c8640f211e85ab338a27e3d5540

---

## Verification

### 1. type-check

```
pnpm type-check
```
Result: PASS — docs-only lane, no TypeScript changes

### 2. pnpm test

```
pnpm test
# tests 700
# suites 6
# pass 700
# fail 0
# skipped 0
```
Result: PASS

### 3. pnpm verify

Full pipeline: env:check + lint + type-check + build + test
Result: PASS (see CI on PR)

### 4. R-level check

```
tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

### 5. pnpm test:db — Live DB Proof

Run against project `zfzdnfwdarxucxtaojxm` (post-deploy SHA `70783c07`):

```
TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 120110.460037
```

### 7. Schema inspection evidence (read-only)

Executed via Supabase MCP against project `zfzdnfwdarxucxtaojxm` (2026-06-25T06:45:00Z):

**Queries executed:**
1. Table size query — 5 hot tables: system_runs (1218MB), raw_payloads (692MB), odds_snapshots (426MB), game_results (44MB), provider_offer_history (0B / 60 partitions)
2. Constraints query — all NOT NULL, CHECK, FK, UNIQUE constraints enumerated
3. Triggers query — immutability triggers identified on raw_payloads and odds_snapshots
4. Partitioning/RLS query — provider_offer_history confirmed partitioned (60 partitions), all tables RLS-enabled

All queries were read-only (SELECT only). No mutations performed.

### 8. Guardrails check

- No DELETE performed: CONFIRMED
- No UPDATE performed: CONFIRMED
- No DDL performed: CONFIRMED
- No backfill: CONFIRMED
- No production deploy: CONFIRMED
- No P3/P4/P5 certification claims: CONFIRMED
- No CLV/ROI/edge claims: CONFIRMED
- No Discord changes: CONFIRMED

---

## Key Findings

1. `raw_payloads` and `odds_snapshots` have BEFORE DELETE/UPDATE triggers that unconditionally block mutations — verified from `information_schema.triggers`
2. `provider_offer_history` is a partitioned table with 60 partitions — partition pruning requires `snapshot_at` in WHERE clause
3. FK chain: `odds_snapshots.raw_payload_id → raw_payloads` — deletion order matters
4. `system_runs` has no immutability trigger — DELETE allowed with PM-approved WHERE clause

---

## Acceptance Criteria Status

| Criterion | Status |
|---|---|
| Verify schemas for 5 hot tables | ✅ DONE |
| Identify immutable triggers/constraints | ✅ DONE — raw_payloads and odds_snapshots are immutable |
| Produce execution decision matrix | ✅ DONE — preflight-matrix.md |
| Define pre/post evidence requirements | ✅ DONE — §5 of preflight-matrix.md |
| Define rollback/abort criteria | ✅ DONE — §6 of preflight-matrix.md |
| Produce follow-up lane definitions | ✅ DONE — 4 lanes defined (§7) |
| No DELETE/UPDATE/DDL | ✅ CONFIRMED |
