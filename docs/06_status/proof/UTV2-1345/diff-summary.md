# UTV2-1345 Diff Summary

**Issue:** UTV2-1345 — M3 error detail follow-up
**Tier:** T3
**Branch:** claude/utv2-1345-m3-error-detail-follow-up
**Merge SHA:** 34ba29fae23c8cb5984b9c7c9afdf8142201cbd3
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1099
**Merged:** 2026-06-28

## Git Diff Stat (vs main)

```
apps/api/src/grading-service.ts            |  9 ++++++++-
docs/06_status/proof/UTV2-1345/verification.md | 55 ++++++++++++++++++++
docs/06_status/proof/UTV2-1345/diff-summary.md | 32 ++++++++++++
3 files changed, 96 insertions(+), 1 deletion(-)
```

## Files Changed

| File | Change |
|------|--------|
| `apps/api/src/grading-service.ts` | MOD — include per-pick error details in `system_runs.details` on grading failure |
| `docs/06_status/proof/UTV2-1345/verification.md` | NEW — verification log |
| `docs/06_status/proof/UTV2-1345/diff-summary.md` | NEW — this file |

## Merge Order

No dependencies on any other open lane. Can merge independently.
