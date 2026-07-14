# Diff Summary — UTV2-1533 (clean replacement)

**Status: clean, verified, PR open, not merged.**

## Why this branch exists

The PM found that the prior replacement PR (#1215, itself replacing #1213) reported **60 GitHub-visible changed files**, not the intended 20. Root cause: that branch's ancestry -- built with `git branch` from an already-accepted head, then advanced with two `git merge origin/main` passes to keep the R-level check's diff stable -- had accumulated individual commits from unrelated, already-shipped lanes (UTV2-1396, UTV2-1484, UTV2-1485, UTV2-1532) as ancestors. Each of those commits surfaced its own files in the PR-vs-main comparison and its own native issue-ID text in commit messages, which was also why Branch Discipline Guard could not be made to pass without rewriting protected accepted history.

Per PM directive, exact commit-history preservation is no longer required. This branch, `claude/utv2-1533-concurrency-ramp-clean`, was created directly from `origin/main` (`git worktree add -b claude/utv2-1533-concurrency-ramp-clean origin/main`) -- no merge, no cherry-picked merge commit, no ancestry relationship to either superseded PR.

## Clean-ancestry proof

The 14 intended implementation paths were checked against a pre-UTV2-1533 main baseline (`9e630fe9`, main's tip immediately before UTV2-1533's first commit) and origin/main's tip at branch-creation time (`40782f85`):

```
$ git diff --stat 9e630fe9188f6ef0722c862ebde2ee71a797f80e 40782f85aa439e2f5c02707f8f447298f734d90a -- \
    docs/governance/CONCURRENCY_CONFIG.json docs/governance/LANE_CONCURRENCY_POLICY.md \
    scripts/ops/concurrency-config.ts scripts/ops/concurrency-simulation.test.ts \
    scripts/ops/shared.ts scripts/ops/shared.test.ts \
    scripts/ops/lane-start.ts scripts/ops/lane-start.test.ts \
    scripts/ops/lane-maximizer.ts scripts/ops/lane-maximizer.test.ts \
    scripts/codex-dispatch.ts scripts/codex-dispatch.test.ts \
    docs/05_operations/LANE_MANIFEST_SPEC.md docs/05_operations/schemas/lane_manifest_v1.schema.json

(no output)
```

origin/main never independently touched any of the 14 intended paths while UTV2-1533 was in progress -- the carried content is byte-identical to the accepted implementation, confirmed by an identical `--stat` shape before and after the copy:

```
14 files changed, 1044 insertions(+), 45 deletions(-)
```

## Mid-session rebase

Between opening this PR and finalizing the proof bundle, `origin/main` advanced further (UTV2-1499, "Runtime Operations Governance Chapter"). Per PM directive ("rebase onto main before opening or updating the PR when necessary, do not merge main into the clean branch"), the branch was rebased onto the new `origin/main` tip:

```
$ git rebase origin/main
Successfully rebased and updated refs/heads/claude/utv2-1533-concurrency-ramp-clean.
```

Zero conflicts -- UTV2-1499 touched `.ops/sync/UTV2-1499.yml`, `docs/05_operations/RUNTIME_OPERATIONS_GOVERNANCE.md`, `docs/06_status/lanes/UTV2-1499.json`, `docs/06_status/proof/UTV2-1499/*`, none of which overlap the 14 intended paths. Re-verified post-rebase: `git diff --name-only origin/main..HEAD` returns exactly the 14 intended paths, no more, no fewer.

## Commit structure

Two substantive commits, no merge commits:

1. `UTV2-1533: raise concurrency ceiling to 10 active lanes with mechanical type caps` -- the 14 carried implementation files, as-is from the accepted state.
2. `UTV2-1533: lane-maximizer never guesses verification_target from issue_id` -- the new lane-maximizer P2 fix (real code + 8 new tests), fixing the review finding the superseded PR had left deferred.

Plus a third, control-plane commit (this bundle + lane manifest + sync file).

No commit subject, commit body, PR title, or PR body anywhere in this branch's history references any UTV2-### or UNI-### issue ID other than UTV2-1533. The two superseded PRs are cited only by their GitHub PR numbers (#1213, #1215), which do not match the `UTV2-\d+`/`UNI-\d+` patterns Branch Discipline Guard scans for.

## Files changed (GitHub-verified)

To be populated with the real `gh pr diff --name-only` / `gh pr view --json changedFiles` output once the control-plane commit is pushed -- see the return packet for the final captured count and list.

## Lane-maximizer P2 fix

See `evidence.json`'s `lane_maximizer_p2_fix` block for the full before/after and test list. Summary: `--verification-target` is never guessed from `candidate.issue_id` anymore -- an explicit, validated, conflict-checked target is required for any `lane_type:"verification"` candidate before it can be recommended.
