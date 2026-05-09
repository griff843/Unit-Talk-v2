# UTV2-855 Case D Migration Ledger Reconciliation Plan

Generated: 2026-05-07
Mode: planning only
Execution status: no writes approved

## 1. Current state

The linked Supabase environment is in a Case D state: migration history and local migration inventory do not agree, and the missing ownership migration cannot be applied safely yet.

Current proven facts:

- Local repo contains `supabase/migrations/202605070002_utv2_854_model_ownership_persistence.sql`.
- Remote migration history does **not** record `202605070002`.
- Remote migration history contains remote-only versions that do not exist in the local `supabase/migrations/` directory:
  - `20260424202018`
  - `20260425030626`
  - `20260425030656`
  - `20260425132920`
  - `20260427045252`
  - `20260427182229`
  - `202604300003`
- `supabase db push --dry-run` refused the normal apply path because remote migration versions were not found locally.
- Live schema still lacks:
  - `pick_candidates.model_registry_id`
  - `pick_candidates.scoring_run_id`
  - `pick_candidates.ownership_timestamp`
  - `model_registry.registry_entity_type`
  - `model_registry.source_type_compatibility`
  - `model_registry.active_state`
- Direct DB host resolution is still broken from this environment, but Supabase management-API reads succeeded, so the migration divergence is real and not just a network illusion.

Read-only repo recovery evidence gathered so far:

- `git rev-list --all --objects` found no object names containing the remote-only versions.
- `git log --all --name-only` found no migration filenames containing those remote-only versions.
- `rg` over the current workspace found no local files with those version IDs beyond the Phase 2 proof bundle.
- Current local worktrees and branches expose no matching migration files in this clone.

## 2. Why normal migration apply is unsafe

`supabase db push` should not be used yet because the remote migration ledger already contains versions that the local repo cannot account for.

Why this matters:

- Supabase uses migration history to decide ordering and whether a migration is eligible to apply.
- If local history is incomplete, a normal push can apply new schema on top of an unknown remote state.
- That creates a real risk of:
  - replaying schema against the wrong baseline
  - skipping missing historical SQL that may matter for constraints or data shape
  - normalizing a broken ledger without understanding what happened
  - making future drift harder to reason about

The current dry-run output is already the warning sign: the linked project is telling us the local repo is missing remote versions. Until those versions are explained, recovered, or explicitly waived by an operator, normal apply is unsafe.

## 3. Remote-only migration recovery plan

For each remote-only version, the recovery objective is the same:

1. determine whether the SQL body exists anywhere in git history or sibling worktrees
2. determine whether another local clone or archived branch contains the file
3. determine whether the operator can retrieve the SQL body from Supabase audit surfaces, dashboard history, or prior exported schema artifacts
4. classify the version before any repair or apply is even discussed

Current status by version:

| Remote-only version | Exists in local git history? | Exists in current clone branches/worktrees? | Supabase SQL body exposure proven? | Current classification |
|---|---|---|---|---|
| `20260424202018` | No evidence found | No evidence found | Unknown | Unknown |
| `20260425030626` | No evidence found | No evidence found | Unknown | Unknown |
| `20260425030656` | No evidence found | No evidence found | Unknown | Unknown |
| `20260425132920` | No evidence found | No evidence found | Unknown | Unknown |
| `20260427045252` | No evidence found | No evidence found | Unknown | Unknown |
| `20260427182229` | No evidence found | No evidence found | Unknown | Unknown |
| `202604300003` | No evidence found | No evidence found | Unknown | Unknown |

Interpretation:

- These versions are **not recoverable from the current repo state alone** based on the read-only search already performed.
- They are **not yet proven unrecoverable overall**, because the SQL body may still exist in:
  - another developer clone
  - archived branch refs outside this clone
  - a Supabase-side audit/export surface
  - a prior schema pull artifact or CI bundle

That is why the current classification remains `Unknown`, not `Recovered` and not `Safe to ignore`.

## 4. Non-destructive reconciliation options

### Option A - recover missing migration files locally

Preferred when the exact SQL bodies can be recovered.

How it works:

1. find the original SQL bodies for the remote-only versions
2. restore them into local `supabase/migrations/` with operator review
3. verify that recovered files match the remote ledger ordering and schema intent
4. rerun read-only reconciliation checks
5. only then consider a normal migration apply path

Why it is preferred:

- preserves the real migration story
- avoids inventing synthetic history
- gives future `supabase db push` runs a coherent baseline

Risk:

- low to medium, depending on confidence that the recovered SQL is exact

### Option B - create local placeholder migration files only if schema-equivalent and operator-approved

Use only if the original SQL bodies cannot be recovered, but the operator can prove what schema changes those versions represent.

How it works:

1. manually audit remote schema and any exported artifacts
2. reconstruct schema-equivalent placeholder migrations locally
3. mark them clearly as reconstructed placeholders
4. obtain explicit operator approval before those placeholders are treated as real ledger history

Risk:

- high
- placeholder files can make local history appear cleaner than it really is
- schema equivalence does not prove behavioral equivalence
- comments, data backfills, trigger definitions, and index variants may be lost

This option is acceptable only with explicit operator approval and a written rationale for each placeholder.

### Option C - mark migration history repaired only with explicit operator approval

This is a high-risk ledger action, not a normal developer fix.

When it might be considered:

- only after the operator fully understands what each remote-only version represents
- only after recovery attempts are exhausted or consciously waived

Why it is dangerous:

- it can hide missing SQL instead of recovering it
- it can convert an explainable divergence into a silent governance gap
- it reduces trust in future migration state

This option should remain blocked unless the operator explicitly chooses ledger repair as the least-bad path.

### Option D - stop and manually audit remote schema

Required if missing migration files cannot be recovered with confidence.

What manual audit must answer:

- what actual schema changes each remote-only version introduced
- whether any of them touched `pick_candidates`, `model_registry`, or dependent objects
- whether remote schema already includes any non-obvious drift not visible in the ownership-column check
- whether the safest path is schema reconstruction, placeholder files, or operator-led repair

This option is the correct fallback if recovery remains incomplete.

## 5. Recommended path

Recommended path: **Option A first, Option D if Option A fails, and do not use Options B or C unless the operator explicitly approves them.**

Why:

- current evidence does not support a normal apply
- the remote-only versions are not recoverable from the current repo snapshot
- preserving exact migration history is safer than reconstructing history from guesswork
- if exact SQL recovery fails, the operator needs a deliberate remote schema audit before any ledger mutation is even discussed

In plain terms:

1. run a broader read-only recovery search
2. try to recover exact SQL bodies
3. if successful, review and re-run dry-run checks
4. if unsuccessful, stop and escalate to manual schema audit

## 6. Operator approval checkpoints

Operator approval is required at each checkpoint below:

1. **Before any recovery beyond the current clone**
   - searching additional archived clones, CI artifacts, or external backups
2. **Before trusting any recovered SQL body**
   - operator reviews provenance of the recovered file
3. **Before introducing recovered or reconstructed files into local `supabase/migrations/`**
   - even local file restoration changes the ledger story
4. **Before any placeholder migration strategy**
   - explicit sign-off required because it is synthetic history
5. **Before any migration repair command**
   - remains blocked by default
6. **Before any normal migration apply**
   - only after reconciliation evidence is complete and dry-run is clean

## 7. Commands for Codex Phase 4

Codex-ready read-only recovery prompt:

```text
UTV2-855 Phase 4 - Read-only migration recovery search

Goal:
Search for remote-only migration versions in git history, branches, worktrees, archived clones, and local artifacts.

Remote-only versions:
- 20260424202018
- 20260425030626
- 20260425030656
- 20260425132920
- 20260427045252
- 20260427182229
- 202604300003

Rules:
- Do not write files
- Do not apply migrations
- Do not run migration repair
- Do not create Supabase branches
- Do not modify live schema

Required read-only work:
1. Search `git rev-list --all --objects` for each version.
2. Search `git log --all --name-only` for each version.
3. Search all local worktrees and obvious sibling clones for matching filenames.
4. Search docs, proof bundles, CI scripts, and migration audit artifacts for references to the versions.
5. Record whether any candidate SQL body or schema-equivalent evidence is found.
6. Produce a recovered SQL candidate list with provenance and confidence.

Required output:
- update a proof file under `docs/06_status/proof/UTV2-855/`
- classify each remote-only version as recovered / still unknown / disproven
```

## 8. Commands explicitly forbidden

Until the operator explicitly approves a later phase, Codex must not run:

- `supabase db push`
- `supabase migration repair`
- `supabase db reset`
- any drop/recreate workflow
- any direct `ALTER TABLE` against the live DB
- any paid preview branch creation
- any manual mutation of migration ledger tables

These remain forbidden until reconciliation evidence is complete and operator approval is explicit.
