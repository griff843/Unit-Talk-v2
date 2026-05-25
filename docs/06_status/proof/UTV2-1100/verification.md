# Verification — UTV2-1100: INIT-2.2.1 — ProofBundle Entity and Proof Contract

## Summary

This lane implements `ProofBundle` and `ProofArtifact` as runtime entities in `packages/invariants/src/proof-bundle.ts`. These replace the previous pattern where "proof" was a markdown document verified only by CI string-match (catastrophic gap #8 in the governance initiative).

## Verification

| Check | Result |
|---|---|
| `pnpm type-check` | PASS — zero TS errors, strict mode |
| `pnpm lint` | PASS — zero ESLint findings |
| `pnpm build` | PASS — exits 0 |
| `pnpm test` | PASS — 113/113 tests (18 new in proof-bundle.test.ts) |
| R-level check | PASS — no R-level artifacts required for this diff |
| test_wiring | VERIFIED — proof-bundle.test.ts added to packages/invariants package.json |
| `pnpm test:db` | PASS — 7/7 live-DB tests against Supabase `zfzdnfwdarxucxtaojxm` (duration: ~115612ms) |

## Adversarial Test Coverage (15 required + 3 bonus)

All 15 required adversarial tests implemented and passing:

1. Valid bundle created → has id, schemaVersion=1, validationHash computed correctly
2. Valid bundle → auditEvent emitted
3. validationHash is deterministic (same inputs → same hash)
4. validateProofBundle recomputes hash correctly → valid=true
5. Tampered artifact SHA → validateProofBundle returns valid=false
6. Missing issueId → ProofBundleValidationError
7. mergeSha "set-by-ci" → ProofBundleValidationError (sentinel string rejected)
8. mergeSha shorter than 40 chars → ProofBundleValidationError
9. Empty artifacts array → ProofBundleValidationError
10. Artifact missing sha → ProofBundleValidationError
11. Artifact missing kind → ProofBundleValidationError
12. Artifact missing path → ProofBundleValidationError
13. validateProofBundle on malformed bundle (wrong hash) → valid=false, errors populated
14. Markdown string as input → throws (not accepted as ProofBundle)
15. Bundle with multiple artifacts → validationHash covers all of them

Bonus: short mergeSha in validateProofBundle → valid=false; markdown string in validateProofBundle → valid=false; empty artifacts in validateProofBundle → valid=false.

## Key Design Decisions

- `validationHash` is computed as `sha256(sorted artifact SHAs joined by ',')` — deterministic, order-independent
- `mergeSha` validated against `/^[0-9a-f]{40}$/i` — rejects all sentinel strings and short SHAs
- `ProofBundleValidationError` carries a `field` property for precise error attribution
- `validateProofBundle(bundle: unknown)` accepts `unknown` to enforce runtime type-checking
- `AuditEvent` emitted using same pattern as `governance-exception.ts` — immutable, fail-closed severity
- No I/O, Supabase, or HTTP — pure data structure in `@unit-talk/invariants` package

## Source SHA

Branch HEAD: `f086fc7579232b3ae79d2dc05960a6780b23af4e`
Merge SHA: set-by-ci (updated after merge to main)
