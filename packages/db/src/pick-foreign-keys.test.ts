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

test('derives game total market type from legacy smart-form totals alias', () => {
  const pick = buildPick(
    {
      market: 'totals',
    },
    {
      sport: 'MLB',
    },
  );

  assert.equal(deriveSportId(pick), 'MLB');
  assert.equal(deriveMarketTypeId(pick), 'game_total_ou');
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

test('derives NBA from SGO-format market key nba-spread when metadata.sport is absent', () => {
  const pick = buildPick({ market: 'nba-spread' }, {});
  assert.equal(deriveSportId(pick), 'NBA');
  assert.equal(deriveMarketTypeId(pick), 'spread');
});

test('derives NBA from SGO market key nba-ml', () => {
  const pick = buildPick({ market: 'nba-ml' }, {});
  assert.equal(deriveSportId(pick), 'NBA');
  assert.equal(deriveMarketTypeId(pick), 'moneyline');
});

test('derives NBA from SGO market key nba-total', () => {
  const pick = buildPick({ market: 'nba-total' }, {});
  assert.equal(deriveSportId(pick), 'NBA');
  assert.equal(deriveMarketTypeId(pick), 'game_total_ou');
});

test('normalizes WNBA metadata and manual market keys to canonical pick foreign keys', () => {
  const metadataPick = buildPick(
    { market: 'WNBA - Player Prop' },
    { sport: 'wnba', marketType: 'player-prop', statType: 'Points' },
  );
  assert.equal(deriveSportId(metadataPick), 'WNBA');
  assert.equal(deriveMarketTypeId(metadataPick), 'player_points_ou');

  const marketPick = buildPick({ market: 'wnba-spread' }, {});
  assert.equal(deriveSportId(marketPick), 'WNBA');
  assert.equal(deriveMarketTypeId(marketPick), 'spread');
});

test('normalizes WNBA moneyline and total aliases without inventing market ids', () => {
  assert.equal(deriveMarketTypeId(buildPick({ market: 'wnba-ml' }, {})), 'moneyline');
  assert.equal(deriveMarketTypeId(buildPick({ market: 'wnba-total' }, {})), 'game_total_ou');
});

test('keeps WNBA sport FK normalization bounded to manual human sources', () => {
  const apiPick = buildPick(
    { source: 'api', market: 'moneyline' },
    { sport: 'WNBA' },
  );
  assert.equal(deriveSportId(apiPick), null);

  const prefixedApiPick = buildPick({ source: 'api', market: 'wnba-ml' }, {});
  assert.equal(deriveSportId(prefixedApiPick), null);

  const alertAgentPick = buildPick(
    { source: 'alert-agent', market: 'moneyline' },
    { sport: 'WNBA' },
  );
  assert.equal(deriveSportId(alertAgentPick), 'WNBA');
});

test('derives NFL from SGO market key nfl-spread when metadata.sport is absent', () => {
  const pick = buildPick({ market: 'nfl-spread' }, {});
  assert.equal(deriveSportId(pick), 'NFL');
  assert.equal(deriveMarketTypeId(pick), 'spread');
});

test('normalizeSportId handles Soccer and Tennis case-insensitively', () => {
  const soccerPick = buildPick({ market: 'soccer-ml' }, { sport: 'Soccer' });
  assert.equal(deriveSportId(soccerPick), 'Soccer');

  const tennisPick = buildPick({ market: 'tennis-ml' }, { sport: 'Tennis' });
  assert.equal(deriveSportId(tennisPick), 'Tennis');
});

test('deriveSportId falls back to market prefix even when deriveMarketTypeId returns null', () => {
  const pick = buildPick({ market: 'nba-spread' }, {});
  assert.equal(deriveSportId(pick), 'NBA');
});
