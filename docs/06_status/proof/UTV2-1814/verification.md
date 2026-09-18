# UTV2-1814 — Verification

MERGE_SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1600
Tier: T2
Lane: claude
Lane type: migration
Proof profile: migration
Proof Artifact: docs/06_status/proof/UTV2-1814/diff-summary.md

## Summary

Production `worker.autorun` has been dead since 2026-09-18T00:38:32Z. The worker container
reports `running=true`, `healthy`, `RestartCount=0` and never polls the distribution outbox,
because `invalidateExpiredCertificationProofs` runs at start-up, calls
`insert_certification_propagation_batch`, and `DatabaseCertificationRepository.insertPropagationBatch`
throws when the RPC is absent:

```
"autorun": true, "certificationRuntime": "enabled",
"error": "certification propagation batch insert failed: Could not find the function
          public.insert_certification_propagation_batch(p_events, p_records) in the schema cache"
```

The function was written once, as
`supabase/migrations_archive/20260527001_utv2_1177_atomic_certification_propagation_batch.sql`,
and was never applied to any live database. UTV2-1274 rebaselined the migration ledger from a
snapshot *of live*, so the object was not there to capture.
`supabase/migrations_archive/README.md` asserts archived migrations are "already represented in"
the baseline; for this object that premise is false, and the definition was lost from the replay
root and from both databases at once. UTV2-1811's RPC contract-parity test surfaced it and carried
it as an allowlist entry pointing here.

This lane supplies the missing contract and deletes that allowlist entry. It changes no caller and
relaxes no fail-closed behaviour: a database lacking this function still aborts worker autorun
exactly as it does today.

## Verification

### What was proven, and where

| Claim | How |
|---|---|
| The baseline replay root genuinely lacks the function | `to_regprocedure(...)` returns `ABSENT` on a scratch `postgres:16` seeded from `00000000000000_baseline_live_schema.sql` |
| Production and staging both lack it | live `to_regprocedure` against `zfzdnfwdarxucxtaojxm` and `xskgrzbteyqdufktjrjx` |
| The migration applies, and is replay-safe | applied twice in succession; second run succeeds because the ownership marker is present |
| It refuses to overwrite an object it does not own | seeded an unmarked same-signature function; migration raised SQLSTATE 42723 before any DDL |
| The rollback refuses to drop an object it does not own | ran the down script twice; second run raised SQLSTATE 42501 |
| Apply/rollback/re-apply converges | `schema-roundtrip-hash.ts` pre-up == post-down, and post-up == re-up, with the hash proven sensitive to this migration |
| The function is atomic | a batch whose event carries an invalid enum rolled the record back too; counts unchanged |
| It refuses malformed input | empty batch, record/event count mismatch and non-array all raise |
| It is not browser-reachable | `proacl` is `{postgres=X/postgres}` — PUBLIC, `anon` and `authenticated` all revoked |
| The parity test is load-bearing | removing the migration file fails it (`not ok 1`); restoring it passes 8/8 |

### The precondition drill had to be taught routines

`scripts/ci/migration-precondition-drill.ts` could not drill a migration whose only object is a
function, and the gate has no usable exemption: the `NO-PRECONDITION-REQUIRED:` marker is honoured
by the workflow and then unconditionally failed by the same job's `drilled 0` backstop, so on a
single-migration PR the exemption path is unreachable. The drill required a declared *relation*,
a `42P07` decoy, and creation of that relation on a clean schema — none of which a function-only
migration can honestly produce.

The repair extends the drill rather than exempting anything:

- a declared target carrying an argument list is a routine; commas are split at parenthesis depth
  zero, so `public.f(jsonb, jsonb)` is one target rather than two nonsense relation names;
- a routine decoy is a same-signature function and the required SQLSTATE is `42723`
  (duplicate_function), the exact analogue of `42P07` (duplicate_table);
- existence is probed with `to_regprocedure` rather than `to_regclass`;
- the schema fingerprint now includes `pg_proc` — body hash, `prosecdef` and `proconfig`.

That last item is not incidental. Before it, the "no DDL ran" assertion was blind to functions:
a routine guard that fired only *after* overwriting a function body would have fingerprinted as
identical and been reported as a clean refusal. The adversarial routine fixture below fails on
exactly that assertion, which is what demonstrates the addition is load-bearing rather than
decorative.

Both of the gate's existing adversarial fixtures still fail as required, and a new routine fixture
that declares a guard it does not enforce fails on two cases:

```
[FAIL] refuses when public._adv_routine_fixture(jsonb) pre-exists — migration APPLIED …
[FAIL] no DDL ran when public._adv_routine_fixture(jsonb) pre-exists — SCHEMA CHANGED during the attempt
```

### Scope note — this does not close UTV2-1814

The issue's definition of done covers **two** ungoverned RPCs. This lane resolves
`insert_certification_propagation_batch` only. `list_provider_offer_history_partition_dates` is a
name mismatch against UTV2-1736's `..._days` and remains open, with its allowlist entry
deliberately retained. The issue must not be marked Done on this lane.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1600
Verified source SHA: 36b4de331a40c00c4f4163938bf24e3dbaf4e451
