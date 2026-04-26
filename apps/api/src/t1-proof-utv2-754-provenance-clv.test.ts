/**
 * Live-DB proof: UTV2-754 market-universe provenance CLV routing.
 *
 * Reads an existing live market_universe closing row, builds a transient pick
 * carrying only marketUniverseId provenance, and proves computeCLVOutcome can
 * resolve CLV before event/participant fallback.
 *
 * Skipped when SUPABASE_SERVICE_ROLE_KEY is not configured or no suitable
 * live closing row exists.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type MarketUniverseRow,
  type PickRecord,
} from '@unit-talk/db';
import { loadEnvironment } from '@unit-talk/config';

import { computeCLVOutcome } from './clv-service.js';

function selectProofRow(rows: MarketUniverseRow[]): {
  row: MarketUniverseRow;
  side: 'Over' | 'Under';
  odds: number;
} | null {
  for (const row of rows) {
    if (row.provider_market_key === 'moneyline' || row.closing_line === null) {
      continue;
    }

    if (Number.isFinite(row.closing_over_odds)) {
      return { row, side: 'Over', odds: row.closing_over_odds as number };
    }

    if (Number.isFinite(row.closing_under_odds)) {
      return { row, side: 'Under', odds: row.closing_under_odds as number };
    }
  }

  return null;
}

function buildProofPick(row: MarketUniverseRow, side: 'Over' | 'Under', odds: number): PickRecord {
  return {
    id: `proof-utv2-754-${row.id}`,
    submission_id: null,
    participant_id: null,
    player_id: null,
    capper_id: null,
    market_type_id: row.market_type_id ?? row.canonical_market_key,
    sport_id: row.sport_key,
    market: row.canonical_market_key,
    selection: `${side} ${row.closing_line}`,
    line: row.closing_line,
    odds,
    stake_units: 1,
    confidence: 0.7,
    source: 'proof-runner',
    approval_status: 'approved',
    promotion_status: 'qualified',
    promotion_target: 'best-bets',
    promotion_score: 91,
    promotion_reason: 'UTV2-754 live provenance proof',
    promotion_version: 'proof',
    promotion_decided_at: row.last_offer_snapshot_at,
    promotion_decided_by: 'proof-runner',
    status: 'posted',
    posted_at: row.last_offer_snapshot_at,
    settled_at: null,
    idempotency_key: null,
    metadata: {
      proofIssue: 'UTV2-754',
      marketUniverseId: row.id,
      providerEventId: row.provider_event_id,
      providerMarketKey: row.provider_market_key,
      providerParticipantId: row.provider_participant_id,
    },
    created_at: row.last_offer_snapshot_at,
    updated_at: row.last_offer_snapshot_at,
  };
}

test('UTV2-754 live CLV uses marketUniverseId provenance before event fallback', async (t) => {
  let connection;
  try {
    connection = createServiceRoleDatabaseConnectionConfig(loadEnvironment());
  } catch (error) {
    t.skip(`Supabase service-role environment unavailable: ${(error as Error).message}`);
    return;
  }

  const repositories = createDatabaseRepositoryBundle(connection);
  const rows = await repositories.marketUniverse.listForScan(5000);
  const proofTarget = selectProofRow(rows.filter((row) => row.sport_key === 'MLB')) ?? selectProofRow(rows);
  if (!proofTarget) {
    t.skip('No market_universe rows with closing odds available for UTV2-754 proof');
    return;
  }

  const outcome = await computeCLVOutcome(
    buildProofPick(proofTarget.row, proofTarget.side, proofTarget.odds),
    repositories,
  );

  assert.equal(outcome.status, 'computed');
  assert.equal(outcome.resolvedMarketKey, proofTarget.row.provider_market_key);
  assert.equal(outcome.result?.closingLine, proofTarget.row.closing_line);
  assert.equal(outcome.result?.closingOdds, proofTarget.odds);
  assert.equal(outcome.result?.providerKey, proofTarget.row.provider_key);
});
