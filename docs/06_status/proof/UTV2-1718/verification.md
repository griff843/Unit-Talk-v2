# PROOF: UTV2-1718

MERGE_SHA: dc7f04accd7d31d737fb714dfbfbdb3c4b26ae80

Verified implementation SHA: `dc7f04accd7d31d737fb714dfbfbdb3c4b26ae80`

Pre-merge this anchor identifies the implementation commit on this branch. Post-merge closeout automation rebinds proof artifacts to the authoritative merge SHA.

**STATUS: EVIDENCE COMPLETE except the PM approval artifact.** The refusal drill executed and passed at head `c706673e67df388051fdab26b58c5e007e9e6bfa` (run 31996952192, job 95290190423), proving both relations independently. Commits after the implementation anchor are proof-path only, enforced mechanically by `proof-binding-validator`. The production ledger repair remains separately prohibited.

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
- [x] The migration refuses with `SQLSTATE 42P07` when `public.command_center_game_threads` pre-exists — run 31996952192: `[PASS] raised SQLSTATE 42P07`.
- [x] The migration refuses with `SQLSTATE 42P07` when `public.command_center_delivery_mappings` pre-exists — run 31996952192: `[PASS] raised SQLSTATE 42P07`. Seeded and asserted separately from the case above, because the guard claims "either", not "both".
- [x] No DDL runs on a refused attempt — schema fingerprint byte-identical before and after, asserted per relation. Run 31996952192, both cases PASS.
- [x] The guard does not simply always refuse: run 31996952192 `[PASS] applies on an empty scratch schema — created all declared relations`.
- [x] The empty-database apply → rollback → reapply convergence proof stays green — `schema-roundtrip-drill` job 95290190466, PASS, preserved untouched.
- [x] Live Schema Parity (job 95290200913), staging writable DB proof (job 95290247439), `pnpm verify` (job 95291314897) and proof binding all PASS at this head. Independent exact-head review is recorded separately and is not asserted here in advance.
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
| `scripts/ci/r-level-check.ts` | PASS | R-Level Compliance green at this head. |
| Refusal — `command_center_game_threads` pre-existing | PASS | Run 31996952192 — raised SQLSTATE 42P07. |
| Refusal — `command_center_delivery_mappings` pre-existing | PASS | Run 31996952192 — raised SQLSTATE 42P07, seeded independently. |
| No DDL on refusal (schema fingerprint unchanged) | PASS | Run 31996952192 — fingerprint identical before/after, both relations. |
| Applies on empty scratch schema | PASS | Run 31996952192 — created both declared relations. |
| Rollback / reapply convergence | PASS | `schema-roundtrip-drill` job 95290190466. |
| Live Schema Parity | PASS | Job 95290200913. |
| `pnpm test:db` / writable DB verification | PASS | Writable DB proof (staging) job 95290247439. |
| `pnpm verify` | PASS | Job 95291314897. |
| Proof binding | PASS | `proof-binding-validator` green; commits after the anchor are proof-path only. |
| Exact-head independent review | PENDING | No result is asserted here in advance. |

## Diff summary

| File | Change | Note |
|---|---|---|
| `supabase/migrations/20260803230000_utv2_1540_command_center_ledger_repair.sql` | carried + marker | Blob carried identically from the predecessor head; a `FAIL-CLOSED-PRECONDITION` declaration line was added so CI knows which relations to seed. |
| `db/migrations-rollback/20260803230000_utv2_1540_command_center_ledger_repair.down.sql` | carried unchanged | Blob `69af4194`, identical to the predecessor head. |
| `packages/db/src/database.types.ts` | carried unchanged | Blob `a49a3853`, generated from a replayed scratch schema, credential-free. |
| `scripts/ci/migration-precondition-drill.ts` | new | The refusal drill. Shells out to `psql` rather than constructing a database client, so it adds no privileged-client site. |
| `.github/workflows/migration-reversibility-gate.yml` | modified | Adds the `precondition-drill` job and its path trigger. No secrets referenced. |
| `docs/06_status/proof/UTV2-1718/*` | new | This bundle. |
| `.ops/sync/UTV2-1718.yml`, `docs/06_status/lanes/UTV2-1718.json` | new | Lane control plane. |

Commands run locally on this branch: `pnpm type-check` (exit 0), `pnpm test` is exercised through `pnpm verify` in CI, `pnpm verify` runs as a required context, and `scripts/ci/r-level-check.ts` runs in CI.

## Corrected fail-open defect in this lane's own drill

The drill's first CI run reported **PASS while testing nothing**. Its real output was:

```
=== supabase/migrations/20260803230000_..._ledger_repair.sql: exempt (declared NO-PRECONDITION-REQUIRED) ===
```

The workflow's exemption check was an unanchored `grep -q -- '-- NO-PRECONDITION-REQUIRED:'`. The migration's comment *explaining* the opt-out quoted that literal token, so the grep matched prose and exempted the very migration the drill exists to test. The adversarial fixture still passed, which made the green look earned.

This is the same fail-open class the drill was built to catch, and it defeated the drill's own defences. Three changes, because removing the prose alone would leave the mechanism just as fragile:

1. **Both marker greps are anchored** to the start of a comment line, so prose can never be read as a declaration.
2. **A guard declaration takes precedence over an exemption**, and declaring both is a hard failure. Ambiguity resolves to failure, never to skipping.
3. **A run that drills zero migrations fails.** If migrations were detected but none drilled, the job errors instead of reporting a green no-op. This is the backstop that would have caught the original bug regardless of the grep.

A regression fixture asserts that prose mentioning the exemption marker does not exempt a guarded migration.

**Second run — the drill executed and failed on its own bug.** With the classification fixed, the job logged `drilled 1 migration(s)` and then errored: `42702: column reference "oid" is ambiguous`. The schema-fingerprint query called `pg_get_constraintdef(oid)` while joining `pg_constraint` to `pg_namespace`, and both expose `oid`. Qualified to `con.oid`.

Worth recording rather than quietly fixing: the first run was green and proved nothing, the second was red and proved the harness was finally executing. A red drill that reaches a real query error is strictly better evidence than a green one that skipped. The workflow's failure message was also corrected — it previously asserted "a precondition did not refuse as required", which would have been a false finding when the actual cause was a drill error; it now defers to the drill's own output.

## What the drill actually caught — the guard never worked as designed

This is the finding that justifies the lane. On its first fully-executing run the drill reported, for **each** relation independently:

```
[FAIL] refuses when public.command_center_game_threads pre-exists —
       SQLSTATE 22P02, expected 42P07.
       psql reported: ERROR:  22P02: malformed array literal: "public.command_center_game_threads"
```

The precondition built its list of offending relations with:

```sql
existing := existing || 'public.command_center_game_threads';
```

With an untyped literal, Postgres resolves `text[] || 'foo'` to **array-to-array** concatenation rather than element append, so it tries to parse the relation name as an array literal and raises `22P02` — **before ever reaching the `RAISE`**.

So the guard as written at the predecessor head `fda0a266`:

- never raised `42P07`;
- never emitted the message naming the operator authorization boundary;
- never emitted the `HINT` telling the operator to use `supabase migration repair --status applied` instead;
- refused **only because it crashed on its own first statement**.

It was fail-closed by accident. An operator who tripped it would have seen `malformed array literal` and no indication of what boundary they had hit or what to do instead. Every review of this migration — including a PM verdict and an independent exact-head review that both accepted the precondition's design — read this code and could not see it. Only execution surfaced it.

Fixed with `array_append(existing, ...)`, which is unambiguous.

Note what the same run *did* establish, and what it did not: refusal genuinely occurred and **no DDL ran** — the schema fingerprint was byte-identical before and after every refused attempt, and the migration still applied in full on an empty schema. The safety property held; the declared contract for *how* it refuses did not.

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
