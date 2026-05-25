# Verification — UTV2-1101: INIT-2.2.2 — Proof Validator

## Summary

Implemented `ProofValidator` in `packages/invariants/src/proof-validator.ts`. Replaces CI string-match on markdown (gap #8 validator component) with a mechanical runtime validator that checks completeness, SHA binding, freshness, and reproducibility hash.

## Verification

| Check | Result |
|---|---|
| `pnpm type-check` | PASS |
| `pnpm lint` | PASS |
| `pnpm build` | PASS |
| Unit tests (18/18) | PASS |
| R-level check | PASS (none triggered) |
| `pnpm test:db` (7/7) | PASS |

## Invariants enforced

- Incomplete bundles → `missing-field` failures
- Mis-bound bundles → `invalid-merge-sha` (sentinels and short SHAs rejected)
- Stale bundles → `stale-bundle` (configurable maxAgeMs, default 7 days)
- Tampered bundles → `hash-mismatch` (validationHash recomputed from artifacts)
- Wrong schemaVersion → `invalid-schema-version`
- `ProofValidationGateError` thrown on any rejection — certification halted
- `AuditEvent` emitted for every validation (pass or fail)
- Pure data structure — no I/O, Supabase, or HTTP

## Test coverage (18 adversarial)

- Valid bundle → result.valid=true, failures=[], auditEvent emitted
- null, markdown string → valid=false, missing-field
- Sentinel mergeSha ("set-by-ci"), short mergeSha → invalid-merge-sha
- Empty artifacts → empty-artifacts
- Tampered artifact sha → hash-mismatch
- Wrong validationHash → hash-mismatch
- Missing issueId → missing-field
- maxAgeMs=0 → stale-bundle
- Invalid ISO-8601 createdAt → missing-field
- schemaVersion=2 → invalid-schema-version
- Rejected bundle → auditEvent.payload.action="rejected"
- CertificationGate.assertValid passes valid bundle
- CertificationGate.assertValid throws ProofValidationGateError on rejection
- ProofValidationGateError carries result with failures
