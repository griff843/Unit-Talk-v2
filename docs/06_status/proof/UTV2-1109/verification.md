# Verification: UTV2-1109 — Dual-Authorization Runtime (INIT-2.4.2)

**Tier:** T1
**Executor:** claude
**Branch:** claude/utv2-1109-init-242-dual-authorization-runtime
**Branch HEAD SHA:** 98e096390959cfe8e34b0d0147170b2b46d765f9
**Merge SHA:** _to be updated post-merge_
**Date:** 2026-05-28

## Summary

Implements `PendingApproval`, `ApprovalRecord`, and `completeApproval()` in `@unit-talk/contracts`.
Six governed actions require two distinct operator approvals. Same-operator second approvals and
expired pending approvals are mechanically rejected with `DualAuthViolationError`.
Closes Gap #16: dual authorization is now mechanically enforced, not convention.

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
tsx --test apps/api/src/t1-proof-utv2-1109-dual-auth.test.ts — PASS (16/16)

  ok 1 - DUAL_AUTH_ACTIONS contains all required governed actions
  ok 2 - DUAL_AUTH_TTL_SECONDS is 3600 (1 hour)
  ok 3 - requiresDualAuth: returns true for governed actions
  ok 4 - requiresDualAuth: returns false for non-governed actions
  ok 5 - createPendingApproval: produces a frozen PendingApproval with correct TTL
  ok 6 - createPendingApproval: respects custom TTL
  ok 7 - completeApproval: succeeds with different operator
  ok 8 - ADVERSARIAL: same-operator second approval is rejected with DualAuthViolationError
  ok 9 - ADVERSARIAL: same-operator approval on operator:admin is rejected
  ok 10 - ADVERSARIAL: same-operator approval on member:write is rejected
  ok 11 - ADVERSARIAL: expired pending approval is rejected
  ok 12 - ADVERSARIAL: expired pending approval on promotion:override is rejected
  ok 13 - isDualAuthExpired: returns true when past TTL
  ok 14 - replayApprovalChain: deterministically reconstructs the ApprovalRecord
  ok 15 - ApprovalRecord is immutable — mutations are rejected in strict mode
  ok 16 - DualAuthViolationError has correct name and code
```

### pnpm test:db

Not applicable for this lane. `PendingApproval` and `ApprovalRecord` are pure TypeScript values with no database dependency. Approval decisions are deterministic and require no DB round-trip. The T1 proof test covers all 16 assertions without a live DB. No `pnpm test:db` run is required; this is documented per the dual-authorization enforcement design for INIT-2.4.2.

### R-Level Compliance

```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

### Acceptance Criteria Status

- Single approval never progresses a dual-auth action: **PASS** — `createPendingApproval()` produces PendingApproval; `completeApproval()` requires two distinct operators
- No operator is both approvers: **PASS** — same-operator rejection in tests ok 8, 9, 10
- Dual authorization enforced by runtime, not convention: **PASS** — `DualAuthViolationError` thrown on violation
- Approval records are immutable and auditable: **PASS** — `Object.freeze()` applied; `ApprovalRecord` carries both approver identities
- Approval chains replayable: **PASS** — `replayApprovalChain()` is deterministic (test ok 14)
- Expired pending approval rejected: **PASS** — tests ok 11, 12
- T1 proof test: **PASS** (16/16)
- pnpm verify green: **PASS**

## Gap Closed

Gap #16 (INIT-2.4.2): Previously, dual authorization existed only as convention. `completeApproval()` now mechanically rejects any same-operator second approval attempt and expired pending approvals. `DualAuthViolationError` carries the action name for audit log entries. All approval records are frozen (immutable) after creation.
