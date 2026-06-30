# UTV2-1376 Diff Summary

## Summary

- Hardened `scripts/ops/runtime-verifier-gate.ts` so a provided `--sha` that is absent from a runtime proof file fails the gate.
- Left `scripts/ops/proof-auditor-gate.ts` unchanged because its existing test contract treats missing proof SHA as advisory-only.
- No migrations, contracts, domain logic, runtime delivery code, or generated DB types were changed.

## Files Changed

- `scripts/ops/runtime-verifier-gate.ts` - changed the missing-SHA branch from `warnings.push(...)` to `failures.push(...)`.
- `docs/06_status/proof/UTV2-1376/diff-summary.md` - records this implementation summary.
- `docs/06_status/proof/UTV2-1376/verification.md` - records verification evidence for the lane.

## Scope

The implementation change is limited to the allowed ops gate script scope. The proof markdown files are included because the lane packet and manifest require them as closeout artifacts.
