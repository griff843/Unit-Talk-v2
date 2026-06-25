# UTV2-1295 Diff Summary

**Issue:** UTV2-1295 — Durable permanent fix: hot-table retention/partition/write-path architecture spec  
**Tier:** T2  
**Lane type:** governance  
**Branch:** griffadavi/utv2-1295-durable-permanent-fix-hot-table-retentionpartition-raw  
**PR:** #1056

## Changes

Three files changed:

### `docs/05_operations/DB_MAINTENANCE_RETENTION_SPEC.md` (created)
New canonical spec establishing the architecture for:
- Hot-table retention policy (system_runs, raw_payloads, odds_snapshots)
- Partition strategy (for raw_payloads)
- Write-path hardening (archive workflow, monitoring)
- Read-only monitoring queries (§5 — T3 GHA lane, independently executable)

### `docs/06_status/lanes/UTV2-1295.json` (created)
Lane manifest for this governance lane.

### `.ops/sync/UTV2-1295.yml` (created)
Linear sync metadata for this issue.

## Schema Corrections Applied

Per PM Codex review, the spec was corrected before merge:

1. **§1.4 carve-outs**: Removed `proof_artifacts` reference (table doesn't exist); corrected `raw_payloads` carve-out to use `kind` column (no `metadata` column exists); corrected `system_runs` carve-out from `status = 'error'` to `status = 'failed'` (real CHECK constraint: `'running', 'succeeded', 'failed', 'cancelled'`).

2. **§2.2 raw_payloads archival**: Replaced impossible `UPDATE raw_payloads SET metadata=...` with Option A/B/C:
   - Option A: write to object store + DELETE + INSERT with `kind='archived'`
   - Option B: schema migration lane first, then UPDATE
   - Option C (recommended): append-only `raw_payloads_archive_log` companion table — no mutation of `raw_payloads` schema, purely additive

3. **§3.4/3.5 forward flow**: References all three Option A/B/C paths; notes PM approval required before any write.

4. **§4.2 pick_lifecycle**: Corrected from `UPDATE` to `INSERT (append-only)` — event-sourced, no UPDATE operations.

5. **§4.3 diagram**: Fixed `pick_lifecycle UPDATE` → `pick_lifecycle INSERT` in settlement path diagram.

6. **§5 monitoring**: Separated as read-only T3 GHA lane — independently executable without PM approval for execution actions.

## What Did Not Change

No TypeScript, no schema migrations, no runtime code, no tests. This is a spec-only governance lane.
