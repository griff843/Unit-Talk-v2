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

### pnpm test:db

```
> tsx --test apps/api/src/database-smoke.test.ts

TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 128943.6129
```

## Merge SHA Binding
**Merge SHA:** pending (auto-bound post-merge)
**PR:** pending
**Merged:** pending
