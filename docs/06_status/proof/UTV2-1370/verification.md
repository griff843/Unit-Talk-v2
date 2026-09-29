# PROOF: UTV2-1370

MERGE_SHA: pending merge

Issue: UTV2-1370  
Tier: T1 / Tier C migration  
Result: ready for T1 review with production parity pending until sanctioned post-merge deployment

## ASSERTIONS:

- [x] Archive evidence is re-read through the reader-only object-store path and independently checked for manifest validity, checksum, Parquet readability, exact source/window, and row count before planning.
- [x] Planning and execution refuse stale or changed evidence, count mismatches, protected references, expired or oversized plans, active legacy pruning, wrong phase credentials, and any unsupported source.
- [x] The execution routine holds an advisory lock, locks the bounded source relation/partition, recounts, deletes an exact maximum-10,000-row window, verifies zero rows remain, and appends an immutable receipt.
- [x] `provider_offers_legacy_quarantine`, picks, settlements, lifecycle, delivery/outbox, receipts, audit/business truth, and archive objects are outside the deletion path.
- [x] `raw_payloads` and `odds_snapshots` immutability exceptions are transaction-local and exact-plan/window scoped inside SECURITY DEFINER routines; no caller receives direct table DELETE.
- [x] Recovery requires the original execution receipt, newly verified archive evidence, exact manifest and object fingerprints matching that receipt, an empty hot window, a bounded payload, exact row restoration, and an immutable recovery receipt; a mismatch refuses before any insert.
- [x] The disabled `nightly-retention-prune` job is asserted inactive and is never scheduled or enabled.

## EVIDENCE:

```text
candidate_source_sha=14e25d858486d16925aa0eb6862fcc1f8edbcf45
parity_run_id=36530964332
parity_job_id=109284355979
parity_state=PENDING_POST_DEPLOY
production_ddl_applied=false
post_deploy_obligation=post-deploy-before-lane-close
```

## Verification

- Exact refreshed execution SHA: `14e25d858486d16925aa0eb6862fcc1f8edbcf45`.
- Sanctioned update commit `720653e30f6c725e3edb152998fc753756497d38` has parents `a3bc984a066225b3e030d88c719179de71fadc1d` and `2775e91e4026fdf9ec35d78519796c217c1ed954`; candidate commit `14e25d858486d16925aa0eb6862fcc1f8edbcf45` adds only the PM-requested recovery fingerprint binding and its regression coverage.
- Migration run `36530964452`, job `109284326913`: apply → rollback → byte-equivalent schema → reapply passed. The same job's ephemeral PostgreSQL lifecycle proved stale/mismatched evidence refusal, 1 → 0 bounded prune, independent archive readback of 1 row, same-count changed-content recovery refusal with the hot window still empty, exact-fingerprint 0 → 1 recovery, reference protection, unchanged quarantine/business rows, disabled legacy cron, and no direct executor DELETE.
- Migration run `36530964452`, job `109284327033`: fail-closed precondition drill and empty-scratch application passed.
- CI run `36530964394`, job `109284452858`: canonical writable DB and T1 live-proof suites ran against governed staging and passed for the refreshed execution SHA; the same-run proof receipt uploaded successfully.
- Local `pnpm verify:static`: passed, including lint, type-check, build, 3,524 tests, Smart Form verification, migration version uniqueness, and migration lint.
- Local focused retention/proof suites: 18 passed, 0 failed, 1 live-DB case skipped without an explicit test DSN.
- `pnpm ci:db-client-boundary`: passed; all privileged driver construction sites remain classified and unreachable from `pnpm test`.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS; no additional R-level rules matched.
- Production writes/deletes performed by this lane: 0 / 0.

## Phase-aware production parity obligation

Live Schema Parity run `36530964332`, job `109284355979` is the authoritative exact-source receipt for the candidate execution SHA. GitHub records the canonical `.github/workflows/live-schema-parity.yml` workflow, `pull_request` event, PR #1678, and immutable `run.head_sha=14e25d858486d16925aa0eb6862fcc1f8edbcf45`. The trusted workflow guard, scratch migration apply, schema comparison, and parity-artifact upload succeeded; the job completed with the expected failure only at `Authorize schema drift gate` because production does not yet contain this unapplied migration.

The phase-aware migration contract records this pre-merge state as `PENDING_POST_DEPLOY` only because all of the following are independently true:

- the run belongs to the canonical Live Schema Parity workflow and targets the exact execution SHA;
- the comparison path completed and only the drift gate failed;
- `production_ddl_applied` is explicitly false; and
- production parity is bound to the `post-deploy-before-lane-close` phase.

After merge and sanctioned deployment, lane close still refuses this pending state. A new authoritative production Live Schema Parity `PASS` receipt is mandatory before the migration lane can close. No gate was weakened or bypassed, and no production DDL or pruning was executed during this candidate-proof refresh.

## Merge SHA Binding

Merge SHA: pending merge  
PR: https://github.com/griff843/Unit-Talk-v2/pull/1678  
Execution SHA: 14e25d858486d16925aa0eb6862fcc1f8edbcf45
