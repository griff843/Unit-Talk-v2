# PROOF: UTV2-1796

MERGE_SHA: c3834a6d80e746ffe39bbde52018373eba1dfadf

> Pre-merge the merge anchor carries the verified implementation identity.
> `post-merge-lane-close.yml` rebinds merge authority only after GitHub supplies
> the merged-PR attestation.

Generated at: 2026-09-01T02:41:54Z
Issue: UTV2-1796
Tier: T1
Lane type: runtime
Branch: claude/utv2-1796-closing-line-marking
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1472
Head SHA: c3834a6d80e746ffe39bbde52018373eba1dfadf
result: pass

## ASSERTIONS:

- [x] `markClosingLines` reads `provider_offer_history` (14,456,685 production rows) instead of `provider_offer_history_compact` (3,139 rows, one event, no temporal overlap with the live window), so the closing-line input is non-vacuous.
- [x] The bounded query is partition-pruned: `EXPLAIN` shows `Append` over 3 pruned child partitions with `Index Scan Backward` on `(provider_event_id, snapshot_at)`, 81.943 ms for 5,000 rows.
- [x] The update reports an exact affected-row count and refuses rather than reporting an unverified number when PostgREST returns no count.
- [x] Marking fails closed: when eligible rows and unmarked anchors exist but zero rows are marked, the call throws instead of reporting a vacuous success.
- [x] Identity keys are reconstructed per bookmaker, so an event quoted by seven books yields seven closing lines rather than one collapsed row.
- [x] `apps/ingestor/src/ingest-odds-api.ts` passes `includeBookmakerKey: true`, closing the collapsed-key hazard on the caller path.
- [x] The caller path is proven by driving the real `ingestOddsApiLeague` entry point across two ingest cycles, not by asserting on the option object.
- [x] P1 (review): the selection is not filtered by `is_closing`, so repeated cycles cannot walk the stored closing line backwards through history.
- [x] P2 (review): the `provider_offer_current` update is constrained to the snapshot it selected, so a live post-commence quote upserted by ingestion is never stamped as the closing line.

## EVIDENCE:

```
$ pnpm verify:static
EXIT=0
100 node:test blocks executed, every one reporting "# fail 0"; no block reported a non-zero failure count.

$ pnpm exec tsx --test packages/db/src/provider-offer-repository.test.ts
# pass 15
# fail 0

$ pnpm exec tsx --test apps/ingestor/src/utv2-1796-closing-line-staging-proof.test.ts
# pass 3
# fail 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 12
Rules matched: ingestor-provider
```

## Verification
- [x] `pnpm type-check`: pass (executed inside `pnpm verify:static`, EXIT=0)
- [x] `pnpm test`: pass (executed inside `pnpm verify:static`, 100 blocks, 0 failures)
- [x] `pnpm verify`: `verify:static` pass (EXIT=0). The `test:live-db` half is not runnable from this containment checkout — it requires the `staging-ci` environment credential that only the CI `staging-db-proof` job holds. CI's required `verify` job asserts that job's result as its first step, so the live half is proven there and not claimed here.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS

## Runtime Verification

Every control below was proven by mutation — the guard was removed or inverted
on the merged source and the suite re-run. A control that is merely present, and
a suite that is merely green, prove nothing.

| Mutation applied | Failing test |
|---|---|
| Source switched back to `provider_offer_history_compact` | `not ok 8` |
| `count: 'exact'` dropped from the update | `not ok 9` |
| Zero-marked fail-closed guard neutered | `not ok 11` |
| `count ?? chunk.length` fallback restored | `not ok 12` |
| `includeBookmakerKey` removed from the ingest caller | `not ok 1` (caller-path suite) |
| `.eq('is_closing', false)` restored to the selection (P1) | `not ok 8` |
| `.eq('snapshot_at', snapAt)` dropped from the projection update (P2) | `not ok 15` |
| None (restored) | `# pass 15 / # fail 0` |

Read-only production measurement (no writes, no provider calls):

- `provider_offer_history`: 14,456,685 rows, 2026-05-11 → 2026-06-30, `provider_key='sgo'` only.
- `provider_offer_history_compact`: 3,139 rows, 2026-04-24 → 2026-04-26, one event. No temporal overlap with history.
- One recent event carries 165,414 eligible unmarked rows in history and 0 in compact — the concrete vacuity this lane removes.
- All 60 child partitions carry the `(provider_event_id, snapshot_at)` index.
- Ordered digest of the bounded selection: `0cce235f8cdc45b8991542e0345ec611324015bf90ac9884b8e243f5f8d59bfc`.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1472
Approved PR head: pending merge
Execution SHA: c3834a6d80e746ffe39bbde52018373eba1dfadf
