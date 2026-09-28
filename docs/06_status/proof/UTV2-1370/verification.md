# PROOF: UTV2-1370

MERGE_SHA: pending merge

Issue: UTV2-1370  
Tier: T1 / Tier C migration  
Result: blocked on a canonical pre-merge migration-control contradiction

## Assertions

- Archive evidence is re-read through the reader-only object-store path and independently checked for manifest validity, checksum, Parquet readability, exact source/window, and row count before planning.
- Planning and execution refuse stale or changed evidence, count mismatches, protected references, expired or oversized plans, active legacy pruning, wrong phase credentials, and any unsupported source.
- The execution routine holds an advisory lock, locks the bounded source relation/partition, recounts, deletes an exact maximum-10,000-row window, verifies zero rows remain, and appends an immutable receipt.
- `provider_offers_legacy_quarantine`, picks, settlements, lifecycle, delivery/outbox, receipts, audit/business truth, and archive objects are outside the deletion path.
- `raw_payloads` and `odds_snapshots` immutability exceptions are transaction-local and exact-plan/window scoped inside SECURITY DEFINER routines; no caller receives direct table DELETE.
- Recovery requires the original execution receipt, newly verified archive evidence, an empty hot window, a bounded payload, exact row restoration, and an immutable recovery receipt.
- The disabled `nightly-retention-prune` job is asserted inactive and is never scheduled or enabled.

## Verification

- Exact refreshed execution SHA: `19b9d81e711f55491c4e1c584874568d1969aa0a`.
- Migration run `36439442288`, job `108985797094`: apply → rollback → byte-equivalent schema → reapply passed. The same job's ephemeral PostgreSQL lifecycle proved stale/mismatched evidence refusal, 1 → 0 bounded prune, independent archive readback of 1 row, reference protection, unchanged quarantine/business rows, disabled legacy cron, no direct executor DELETE, and 0 → 1 recovery.
- Migration run `36439442288`, job `108985796493`: fail-closed precondition drill and empty-scratch application passed.
- CI run `36439442259`, job `108986033953`: canonical writable staging DB proof receipt for the refreshed execution SHA.
- Local `pnpm verify:static`: passed, including lint, type-check, build, 3,524 tests, Smart Form verification, migration version uniqueness, and migration lint.
- Local focused retention/proof suites: 18 passed, 0 failed, 1 live-DB case skipped without an explicit test DSN.
- `pnpm ci:db-client-boundary`: passed; all privileged driver construction sites remain classified and unreachable from `pnpm test`.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS; no additional R-level rules matched.
- Production writes/deletes performed by this lane: 0 / 0.

## Governance contradiction

Live Schema Parity run `36439442340`, job `108985848653` fails because production does not contain the unapplied retention migration. This is not an accepted proof result: the schema-v2 migration contract requires this receipt to be `PASS`.

The repository currently provides no sanctioned order that can make that pre-merge receipt pass:

- `docs/05_operations/DB_EXECUTION_PLAN.md` says migration apply happens only after review, CI, merge, and the sanctioned deploy flow.
- `docs/05_operations/DB_ARCHITECTURE_SPEC.md` says no migration may be applied to live Supabase before merge.
- `scripts/ops/proof-schema.ts` requires a passing `runtime_proof.live_schema_parity` receipt for a pre-merge migration packet.
- `.github/workflows/live-schema-parity.yml` replays all PR migrations into scratch, compares that result directly with production, and denies every schema difference other than two named extension differences.

Therefore this new schema-changing migration cannot be both unapplied before merge and equal to production before merge. No gate was weakened, bypassed, or reclassified, and no production DDL was executed.

## Merge SHA Binding

Merge SHA: pending merge  
PR: https://github.com/griff843/Unit-Talk-v2/pull/1678  
Execution SHA: 19b9d81e711f55491c4e1c584874568d1969aa0a
