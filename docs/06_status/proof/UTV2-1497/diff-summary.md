# UTV2-1497 Diff Summary

MERGE_SHA: 811b86a59fd610ef9041cfff1e8f66558ce1a973

## Change

Adds a standalone T1 live-DB proof test confirming `DatabaseOutboxRepository.claimNextAtomic` — the atomic `SELECT ... FOR UPDATE SKIP LOCKED` outbox claim used by `apps/worker`'s drain cycle — is race-safe under real concurrent load against real Postgres. No production code is changed.

## Files changed

- `apps/worker/src/t1-proof-utv2-1497-outbox-concurrent-claim.test.ts` (new) — creates 8 real `picks` + `distribution_outbox` rows for one synthetic target, then races 12 concurrent `claimNextAtomic` calls (distinct worker ids) against them via `Promise.all`. Asserts the claimed-row set is disjoint, covers every enqueued row exactly once, and that the 4 excess callers correctly receive `null` rather than a duplicate claim.
- `docs/06_status/proof/UTV2-1497/verification.md`, `evidence.json` — proof bundle.

## Result

Zero races surfaced. The existing `claim_next_outbox` Postgres RPC (backing `claimNextAtomic`) already correctly serializes concurrent claimants via row-level locking — confirmed against real Postgres, not InMemory. Per the issue's own plan-gate spec, this means **no production code change is in scope for this lane**.

## Merge order

Standalone. No dependency on any other open lane.
