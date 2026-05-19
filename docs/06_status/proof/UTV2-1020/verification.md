# UTV2-1020 Verification

Issue: UTV2-1020
PR: https://github.com/griff843/Unit-Talk-v2/pull/773
Branch: claude/utv2-1020-truth-check-r1-r3
Implementation commit: 77c18104

## Verification

Pre-merge verification completed in worktree `.out/worktrees/claude__utv2-1020-truth-check-r1-r3`.

## Summary

Fix: R1/R2/R3 runtime checks in `scripts/ops/truth-check-lib.ts` were permanently skipped for all T1 lanes because `require_phase_contracts` was never set in any `LaneManifest` (field didn't exist in the TypeScript type, always evaluated to `false`).

Replaced the dead `requirePhaseContracts` parameter with `evidence: { bundle: EvidenceBundleV1 } | null`. R1/R2/R3 now run unconditionally for T1 — real checks against the evidence bundle instead of always-skip guards.

## Evidence

```text
> pnpm type-check
(exit 0, no errors)

> pnpm test 2>&1 | grep -E "^# (tests|pass|fail)"
# fail 0
# skipped 0
# tests 9
# pass 9
# fail 0
# skipped 0
# tests 410
# pass 410
# fail 0
# skipped 0

New test cases in scripts/ops/truth-check-lib.test.ts:
ok 351 - R1 R2 R3 skip for non-T1 tier
ok 352 - R1 R2 R3 fail for T1 when --no-runtime is set
ok 353 - R1 R2 R3 fail for T1 when evidence bundle is null
ok 354 - R1 R2 R3 pass for T1 with valid evidence bundle
ok 355 - R1 fails for T1 when queries empty, R2 fails when row_counts empty, R3 fails when verifier identity missing

> pnpm verify
(exit 0 — all stages pass)
```

Root cause confirmation:
```text
grep -n "require_phase_contracts" scripts/ops/truth-check-lib.ts
# Before fix: line 581: Boolean((manifest as LaneManifest & { require_phase_contracts?: boolean }).require_phase_contracts)
# Field not in LaneManifest interface → always false → R1/R2/R3 always skip
```
