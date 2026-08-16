# PROOF: UTV2-1713

MERGE_SHA: N/A

Pre-merge this anchor is `N/A`. Post-merge closeout automation rebinds proof artifacts to the authoritative merge SHA.

## Summary

`linear-auto-close.yml` shared the `merge-closeout-mutex` concurrency group with `post-merge-lane-close.yml`. `cancel-in-progress: false` protects a *running* job, but GitHub retains at most one *pending* run per group, so a run queued behind the mutex is cancelled outright when a newer run enters that group. There is no retry and no replacement run, so the Linear transition is skipped silently.

This lane moves `linear-auto-close` to a per-commit concurrency group. It never writes to the repository — it reads the head commit message and updates Linear — so it does not need to serialize against the closeout writer. `post-merge-lane-close` keeps the shared mutex because it commits to `main`.

## ASSERTIONS:

- [x] `linear-auto-close` does not share a concurrency group with the closeout writer, so a queued run can no longer be cancelled by closeout entering the group.
- [x] `linear-auto-close`'s group is scoped per commit, so two distinct merges never queue behind one another.
- [x] `post-merge-lane-close` retains `merge-closeout-mutex`: it commits to `main` and must stay serialized.
- [x] Both properties are mutation-proven: reverting to the shared mutex, and using a non-per-SHA group, each fail the regression.

## EVIDENCE:

- Confirmed reproduction: Linear Auto-Close run `31900689921` on merge commit `52b4878b` (UTV2-1690 closeout) was **cancelled** while queued behind `post-merge-lane-close`. No replacement run exists for that SHA. The lane manifest reached `status: done` with a passing truth-check bound to merge SHA `2a6aecac`, and its lease and merge lock were released, while the Linear issue stayed `In Codex` until a human moved it.
- Scope boundary confirmed by measurement, not assumption: `ci.yml` uses `cancel-in-progress: true` on a per-PR group and **self-heals**. On PR #1424, run `31914709490` was cancelled with a failing `verify` on `e4cc594b`, and the authoritative replacement run `31914728317` produced a successful `verify` on `c8feb6e3`. The required context converged with no manual rerun, so `ci.yml` is explicitly **not** changed by this lane.
- A regression in `scripts/ops/workflow-hardening.test.ts` asserts the closeout writer keeps the shared mutex, that `linear-auto-close` does not share it, and that its group interpolates `github.sha`.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts` | PASS | 65 tests passed, 0 failed, 0 skipped. |
| `pnpm type-check` | PASS | Completed as part of `pnpm verify:static` with exit 0. |
| `pnpm test` | PASS | Root aggregate completed as part of `pnpm verify:static` with exit 0. |
| `scripts/ci/r-level-check.ts` | PASS | No R-level artifacts triggered by this change. |
| Mutation battery | PASS | 2 of 2 mutations killed. |

Focused TAP summary:

```text
# tests 65
# pass 65
# fail 0
# skipped 0
```

### Mutation battery

| # | Mutation | Result |
|---|---|---|
| M1 | Revert `linear-auto-close` to `group: merge-closeout-mutex` | killed |
| M2 | Use a static `group: linear-auto-close` instead of a per-SHA group | killed |

### Scope and R-level disposition

The change is confined to one workflow's concurrency declaration and one regression test. No runtime, domain, DB, migration, contract, or generated type is touched, and no production row is read or written. `ci.yml`, `post-merge-lane-close.yml`'s own gating, and lane-type policy are explicitly out of scope and unmodified.

### Known limitations

- This prevents the cancellation. It does not add a reconciliation sweep for lanes whose Linear issue was *already* left open by a historical cancellation; those remain to be reconciled separately.
- The assertion is static: it verifies the concurrency declaration, not GitHub's runtime scheduling behaviour, which cannot be exercised from a unit test.
