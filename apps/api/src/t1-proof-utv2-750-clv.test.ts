import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDatabaseClientFromConnection,
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type PickRecord,
} from '@unit-talk/db';
import { loadEnvironment } from '@unit-talk/config';

import { computeCLVOutcome } from './clv-service.js';

const STALE_MLB_ALIASES = [
  'batting-doubles-all-game-ou',
  'batting-hits-all-game-ou',
  'batting-hits-runs-rbis-all-game-ou',
  'batting-home-runs-all-game-ou',
  'batting-rbi-all-game-ou',
  'batting-singles-all-game-ou',
  'batting-triples-all-game-ou',
  'batting-walks-all-game-ou',
  'batting-total-bases-all-game-ou',
  'pitching-earned-runs-all-game-ou',
  'pitching-hits-allowed-all-game-ou',
  'pitching-outs-all-game-ou',
  'pitching-strikeouts-all-game-ou',
];

test('UTV2-750 live MLB CLV aliases resolve and recompute missing CLV samples', async (t) => {
  let connection;
  try {
    connection = createServiceRoleDatabaseConnectionConfig(loadEnvironment());
  } catch (error) {
    t.skip(`Supabase service-role environment unavailable: ${(error as Error).message}`);
    return;
  }

  const db = createDatabaseClientFromConnection(connection);
  const repositories = createDatabaseRepositoryBundle(connection);

  const { count: staleAliasCount, error: staleAliasError } = await db
    .from('provider_market_aliases')
    .select('id', { count: 'exact', head: true })
    .eq('provider', 'sgo')
    .eq('sport_id', 'MLB')
    .in('provider_market_key', STALE_MLB_ALIASES);

  assert.ifError(staleAliasError);
  assert.equal(staleAliasCount, 0);

  const { data: gameTotalAliases, error: gameTotalAliasError } = await db
    .from('provider_market_aliases')
    .select('provider_market_key, market_type_id')
    .eq('provider', 'sgo')
    .eq('sport_id', 'MLB')
    .eq('provider_market_key', 'points-all-game-ou')
    .eq('market_type_id', 'game_total_ou')
    .limit(1);

  assert.ifError(gameTotalAliasError);
  assert.equal(gameTotalAliases?.length, 1);

  const { data: settlementRows, error: settlementRowsError } = await db
    .from('settlement_records')
    .select('pick_id, created_at')
    .filter('payload->>clvUnavailableReason', 'eq', 'missing_closing_line')
    .order('created_at', { ascending: true });

  assert.ifError(settlementRowsError);
  const candidatePickIds = [...new Set((settlementRows ?? []).map((row) => row.pick_id as string))];
  assert.ok(candidatePickIds.length > 0, 'expected historical missing-closing-line settlements');

  const pickMap = await repositories.picks.findPicksByIds(candidatePickIds);
  const samplePicks = [...pickMap.values()]
    .filter((pick) => pick.sport_id === 'MLB' && pick.market !== 'totals')
    .slice(0, 8);

  assert.ok(samplePicks.length >= 5, 'expected live MLB CLV sample picks');

  const outcomes = [];
  for (const pick of samplePicks as PickRecord[]) {
    outcomes.push(await computeCLVOutcome(pick, repositories));
  }

  const computedOutcomes = outcomes.filter(
    (outcome) => outcome.status === 'computed' || outcome.status === 'opening_line_fallback',
  );

  assert.equal(computedOutcomes.length, samplePicks.length);
  assert.ok(
    computedOutcomes.every((outcome) => outcome.resolvedMarketKey?.includes('-all-game-')),
    'expected all MLB sample markets to resolve to full-game provider keys',
  );
});
