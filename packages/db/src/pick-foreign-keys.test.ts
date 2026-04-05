import assert from 'node:assert/strict';
import test from 'node:test';
import type { CanonicalPick } from '@unit-talk/contracts';
import {
  deriveMarketTypeId,
  derivePickForeignKeyCandidates,
  deriveSportId,
} from './pick-foreign-keys.js';

function buildPick(
  overrides: Partial<CanonicalPick> = {},
  metadata: Record<string, unknown> = {},
): CanonicalPick {
  return {
    id: 'pick-1',
    submissionId: 'submission-1',
    market: 'NBA - Player Prop',
    selection: 'Jayson Tatum Points O 27.5',
    source: 'smart-form',
    submittedBy: 'griff843',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'validated',
    metadata,
    createdAt: '2026-04-05T00:00:00.000Z',
    ...overrides,
  };
}

test('derives sport, capper, and canonical player prop market type from smart form metadata', () => {
  const candidates = derivePickForeignKeyCandidates(
    buildPick({}, {
      sport: 'NBA',
      capper: 'griff843',
      marketTypeId: 'player.points',
    }),
  );

  assert.deepEqual(candidates, {
    capperCandidate: 'griff843',
    sportId: 'NBA',
    marketTypeId: 'player_points_ou',
  });
});

test('derives combo market types from stat type when canonical market type id is absent', () => {
  const pick = buildPick(
    {},
    {
      sport: 'NBA',
      marketType: 'player-prop',
      statType: 'Points + Rebounds + Assists',
    },
  );

  assert.equal(deriveMarketTypeId(pick), 'player_pra_ou');
});

test('derives game markets from compact smart form market metadata', () => {
  const pick = buildPick(
    {
      market: 'NBA - Spread',
    },
    {
      sport: 'NBA',
      marketType: 'spread',
    },
  );

  assert.equal(deriveSportId(pick), 'NBA');
  assert.equal(deriveMarketTypeId(pick), 'spread');
});

test('derives MLB stat market ids from stat type fallback', () => {
  const pick = buildPick(
    {
      market: 'MLB - Player Prop',
    },
    {
      sport: 'MLB',
      marketType: 'player-prop',
      statType: 'Pitching Strikeouts',
    },
  );

  assert.equal(deriveSportId(pick), 'MLB');
  assert.equal(deriveMarketTypeId(pick), 'player_pitching_strikeouts_ou');
});

test('returns null market type for unknown manual metadata instead of inventing a FK', () => {
  const pick = buildPick(
    {
      market: 'Custom Market',
    },
    {
      sport: 'NBA',
      marketType: 'player-prop',
      statType: 'Custom Stat',
    },
  );

  assert.equal(deriveMarketTypeId(pick), null);
});
