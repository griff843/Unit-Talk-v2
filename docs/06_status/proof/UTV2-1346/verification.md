# UTV2-1346 Verification Log

## Issue
Smart-form capper attribution fix — `metadata.capper` not propagated from `payload.submittedBy` in submission-service.

## Root Cause
`processSubmission` and `processShadowSubmission` in `apps/api/src/submission-service.ts` built `enrichedPick.metadata` without including `capper: payload.submittedBy`. The smart-form already sent `submittedBy` via `buildSubmissionPayload` (form-utils.ts:306), and the API contract already accepted it (`SubmissionPayload.submittedBy`). The CLV trust adjustment in `clv-feedback.ts` reads `metadata.capper` to attribute picks — with it missing, trust scoring could not identify the submitter.

## Fix
Added `...(payload.submittedBy ? { capper: payload.submittedBy } : {})` to the metadata spread in both:
- `processSubmission` (line ~332) — primary submission path
- `processShadowSubmission` (line ~539) — shadow submission path

No contract changes needed. No schema changes. No migration.

## Verification Steps

### pnpm type-check
PASS — TypeScript build clean, no new errors.

### pnpm lint
PASS

### pnpm build
PASS

### pnpm test (unit tests)
```
# tests 73
# pass 73
# fail 0
# duration_ms 1013.972528
```
All 73 submission-service unit tests pass. Change is tested end-to-end through existing capper-metadata assertions.

### R-level check
```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

### database-smoke.test.ts failures
2 pre-existing failures in `database-smoke.test.ts` due to Supabase `statement_timeout` on settlement list — confirmed pre-existing (same errors present on main, unrelated to this change). These tests exercise CLV/settlement paths in live Supabase, not the metadata field being fixed here.

## Merge SHA Binding
**Merge SHA:** pending (auto-bound post-merge)
**PR:** pending
**Merged:** pending
