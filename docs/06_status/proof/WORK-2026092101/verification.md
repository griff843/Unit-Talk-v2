# PROOF: WORK-2026092101

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-21T15:28:15.000Z
Issue: WORK-2026092101
Tier: T1
Lane type: governance
Branch: claude/work-2026092101-historical-data-warehouse
PR URL: N/A
Head SHA: 12fb46bc82fbfc9fa8f11a0ad6a00d2ccb93f44b
result: pass

## ASSERTIONS:

- [x] A bounded partition exporter exists and is tested: it reads one closed half-open
      window at a time, refuses a window above its row bound before writing anything,
      refuses an export with no deterministic ordering, and never issues a select
      without a window.
- [x] Representative data produces a real Parquet object with zstd compression, measured
      from the written file rather than from the intent to write it.
- [x] The archive manifest is deterministic in its inputs and records source relation and
      partition, window, sport/domain, source row count, exported row count, exported
      byte size, SHA256 checksum, exporter repo SHA, schema version, export timestamp,
      verification timestamp and the bounded sample read-back.
- [x] Verification is fail-closed. A manifest is never born verified; each of
      row_count_match, checksum_match, object_exists, parquet_readable and
      sample_readback_match gates the prune decision on its own; a hand-flipped
      `passed` does not open the gate; and counts that disagree block the prune even
      when every check claims to have passed.
- [x] An archived partition is queryable through DuckDB over the S3-compatible API with
      no production database connection — the query proof asserts
      `used_production_database === false` and reconciles 2880 rows across four
      partitions (two days x two sports).
- [x] The scheduled conveyor is idempotent (a second run over the same windows does
      nothing and rewrites no object), leaves no manifest behind an interrupted upload,
      completes on retry, writes a heartbeat even when every window fails, and reads a
      missing or stale heartbeat as stale rather than unknown.
- [x] Object-storage configuration is private and secret-safe: every required key is
      individually required, a placeholder counts as missing, `describeConfig` reports
      presence and never a value, and every `UNIT_TALK_WAREHOUSE_*` assignment in the
      workflow is a `${{ secrets.* }}` reference.
- [x] Nothing reachable from the schedule can delete production data. The workflow has no
      prune step and the CLI has no prune subcommand; the control was mutation-tested by
      appending a real `pnpm warehouse prune` step, which failed it.
- [x] The production sizing audit is read-only: the session is pinned read-only before
      anything is read, no statement it issues can write, and the report states plainly
      that it mutated nothing.
- [x] No production data was deleted, no partition dropped, no provider activated and no
      containment setting changed by this lane.

Not asserted, deliberately: the production sizing audit has not been RUN against
production, because production Supabase was `RESTORING` for the whole of this lane. The
procedure is proven against staging and documented in
`docs/05_operations/PRODUCTION_DB_SIZING_AUDIT.md`, whose section 6 lists the ten
outputs that remain unmeasured.

## EVIDENCE:

```
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
rc=0

$ pnpm test
# tests 6787
# pass 6787
# fail 0
rc=0

$ pnpm verify
verify:static rc=0 (env:check + lint + type-check + build + test + verify:commands)
  [command-manifest] Verified 14 command definition(s)
  [check-migration-versions] 136 migration file(s) verified - no duplicate versions.
  [lint-migrations] 135 migration file(s) checked - no findings.
test:live-db: deferred to CI. `scripts/ci/assert-staging-target.ts` refuses a local
target by design - "REFUSED: target identity could not be resolved from its URL
(host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx." The lane
manifest records t1_live_db_precondition: deferred_to_ci.

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 34
Rules matched: (none) - no R-level artifacts required for this diff

$ pnpm exec tsx --test scripts/warehouse/*.test.ts
# tests 102
# pass 102
# fail 0
```

## Verification
- [x] `pnpm type-check`: rc=0
- [x] `pnpm test`: 6787 passed, 0 failed
- [x] `pnpm verify`: verify:static rc=0; test:live-db deferred to CI (staging-target refusal is by design locally)
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, no R-level artifacts required

## Runtime Verification

The warehouse battery is executable runtime proof, not static inspection. Each module is
exercised against real artifacts rather than mocks:

- `export-partition.test.ts` writes an actual zstd Parquet file through DuckDB and
  measures the row count, byte size and checksum back off the written file.
- `verify-archive.test.ts` archives a real 720-row window into a `LocalObjectStore`,
  then breaks exactly one property per case - one flipped byte with the size unchanged,
  a deleted object, a short-but-valid Parquet with a corrected size and hash, non-Parquet
  bytes with a matching checksum, a drifted source, an unreadable source, an empty sample
  on a non-empty partition, and a hand-edited manifest - and asserts both that the named
  check fails and that `decidePrune(...).eligible === false`.
- `query.test.ts` writes four partitions, then opens a separate connection with an empty
  `NodeJS.ProcessEnv` and reconciles 2880 rows, 7 events, 3 markets and 2 books while
  asserting `used_production_database === false`.
- `conveyor.test.ts` exercises a full run, a no-op second run, an interrupted run that
  leaves zero orphan manifests and completes on retry, and heartbeat staleness.
- `db-audit.test.ts` asserts the audit emits no write verb, refuses a non-identifier,
  reports reset statistics as reset rather than as zero bloat, and never concludes that a
  relation is safe to prune - including for a 6.8 GB, 8.19M-row, zero-FK relation.
- `conveyor-workflow.test.ts` reads the committed workflow and CLI from disk. Its
  destructive-reachability assertion was mutation-tested: appending a real
  `run: pnpm warehouse prune --yes` step failed it.

Production observation is NOT part of this proof. Production Supabase was `RESTORING`
throughout, no production credential was used, and no production statement was issued.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Approved PR head: pending merge
Execution SHA: 12fb46bc82fbfc9fa8f11a0ad6a00d2ccb93f44b
