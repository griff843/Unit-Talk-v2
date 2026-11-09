# PROOF: WORK-2026110803

MERGE_SHA: pending merge

> Scaffolded by `ops:lane-start`. Nothing below has been run. Record each command
> actually executed and its real result before review. `post-merge-lane-close.yml`
> binds the merge SHA; never write one here by hand.

Issue: WORK-2026110803
Tier: T1
result: not_run

## ASSERTIONS:

- [ ] (state each behavior this lane proves, and the test that proves it)

## EVIDENCE:

(paste measured output here, in fenced blocks)

## Verification

(record every verification command run on the final code commit, with its real result)

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: 01637c26a6b53b1ac32fb3a25049c7b712717d02

## Executor verification notes (WORK-2026110803)

- Focused tests: `scripts/ops/lane-manifest.test.ts` + `scripts/ops/model-routing.test.ts` — 92/92 pass (includes the legitimate PR-head-advance case, idempotence, conflicting sidecar, each refusal).
- Mutation proof (each mutation restored afterwards): removing the PR-history check fails "refuses when the approval head is not in the PR history"; verifying against a different head than the stored one fails 4 tests; skipping the reviewer/identity equality checks fails "refuses when the stored approval no longer matches what GitHub returns".
- `pnpm lint`, `pnpm type-check`, `pnpm build`, `pnpm test` (227/227 in the final stage) passed in `pnpm verify`. `pnpm verify` stopped at `test:live-db` / `ci:assert-staging` with `ref=unidentified`: the live-DB step refuses locally and is deferred to staging CI under the PT1 route-B containment deferral.
- No `package.json` change: both test files are already registered in `test:ops`.
