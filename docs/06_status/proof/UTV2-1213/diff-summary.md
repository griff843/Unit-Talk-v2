# UTV2-1213 Diff Summary

## Summary

Wave 5 opportunity provenance gate: `computeStatProjection` now fails closed when `usage_rate_source === 'snap_share'` or `snap_share_suppressed === true`. Picks derived from snap_share proxy usage are suppressed for manual review rather than silently promoted.

## Evidence

### Files changed

| File | Change |
|---|---|
| `packages/domain/src/models/stat-distribution.ts` | Provenance gate after input validation; `usage_rate_source` added to `StatProjectionOutput` |
| `packages/domain/src/models/stat-distribution.test.ts` | 3 new provenance gate tests |
| `packages/domain/src/models/stat-market-blend.test.ts` | Mock updated with required `usage_rate_source: 'direct'` field |

### Invariants preserved

- Fail-closed: `ok: false` returned on snap_share provenance (never silent promotion)
- `direct` provenance passes through unchanged — backward-compatible
- `usage_rate_source` in output for caller inspection
- Domain stays pure: no I/O, no env reads
- No market inputs introduced

### Test coverage

- 18/18 stat-distribution tests pass
- 3 new provenance tests: snap_share fail-closed (by source), snap_share fail-closed (by flag), direct pass-through
- All existing tests unaffected
