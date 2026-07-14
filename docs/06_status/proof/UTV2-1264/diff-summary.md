# UTV2-1264 Diff Summary

## Change

Extends CLV resolution to event-scoped game-total picks in `apps/api/src/clv-service.ts`, resolving closing line via retained event identity (canonical `eventId`/`providerEventId`/start time) rather than requiring `picks.metadata.marketUniverseId` linkage. A retained provider event can resolve without a local event row, and the retained event start remains the strict closing-offer cutoff.

## Files changed

- `apps/api/src/clv-service.ts` — join-chain resolution for event-scoped game totals
- `apps/api/src/clv-service.test.ts` — coverage for direct provider identity, exact same-day event disambiguation, and rejection of post-start offers

## Key finding

The originally reported 1,833-row `missing_event_context` bucket for `points-all-game-ou` conflates player props sharing that market key — it is not a clean game-total population. Of the real game-total population: 445 event-scoped universe rows exist, 388 have verified closing data, 57 picks already resolve via existing universe provenance, and 27 real scanner game totals were the actual gap this fix closes.

## Merge order

Standalone. No dependency on any other open lane.
