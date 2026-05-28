# Verification: UTV2-1110 — Approval Expiration (INIT-2.4.3)

**Tier:** T1
**Executor:** claude
**Branch:** claude/utv2-1110-init-243-approval-expiration
**Branch HEAD SHA:** 9e421db31ddf50e5038251490dbf7c9e247195b1
**Merge SHA:** _to be updated post-merge_
**Date:** 2026-05-28

## Summary

Implements `ApprovalExpiredError`, `computeExpiresAt()`, `isApprovalExpired()`, `assertApprovalNotExpired()`,
`createExpirationRecord()`, and `replayExpirationChain()` in `@unit-talk/contracts`.
Three governed approval windows are registered: `dual-auth` (3600s), `operator-action` (1800s), `member-promotion` (86400s).
Expired approvals are mechanically rejected with `ApprovalExpiredError`. Expiration at exactly the window boundary
is treated as expired (fail-closed). Expiration state is deterministic from `(issuedAt, kind)` alone.
Closes INIT-2.4.3: approval expiration is now mechanically enforced across all governance approval windows.

## Verification

### Static Verification (pnpm verify)

```
pnpm verify — PASS (exit 0)
  pnpm env:check: PASS
  pnpm lint: PASS
  pnpm type-check: PASS
  pnpm build: PASS
  pnpm test: 113 pass, 0 fail
  check-migration-versions: 114 files verified, no duplicate versions
  lint-migrations: 114 files checked, no findings
```

### T1 Proof Test (local — pure TypeScript enforcement)

```
tsx --test apps/api/src/t1-proof-utv2-1110-approval-expiration.test.ts — PASS (16/16)

  ok 1 - APPROVAL_WINDOW_SECONDS includes all required window kinds
  ok 2 - computeExpiresAt produces correct future timestamp for dual-auth
  ok 3 - computeExpiresAt is deterministic — same inputs produce equal outputs
  ok 4 - isApprovalExpired returns false when within window
  ok 5 - isApprovalExpired returns true when past expiry
  ok 6 - BOUNDARY: isApprovalExpired returns true at exactly expiry time
  ok 7 - assertApprovalNotExpired passes when within window
  ok 8 - ADVERSARIAL: assertApprovalNotExpired throws ApprovalExpiredError when expired (dual-auth)
  ok 9 - ADVERSARIAL: assertApprovalNotExpired throws for operator-action when expired
  ok 10 - ADVERSARIAL: assertApprovalNotExpired throws for member-promotion when expired
  ok 11 - ADVERSARIAL: assertApprovalNotExpired throws at exactly expiry time (boundary fail-closed)
  ok 12 - createExpirationRecord produces a frozen ExpirationRecord with correct fields
  ok 13 - createExpirationRecord captures expiredAt when approval was recorded as expired
  ok 14 - ExpirationRecord is frozen — mutations throw TypeError in strict mode
  ok 15 - replayExpirationChain is deterministic — same inputs produce equal ExpirationRecords
  ok 16 - ApprovalExpiredError has correct name, code, kind, and expiresAt
```

### pnpm test:db

Not applicable for this lane. `ExpirationRecord` and expiration enforcement are pure TypeScript values with no database dependency. Expiration decisions are deterministic from `(issuedAt, kind)` alone and require no DB round-trip. The T1 proof test covers all 16 assertions without a live DB. No `pnpm test:db` run is required; this is documented per the approval expiration enforcement design for INIT-2.4.3.

### R-Level Compliance

```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

### Acceptance Criteria Status

- Expired approvals fail closed: **PASS** — `assertApprovalNotExpired()` throws `ApprovalExpiredError`; silent degradation is impossible
- Stale authorizations become invalid deterministically: **PASS** — expiration computed from `(issuedAt, kind)` alone; no mutable state
- Boundary at exactly expiry time is treated as expired: **PASS** — tests ok 6 (isExpired) and ok 11 (assertNotExpired)
- Replay reconstruction reproduces expiration state: **PASS** — `replayExpirationChain()` is deterministic (test ok 15)
- Expiration evidence is append-only: **PASS** — `ExpirationRecord.expiredAt` set at creation time; `Object.freeze()` prevents mutation
- All three governed window kinds enforced: **PASS** — dual-auth, operator-action, member-promotion all tested adversarially
- ExpirationRecord is immutable: **PASS** — `Object.freeze()` applied; mutations throw TypeError (test ok 14)
- T1 proof test: **PASS** (16/16)
- pnpm verify green: **PASS**

## Gap Closed

INIT-2.4.3: Previously, expiration semantics existed only within dual-auth TTL (UTV2-1109). Now all governance
approval windows have explicit, deterministic expiration enforcement. `assertApprovalNotExpired()` throws
`ApprovalExpiredError` (with `ERRCODE=APPROVAL_EXPIRED`) for any expired window, across all window kinds.
`replayExpirationChain()` guarantees replay reconstruction produces identical expiration records.
