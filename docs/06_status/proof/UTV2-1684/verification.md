# PROOF: UTV2-1684

MERGE_SHA: f044a2c465004d05aa2eca93e041d2f1e4b43b84

This is the approved implementation head. The post-merge close workflow rebinds these anchors to the authoritative PR merge SHA after merge; no pre-merge artifact claims that future SHA.

## Summary

The workflow preserves resolved PR `mergeCommit` authority, asserts push identity, limits proof side effects to closeable lane flows, persists proof before downstream truth checks, and retries persistence when `main` advances concurrently.

## Verification

- `pnpm type-check` — PASS in the full verification run.
- `pnpm test` — unit and ops suites passed in the full verification run.
- `pnpm verify` — lint, type-check, build, unit/ops suites, command-manifest, and migration checks passed. The final writable live-DB phase was refused by the staging-target guard because the local target resolved to `127.0.0.1`, not the required staging project. No bypass was attempted.
- `tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS; no R-level artifacts required.
- `tsx --test scripts/ops/lane-close.test.ts` — 159 tests passed at implementation head `543271854f8beb548f094885153d060b49a19bce` before the behavioral seams were relocated unchanged into the reserved workflow-hardening test file for scope compliance.

Mutation validation at the implementation head killed 3 of 3 targeted mutants: reintroduced `github.sha` fallback, disabled push identity guard, and removed concurrent-main retry.

## ASSERTIONS:

- [x] Missing `mergeCommit` fails closed and cannot fall back to `github.sha`.
- [x] A push whose `github.sha` differs from the resolved PR merge SHA fails closed.
- [x] Proof binding and persistence run only when the lane is closeable.
- [x] Persisted proof remains available after a downstream truth-check failure.
- [x] Concurrent advancement of `main` triggers rebase and retry behavior.
- [x] Implementation SHA authority is preserved; proof does not substitute workflow-run identity.

## EVIDENCE:

```text
$ tsx --test scripts/ops/lane-close.test.ts
1..159
# tests 159
# pass 159
# fail 0
# skipped 0
```

```text
$ tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff
```

```text
Targeted mutation validation
github.sha fallback mutant: KILLED
push identity guard removal mutant: KILLED
single-attempt persistence mutant: KILLED
mutation score: 3/3
```
