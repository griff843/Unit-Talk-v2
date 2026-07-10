# UTV2-1454 Runtime Verification

Generated at: 2026-07-10T13:12:22.524Z
Issue: UTV2-1454
Tier: T2
Lane type: governance
Branch: codex/utv2-1454-t3-fast-path-docs-only-lanes
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1181
Head SHA: 2ebb1befb3bb06a734e1fb112fab827536a3b5e4
Merge SHA: ee7ae08c401fc29fb8318021c6a01451790b102e
result: not_run

## Verification
- [x] `pnpm type-check`: PASS (part of full `pnpm verify` run on final head 14337c8d)
- [x] `pnpm test`: PASS (part of full `pnpm verify` run, includes 18/18 lane-start.test.ts overlap-recheck tests)
- [x] `pnpm verify`: PASS on final head 14337c8d (CI run 29094632253, exit 0)
- [x] `scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS

## Runtime Verification
- `pnpm test:db`: PASS (7/7) against live Supabase (zfzdnfwdarxucxtaojxm), embedded as Proof Auditor Gate evidence.

## SHA Binding
Head SHA: 2ebb1befb3bb06a734e1fb112fab827536a3b5e4
Merge SHA: ee7ae08c401fc29fb8318021c6a01451790b102e
