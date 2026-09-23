# PROOF: WORK-2026092101

MERGE_SHA: 8151a55c3a62e387818cbb36a47b20fd23b84b55

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-23T05:43:28.000Z
Issue: WORK-2026092101
Tier: T1
Lane type: governance
Branch: claude/work-2026092101-historical-data-warehouse
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1627
Head SHA: ae244e21c74a6f374875bcdec205f94cf7e3879d
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
# tests 6798
# pass 6798
# fail 0
rc=0

$ pnpm verify
verify:static rc=0 (env:check + lint + type-check + build + test + verify:commands); 7004/7004 across 106 TAP blocks
  [command-manifest] Verified 14 command definition(s)
  [check-migration-versions] 136 migration file(s) verified - no duplicate versions.
  [lint-migrations] 135 migration file(s) checked - no findings.
test:live-db: deferred to CI. `scripts/ci/assert-staging-target.ts` refuses a local
target by design - "REFUSED: target identity could not be resolved from its URL
(host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx." The lane
manifest records t1_live_db_precondition: deferred_to_ci.

$ pnpm exec tsx scripts/ci/r-level-check.ts --issue WORK-2026092101 --base origin/main --head ae244e21c74a6f374875bcdec205f94cf7e3879d
Verdict: PASS
Changed files: 37
Rules matched: (none) - no R-level artifacts required for this diff

$ pnpm exec tsx --test scripts/warehouse/*.test.ts
# tests 102
# pass 102
# fail 0
```

## Verification
- [x] `pnpm type-check`: rc=0
- [x] `pnpm test`: 6798 passed, 0 failed
- [x] `pnpm verify`: verify:static rc=0; test:live-db deferred to CI (staging-target refusal is by design locally)
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --issue WORK-2026092101 --base origin/main --head ae244e21c74a6f374875bcdec205f94cf7e3879d`: PASS, 37 changed files, no R-level artifacts required

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
  `run: pnpm warehouse prune --yes` step failed it (1 fail), and restoring the file gave 8/8.
  Re-run at the current anchor with the same result.

Production observation is NOT part of this proof. Production Supabase was unavailable
throughout (`RESTORING`, then `RESTORE_FAILED`), no production credential was used, and no
production statement was issued.

## Merge SHA Binding

Merge SHA: 8151a55c3a62e387818cbb36a47b20fd23b84b55
PR: https://github.com/griff843/Unit-Talk-v2/pull/1627
Approved PR head: f70423b79d03fa86de2602368b78986046b1286c
Execution SHA: ae244e21c74a6f374875bcdec205f94cf7e3879d

Execution anchor: `ae244e21c74a6f374875bcdec205f94cf7e3879d` -- the last commit on this lane that changes anything outside
`docs/06_status/proof/WORK-2026092101/`. It is the branch-refresh merge commit that reconciled
this lane onto `origin/main` `966d9a31b` (the merge of #1629), produced by
`ops:merge-wrapper pr-update-branch`. No conflict and no overlap. What `main` brought in since the
previous anchor is lane bookkeeping only -- `docs/06_status/lanes/UTV2-1892.json`,
`docs/06_status/lanes/WORK-2026092302.json`, `.ops/sync/WORK-2026092302.yml` and
`.ops/work/WORK-2026092302.md` -- and no code, test or configuration file. The anchor moves because
`scripts/ci/proof-binding-validator.ts` rule 4 compares trees and refuses the two `.ops` files.
Superseded anchors, not withdrawn: `e9521eb2e7985bdad2ae1c8ccaf90e0a81621122`, `12fb46bc82fbfc9fa8f11a0ad6a00d2ccb93f44b`.
CI at the anchor: run `35822642624` -- `Writable DB proof (staging only)` job `107057593577` and
`verify` job `107059187422`, both success. The R-level check was re-run at the anchor (PASS, 37
files). The unit-test, warehouse-battery and `verify:static` figures above were measured at `e9521eb2e7985bdad2ae1c8ccaf90e0a81621122`
and carry forward, because the refresh changed no executable file.

`work-order.md` in this directory is a byte-identical copy of the repository-owned work order
`.ops/work/WORK-2026092101.md`, which existed only as an uncommitted file. It is kept here
because the lane's own proof directory is the one path the closeout scope check (S1) and the
file-scope guard both admit without widening `file_scope_lock`.
