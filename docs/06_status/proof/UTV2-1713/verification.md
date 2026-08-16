# PROOF: UTV2-1713

MERGE_SHA: e337226de55adbbafc52389c946bb84e289b51fe

Verified implementation SHA: `a1b84ee1685b2dd7cd20936aa587b0e4a9dbd383`

Pre-merge this anchor identifies the verified implementation commit. Post-merge closeout automation rebinds proof artifacts to the authoritative merge SHA.

## Summary

`linear-auto-close.yml` shared the `merge-closeout-mutex` concurrency group with `post-merge-lane-close.yml`. `cancel-in-progress: false` protects a *running* job, but GitHub retains at most one *pending* run per group, so a run queued behind the mutex is cancelled outright when a newer run enters that group. There is no retry and no replacement run, so the Linear transition is skipped silently.

This lane moves `linear-auto-close` to a per-commit concurrency group. It never writes to the repository — it reads the head commit message and updates Linear — so it does not need to serialize against the closeout writer. `post-merge-lane-close` keeps the shared mutex because it commits to `main`.

## ASSERTIONS:

- [x] `linear-auto-close` does not share a concurrency group with the closeout writer, so a queued run can no longer be cancelled by closeout entering the group.
- [x] `linear-auto-close`'s group is scoped per commit, so two distinct merges never queue behind one another.
- [x] `post-merge-lane-close` retains `merge-closeout-mutex`: it commits to `main` and must stay serialized.
- [x] Both properties are mutation-proven: reverting to the shared mutex, and using a non-per-SHA group, each fail the regression.

## EVIDENCE:

- Eviction mechanism confirmed from run history: Linear Auto-Close run `31900689921` on commit `52b4878b` recorded `conclusion: cancelled` with **zero jobs ever created**, i.e. it was evicted from the concurrency group before execution rather than cancelled mid-run. A `post-merge-lane-close` run for an earlier commit was still executing in the same group when a newer `post-merge-lane-close` entrant arrived; the newer entrant survived and the older-pending Linear Auto-Close entrant was evicted. This matches GitHub's documented one-pending-run-per-group semantics.
- **Correction, established by independent review.** That run is evidence of the eviction mechanism only. It is **not** an instance of a lost Linear transition, and this lane does not claim it is. Replaying the workflow's own extraction function against `52b4878b`'s message returns no issue IDs — `chore(lanes): close UTV2-1690 …` carries no recognized close-intent marker, since `close` is not one of `closes|fixes|resolves` and there is no `Linear-Close:` trailer. The successful run on the authoritative merge SHA `2a6aecac` (run `31900061680`) logged `decision=no_close reason=no_close_intent`, confirming the same. The reason that lane's Linear issue stayed open is therefore a **different, still-open defect** — lane-closeout automation never emits a commit message carrying a recognized close-intent marker, and the `completion_block` additionally requires the manifest `commit_sha` to equal the pushed SHA, which is structurally unreachable when closeout spans multiple commits. That defect is filed separately and is not addressed here.
- This lane therefore hardens a **latent** failure: an eviction that would silently drop a Linear transition for any push that *did* carry a valid marker.
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

- This prevents the eviction. It does not fix the reason lane closeouts currently fail to close their Linear issue at all — no recognized close-intent marker is emitted, and the `commit_sha`-equals-pushed-SHA gate is unreachable across multi-commit closeouts. That is filed separately and is the higher-impact defect.
- No reconciliation sweep is added for lanes whose Linear issue is already open.
- The assertion is static: it verifies the concurrency declaration, not GitHub's runtime scheduling behaviour, which cannot be exercised from a unit test.
