import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractPlayerFormFeatures } from './player-form.js';
import type { GameLog } from './player-form.js';

function makeLog(overrides: Partial<GameLog> & { game_date: string }): GameLog {
  return {
    minutes: 30,
    stat_value: 20,
    started: true,
    ...overrides,
  };
}

describe('extractPlayerFormFeatures', () => {
  it('returns ok:false when insufficient games', () => {
    const result = extractPlayerFormFeatures([
      makeLog({ game_date: '2026-01-01' }),
    ]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /Insufficient/);
  });

  it('computes features from minimum games', () => {
    const logs: GameLog[] = [
      makeLog({ game_date: '2026-01-03', minutes: 32, stat_value: 22 }),
      makeLog({ game_date: '2026-01-02', minutes: 28, stat_value: 18 }),
      makeLog({ game_date: '2026-01-01', minutes: 30, stat_value: 20 }),
    ];
    const result = extractPlayerFormFeatures(logs);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.games_sampled, 3);
    assert.equal(result.data.window_size, 10);
    assert.ok(result.data.minutes_avg > 0);
    assert.ok(result.data.stat_per_minute > 0);
  });

  it('respects window_size config', () => {
    const logs: GameLog[] = Array.from({ length: 20 }, (_, i) =>
      makeLog({ game_date: `2026-01-${String(i + 1).padStart(2, '0')}` }),
    );
    const result = extractPlayerFormFeatures(logs, { window_size: 5 });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.games_sampled, 5);
  });

  it('computes positive trend for increasing stats', () => {
    const logs: GameLog[] = [
      makeLog({ game_date: '2026-01-05', stat_value: 30 }),
      makeLog({ game_date: '2026-01-04', stat_value: 25 }),
      makeLog({ game_date: '2026-01-03', stat_value: 20 }),
      makeLog({ game_date: '2026-01-02', stat_value: 15 }),
      makeLog({ game_date: '2026-01-01', stat_value: 10 }),
    ];
    const result = extractPlayerFormFeatures(logs);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.data.stat_trend > 0, 'stat_trend should be positive for increasing values');
  });

  it('uses usage_rate for stat_per_opportunity when available', () => {
    const logs: GameLog[] = [
      makeLog({ game_date: '2026-01-03', usage_rate: 0.25 }),
      makeLog({ game_date: '2026-01-02', usage_rate: 0.30 }),
      makeLog({ game_date: '2026-01-01', usage_rate: 0.28 }),
    ];
    const result = extractPlayerFormFeatures(logs);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.data.stat_per_opportunity > 0);
  });

  it('consistency_score is bounded [0, 1]', () => {
    const logs: GameLog[] = [
      makeLog({ game_date: '2026-01-03', stat_value: 20 }),
      makeLog({ game_date: '2026-01-02', stat_value: 20 }),
      makeLog({ game_date: '2026-01-01', stat_value: 20 }),
    ];
    const result = extractPlayerFormFeatures(logs);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.data.consistency_score >= 0 && result.data.consistency_score <= 1);
  });

  it('is pure — same input produces same output', () => {
    const logs: GameLog[] = [
      makeLog({ game_date: '2026-01-03', stat_value: 22, minutes: 32 }),
      makeLog({ game_date: '2026-01-02', stat_value: 18, minutes: 28 }),
      makeLog({ game_date: '2026-01-01', stat_value: 20, minutes: 30 }),
    ];
    const r1 = extractPlayerFormFeatures(logs);
    const r2 = extractPlayerFormFeatures(logs);
    assert.deepEqual(r1, r2);
  });
});
