# UTV2-1829 Diff Summary

Generated at: 2026-09-04T00:15:50.000Z
Issue: UTV2-1829
Tier: T2
Lane type: governance
Branch: claude/utv2-1829-mission-context
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1499
Head SHA: cb5a69668a135440d16dbe9212325a66e1b9b2a3
Merge SHA: N/A
Diff base: 987354fc86c745eb3080bcaac812a79b08fd100e
Diff target: cb5a69668a135440d16dbe9212325a66e1b9b2a3

## Git Diff Stat

Measured at the anchor commit `cb5a69668a135440d16dbe9212325a66e1b9b2a3` — the last non-proof commit
on this branch, and the `verified_source_sha` this bundle binds to. That commit is the second
sanctioned `ops:merge-wrapper git-merge-main` sync, onto `main` at `987354fc8`. Two syncs were
needed because `main` advanced twice during review; neither changed any file this lane owns
(assertion A15), so the base below is current `main` and the stat carries no imported path.

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
  docs/06_status/proof/UTV2-1829/diff-summary.md |  61 ++++
  docs/06_status/proof/UTV2-1829/evidence.json   | 145 ++++++++
  docs/06_status/proof/UTV2-1829/verification.md | 293 ++++++++++++++++
  docs/mission/intent.md                         | 190 +++++++++++
  docs/mission/plan.md                           | 449 +++++++++++++++++++++++++
  docs/mission/spec.md                           | 152 +++++++++
  11 files changed, 1578 insertions(+), 4 deletions(-)
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
