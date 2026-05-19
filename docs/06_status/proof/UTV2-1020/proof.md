# PROOF: UTV2-1020
MERGE_SHA: 100b0b3d5cb6fcc52a2a1b595a7eb18ae64eab68

ASSERTIONS:
- [x] R1/R2/R3 checks no longer unconditionally skip for T1 lanes
- [x] R1 verifies runtime_proof.queries is non-empty in the evidence bundle
- [x] R2 verifies runtime_proof.row_counts is non-empty in the evidence bundle
- [x] R3 verifies verifier.identity is set in the evidence bundle
- [x] All 410 tests pass with 0 failures after the fix
- [x] pnpm verify exits 0 (type-check, lint, build, test all pass)

EVIDENCE:
```text
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

New test cases added (truth-check-lib.test.ts):
ok 351 - R1 R2 R3 skip for non-T1 tier
ok 352 - R1 R2 R3 fail for T1 when --no-runtime is set
ok 353 - R1 R2 R3 fail for T1 when evidence bundle is null
ok 354 - R1 R2 R3 pass for T1 with valid evidence bundle
ok 355 - R1 fails for T1 when queries empty, R2 fails when row_counts empty, R3 fails when verifier identity missing

> pnpm type-check
(exit 0, no errors)

> pnpm lint
(exit 0, no errors)

Root cause confirmed: require_phase_contracts was never set in any LaneManifest.
Field accessed via unsafe cast: Boolean((manifest as LaneManifest & { require_phase_contracts?: boolean }).require_phase_contracts)
Always evaluated to false, causing all 3 checks to skip for every T1 lane.

Fix: replaced requirePhaseContracts parameter with evidence: { bundle: EvidenceBundleV1 } | null.
R1/R2/R3 now run unconditionally for T1 — fail when evidence is null, pass/fail based on bundle contents.
```
