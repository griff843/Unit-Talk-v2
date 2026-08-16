# DIFF SUMMARY: UTV2-1713

MERGE_SHA: N/A

## Files changed

| File | Change |
|---|---|
| `.github/workflows/linear-auto-close.yml` | Concurrency group moved off the shared `merge-closeout-mutex` to a per-commit group, with the failure mechanism recorded inline. |
| `scripts/ops/workflow-hardening.test.ts` | Adds the regression asserting the group separation and per-SHA scoping. |
| `docs/06_status/proof/UTV2-1713/verification.md` | Proof bundle. |
| `docs/06_status/proof/UTV2-1713/diff-summary.md` | This file. |

## Behaviour change

Before: a `linear-auto-close` run queued behind `post-merge-lane-close` on the shared `merge-closeout-mutex` was cancelled when another run entered that group. No retry, no replacement run, and the Linear transition was skipped with no signal.

After: `linear-auto-close` runs in `linear-auto-close-${{ github.sha }}`. It cannot be cancelled by closeout entering the mutex, and distinct merges never queue behind one another. Repeated runs for the same commit still de-duplicate, which is the only serialization this workflow needs — it reads the head commit message and updates Linear, and never writes to the repository.

`post-merge-lane-close.yml` is unchanged and retains `merge-closeout-mutex`, because it commits to `main` and must stay serialized.

## Not changed

- `ci.yml` concurrency. Measured on PR #1424: a cancelled run's failing `verify` is superseded by the authoritative replacement run's successful `verify` on the new head, so that path already converges without intervention.
- `post-merge-lane-close.yml` gating.
- Lane-type or lane-authority policy.
