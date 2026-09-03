# UTV2-1829 Diff Summary

Generated at: 2026-09-03T19:47:57.000Z
Issue: UTV2-1829
Tier: T2
Lane type: governance
Branch: claude/utv2-1829-mission-context
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1499
Head SHA: 31d09de7150791a81fc57e4e0f40d0149a185c85
Merge SHA: N/A
Diff base: abcedd96414123dd6dc19a81e615a548dec67f98
Diff target: 31d09de7150791a81fc57e4e0f40d0149a185c85

## Git Diff Stat

Measured at the anchor commit `31d09de7150791a81fc57e4e0f40d0149a185c85` — the last non-proof commit
on this branch, and the `verified_source_sha` this bundle binds to. That commit is the sanctioned
`ops:merge-wrapper git-merge-main` sync onto `main` at `abcedd964`, so the base below is current
`main` and the stat contains no UTV2-1823 path: 1823 is now on both sides of the diff.

The proof commit that carries this file sits on top of that anchor, so the three
`docs/06_status/proof/UTV2-1829/*` line counts below are the anchor's values and do not include the
proof commit's own edits. A stat cannot state its own final size; naming the commit it was taken at
is the honest form.

```
  .lane/lanes/governance.yml                     |   7 +
  .ops/sync/UTV2-1829.yml                        | 200 +++++++++++
  AGENTS.md                                      |  18 +
  CLAUDE.md                                      |  28 +-
  docs/06_status/lanes/UTV2-1829.json            |  39 +++
  docs/06_status/proof/UTV2-1829/diff-summary.md |  58 ++++
  docs/06_status/proof/UTV2-1829/evidence.json   | 138 ++++++++
  docs/06_status/proof/UTV2-1829/verification.md | 285 ++++++++++++++++
  docs/mission/intent.md                         | 190 +++++++++++
  docs/mission/plan.md                           | 449 +++++++++++++++++++++++++
  docs/mission/spec.md                           | 152 +++++++++
  11 files changed, 1560 insertions(+), 4 deletions(-)
```

## Git Name Status
```
M	.lane/lanes/governance.yml
A	.ops/sync/UTV2-1829.yml
M	AGENTS.md
M	CLAUDE.md
A	docs/06_status/lanes/UTV2-1829.json
A	docs/06_status/proof/UTV2-1829/diff-summary.md
A	docs/06_status/proof/UTV2-1829/evidence.json
A	docs/06_status/proof/UTV2-1829/verification.md
A	docs/mission/intent.md
A	docs/mission/plan.md
A	docs/mission/spec.md
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: bc87a718701ef11a798511e0857a4aa29ed29076
Merge SHA: N/A
