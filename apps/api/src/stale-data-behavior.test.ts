import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProviderDataFreshness } from '@unit-talk/domain';

test('freshness windows enforce tiers and modifiers', () => {
  const nowMs = Date.parse('2026-05-01T12:00:00Z');
  assert.equal(evaluateProviderDataFreshness({ snapshotAt: '2026-05-01T10:20:00Z', eventStartsAt: '2026-05-01T15:00:00Z', sportKey: 'nba', marketKey: 'game_total_ou', nowMs }).freshnessWindowFailed, true);
  assert.equal(evaluateProviderDataFreshness({ snapshotAt: '2026-05-01T07:30:00Z', eventStartsAt: '2026-05-02T15:00:00Z', sportKey: 'nba', marketKey: 'game_total_ou', nowMs }).freshnessWindowFailed, false);
  assert.equal(evaluateProviderDataFreshness({ snapshotAt: '2026-05-01T10:30:00Z', eventStartsAt: '2026-05-01T15:00:00Z', sportKey: 'nfl', marketKey: 'game_total_ou', nowMs }).freshnessWindowFailed, false);
  assert.equal(evaluateProviderDataFreshness({ snapshotAt: '2026-05-01T08:00:00Z', eventStartsAt: null, sportKey: 'nba', marketKey: 'game_total_ou', nowMs }).freshnessWindowFailed, false);
});
