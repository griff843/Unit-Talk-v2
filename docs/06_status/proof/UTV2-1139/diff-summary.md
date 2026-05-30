# UTV2-1139 Diff Summary

## Summary

INIT-4.3.2 — Opening-Line Proxy Removal. Removes the opening-line fallback path from CLV computation. When no verified closing source exists, CLV is quarantined (result=null, status=missing_closing_line) rather than fabricated from an unverified opening line.

## Changes

- `apps/api/src/clv-service.ts`: removed `opening_line_proxy` from ClosingSourceType, removed `opening_line_fallback` from CLVComputationStatus, removed `isOpeningLineFallback` from CLVResult, removed opening-line fallback block from computeCLVOutcome, removed `isOpeningFallback` parameter from computeClvFromClosingLine
- `apps/api/src/settlement-service.ts`: removed `opening_line_fallback` from CLV_SKIP_REASON_MAP, replaced isOpeningLineFallback diagnostic with closingSourceType
- `apps/api/src/clv-service.test.ts`: updated opening-line tests to assert quarantine behavior; added adversarial validation test
- `apps/api/src/grading-service.test.ts`: updated settlement test to assert quarantine (CLV null, status=missing_closing_line)
- `apps/api/src/t1-proof-utv2-750-clv.test.ts`: removed opening_line_fallback from computed outcomes filter

## Invariant enforced

No CLV record without a verified closing source. Quarantine is mandatory when no closing line exists.

## Scope

All changes within `apps/api/src/`. No Tier C modifications. No DB schema changes. No domain mutations.

## SHA Binding
merge_sha: ca8d8ad8bc8c8ea9ccca6549d32fea535058d677
pr: https://github.com/griff843/Unit-Talk-v2/pull/935
