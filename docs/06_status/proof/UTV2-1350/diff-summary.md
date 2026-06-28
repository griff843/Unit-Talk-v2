# UTV2-1350 Diff Summary

## Scope

- Added proof-only evidence under `docs/06_status/proof/UTV2-1350/`.
- No runtime, database, API, worker, contract, or test source files were changed.

## Root Cause Notes

- `GET /api/settlements/recent` is implemented in `apps/api/src/routes/settlements-query.ts`.
- The route clamps `limit` to `MAX_LIMIT = 200`, then calls `runtime.repositories.settlements.listRecent(limit)` without passing a `since` lower bound.
- `DatabaseSettlementRepository.listRecent()` queries `settlement_records`, orders by `created_at desc`, and applies the requested limit. If `since` is supplied it adds `gte('created_at', since)`, but the API route does not expose or pass that parameter.
- Live evidence collected on 2026-06-28 showed the route currently returns successfully at the exposed max limit (`limit=200`), while the larger historical proof shape (`listRecent(500, since)`) produced one transient `statement_timeout` and then passed on rerun.

## Files Changed

- `docs/06_status/proof/UTV2-1350/diff-summary.md` - proof summary and root-cause notes.
- `docs/06_status/proof/UTV2-1350/verification.md` - verification command log and results.

## Runtime Change

None. This lane was constrained to proof files only.
