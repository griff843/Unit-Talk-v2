# PROOF: UTV2-1370

MERGE_SHA: pending merge

Issue: UTV2-1370  
Tier: T1 / Tier C migration  
Result: ready for T1 review with production parity pending until sanctioned post-merge deployment

## ASSERTIONS:

- Archive evidence is re-read through the reader-only object-store path and independently checked for manifest validity, checksum, Parquet readability, exact source/window, and row count before planning.
- Planning and execution refuse stale or changed evidence, count mismatches, protected references, expired or oversized plans, active legacy pruning, wrong phase credentials, and any unsupported source.
- The execution routine holds an advisory lock, locks the bounded source relation/partition, recounts, deletes an exact maximum-10,000-row window, verifies zero rows remain, and appends an immutable receipt.
- `provider_offers_legacy_quarantine`, picks, settlements, lifecycle, delivery/outbox, receipts, audit/business truth, and archive objects are outside the deletion path.
- `raw_payloads` and `odds_snapshots` immutability exceptions are transaction-local and exact-plan/window scoped inside SECURITY DEFINER routines; no caller receives direct table DELETE.
- Recovery requires the original execution receipt, newly verified archive evidence, an empty hot window, a bounded payload, exact row restoration, and an immutable recovery receipt.
- The disabled `nightly-retention-prune` job is asserted inactive and is never scheduled or enabled.

## EVIDENCE:

## Verification

- Exact refreshed execution SHA: `12e0f4b936586ab86cf2db300c07ccefdcb32c51`.
- Migration run `36471754685`, job `109095473654`: apply → rollback → byte-equivalent schema → reapply passed. The same job's ephemeral PostgreSQL lifecycle proved stale/mismatched evidence refusal, 1 → 0 bounded prune, independent archive readback of 1 row, reference protection, unchanged quarantine/business rows, disabled legacy cron, no direct executor DELETE, and 0 → 1 recovery.
- Migration run `36471754685`, job `109095473395`: fail-closed precondition drill and empty-scratch application passed.
- Proof Gate run `36471754947`, job `109095745470`: canonical T1 live-DB proof ran against governed staging and passed for the refreshed execution SHA.
- Local `pnpm verify:static`: passed, including lint, type-check, build, 3,524 tests, Smart Form verification, migration version uniqueness, and migration lint.
- Local focused retention/proof suites: 18 passed, 0 failed, 1 live-DB case skipped without an explicit test DSN.
- `pnpm ci:db-client-boundary`: passed; all privileged driver construction sites remain classified and unreachable from `pnpm test`.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS; no additional R-level rules matched.
- Production writes/deletes performed by this lane: 0 / 0.

## Phase-aware production parity obligation

Live Schema Parity run `36471754689`, job `109095503592` is the authoritative exact-head receipt for the candidate execution SHA. The trusted workflow applied the repository migrations to scratch, compared scratch with production, uploaded its parity artifact, and completed with the expected failure at `Authorize schema drift gate` because production does not yet contain this unapplied migration.

The phase-aware migration contract records this pre-merge state as `PENDING_POST_DEPLOY` only because all of the following are independently true:

- the run belongs to the canonical Live Schema Parity workflow and targets the exact execution SHA;
- the comparison path completed and only the drift gate failed;
- `production_ddl_applied` is explicitly false; and
- production parity is bound to the `post-deploy-before-lane-close` phase.

After merge and sanctioned deployment, lane close still refuses this pending state. A new authoritative production Live Schema Parity `PASS` receipt is mandatory before the migration lane can close. No gate was weakened or bypassed, and no production DDL or pruning was executed during this candidate-proof refresh.

## Merge SHA Binding

Merge SHA: pending merge  
PR: https://github.com/griff843/Unit-Talk-v2/pull/1678  
Execution SHA: 12e0f4b936586ab86cf2db300c07ccefdcb32c51
