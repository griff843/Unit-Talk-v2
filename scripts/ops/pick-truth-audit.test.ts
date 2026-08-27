import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ReadOnlyPostgrestClient,
  buildPickTruthAuditReport,
  inferSelectionSide,
  recomputeGrade,
  type EventRow,
  type GameResultRow,
  type MarketUniverseRow,
  type ParticipantRow,
  type PickRow,
  type SettlementRow,
  type TruthAuditDataset,
} from './pick-truth-audit.js';

function settlement(
  id: string,
  pickId: string,
  result: 'win' | 'loss' | 'push',
  gameResultId: string | null,
): SettlementRow {
  return {
    id,
    pick_id: pickId,
    status: 'settled',
    result,
    source: 'grading',
    evidence_ref: gameResultId ? `game-result:${gameResultId}` : null,
    payload: gameResultId
      ? { gradingContext: { gameResultId }, clvStatus: 'computed' }
      : { clvStatus: 'missing_event_context' },
    settled_at: '2026-07-01T00:00:00Z',
    corrects_id: null,
  };
}

function pick(
  id: string,
  overrides: Partial<PickRow> = {},
): PickRow {
  return {
    id,
    market: 'player_points_ou',
    market_type_id: 'player_points_ou',
    selection: 'over',
    line: 20.5,
    odds: -110,
    participant_id: 'participant-1',
    status: 'settled',
    metadata: {
      eventId: 'event-1',
      providerEventId: 'provider-event-1',
      providerMarketKey: 'points-all-game-ou',
      providerParticipantId: 'PROVIDER_PLAYER_1',
      marketUniverseId: 'universe-1',
    },
    created_at: '2026-06-30T00:00:00Z',
    ...overrides,
  };
}

function gameResult(
  id: string,
  actualValue: number,
  overrides: Partial<GameResultRow> = {},
): GameResultRow {
  return {
    id,
    event_id: 'event-1',
    participant_id: 'participant-1',
    market_key: 'points-all-game-ou',
    actual_value: actualValue,
    ...overrides,
  };
}

const event: EventRow = {
  id: 'event-1',
  external_id: 'provider-event-1',
  event_name: 'Visitor vs. Home',
  event_date: '2026-06-30',
  metadata: { starts_at: '2026-06-30T23:00:00Z' },
};

const participant: ParticipantRow = {
  id: 'participant-1',
  external_id: 'PROVIDER_PLAYER_1',
  display_name: 'Player One',
  participant_type: 'player',
};

function universe(
  id: string,
  overrides: Partial<MarketUniverseRow> = {},
): MarketUniverseRow {
  return {
    id,
    event_id: 'event-1',
    participant_id: 'participant-1',
    provider_event_id: 'provider-event-1',
    provider_market_key: 'points-all-game-ou',
    provider_participant_id: 'PROVIDER_PLAYER_1',
    provider_key: 'sgo',
    closing_line: 20.5,
    closing_over_odds: -105,
    closing_under_odds: -115,
    last_offer_snapshot_at: '2026-06-30T22:55:00Z',
    ...overrides,
  };
}

test('selection parsing and independent grade recomputation cover over, under, and push', () => {
  assert.equal(inferSelectionSide('Player Over 20.5'), 'over');
  assert.equal(inferSelectionSide('Player U 7.5'), 'under');
  assert.equal(inferSelectionSide('moneyline'), null);
  assert.equal(recomputeGrade(21, 20.5, 'over'), 'win');
  assert.equal(recomputeGrade(21, 20.5, 'under'), 'loss');
  assert.equal(recomputeGrade(20.5, 20.5, 'under'), 'push');
});

test('audit itemizes grading disagreements, named CLV failures, and structural blockers', async () => {
  const settlements = [
    settlement('settlement-1', 'pick-1', 'win', 'result-1'),
    settlement('settlement-2', 'pick-2', 'win', 'result-2'),
    settlement('settlement-3', 'pick-3', 'loss', null),
  ];
  const picks = [
    pick('pick-1'),
    pick('pick-2', {
      selection: 'under',
      metadata: {
        eventId: 'event-1',
        providerEventId: 'provider-event-1',
        providerMarketKey: 'points-all-game-ou',
        providerParticipantId: 'PROVIDER_PLAYER_1',
        marketUniverseId: 'universe-2',
      },
    }),
    pick('pick-3', {
      selection: 'moneyline',
      line: null,
      odds: null,
      participant_id: null,
      metadata: {},
    }),
  ];
  const results = [gameResult('result-1', 21), gameResult('result-2', 21)];
  const universes = [
    universe('universe-1'),
    universe('universe-2', { closing_under_odds: null }),
  ];
  const dataset: TruthAuditDataset = {
    settlements,
    picksById: new Map(picks.map((row) => [row.id, row])),
    gameResultsById: new Map(results.map((row) => [row.id, row])),
    eventsById: new Map([[event.id, event]]),
    eventsByExternalId: new Map([[event.external_id!, event]]),
    participantsById: new Map([[participant.id, participant]]),
    marketUniverseById: new Map(universes.map((row) => [row.id, row])),
    providerMarketKeysByType: new Map(),
  };

  const report = await buildPickTruthAuditReport(
    dataset,
    async () => [],
    {
      projectRef: 'test-project',
      requestedSampleSize: 3,
      gradingPopulation: 3,
      auditablePopulation: 3,
      rowCounts: [{ table: 'picks', count: 3 }],
      generatedAt: '2026-08-26T00:00:00Z',
    },
  );

  assert.equal(report.grading.resolvable, 2);
  assert.equal(report.grading.agreements, 1);
  assert.equal(report.grading.disagreements, 1);
  assert.equal(report.grading.unresolvable, 1);
  assert.equal(report.grading.agreement_rate_pct, 50);
  assert.deepEqual(report.grading.disagreements_itemized[0], {
    settlement_id: 'settlement-2',
    pick_id: 'pick-2',
    recorded_result: 'win',
    recomputed_result: 'loss',
    game_result_id: 'result-2',
    actual_value: 21,
    line: 20.5,
    side: 'under',
  });
  assert.equal(
    report.grading.unresolvable_itemized[0]?.reason,
    'missing_game_result_reference',
  );
  assert.deepEqual(report.clv.failure_class_counts, {
    missing_priced_side: 1,
    missing_pick_odds: 1,
  });
  assert.equal(report.structural.orphaned_event, 1);
  assert.equal(report.structural.missing_participant, 1);
  assert.equal(report.structural.unresolvable_market, 1);
  assert.equal(report.verdict.answer, 'no');
  assert.equal(report.systemic_defect.detected, true);
});

test('CLV names missing_closing_line instead of assuming missing_event_context', async () => {
  const row = pick('pick-1', {
    metadata: {
      eventId: 'event-1',
      providerEventId: 'provider-event-1',
      providerMarketKey: 'points-all-game-ou',
      providerParticipantId: 'PROVIDER_PLAYER_1',
    },
  });
  const result = gameResult('result-1', 21);
  const dataset: TruthAuditDataset = {
    settlements: [settlement('settlement-1', row.id, 'win', result.id)],
    picksById: new Map([[row.id, row]]),
    gameResultsById: new Map([[result.id, result]]),
    eventsById: new Map([[event.id, event]]),
    eventsByExternalId: new Map([[event.external_id!, event]]),
    participantsById: new Map([[participant.id, participant]]),
    marketUniverseById: new Map(),
    providerMarketKeysByType: new Map(),
  };
  const report = await buildPickTruthAuditReport(dataset, async () => [], {
    projectRef: 'test-project',
    requestedSampleSize: 1,
    gradingPopulation: 1,
    auditablePopulation: 1,
    rowCounts: [],
  });
  assert.deepEqual(report.clv.failure_class_counts, { missing_closing_line: 1 });
  assert.equal(report.clv.failures_itemized[0]?.reason, 'missing_closing_line');
});

test('production transport exposes only GET and no write method', async () => {
  const calls: RequestInit[] = [];
  const client = new ReadOnlyPostgrestClient(
    'https://example.supabase.co',
    'read-key',
    async (_input, init) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify([{ id: 'row-1' }]), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-range': '0-0/1',
        },
      });
    },
  );

  const response = await client.read<{ id: string }>({
    table: 'picks',
    select: 'id',
    exactCount: true,
  });
  assert.deepEqual(response, { rows: [{ id: 'row-1' }], count: 1 });
  assert.deepEqual(calls.map((call) => call.method), ['GET']);
  assert.deepEqual(
    Object.getOwnPropertyNames(ReadOnlyPostgrestClient.prototype).sort(),
    ['constructor', 'read'],
  );
  for (const writeMethod of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
    assert.equal(writeMethod in client, false);
  }
});
