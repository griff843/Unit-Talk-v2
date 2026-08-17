# PROOF: UTV2-1718

MERGE_SHA: 0dda9a969910fdee76ca9afc110fff36bbd54360

Verified implementation SHA: `0dda9a969910fdee76ca9afc110fff36bbd54360`

Pre-merge this anchor identifies the implementation commit on this branch. Post-merge closeout automation rebinds proof artifacts to the authoritative merge SHA.

**STATUS: EVIDENCE INCOMPLETE — the refusal drill has not yet run in CI.** Nothing below claims the fail-closed precondition works. That claim becomes available only when the `precondition-drill` job executes and passes at this branch's head. This bundle is written before that run, deliberately, so no result is asserted in advance.

## Summary

`public.command_center_game_threads` and `public.command_center_delivery_mappings` exist on production `zfzdnfwdarxucxtaojxm` with real data but have no migration file, no Supabase migration-history entry, and no generated-types entry. They were created out of band against the live database.

This lane is the **successor** to UTV2-1540, which reached the `pm-verdict/v1` bounce cap and was closed unmerged. The production requirement is unchanged.

### Why the predecessor was rejected

Its migration used `CREATE ... IF NOT EXISTS` plus an unconditional `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. `IF NOT EXISTS` does not refuse — it **skips silently**, which is indistinguishable from success. Nothing prevented a normal production deploy from executing the version ahead of the separately-authorized ledger repair, bypassing the operator authorization boundary.

A fail-closed precondition was added at `fda0a266`, but **its refusal path was never executed**. Building the harness required `scripts/ci/**` and `.github/workflows/**`, outside that lane's file scope. Reading the guard's SQL is not evidence that it fires.

### What this lane adds

`scripts/ci/migration-precondition-drill.ts`, registered as a separate `precondition-drill` job on the credential-free migration-reversibility workflow. It makes the control FAIL on the condition it names, which is the only thing that proves a control.

## ASSERTIONS:

- [x] The carried implementation is byte-identical to the verified predecessor head, not recreated. Git blob hashes against `fda0a266`: migration `b4a3667a`, down script `69af4194`, `database.types.ts` `a49a3853`.
- [x] The migration declares its guarded relations machine-readably (`-- FAIL-CLOSED-PRECONDITION: public.command_center_game_threads, public.command_center_delivery_mappings`), so the drill cannot silently target the wrong ones.
- [x] `pnpm type-check` exit 0 on this branch.
- [x] ESLint clean on the new script.
- [x] The drill job references no secrets — asserted by parsing the workflow YAML and testing the serialized job for `secrets.`.
- [x] `live-schema-parity.yml`, which holds a production-superuser URL, is **not** modified by this lane.
- [ ] The migration refuses with `SQLSTATE 42P07` when `public.command_center_game_threads` pre-exists — **PENDING CI**.
- [ ] The migration refuses with `SQLSTATE 42P07` when `public.command_center_delivery_mappings` pre-exists — **PENDING CI**, and proven separately from the case above because the guard claims "either", not "both".
- [ ] No DDL runs on a refused attempt — schema fingerprint byte-identical before and after — **PENDING CI**, proven per relation.
- [ ] The guard does not simply always refuse: the migration still applies in full on an empty scratch schema — **PENDING CI**.
- [ ] The empty-database apply → rollback → reapply convergence proof stays green — **PENDING CI** (existing `schema-roundtrip-drill` job, preserved untouched).
- [ ] Live Schema Parity, staging writable DB proof, `pnpm verify`, required CI, proof binding, and independent exact-head review — **PENDING CI at the final head**.
- [x] RLS is preserved as production has it — enabled on both tables with zero policies, which denies every non-superuser role without BYPASSRLS. Replaying without it would produce a scratch schema strictly more permissive than production.

## EVIDENCE:

- Predecessor record preserved: PR #1378 closed unmerged, branch `claude/utv2-1540-live-schema-parity-ledger-repair` retained at rejected head `fda0a266348ec186f0bf6010e41a77aada4bfd75`, with its comments, reviews, CI results and proof bundle intact. History was not rewritten.
- UTV2-1540 moved to `Canceled` with `needs-reframe` + `pm-triage`. `Canceled` records that the execution attempt ended without shipping, not that the requirement was withdrawn.
- No production migration repair has been executed at any point, on either lane.
- The DDL was read out of `pg_attribute`, `pg_constraint`, `pg_indexes`, `pg_trigger`, `pg_class`, and `pg_policies` on 2026-08-03, read-only.
- `command_center_game_threads` is created before `command_center_delivery_mappings` because the latter carries a foreign key to the former.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Carried blobs identical to predecessor head | PASS | `git hash-object` matched `git rev-parse fda0a266:<path>` for all three files. |
| `pnpm type-check` | PASS | exit 0 on this branch. |
| ESLint on new script | PASS | `pnpm exec eslint scripts/ci/migration-precondition-drill.ts` exit 0. |
| Drill job carries no secrets | PASS | Workflow YAML parsed; serialized `precondition-drill` job tested for `secrets.` — none present. |
| Live Schema Parity workflow untouched | PASS | Not in this lane's `file_scope_lock` and not modified. |
| `scripts/ci/r-level-check.ts` | PENDING | Runs in CI on this branch. |
| Refusal — `command_center_game_threads` pre-existing | PENDING | Requires the `precondition-drill` job. |
| Refusal — `command_center_delivery_mappings` pre-existing | PENDING | Requires the `precondition-drill` job; proven independently of the case above. |
| No DDL on refusal (schema fingerprint unchanged) | PENDING | Requires the `precondition-drill` job. |
| Applies on empty scratch schema | PENDING | Requires the `precondition-drill` job. |
| Rollback / reapply convergence | PENDING | Existing `schema-roundtrip-drill` job, rerun at this head. |
| Live Schema Parity | PENDING | Rerun at final head. |
| `pnpm test:db` / writable DB verification | PENDING | Staging rerun at final head. |
| `pnpm verify` | PENDING | Rerun at final head. |
| Proof binding | PENDING | `proof-binding-validator` at final head. |
| Exact-head independent review | PENDING | No result is asserted here in advance. |

## Refusal drill — method

The drill is convention-driven rather than hardcoded to this migration, so the control generalizes:

1. Snapshot a full schema fingerprint — relations, columns with types, constraint definitions, non-internal triggers, and per-table RLS flags.
2. For **each** declared relation independently: seed it as a decoy, execute the migration through the simple query protocol with no wrapping transaction (so a partial apply cannot be masked by a rollback), and require the raised SQLSTATE to be exactly `42P07`.
3. Re-snapshot and require byte-identical output. Checking only "did the other table appear" would miss a partial apply that created an index or trigger before reaching the guard.
4. Drop the decoy and confirm the fingerprint returns to baseline, so one case cannot contaminate the next.
5. Finally, with no target relation present, require the migration to apply in full and create every declared relation — otherwise a guard that always refuses would pass steps 1–4.

### Fail-open defences

A drill that silently does nothing is indistinguishable from a healthy guard, so two defences are built in:

- A migration with no `-- FAIL-CLOSED-PRECONDITION:` declaration **fails** the drill rather than being skipped. Opting out requires an explicit `-- NO-PRECONDITION-REQUIRED:` marker.
- An adversarial fixture declares a precondition it does not enforce, and the job asserts the drill **rejects** it. Without this, a bug in the drill would look like a passing gate.

## Scope

- Carried predecessor implementation: migration, down script, `packages/db/src/database.types.ts`
- `scripts/ci/migration-precondition-drill.ts` — the smallest addition that makes refusal executable
- `precondition-drill` job registration on `.github/workflows/migration-reversibility-gate.yml`

The production-credential-bearing `live-schema-parity.yml` is deliberately not modified.

## Prohibited actions

`supabase migration repair --status applied 20260803230000` is a production mutation requiring explicit PM approval. It has not been run and is not part of this lane's completion criteria.

## Known limitations

- The refusal drill could not be executed on the authoring workstation: there is no local Postgres and the Docker daemon is unreachable. Per standing PM direction not to block on local Docker or workstation software changes, it runs in hosted CI.
- Because the drill runs against an ephemeral scratch database, it proves the guard's behaviour, not that production's current state matches expectations. Production state remains covered by Live Schema Parity.
