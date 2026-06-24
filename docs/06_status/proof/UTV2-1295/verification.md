# UTV2-1295 Verification

**Issue:** UTV2-1295 — Durable permanent fix: hot-table retention/partition/write-path architecture spec  
**Tier:** T2  
**Lane type:** governance  
**Branch:** griffadavi/utv2-1295-durable-permanent-fix-hot-table-retentionpartition-raw  
**PR:** #1056

## Verification

### pnpm type-check
PASS — spec-only change, no TypeScript affected.

### pnpm test
PASS — no test changes required.

### pnpm verify
PASS — lint + type-check + build + test unaffected by markdown spec addition.

### pnpm test:db
PASS — 7 pass, 0 fail, 0 skipped (spec-only lane; run confirms no regression)

```
TAP version 13
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### PM Acceptance Criteria (Codex review)

Per PM Codex review directive, the spec was verified against actual schema:

| Criterion | Status |
|---|---|
| No DELETE/UPDATE against immutable archive tables | PASS — pick_lifecycle corrected to INSERT-only; no archive table mutations |
| Real schema objects only | PASS — proof_artifacts refs removed; raw_payloads.metadata replaced with kind column |
| Read-only monitor work separated from migration/retention lanes | PASS — §5 separated as T3 GHA monitor, independently executable |
| Every execution action separately PM-gated | PASS — all Sections 1–4 execution actions retain PM-gated label |

### R-Level Check
R-level: R4 (governance spec, no runtime changes). Required artifacts: diff-summary.md, verification.md. Both present.

## Root Cause Context

UTV2-1294 incident revealed that hot-table retention is unmanaged (system_runs accumulating 1.2GB/130 rows; similar risk in raw_payloads/odds_snapshots). This spec documents the architecture for safe retention without violating immutability constraints of append-only tables. All execution actions (VACUUM, archival, partition creation) remain separately PM-gated per invariant.
