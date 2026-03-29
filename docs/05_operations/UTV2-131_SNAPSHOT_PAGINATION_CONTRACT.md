# Snapshot Pagination Contract

**Status:** RATIFIED 2026-03-29
**Lane:** claude (contract) — codex (implementation: UTV2-131)
**Authority:** Defines `?limit` and `?since` query params on `GET /api/operator/snapshot` and caps unbounded list queries.

---

## Problem

`GET /api/operator/snapshot` returns `recentOutbox`, `recentSettlements`, and `recentRuns` lists with hardcoded limits of 12–20 rows. There is no way for an operator to retrieve more rows or paginate through history. As pick volume grows, these lists become too small for useful diagnosis without increasing the hardcoded limit (which would increase DB load unconditionally).

---

## Design

### Query params

| Param | Type | Default | Max | Notes |
|---|---|---|---|---|
| `limit` | integer | 25 | 100 | Applied to `recentOutbox`, `recentSettlements`, `recentRuns` |
| `since` | ISO 8601 timestamp | — | — | Filters to rows `created_at > since`. Optional. |

If `limit` is out of range or not a valid integer, it is clamped/defaulted silently (no error).

If `since` is not a valid ISO timestamp, it is ignored silently.

### Response envelope change

Add a `pagination` field to the `OperatorSnapshot` response:

```typescript
export interface SnapshotPagination {
  limit: number;
  since: string | null;   // ISO timestamp applied, or null if not provided
  hasMore: boolean;       // true if any of the three lists returned exactly `limit` rows
}
```

Add to `OperatorSnapshot`:

```typescript
pagination?: SnapshotPagination;
```

`hasMore` is true if `recentOutbox.length === limit || recentSettlements.length === limit || recentRuns.length === limit`. It is a heuristic, not a precise cursor — callers should use `since` to page forward.

### Implementation notes

- `createOperatorSnapshotProvider` receives `filter` (existing `OutboxFilter`) extended with `limit` and `since`
- `createSnapshotFromRows` is pure and does not need to change — pagination metadata is computed at the provider level from the row counts
- The existing `?outboxStatus` and `?target` filter params remain unchanged

---

## Updated `OutboxFilter` / snapshot filter type

Extend the existing filter type (or introduce `SnapshotFilter` if cleaner):

```typescript
export interface SnapshotFilter extends OutboxFilter {
  limit?: number;   // default 25, max 100
  since?: string;   // ISO timestamp
}
```

---

## Backward Compatibility

- Existing callers that do not pass `limit` or `since` receive identical behavior (default limit 25 — slightly higher than the current hardcoded 12–20, which is acceptable)
- `pagination` field is optional in `OperatorSnapshot` — callers that don't use it are unaffected
- HTML dashboard does not need to change (renders whatever rows are returned)

---

## Acceptance Criteria (UTV2-131)

- [ ] `GET /api/operator/snapshot?limit=N` applies `N` (clamped 1–100, default 25) to all three list queries
- [ ] `GET /api/operator/snapshot?since=<iso>` filters rows to `created_at > <iso>`
- [ ] Response includes `pagination: { limit, since, hasMore }` field
- [ ] Invalid `limit` (non-integer, out of range) is silently clamped/defaulted
- [ ] Invalid `since` (unparseable) is silently ignored
- [ ] Existing `?outboxStatus` and `?target` params continue to work
- [ ] `pnpm verify` passes
- [ ] New tests:
  - `?limit=5` returns at most 5 rows per list
  - `?since=<past iso>` filters rows correctly
  - `pagination.hasMore` is true when a list hits the limit
  - Default behavior (no params) returns 25 rows or fewer

---

## Out of Scope

- Cursor-based pagination (offset/cursor tokens)
- Per-list limit controls
- Filtering on `recentRuns` by `runType`
- Changes to `picks-pipeline` endpoint
