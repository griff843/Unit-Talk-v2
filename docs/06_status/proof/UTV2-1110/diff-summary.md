## Summary

UTV2-1110 implements INIT-2.4.3 — Approval Expiration, extending expiration semantics beyond the dual-auth
TTL introduced in UTV2-1109 to cover all governance approval windows.

**Branch HEAD SHA:** 9e421db31ddf50e5038251490dbf7c9e247195b1
**Merge SHA:** _to be updated post-merge_
**PR:** _to be updated post-merge_

## Files Changed

- `packages/contracts/src/approval-expiration.ts`: Defines `APPROVAL_WINDOW_SECONDS`, `ApprovalWindowKind`, `ExpirationRecord`, `ApprovalExpiredError`, `computeExpiresAt()`, `isApprovalExpired()`, `assertApprovalNotExpired()`, `createExpirationRecord()`, `replayExpirationChain()`.
- `packages/contracts/src/index.ts`: Exports `./approval-expiration.js`.
- `docs/governance/approval-expiration-policy.json`: Governance document encoding the three approval windows, invariants, enforcement reference, and closed gap.
- `apps/api/src/t1-proof-utv2-1110-approval-expiration.test.ts`: 16 adversarial T1 proof assertions — boundary semantics, all three window kinds, fail-closed enforcement, immutability, replay determinism.
- `package.json`: Added UTV2-1110 T1 proof test to `test:t1-proof` script.

## Gap Closed

INIT-2.4.3: Previously, expiration was handled only within `dual-auth.ts` TTL (UTV2-1109). Now all governance
approval windows have explicit, mechanically-enforced expiration: `assertApprovalNotExpired()` throws
`ApprovalExpiredError` (fail-closed). Boundary condition (exactly at expiry) is treated as expired.
Expiration is deterministic from `(issuedAt, kind)` alone — replay-safe. `ExpirationRecord` is frozen.

## Proof Result

pnpm verify — PASS (113 tests, 0 fail). T1 proof test — PASS (16/16). R-level — PASS.
