# UTV2-1376 Diff Summary

## Summary

- Hardened `scripts/ops/runtime-verifier-gate.ts` SHA binding check: proof files that contain NO SHA at all now fail the gate. The exact branch HEAD SHA check remains advisory (warning only) due to the inherent circular dependency — a commit SHA cannot be embedded in the proof file before the commit is made. Post-merge merge SHA binding is enforced by `ops:truth-check` P3/C4.
- No migrations, contracts, domain logic, runtime delivery code, or generated DB types were changed.

## Files Changed

- `scripts/ops/runtime-verifier-gate.ts` - restored the branch-HEAD SHA check as a warning (not failure) with the design rationale comment; added a new hard failure when the proof contains no 40-char hex SHA at all.
- `docs/06_status/proof/UTV2-1376/diff-summary.md` - records this implementation summary.
- `docs/06_status/proof/UTV2-1376/verification.md` - records verification evidence for the lane.

## Scope

The implementation change is limited to the allowed ops gate script scope. The proof markdown files are included because the lane packet and manifest require them as closeout artifacts.

## Merge SHA

Merged to main: `308470064c61187e3c910e31d89dd5f2d0731bdb`
