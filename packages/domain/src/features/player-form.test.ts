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

  // ── 72h max-age guard tests ──────────────────────────────────────────────

  describe('72h max-age guard (mock fixture pipeline)', () => {
    // Mock fixture: NBA player logs within 72h of a reference game
    const REFERENCE_DATE = '2026-06-05T18:00:00.000Z'; // game being evaluated
    const HOURS = (h: number): string => {
      const d = new Date(REFERENCE_DATE);
      d.setTime(d.getTime() - h * 60 * 60 * 1000);
      return d.toISOString().slice(0, 10);
    };

    const MOCK_FIXTURE: GameLog[] = [
      { player_id: 'player-001', game_date: HOURS(12), minutes: 34, stat_value: 28, started: true },
      { player_id: 'player-001', game_date: HOURS(36), minutes: 31, stat_value: 22, started: true },
      { player_id: 'player-001', game_date: HOURS(60), minutes: 29, stat_value: 19, started: false },
    ];

    it('accepts fresh fixture logs (within 72h) and produces non-null output', () => {
      const result = extractPlayerFormFeatures(MOCK_FIXTURE, {
        reference_date: REFERENCE_DATE,
        max_age_hours: 72,
      });
      assert.equal(result.ok, true, 'should succeed with fresh logs');
      if (!result.ok) return;
      assert.equal(result.data.games_sampled, 3);
      assert.ok(result.data.minutes_avg > 0);
      assert.ok(result.data.stat_per_minute > 0);
      assert.ok(result.data.consistency_score >= 0 && result.data.consistency_score <= 1);
    });

    it('rejects all-stale logs (age > 72h) — fail closed', () => {
      const staleLogs: GameLog[] = [
        { player_id: 'player-001', game_date: HOURS(73), minutes: 30, stat_value: 20, started: true },
        { player_id: 'player-001', game_date: HOURS(96), minutes: 28, stat_value: 18, started: true },
        { player_id: 'player-001', game_date: HOURS(120), minutes: 32, stat_value: 22, started: true },
      ];
      const result = extractPlayerFormFeatures(staleLogs, {
        reference_date: REFERENCE_DATE,
        max_age_hours: 72,
      });
      assert.equal(result.ok, false, 'should fail closed for all-stale logs');
      if (result.ok) return;
      assert.match(result.reason, /[Ss]tale/);
      assert.match(result.reason, /72h/);
    });

    it('filters stale logs and fails when insufficient fresh logs remain', () => {
      const mixed: GameLog[] = [
        { player_id: 'player-001', game_date: HOURS(24), minutes: 30, stat_value: 20, started: true },
        { player_id: 'player-001', game_date: HOURS(80), minutes: 28, stat_value: 18, started: true },
        { player_id: 'player-001', game_date: HOURS(100), minutes: 32, stat_value: 22, started: true },
      ];
      const result = extractPlayerFormFeatures(mixed, {
        reference_date: REFERENCE_DATE,
        max_age_hours: 72,
        min_games: 3,
      });
      assert.equal(result.ok, false, 'only 1 fresh log, min_games=3 — should fail closed');
    });

    it('uses only fresh logs when mix of stale and fresh exceeds min_games', () => {
      const mixed: GameLog[] = [
        { player_id: 'player-001', game_date: HOURS(10), minutes: 35, stat_value: 30, started: true },
        { player_id: 'player-001', game_date: HOURS(30), minutes: 33, stat_value: 25, started: true },
        { player_id: 'player-001', game_date: HOURS(50), minutes: 31, stat_value: 20, started: true },
        { player_id: 'player-001', game_date: HOURS(80), minutes: 29, stat_value: 10, started: false },
      ];
      const result = extractPlayerFormFeatures(mixed, {
        reference_date: REFERENCE_DATE,
        max_age_hours: 72,
      });
      assert.equal(result.ok, true, 'three fresh logs satisfy min_games=3');
      if (!result.ok) return;
      assert.equal(result.data.games_sampled, 3, 'stale log excluded from window');
    });

    it('skips max-age guard when reference_date is not provided', () => {
      const oldLogs: GameLog[] = [
        { player_id: 'player-001', game_date: '2020-01-03', minutes: 30, stat_value: 20, started: true },
        { player_id: 'player-001', game_date: '2020-01-02', minutes: 28, stat_value: 18, started: true },
        { player_id: 'player-001', game_date: '2020-01-01', minutes: 32, stat_value: 22, started: true },
      ];
      const result = extractPlayerFormFeatures(oldLogs);
      assert.equal(result.ok, true, 'no reference_date — no age filtering applied');
    });

    it('player_id field is preserved on GameLog fixture entries', () => {
      assert.equal(MOCK_FIXTURE[0]!.player_id, 'player-001');
      assert.equal(MOCK_FIXTURE[1]!.player_id, 'player-001');
    });
  });
});
