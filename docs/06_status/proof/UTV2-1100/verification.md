# Verification — UTV2-1100: ProofBundle Entity and Proof Contract

## Summary

Implemented `ProofBundle` and `ProofArtifact` runtime entities in `packages/invariants/src/proof-bundle.ts`. This replaces the prior pattern where "proof" was a markdown document checked by CI string-match (catastrophic gap #8).

## Verification

| Check | Result |
|---|---|
| TypeScript type-check | PASS |
| Lint | PASS |
| Build | PASS |
| Unit tests (18/18) | PASS |
| R-level check | PASS (none triggered) |
| pnpm test:db (7/7) | PASS |

## Invariants enforced

- `mergeSha` must be exactly 40 hex chars — any sentinel ("set-by-ci", short SHA) throws `ProofBundleValidationError`
- `artifacts` must be non-empty — at least 1 artifact required
- `validationHash` computed deterministically: `sha256(sorted artifact SHAs joined by ',')`
- `validateProofBundle` recomputes hash from artifacts — detects tampering
- `AuditEvent` emitted on every successful `createProofBundle` call
- No I/O, Supabase, or HTTP — pure data structure in `@unit-talk/invariants` package

## Test coverage

18 adversarial tests across `createProofBundle` and `validateProofBundle`:
- Valid bundle creation with deterministic hash
- AuditEvent emission and immutability
- Rejection of markdown strings as input
- Rejection of `set-by-ci` and short mergeSha values
- Rejection of empty artifacts array
- Per-artifact field validation (kind, path, sha, generatedAt, reproducible, lineage)
- Tamper detection in `validateProofBundle`
- Multi-artifact hash coverage
