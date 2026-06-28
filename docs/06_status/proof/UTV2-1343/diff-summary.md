# UTV2-1343 Diff Summary

**Issue:** UTV2-1343 — M3 grading investigation  
**Tier:** T2  
**Branch:** claude/utv2-1343-m3-grading-investigation

## Files Changed

| File | Change | Notes |
|------|--------|-------|
| `docs/06_status/proof/UTV2-1343/grading-investigation.md` | CREATED | Full M3 grading failure investigation report |
| `docs/06_status/proof/UTV2-1343/diff-summary.md` | CREATED | This file |
| `docs/06_status/proof/UTV2-1343/verification.md` | CREATED | Verification log |

## Summary of Changes

Investigation-only lane. No code changes.

Investigated the 34.8% grading run failure rate (32/92 runs) observed today vs 1.46% historical baseline.

**Key findings:**
1. Grading heartbeat (cron.heartbeat): 69/69 PASS — scheduler is healthy
2. Failed runs all show `{failed:1, picksGraded:0}` — one pick throws an exception per run
3. The actual exception is NOT stored in `system_runs.details` — only the count. Error text goes to Hetzner server stdout only.
4. A separate `closing_for_clv_snapshot_write_failed` constraint violation fires 10x/24h but is handled gracefully and does NOT cause grading failures.
5. Root cause (specific exception + pick) requires server-side log access OR deploying a logging fix.

**Recommended follow-up:** Add `errorDetails` to `system_runs.details` in `grading-service.ts` (T3 lane). After deploy, the next failed grading run will reveal the actual exception without needing Hetzner log access.

## Milestone Impact

- **Milestone:** M3 — Grading Runtime Proof
- **Verdict before:** PARTIAL (heartbeat active, failure rate elevated)
- **Verdict after:** PARTIAL — investigation completed; root cause partially diagnosed; structural fix recommended
- **Criterion addressed:** Criterion 3 (zero-graded run investigation) — investigation is now documented
- **Remaining gaps:** Criteria 2 (failure rate must return to ≤5%), 3 (root cause must be fixed/attributed), 4 (no consecutive zero-graded failures without explanation)
