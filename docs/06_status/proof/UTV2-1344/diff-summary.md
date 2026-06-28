# UTV2-1344 Diff Summary

Generated at: 2026-06-28T01:55:00.000Z
Issue: UTV2-1344
Tier: T2
Lane type: governance
Branch: codex/utv2-1344-m5-staleness-alert
PR URL: TBD
Head SHA: TBD
Merge SHA: TBD

## Git Diff Stat (vs main)

```
.github/workflows/grading-staleness-check.yml |  40 +++++++++
 scripts/grading-alert-check.ts               | 152 +++++++++++++++++++++++++++
 docs/06_status/proof/UTV2-1344/verification.md |  47 ++++++++++
 docs/06_status/proof/UTV2-1344/diff-summary.md |  35 ++++++++
 4 files changed, 274 insertions(+)
```

## Files Changed

| File | Change |
|------|--------|
| `.github/workflows/grading-staleness-check.yml` | NEW — GHA workflow: daily 6am UTC cron, checks grading staleness via script |
| `scripts/grading-alert-check.ts` | NEW — alert script: queries `system_runs` for `grading.run` rows in last 24h |
| `docs/06_status/proof/UTV2-1344/verification.md` | NEW — verification log |
| `docs/06_status/proof/UTV2-1344/diff-summary.md` | NEW — this file |

## SHA Binding

Head SHA: TBD
Merge SHA: TBD (auto-bound by post-merge-lane-close.yml)
