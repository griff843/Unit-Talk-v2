# PROOF: UTV2-1814 — governed migration for insert_certification_propagation_batch

MERGE_SHA: 36b4de331a40c00c4f4163938bf24e3dbaf4e451
PR: https://github.com/griff843/Unit-Talk-v2/pull/1600
Tier: T2
Lane: claude
Lane type: migration
Proof profile: migration

## Diff

| File | Change |
|---|---|
| `supabase/migrations/20260918020000_utv2_1814_certification_propagation_rpc.sql` | new — creates `public.insert_certification_propagation_batch(jsonb, jsonb)`, body carried forward faithfully from UTV2-1177, behind a fail-closed ownership precondition, with `search_path` pinned and explicit ACLs |
| `db/migrations-rollback/20260918020000_utv2_1814_certification_propagation_rpc.down.sql` | new — drops exactly that function, refusing anything not carrying the `UTV2-1814:` ownership marker |
| `scripts/ci/migration-precondition-drill.ts` | modified — drills routine guards as well as relation guards, and extends the schema fingerprint to `pg_proc` |
| `scripts/ci/migration-precondition-drill.test.ts` | new — declaration-parsing unit tests |
| `apps/api/src/t1-proof-utv2-1811-rpc-contract-parity.test.ts` | modified — deletes the `insert_certification_propagation_batch` allowlist entry |
| `package.json` | modified — wires the new test file into `test:ops` |

No application source changes. No caller changed. Nothing in `apps/**` or `packages/**`.

## ASSERTIONS:

1. `public.insert_certification_propagation_batch(jsonb, jsonb)` is absent from the baseline replay
   root, from production `zfzdnfwdarxucxtaojxm` and from staging `xskgrzbteyqdufktjrjx` — measured,
   not inferred.
2. Applying the migration to a scratch Postgres seeded from the baseline creates it; applying it a
   second time succeeds, because the ownership marker is present.
3. Seeding an unmarked function of the same signature makes the migration raise SQLSTATE `42723`
   before any DDL, with a byte-identical schema fingerprint across the attempt.
4. Running the rollback twice raises SQLSTATE `42501` on the second run rather than dropping an
   object it does not own.
5. `schema-roundtrip-hash.ts` reports post-down == pre-up and re-up == post-up, with pre-up != post-up
   proving the hash is sensitive to this migration.
6. A batch whose event carries an invalid enum inserts neither the record nor the event.
7. Empty batch, record/event count mismatch and non-array input each raise.
8. `proacl` is `{postgres=X/postgres}`: PUBLIC, `anon` and `authenticated` hold no EXECUTE.
9. Deleting the migration file makes `t1-proof-utv2-1811-rpc-contract-parity.test.ts` fail
   (`not ok 1`); restoring it passes 8/8. The allowlist deletion is forced, not cosmetic.
10. The drill's two existing adversarial fixtures still fail as required, and a routine fixture
    declaring an unenforced guard fails on both the refusal and the no-DDL assertions.
11. This lane resolves one of the two RPCs in UTV2-1814's definition of done.
    `list_provider_offer_history_partition_dates` remains open and its allowlist entry is retained.

## Execution anchor

Verified source SHA: 36b4de331a40c00c4f4163938bf24e3dbaf4e451
