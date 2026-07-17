# UTV2-1551 Diff Summary

Issue: UTV2-1551
Tier: T1
Lane type: governance
Branch: `claude/utv2-1551-merge-gate-opened-trigger-bot-token`

## Changes (part 1 of 2 — see note below)

- `.github/workflows/tier-label-check.yml` — the tier-label sync step now
  uses `secrets.SYNC_BOT_TOKEN || secrets.GITHUB_TOKEN` instead of the
  implicit default `GITHUB_TOKEN`. Labels added via `GITHUB_TOKEN` don't
  cascade to trigger other workflows' `labeled` events (documented GitHub
  Actions behavior), so a fresh PR's tier-label sync could never fire
  Merge Gate's own `pull_request: labeled` trigger. `SYNC_BOT_TOKEN` is an
  existing PAT already used for this exact class of problem in
  `post-merge-lane-close.yml`.
- `scripts/ops/workflow-hardening.test.ts` — regression test asserting the
  sync step's `github-token` input.

## Part 2 (deferred to a follow-up commit on this same branch)

The other half of the root cause — `merge-gate.yml`'s `pull_request` trigger
omitting `opened`, so a brand-new PR gets zero Merge Gate evaluation from
that event either — could not be implemented in this same commit: the
active UTV2-1543 lane holds `.github/workflows/merge-gate.yml` in its file
scope lock (it is mid-flight, PR #1246, itself touching Merge Gate). Adding
`opened` will land as a small follow-up once #1246 merges, avoiding a file-
scope collision between two concurrent governance lanes on the same
singleton path.

## Explicitly not changed

- The "Comment on blocked tier state" step keeps the default `GITHUB_TOKEN`
  — posting a comment doesn't need to cascade anything.
- No branch-protection or repository ruleset setting.
