# UTV2-1345 Verification Log

**Issue:** UTV2-1345 — M3 error detail follow-up
**Lane:** claude/utv2-1345-m3-error-detail-follow-up
**Tier:** T3
**Date:** 2026-06-28

## Verification

| Command | Status |
|---------|--------|
| `pnpm type-check` | PASS |
| `pnpm test` | PASS |
| `pnpm verify` | PASS |
| `pnpm test:db` | PASS |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS |

R-level output:
```text
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

## Change

**File:** `apps/api/src/grading-service.ts`

**Root cause (from UTV2-1343):** `system_runs.details` for failed grading runs only recorded aggregate counts (`{ picksGraded, failed }`). The per-pick error reasons (`pickId`, `reason`) were captured in the in-memory `details` array but never written to the run record, making it impossible to diagnose which picks failed and why from `system_runs` alone.

**Fix:** Extract error entries from the `details` array and include them in `completeRun.details` when `errorCount > 0`:

```typescript
const errorDetails = details
  .filter((d) => d.outcome === 'error')
  .map((d) => ({ pickId: d.pickId, reason: d.reason }));

await repositories.runs.completeRun({
  runId: runRecord.id,
  status: errorCount > 0 ? 'failed' : 'succeeded',
  details: {
    picksGraded: gradedCount,
    failed: errorCount,
    ...(errorCount > 0 ? { errors: errorDetails } : {}),
  },
});
```

**Effect:** Failed grading run records in `system_runs` now contain `details.errors = [{ pickId, reason }, ...]`, enabling operators to identify exactly which picks errored and the error message without reading application logs.

## pnpm test:db Output

```text
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

**Merge SHA:** pending (auto-bound post-merge)
