# Verification — UTV2-1102: INIT-2.2.3 — Merge-SHA Binding

## Summary

Implements `assertMergeShaBinding()`, `assertShaBindingBlock()`, and `requireMergeShaBinding()` in `packages/invariants/src/merge-sha-binding.ts`. Every ProofBundle must be cryptographically bound to a full 40-char merge SHA; branch HEAD abbreviations and sentinels are rejected.

## Verification

| Check | Result |
|---|---|
| type-check | PASS |
| lint | PASS |
| build | PASS |
| Unit tests (18/18) | PASS |
| R-level | PASS (none triggered) |
| test:db (7/7) | PASS |

## Invariants enforced

- Short SHAs (1–39 hex chars) → `short-sha` failure (branch HEAD abbreviations rejected)
- Sentinel values (set-by-ci, pending, tbd, unknown, empty) → `sentinel-sha` failure
- Null/undefined → `missing-sha` failure
- Non-hex 40-char strings → `invalid-format` failure
- `ShaBindingGateError` thrown by `requireMergeShaBinding()` — certification halts
- `AuditEvent` emitted for every check
- `assertShaBindingBlock()` validates the full sha_binding block on a proof
