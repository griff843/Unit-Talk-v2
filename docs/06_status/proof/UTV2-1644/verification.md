# PROOF: UTV2-1644 — remove stray UTV2-1641 files pushed directly to main

MERGE_SHA: 3bde0a6a

## Summary

Commit `6afd7fb6` was pushed directly to `main` from a shared root checkout by a
concurrent agent, bypassing PR/CI (informational "bypassed rule violations" warning,
not a hard rejection). Reported by that agent, verified independently against
`origin/main` before acting.

The commit's primary content — reconciling ghost lane UTV2-1553
(`docs/06_status/lanes/UTV2-1553.json`, binding `commit_sha`/`pr_url` from PR #1322
and releasing a stale lock, via a real `ops:reconcile` run recording an honest
`verdict: "fail"`, not a fabricated pass) — is legitimate, correctly produced, and
untouched by this lane. Verified: `git diff HEAD -- docs/06_status/lanes/UTV2-1553.json`
is empty in this worktree.

It also swept in two stray files from a different concurrent lane's shared-checkout
state: `.ops/sync/UTV2-1641.yml` and `docs/06_status/lanes/UTV2-1641.json` — an early
snapshot from UTV2-1641's own `lane-start` scaffold (narrow `file_scope_lock`:
`["scripts/ops/proof-generate.ts"]`). UTV2-1641's real work is in open PR #1351,
whose branch has since widened `file_scope_lock` to 15 entries on the same file.

## Verification of the conflict this fixes

Compared both versions of `docs/06_status/lanes/UTV2-1641.json` directly:

- `origin/main` (this stray commit): `file_scope_lock: ["scripts/ops/proof-generate.ts"]`
- PR #1351 branch (`claude/utv2-1641-1642-proof-lifecycle-fixes`): `file_scope_lock`
  with 15 entries including the actual implementation and test files

Same `started_at`/`heartbeat_at` timestamp on both (`2026-08-01T04:02:13.155Z`),
confirming both trace to the same original scaffold commit that diverged after main
got the stray, unwidened copy directly. Left as-is, PR #1351's merge/rebase would see
this file as "added independently on both sides with different content" — a genuine
conflict.

## Fix

`git rm .ops/sync/UTV2-1641.yml docs/06_status/lanes/UTV2-1641.json` — nothing else
touched. Once `main` no longer has these two paths, PR #1351 adds them fresh with no
conflict.

## ASSERTIONS:

- [x] Exactly two files removed: `.ops/sync/UTV2-1641.yml`, `docs/06_status/lanes/UTV2-1641.json`.
- [x] `docs/06_status/lanes/UTV2-1553.json` is byte-identical to its state on `main` — confirmed via empty diff.
- [x] No other file touched.

## EVIDENCE:

```
$ git status --porcelain
D  .ops/sync/UTV2-1641.yml
D  docs/06_status/lanes/UTV2-1641.json

$ git diff HEAD -- docs/06_status/lanes/UTV2-1553.json
(empty)
```
