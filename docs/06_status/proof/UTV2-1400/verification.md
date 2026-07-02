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
