# PROOF: UTV2-1020
Implementation SHA: 77c18104

## Summary

R1/R2/R3 runtime checks in `truth-check-lib.ts` were permanently bypassed for all T1 lanes. The `require_phase_contracts` guard (always false) was replaced with real evidence bundle checks. R1/R2/R3 now run unconditionally for T1.

## Assertions

- [x] R1/R2/R3 checks no longer unconditionally skip for T1 lanes
- [x] R1 verifies `runtime_proof.queries` is non-empty in the evidence bundle
- [x] R2 verifies `runtime_proof.row_counts` is non-empty in the evidence bundle
- [x] R3 verifies `verifier.identity` is set in the evidence bundle
- [x] All 410 tests pass with 0 failures after the fix
- [x] `pnpm verify` exits 0

## Evidence

```text
pnpm test — 410 tests, 0 failures
pnpm type-check — exit 0
pnpm lint — exit 0

New tests (ok 351-355):
ok 351 - R1 R2 R3 skip for non-T1 tier
ok 352 - R1 R2 R3 fail for T1 when --no-runtime is set
ok 353 - R1 R2 R3 fail for T1 when evidence bundle is null
ok 354 - R1 R2 R3 pass for T1 with valid evidence bundle
ok 355 - R1 fails for T1 when queries empty, R2 fails when row_counts empty, R3 fails when verifier identity missing
```

## Verification

See `verification.md` for full verification log. Implementation commit: `77c18104`.
