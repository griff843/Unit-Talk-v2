# PROOF: UTV2-1370

MERGE_SHA: pending merge

Issue: UTV2-1370  
Tier: T1 / Tier C migration  
Result: blocked only on live parity that cannot pass until this migration is deployed

## Assertions

- Archive evidence is re-read through the reader-only object-store path and independently checked for manifest validity, checksum, Parquet readability, exact source/window, and row count before planning.
- Planning and execution refuse stale or changed evidence, count mismatches, protected references, expired or oversized plans, active legacy pruning, wrong phase credentials, and any unsupported source.
- The execution routine holds an advisory lock, locks the bounded source relation/partition, recounts, deletes an exact maximum-10,000-row window, verifies zero rows remain, and appends an immutable receipt.
- `provider_offers_legacy_quarantine`, picks, settlements, lifecycle, delivery/outbox, receipts, audit/business truth, and archive objects are outside the deletion path.
- `raw_payloads` and `odds_snapshots` immutability exceptions are transaction-local and exact-plan/window scoped inside SECURITY DEFINER routines; no caller receives direct table DELETE.
- Recovery requires the original execution receipt, newly verified archive evidence, an empty hot window, a bounded payload, exact row restoration, and an immutable recovery receipt.
- The disabled `nightly-retention-prune` job is asserted inactive and is never scheduled or enabled.

## Measured evidence

- Exact implementation SHA: `ee373ec786a24c460412361dce2708f4e69ce597`.
- Migration run `36436625145`, job `108976108520`: apply → rollback → byte-equivalent schema → reapply passed. The same job's ephemeral PostgreSQL lifecycle proved stale/mismatched evidence refusal, 1 → 0 bounded prune, independent archive readback of 1 row, reference protection, unchanged quarantine/business rows, disabled legacy cron, no direct executor DELETE, and 0 → 1 recovery.
- Migration run `36436625145`, job `108976108712`: fail-closed precondition drill and empty-scratch application passed.
- CI run `36436625310`, job `108976752649`: the canonical writable staging DB proof and all T1 live proof suites passed; credentials were scrubbed and a same-run receipt was uploaded.
- Local `pnpm verify:static`: passed, including lint, type-check, build, 3,524 tests, Smart Form verification, migration version uniqueness, and migration lint.
- Local focused retention/proof suites: 18 passed, 0 failed, 1 live-DB case skipped without an explicit test DSN.
- `pnpm ci:db-client-boundary`: passed; all privileged driver construction sites remain classified and unreachable from `pnpm test`.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS; no additional R-level rules matched.
- Production writes/deletes performed by this lane: 0 / 0.

## Open gate

Live Schema Parity run `36436625162`, job `108976153000` correctly fails because production does not yet contain the unapplied retention migration. The drift is the new retention control schema. Passing this gate before deployment would require either deploying the migration or weakening the parity gate; both are outside this lane's authorization.

## Merge SHA Binding

Merge SHA: pending merge  
PR: https://github.com/griff843/Unit-Talk-v2/pull/1678  
Execution SHA: ee373ec786a24c460412361dce2708f4e69ce597
