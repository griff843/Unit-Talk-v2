# Verification — UTV2-1111 INIT-2.4.4 Emergency Governance Rollback

## Verification

| Check | Result |
|-------|--------|
| `pnpm verify` | PASS |
| Type-check | PASS |
| Lint | PASS |
| Build | PASS |
| T1 proof test (17/17) | PASS |
| R-level check | PASS — no artifacts required |

## Merge SHA

Merge SHA: _to be populated post-merge_

## pnpm test:db

**N/A** — UTV2-1111 implements a pure TypeScript governance contract (`packages/contracts/src/governance-rollback.ts`). No database migrations, no schema changes, no runtime DB mutations. The implementation operates entirely at the contract layer with no Supabase dependency. `pnpm test:db` does not apply to this lane.

## Invariants verified

| Invariant | Description | Result |
|-----------|-------------|--------|
| ERB-1 | Rollback authority remains dual-authorized | PASS |
| ERB-2 | Rollback events are replay-visible | PASS |
| ERB-3 | Rollback is append-only | PASS |
| ERB-4 | Rollback reconstruction is deterministic | PASS |
| ERB-5 | Emergency override remains fail-closed | PASS |

## Key assertions

- `authorizeRollback` rejects same-operator dual-auth via `DualAuthViolationError`
- `assertDomainNotFrozen` throws `RollbackDomainFrozenError` for `capital`, `scaling`, `ws-3.5`
- Frozen domain check fires **before** dual-auth validation — fail-closed ordering confirmed
- `isRollbackExpired` at exact expiry boundary returns `true` (fail-closed boundary semantics)
- `createRollbackEvent` returns `Object.freeze`'d records with frozen nested fields
- `replayRollbackChain` produces same `finalStatus` regardless of input order — deterministic
- `reconstructRollbackChain` is idempotent — running twice on same input produces identical output
