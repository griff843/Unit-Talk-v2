# PROOF: UTV2-1814 — governed migration for insert_certification_propagation_batch

MERGE_SHA: d122f28372784ebce01d92e3e3ae19f7a7b7c30c
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

- [x] `public.insert_certification_propagation_batch(jsonb, jsonb)` is absent from the baseline replay
      root, from production `zfzdnfwdarxucxtaojxm` and from staging `xskgrzbteyqdufktjrjx` — measured,
      not inferred.
- [x] Applying the migration to a scratch Postgres seeded from the baseline creates it; applying it a
      second time succeeds, because the ownership marker is present.
- [x] Seeding an unmarked function of the same signature makes the migration raise SQLSTATE `42723`
      before any DDL, with a byte-identical schema fingerprint across the attempt.
- [x] Running the rollback twice raises SQLSTATE `42501` on the second run rather than dropping an
      object it does not own.
- [x] `schema-roundtrip-hash.ts` reports post-down == pre-up and re-up == post-up, with pre-up != post-up
      proving the hash is sensitive to this migration.
- [x] A batch whose event carries an invalid enum inserts neither the record nor the event.
- [x] Empty batch, record/event count mismatch and non-array input each raise.
- [x] `proacl` is `{postgres=X/postgres}`: PUBLIC, `anon` and `authenticated` hold no EXECUTE.
- [x] Deleting the migration file makes `t1-proof-utv2-1811-rpc-contract-parity.test.ts` fail
      (`not ok 1`); restoring it passes 8/8. The allowlist deletion is forced, not cosmetic.
- [x] The drill's two existing adversarial fixtures still fail as required, and a routine fixture
      declaring an unenforced guard fails on both the refusal and the no-DDL assertions.
- [x] This lane resolves one of the two RPCs in UTV2-1814's definition of done.
      `list_provider_offer_history_partition_dates` remains open and its allowlist entry is retained.

## Merge SHA Binding

Merge SHA: d122f28372784ebce01d92e3e3ae19f7a7b7c30c
PR: https://github.com/griff843/Unit-Talk-v2/pull/1600
Verified source SHA: 36b4de331a40c00c4f4163938bf24e3dbaf4e451

## EVIDENCE:

Fail-closed precondition drill — run `35306930500`, job `105480922878`, head
`36b4de331a40c00c4f4163938bf24e3dbaf4e451`:

```
[PASS] refuses when public.insert_certification_propagation_batch(jsonb, jsonb) pre-exists — raised SQLSTATE 42723
[PASS] no DDL ran when public.insert_certification_propagation_batch(jsonb, jsonb) pre-exists — schema fingerprint identical before and after the attempt
[PASS] scratch restored after public.insert_certification_propagation_batch(jsonb, jsonb) case — back to baseline
[PASS] applies on an empty scratch schema — created all declared targets: public.insert_certification_propagation_batch(jsonb, jsonb)
drilled 1 migration(s)
```

Parity test, with and without the migration file present:

```
$ pnpm exec tsx --test apps/api/src/t1-proof-utv2-1811-rpc-contract-parity.test.ts
# tests 8
# pass 8
# fail 0

$ rm supabase/migrations/20260918020000_utv2_1814_certification_propagation_rpc.sql
$ pnpm exec tsx --test apps/api/src/t1-proof-utv2-1811-rpc-contract-parity.test.ts
not ok 1 - every runtime client.rpc() dependency is defined by a governed migration
# fail 1
```

Granted ACLs on the created function, read back from `pg_proc`:

```
proname   | insert_certification_propagation_batch
proacl    | {postgres=X/postgres}
prosecdef | t
proconfig | {search_path=pg_catalog, public}
```

The defect this repairs, measured on the production worker before any change:

```
$ ssh unit-talk-prod docker logs unit-talk-worker-1
certification propagation batch insert failed: Could not find the function
public.insert_certification_propagation_batch(p_events, p_records) in the schema cache
$ ssh unit-talk-prod docker inspect -f '{{.State.Health.Status}} {{.RestartCount}}' unit-talk-worker-1
healthy 0
```

## Receipts

| Receipt | Workflow / job | Run | Job | Result |
|---|---|---|---|---|
| `precondition_drill` | Fail-closed precondition drill (scratch Postgres) | 35306930500 | 105480922878 | PASS |
| `schema_roundtrip_drill` | Schema round-trip drill (scratch Postgres) | 35306930500 | 105480922828 | PASS |
| `live_schema_parity` | Live Schema Parity | 35306930585 | 105480940619 | PASS |
| `writable_db_proof_staging` | Writable DB proof (staging only) | 35306930508 | 105481005611 | PASS |

All four were produced at `36b4de331a40c00c4f4163938bf24e3dbaf4e451`, the declared
`sha_binding.verified_source_sha`.
