# Diff summary: UTV2-1970

This lane adds a fail-closed Discord preflight for an existing pinned human-capper
Official Picks destination. It does not add a destination, change routing, or enable
any deferred Discord target.

| File                                                  | Change                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/worker/src/delivery-adapters.ts`                | GET and validate the exact pinned Discord public thread before posting; safely reopen archived locked threads with `{ archived: false, locked: true }`, re-read them, and post only after active-and-locked validation. All new channel requests have bounded deadlines. |
| `apps/worker/src/delivery-adapters.test.ts`           | Add focused active/archived success, malformed/mismatched/unlocked refusal, request failure/timeout, lock-preservation, payload/nonce, receipt-attribution, and no-fallback coverage.                                                                                    |
| `apps/worker/src/official-picks-exactly-once.test.ts` | Update the existing Discord fetch fixture for GET-before-POST while preserving existing nonce, idempotency, dispatch, kill-switch, and terminal-containment assertions.                                                                                                  |

The remaining changed files are issue-owned lane metadata and the required T1 proof
bundle. There are no other implementation changes.

## Scope audit

- Production changes are confined to the three PM-approved worker files.
- No contracts, domain logic, migrations, database repositories, target maps, roles,
  permissions, overwrites, parent/thread names, tags, or capper identities changed.
- No deployment, live Discord request, replay/retry, release, or merge was performed.
- Existing Saints Track Only negative-control behavior is untouched.

## SHA Binding

Verified implementation SHA: `b9d5e698a84b7fae3411a6a8a3d7d12a49768acf`
Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1722
