# UTV2-1296 — Diff Summary

**Lane:** UTV2-1296 — scope provider_offer_history dedup pre-load by snapshot_at (partition pruning)
**Tier:** T2 · **Lane type:** runtime · **Executor:** Claude

## Files changed

- `packages/db/src/runtime-repositories.ts` — `DatabaseProviderOfferRepository.upsertBatch`: scope the dedup pre-load query to the batch's distinct `snapshot_at` value(s) (`.in('snapshot_at', snapshotAts).in('idempotency_key', chunk)`, selecting `snapshot_at,idempotency_key`) so it prunes `provider_offer_history`'s `RANGE(snapshot_at)` partitions and seeks the existing composite unique index `(snapshot_at, idempotency_key)`. Existence is now keyed on the composite pair (also corrects the inserted/updated count — a key present only in a prior snapshot is no longer miscounted as an update of this snapshot).
- `packages/db/src/provider-offer-repository.test.ts` — update the existing `upsertBatch` fake client + harness type to the chained `.in('snapshot_at', …).in('idempotency_key', …)` shape and assert the `snapshot_at` predicate; add a multi-snapshot test asserting all distinct `snapshot_at` values are passed.

## Behavior change

- **Before:** dedup pre-load = `select('idempotency_key').in('idempotency_key', chunk)` — no `snapshot_at`, so no partition pruning and no seekable index → full scan of all 60 partitions / 1.39M rows per chunk → 120s `statement_timeout`, aborting the MLB odds cycle every cycle.
- **After:** prunes to the batch's partition(s) and seeks the composite index.
- The actual upsert (`onConflict: 'snapshot_at,idempotency_key', ignoreDuplicates: true`) is unchanged; only the existence probe changed — no write-semantics change.

## Out of scope (guardrails honored)

No DDL, no new index, no migration, no DB mutation, no retention/purge. No change to settlement/scoring/freshness thresholds. Critical settlement writes remain fail-closed; archive/telemetry remain fail-open.
