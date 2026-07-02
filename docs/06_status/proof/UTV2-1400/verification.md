# UTV2-1400 Verification

## Verification

Commands run from `/home/griff843/code/Unit-Talk-v2/.out/worktrees/griffadavi__utv2-1400-source-activationdeprecation-decision-packet-alert-agent`:

- `pnpm type-check` — pass
- `pnpm lint` — pass
- `pnpm verify` — pass (includes `pnpm test` and `pnpm test:db` against live Supabase)
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS, no R-level artifacts required for this diff

This lane produced a decision document only — no code, tests, or scripts
were added. `pnpm verify`/`pnpm test:db` confirm no regression was
introduced anywhere in the repo by the documentation change (there is no
issue-specific runtime proof to run, since no runtime behavior changed).

### `pnpm test:db` TAP output

```
TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  ---
  duration_ms: 16897.231883
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ---
  duration_ms: 15993.357937
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 15432.985126
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ---
  duration_ms: 17395.465799
  type: 'test'
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 759.592177
  type: 'test'
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 19046.906999
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 18067.602485
  type: 'test'
  ...
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 105177.287232
```

Issue-specific proof:

- `docs/06_status/proof/UTV2-1400/decision-packet.md` covers all three
  sources (`alert-agent`, `model-driven`, `smart-form`) with the required
  fields: current code path, deploy status, product-surface-vs-dead-code
  assessment, activation requirements, risks, rollback plan, scoring/data
  requirements, and a recommended PM decision reconciled against the PM's
  preliminary stance.
- No deployment, producer activation, member-visible change, or DB
  mutation was made in this lane, per its constraints.

## Merge SHA

Branch head SHA at proof time: `6413339b995d43dc8c11c3cb781935ef4baa9e75`.

Pending merge — this lane closes on tier policy (T2: orchestrator merge on
green, no PM_VERDICT required), per `docs/05_operations/WORKFLOW_SPEC.md`.
This section will be rebound to the merge SHA automatically by
`post-merge-lane-close.yml` (`ops:proof-generate --merge-sha`); the prior
two lanes (UTV2-1382, UTV2-1397) both required a manual repair here
because `ops:proof-generate --merge-sha` does not rewrite this section's
prose, so expect to manually update this SHA reference post-merge before
`ops:truth-check` will pass P3.
