import test from 'node:test';
import assert from 'node:assert/strict';
import { SEARCH_PICKS_FILTER_COLUMNS, VIEW_DERIVED_COLUMNS } from './queues';

/**
 * `searchPicks` renders its page from `picks_current_state` but takes its total
 * from `picks`. That split is only correct because two things hold, and this
 * file exists because the second one is easy to break by accident later.
 *
 * 1. Row counts agree. Structural: every join in the view is a LEFT JOIN, and
 *    the three correlated ones are `LEFT JOIN LATERAL (... LIMIT 1) ON true`,
 *    so none can drop a `picks` row or emit two. Measured against production
 *    2026-09-18: 107866/107866 unfiltered, 62629/62629 on source='smart-form',
 *    18287/18287 on settled since 2026-01-01.
 *
 * 2. No filter reads a joined column. Not structural -- a future filter on,
 *    say, `settlement_result` or `review_decision` would narrow the page but
 *    not the count, and the explorer would report a total larger than the set
 *    it is paginating with nothing to indicate it. That is the failure this
 *    test converts from silent into red.
 */
test('every searchPicks filter is a base picks column, so the count may be taken on picks', () => {
  const derived = new Set<string>(VIEW_DERIVED_COLUMNS);
  const offenders = SEARCH_PICKS_FILTER_COLUMNS.filter((column) => derived.has(column));

  assert.deepEqual(
    offenders,
    [],
    `searchPicks filters on view-derived column(s): ${offenders.join(', ')}. ` +
      'Counting `picks` would then return a total larger than the filtered page. ' +
      'Either move the filter onto a base column, or count the view and accept its cost.',
  );
});

test('the two column sets are non-empty, so the guard above cannot pass vacuously', () => {
  assert.ok(VIEW_DERIVED_COLUMNS.length > 0);
  assert.ok(SEARCH_PICKS_FILTER_COLUMNS.length > 0);
});
