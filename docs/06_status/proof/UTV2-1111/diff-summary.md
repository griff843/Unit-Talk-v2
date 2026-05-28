# Diff Summary — UTV2-1111 INIT-2.4.4 Emergency Governance Rollback

PR URL: https://github.com/griff843/Unit-Talk-v2/pull/905
Merge SHA: `7622c7dcf3ff68cf5b46b833fdd07e8a69e0754d`

## Files changed

| File | Change |
|------|--------|
| `packages/contracts/src/governance-rollback.ts` | New — emergency rollback contract |
| `packages/contracts/src/index.ts` | Added export for `governance-rollback.js` |
| `docs/governance/emergency-rollback-policy.json` | New — policy document |
| `apps/api/src/t1-proof-utv2-1111-governance-rollback.test.ts` | New — 17 adversarial T1 proof assertions |
| `package.json` | Added governance-rollback test to `test:t1-proof` script |
| `.ops/sync/UTV2-1111.yml` | New — per-issue sync file |
| `docs/06_status/proof/UTV2-1111/evidence.json` | New — T1 evidence bundle |
| `docs/06_status/proof/UTV2-1111/verification.md` | New — verification record |
| `docs/06_status/proof/UTV2-1111/diff-summary.md` | New — this file |

## Scope

Pure TypeScript governance contract with policy document. No database migrations, no schema changes, no runtime service modifications. Extends `@unit-talk/contracts` package with emergency rollback semantics that wrap the existing dual-auth runtime (UTV2-1109).

## Key implementation decisions

1. **Frozen domain check fires first** — `assertRollbackAuthorized` calls `assertDomainNotFrozen` before `assertRollbackNotExpired`. This ensures capital/scaling/ws-3.5 domains are rejected before any authorization computation.

2. **Uses `ApprovalRecord` from dual-auth** — rather than introducing a new authorization type, rollback events carry the existing `ApprovalRecord` from UTV2-1109's `completeApproval()`. This ensures rollback authorization goes through the same dual-auth runtime path.

3. **`authorizeRollback` factory** — a single entry point that calls `assertDomainNotFrozen`, `createPendingApproval`, and `completeApproval` in sequence. Fail-closed: frozen domain or same-operator throws before returning.

4. **Deterministic replay via time-ordered sort** — `replayRollbackChain` sorts by `occurredAt` before applying the state machine, ensuring order-independence in the input.
