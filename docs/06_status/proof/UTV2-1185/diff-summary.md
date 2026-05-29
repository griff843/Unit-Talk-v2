# UTV2-1185 Diff Summary

## Branch

`claude/utv2-1185-cr-67-rollback-contract-hardening`

## PR

https://github.com/griff843/Unit-Talk-v2/pull/912

## Commit SHA

`2baf50fba01f32fd4996bb0b5fd2b46ccc9040db`

## Changes

### packages/contracts/src/governance-rollback.ts

- Removed `computeRollbackExpiresAt` (dead code — never called in production paths; rollback expiry derives from `createPendingApproval()` using `DUAL_AUTH_TTL_SECONDS`)
- `Object.freeze(sorted)` added in `replayRollbackChain()` — events array is now runtime-immutable, not just TypeScript-readonly

### packages/contracts/src/dual-auth.ts

- Added JSDoc to `createPendingApproval` documenting that actor authority validation is the caller's responsibility
- Added JSDoc to `completeApproval` documenting the deliberate decoupling between dual-auth (identity/timing enforcement) and authority-enforcement (role/domain enforcement)

### apps/api/src/t1-proof-utv2-1111-governance-rollback.test.ts

- Removed `computeRollbackExpiresAt` import (function deleted)
- Removed `ROLLBACK_AUTHORIZATION_WINDOW_SECONDS` import (no longer needed after test removed)
- Removed `computeRollbackExpiresAt is deterministic` test (function deleted)

## Verification

| Command | Result |
|---|---|
| `pnpm type-check` | PASS |
| `pnpm verify` | PASS |
| `tsx --test apps/api/src/t1-proof-utv2-1111-governance-rollback.test.ts` | PASS (17 assertions) |
| R-level check | PASS — no R-level artifacts required |
