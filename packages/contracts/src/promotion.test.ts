import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveRolloutConfig,
  resolveTargetRegistry,
  checkRolloutControls,
  fnv1aHash,
  defaultTargetRegistry,
  resolveExposureGateConfig,
  defaultExposureGateConfig,
  type TargetRegistryEntry,
} from './promotion.js';

describe('rollout controls', () => {
  describe('defaultTargetRegistry', () => {
    test('all entries have rolloutPct: 100', () => {
      for (const entry of defaultTargetRegistry) {
        assert.equal(entry.rolloutPct, 100, `${entry.target} should have rolloutPct 100`);
      }
    });
  });

  describe('resolveRolloutConfig', () => {
    test('returns empty record when env var is missing', () => {
      const result = resolveRolloutConfig({});
      assert.deepEqual(result, {});
    });

    test('returns empty record for invalid JSON', () => {
      const result = resolveRolloutConfig({ UNIT_TALK_ROLLOUT_CONFIG: 'not-json' });
      assert.deepEqual(result, {});
    });

    test('parses rolloutPct and sportFilter', () => {
      const config = JSON.stringify({
        'best-bets': { rolloutPct: 50, sportFilter: ['NBA', 'NFL'] },
        'trader-insights': { rolloutPct: 0 },
      });
      const result = resolveRolloutConfig({ UNIT_TALK_ROLLOUT_CONFIG: config });
      assert.equal(result['best-bets']?.rolloutPct, 50);
      assert.deepEqual(result['best-bets']?.sportFilter, ['NBA', 'NFL']);
      assert.equal(result['trader-insights']?.rolloutPct, 0);
    });

    test('clamps rolloutPct to 0-100', () => {
      const config = JSON.stringify({
        'best-bets': { rolloutPct: 150 },
        'trader-insights': { rolloutPct: -10 },
      });
      const result = resolveRolloutConfig({ UNIT_TALK_ROLLOUT_CONFIG: config });
      assert.equal(result['best-bets']?.rolloutPct, 100);
      assert.equal(result['trader-insights']?.rolloutPct, 0);
    });
  });

  describe('resolveTargetRegistry with rollout config', () => {
    test('merges rollout config into registry', () => {
      const registry = resolveTargetRegistry({
        UNIT_TALK_ROLLOUT_CONFIG: JSON.stringify({
          'best-bets': { rolloutPct: 25, sportFilter: ['NBA'] },
        }),
      });
      const bestBets = registry.find((e) => e.target === 'best-bets');
      assert.ok(bestBets);
      assert.equal(bestBets.rolloutPct, 25);
      assert.deepEqual(bestBets.sportFilter, ['NBA']);
    });

    test('defaults to rolloutPct 100 when no config', () => {
      const registry = resolveTargetRegistry({});
      for (const entry of registry) {
        assert.equal(entry.rolloutPct, 100);
      }
    });

    test('works with UNIT_TALK_ENABLED_TARGETS and rollout config together', () => {
      const registry = resolveTargetRegistry({
        UNIT_TALK_ENABLED_TARGETS: 'best-bets',
        UNIT_TALK_ROLLOUT_CONFIG: JSON.stringify({
          'best-bets': { rolloutPct: 50 },
        }),
      });
      const bestBets = registry.find((e) => e.target === 'best-bets');
      assert.ok(bestBets);
      assert.equal(bestBets.enabled, true);
      assert.equal(bestBets.rolloutPct, 50);
    });
  });

  describe('fnv1aHash', () => {
    test('is deterministic', () => {
      const a = fnv1aHash('pick-123:best-bets');
      const b = fnv1aHash('pick-123:best-bets');
      assert.equal(a, b);
    });

    test('produces different hashes for different inputs', () => {
      const a = fnv1aHash('pick-123:best-bets');
      const b = fnv1aHash('pick-456:best-bets');
      assert.notEqual(a, b);
    });

    test('returns unsigned 32-bit integer', () => {
      const hash = fnv1aHash('test-input');
      assert.ok(hash >= 0);
      assert.ok(hash <= 0xFFFFFFFF);
    });
  });

  describe('checkRolloutControls', () => {
    const makeRegistry = (overrides: Partial<TargetRegistryEntry> = {}): TargetRegistryEntry[] => [
      { target: 'best-bets', enabled: true, rolloutPct: 100, ...overrides },
    ];

    test('allows when rolloutPct is 100 and no sport filter', () => {
      const result = checkRolloutControls('pick-1', 'best-bets', 'NBA', makeRegistry());
      assert.equal(result.allowed, true);
    });

    test('blocks when rolloutPct is 0 (kill switch)', () => {
      const result = checkRolloutControls('pick-1', 'best-bets', 'NBA', makeRegistry({ rolloutPct: 0 }));
      assert.equal(result.allowed, false);
      assert.equal(result.skipReason, 'rollout-pct');
    });

    test('filters by sport when sportFilter is set', () => {
      const registry = makeRegistry({ sportFilter: ['NBA', 'NFL'] });
      const allowed = checkRolloutControls('pick-1', 'best-bets', 'NBA', registry);
      assert.equal(allowed.allowed, true);

      const blocked = checkRolloutControls('pick-1', 'best-bets', 'MLB', registry);
      assert.equal(blocked.allowed, false);
      assert.equal(blocked.skipReason, 'sport-filter');
    });

    test('blocks when sport is null and sportFilter is set', () => {
      const registry = makeRegistry({ sportFilter: ['NBA'] });
      const result = checkRolloutControls('pick-1', 'best-bets', null, registry);
      assert.equal(result.allowed, false);
      assert.equal(result.skipReason, 'sport-filter');
    });

    test('sport filter check happens before rollout pct', () => {
      const registry = makeRegistry({ rolloutPct: 0, sportFilter: ['NBA'] });
      const result = checkRolloutControls('pick-1', 'best-bets', 'MLB', registry);
      assert.equal(result.skipReason, 'sport-filter');
    });

    test('deterministic rollout - same pick+target always same result', () => {
      const registry = makeRegistry({ rolloutPct: 50 });
      const results = [];
      for (let i = 0; i < 10; i++) {
        results.push(checkRolloutControls('pick-abc', 'best-bets', null, registry));
      }
      const first = results[0]!.allowed;
      for (const r of results) {
        assert.equal(r.allowed, first, 'should be deterministic');
      }
    });

    test('partial rollout allows some picks and blocks others', () => {
      const registry = makeRegistry({ rolloutPct: 50 });
      let allowed = 0;
      let blocked = 0;
      // With enough diverse pick IDs, we should see both outcomes
      for (let i = 0; i < 100; i++) {
        const result = checkRolloutControls(`pick-${i}`, 'best-bets', null, registry);
        if (result.allowed) allowed++;
        else blocked++;
      }
      assert.ok(allowed > 0, 'at least some picks should be allowed at 50%');
      assert.ok(blocked > 0, 'at least some picks should be blocked at 50%');
    });

    test('returns allowed when target not in registry', () => {
      const result = checkRolloutControls('pick-1', 'unknown-target', 'NBA', []);
      assert.equal(result.allowed, true);
    });
  });
});

describe('exposure gate config', () => {
  test('returns defaults when env var is absent', () => {
    const config = resolveExposureGateConfig({});
    assert.deepStrictEqual(config, defaultExposureGateConfig);
  });

  test('returns defaults when env var is empty string', () => {
    const config = resolveExposureGateConfig({ UNIT_TALK_EXPOSURE_GATE_CONFIG: '' });
    assert.deepStrictEqual(config, defaultExposureGateConfig);
  });

  test('returns defaults when env var is malformed JSON', () => {
    const config = resolveExposureGateConfig({ UNIT_TALK_EXPOSURE_GATE_CONFIG: '{bad' });
    assert.deepStrictEqual(config, defaultExposureGateConfig);
  });

  test('returns defaults when env var is an array', () => {
    const config = resolveExposureGateConfig({ UNIT_TALK_EXPOSURE_GATE_CONFIG: '[]' });
    assert.deepStrictEqual(config, defaultExposureGateConfig);
  });

  test('parses valid overrides', () => {
    const config = resolveExposureGateConfig({
      UNIT_TALK_EXPOSURE_GATE_CONFIG: JSON.stringify({
        maxPicksPerGame: 5,
        maxPicksPerDay: 20,
        enabled: false,
      }),
    });
    assert.equal(config.maxPicksPerGame, 5);
    assert.equal(config.maxPicksPerDay, 20);
    assert.equal(config.enabled, false);
  });

  test('uses defaults for missing fields', () => {
    const config = resolveExposureGateConfig({
      UNIT_TALK_EXPOSURE_GATE_CONFIG: JSON.stringify({ maxPicksPerGame: 7 }),
    });
    assert.equal(config.maxPicksPerGame, 7);
    assert.equal(config.maxPicksPerDay, defaultExposureGateConfig.maxPicksPerDay);
    assert.equal(config.enabled, defaultExposureGateConfig.enabled);
  });

  test('ignores non-numeric maxPicksPerGame', () => {
    const config = resolveExposureGateConfig({
      UNIT_TALK_EXPOSURE_GATE_CONFIG: JSON.stringify({ maxPicksPerGame: 'five' }),
    });
    assert.equal(config.maxPicksPerGame, defaultExposureGateConfig.maxPicksPerGame);
  });

  test('default config has expected values', () => {
    assert.equal(defaultExposureGateConfig.maxPicksPerGame, 3);
    assert.equal(defaultExposureGateConfig.maxPicksPerDay, 15);
    assert.equal(defaultExposureGateConfig.enabled, true);
  });
});
