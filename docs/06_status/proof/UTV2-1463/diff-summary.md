# UTV2-1463 Diff Summary

Issue: UTV2-1463
Tier: T2
Branch: codex/utv2-1463-closeout-concurrency-hardening

## Summary

- Hardened `.github/workflows/post-merge-lane-close.yml` with a 30 minute job timeout so a hung post-merge closeout cannot hold the shared `merge-closeout-mutex` indefinitely.
- Added failure-only merge mutex cleanup after `ops:lane-close --repair-merged` fails. The cleanup reads the lane manifest branch and calls `pnpm ops:merge-lock release --issue "$ISSUE_ID" --branch "$manifest_branch"` without `--force`, so it only releases the same issue/branch lock and does not mask the failing closeout.
- Kept the existing red failure path intact: the workflow still posts the failure comment when a PR is known, then re-raises the lane-close exit code.
- Added a rebase-and-retry loop (3 attempts) around the bookkeeping `git push`. When another PR merges mid-closeout, main advances and the bare push was rejected non-fast-forward, failing the closeout and stranding the lane in `merged` state — the primary observed cause of manual SHA-repair commits.

## Files Changed

- `.github/workflows/post-merge-lane-close.yml` — bounded the closeout job runtime and added scoped merge-mutex release on failed lane closeout.
- `docs/06_status/proof/UTV2-1463/diff-summary.md` — this proof summary.
- `docs/06_status/proof/UTV2-1463/verification.md` — verification log and blocker detail.

## R-Level

`docs/05_operations/r1-r5-rules.json` was checked. The changed workflow/proof paths do not match any R1-R5 runtime rule, so no R-level artifacts are required.
