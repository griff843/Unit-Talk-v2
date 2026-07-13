# UTV2-1518 Runtime Verification

Generated at: 2026-07-13T12:21:26.665Z
Issue: UTV2-1518
Tier: T2
Lane type: governance
Branch: claude/utv2-1518-scope-guard-canonical-paths-reopen
PR URL: N/A
Head SHA: 683f1a1b0de96b2b29345b6ce65f1ff5dfe42915
Merge SHA: N/A
result: not_run

## Verification
- [x] `pnpm type-check`: PASS (0 errors)
- [x] `pnpm test`: PASS (19/19, 0 failures, full repo suite)
- [x] `npx tsx --test scripts/ci/file-scope-guard.test.ts`: PASS (30/30, includes 2 new regression tests reproducing the exact UTV2-1428 two-commit failure)
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS — no R-level artifacts required for this diff

## Runtime Verification

Not applicable — this is a T2 CI-tooling-correctness change (file-scope-guard logic only, no runtime/DB surface). No `pnpm test:db` run is required or claimed for this tier.

## Regression proof (sanity check that the new tests actually catch the bug)

Temporarily reverted `scripts/ci/file-scope-guard.ts` (kept the new tests) and re-ran `npx tsx --test scripts/ci/file-scope-guard.test.ts`:
```
not ok 12 - own lane proof directory (UTV2-1518 reopened): a fresh multi-commit lane whose SECOND commit adds proof files still passes without needing them in expected_proof_paths
not ok 13 - own lane proof directory (UTV2-1518 reopened): files outside the proof directory still require file_scope_lock/expected_proof_paths declaration
```
Both tests fail without the fix and pass with it restored — confirms the regression tests are meaningful, not tautological.

## SHA Binding
Head SHA: 683f1a1b0de96b2b29345b6ce65f1ff5dfe42915
Merge SHA: N/A
