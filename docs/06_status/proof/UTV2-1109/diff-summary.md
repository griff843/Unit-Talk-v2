## Summary

UTV2-1109 implements INIT-2.4.2 — Dual-Authorization Runtime, closing Gap #16 where dual authorization existed only as convention (a single approval could progress any governed action without enforcement).

**Branch HEAD SHA:** 98e096390959cfe8e34b0d0147170b2b46d765f9
**Merge SHA:** _to be updated post-merge_
**PR:** _to be updated post-merge_

## Files Changed

- `packages/contracts/src/dual-auth.ts`: Defines `DualAuthAction`, `DUAL_AUTH_ACTIONS`, `PendingApproval`, `ApprovalRecord`, `DualAuthViolationError`, `createPendingApproval()`, `completeApproval()`, `isDualAuthExpired()`, `replayApprovalChain()`, `requiresDualAuth()`.
- `packages/contracts/src/index.ts`: Exports `./dual-auth.js`.
- `docs/governance/dual-auth-matrix.json`: Governance document encoding the dual-auth action list, lifecycle, invariants, and enforcement reference.
- `apps/api/src/t1-proof-utv2-1109-dual-auth.test.ts`: 16 adversarial T1 proof assertions — valid two-operator approvals accepted, same-operator approvals rejected, expired approvals rejected.
- `package.json`: Added UTV2-1109 T1 proof test to `test:t1-proof` script.

## Gap Closed

Gap #16 (INIT-2.4.2): Previously, dual authorization was convention enforced only by code review. `completeApproval()` now mechanically rejects same-operator second approvals (throwing `DualAuthViolationError` with `ERRCODE=DUAL_AUTH_VIOLATION`) and expired pending approvals. ApprovalRecords are frozen/immutable and replay-deterministic.

## Proof Result

pnpm verify — PASS (113 tests, 0 fail). T1 proof test — PASS (16/16). R-level — PASS.
