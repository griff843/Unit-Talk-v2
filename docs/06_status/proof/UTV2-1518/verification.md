# UTV2-1518 Verification

Generated at: 2026-07-10T16:09:59Z
Issue: UTV2-1518
Tier: T2
Lane type: governance
Branch: codex/utv2-1518-file-scope-guard-proof-exemption
Head SHA: pending final head

## Verification
- [x] `npx tsx --test scripts/ci/file-scope-guard.test.ts`: PASS (15/15)
- [x] `pnpm type-check`: PASS
- [x] `pnpm test`: PASS
- [x] `pnpm verify`: PASS, including `pnpm test:db` and `pnpm test:t1-proof:live`
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS

## Issue-Specific Verification
- Added regression test: `trusted resolution: a well-formed scope_override on another lane manifest is ignored`.
- Verified the existing documented override path still works for the PR branch's own lane manifest.
- Verified malformed overrides remain ignored.

## Notes
- Live DB proof emitted existing stranded-pick diagnostics during `pnpm verify`; assertions still passed and no remediation was performed in this lane.
- `findExistingCombinations` live proof skipped its window-content assertion because provider offer history is stale; the skip is emitted by existing test logic and did not fail the gate.

## SHA Binding
Head SHA: pending final head
Merge SHA: pending
