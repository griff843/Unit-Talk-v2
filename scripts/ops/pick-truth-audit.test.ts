import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CLOSING_LINE_TABLE,
  ReadOnlyPostgrestClient,
  buildPickIdentityContext,
  buildPickTruthAuditReport,
  buildProviderMarketKeyIndex,
  createClosingOfferLookup,
  inferSelectionSide,
  recomputeGrade,
  resolveEventStartTime,
  validateGameResultIdentity,
  type ClosingOfferLookup,
  type ClosingOfferRow,
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
    supersededSettlementIds: new Set<string>(),
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
    supersededSettlementIds: new Set<string>(),
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
    ['constructor', 'read', 'transportEvidence'],
  );
  // The report's read_only block is derived from this tally, so it has to track
  // the calls actually issued rather than restate a constant.
  assert.deepEqual(client.transportEvidence(), { methods: { GET: 1 }, requests: 1 });
  await client.read<{ id: string }>({ table: 'events', select: 'id' });
  assert.deepEqual(client.transportEvidence(), { methods: { GET: 2 }, requests: 2 });
  for (const writeMethod of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
    assert.equal(writeMethod in client, false);
  }
});

// ---------------------------------------------------------------------------
// UTV2-1745 P1-A — the referenced game_results row must be PROVEN to belong to
// the pick before any recomputation can count as agreement or disagreement.
//
// Pick identity is derived from pick metadata, market_universe provenance, the
// canonical events/participants tables and the provider market alias table.
// The referenced row never supplies the identity it is validated against.
// ---------------------------------------------------------------------------

const otherEvent: EventRow = {
  id: 'event-2',
  external_id: 'provider-event-2',
  event_name: 'Other vs. Other',
  event_date: '2026-06-30',
  metadata: { starts_at: '2026-06-30T20:00:00Z' },
};

const otherParticipant: ParticipantRow = {
  id: 'participant-2',
  external_id: 'PROVIDER_PLAYER_2',
  display_name: 'Player Two',
  participant_type: 'player',
};

/** One settled pick + one referenced game_results row, nothing else. */
function identityDataset(
  row: PickRow,
  result: GameResultRow,
  recorded: 'win' | 'loss' | 'push',
  universes: MarketUniverseRow[] = [universe('universe-1')],
): TruthAuditDataset {
  return {
    settlements: [settlement('settlement-1', row.id, recorded, result.id)],
    picksById: new Map([[row.id, row]]),
    gameResultsById: new Map([[result.id, result]]),
    eventsById: new Map([
      [event.id, event],
      [otherEvent.id, otherEvent],
    ]),
    eventsByExternalId: new Map([
      [event.external_id!, event],
      [otherEvent.external_id!, otherEvent],
    ]),
    participantsById: new Map([
      [participant.id, participant],
      [otherParticipant.id, otherParticipant],
    ]),
    marketUniverseById: new Map(universes.map((u) => [u.id, u])),
    providerMarketKeysByType: new Map(),
    supersededSettlementIds: new Set<string>(),
  };
}

async function identityReport(dataset: TruthAuditDataset) {
  return buildPickTruthAuditReport(dataset, async () => [], {
    projectRef: 'test-project',
    requestedSampleSize: 1,
    gradingPopulation: 1,
    auditablePopulation: 1,
    rowCounts: [],
    generatedAt: '2026-08-30T00:00:00Z',
  });
}

test('P1-A: a real game_results row from the wrong event is unresolvable, never an agreement', async () => {
  // result-wrong is a real row — it just belongs to event-2, not this pick's event-1.
  const wrongEventResult = gameResult('result-wrong', 21, { event_id: 'event-2' });
  const report = await identityReport(
    identityDataset(pick('pick-1'), wrongEventResult, 'win'),
  );

  assert.equal(report.grading.agreements, 0);
  assert.equal(report.grading.disagreements, 0);
  assert.equal(report.grading.resolvable, 0);
  assert.equal(report.grading.unresolvable, 1);
  assert.equal(
    report.grading.unresolvable_itemized[0]?.reason,
    'game_result_event_mismatch',
  );
});

test('P1-A: correct event but wrong participant is unresolvable', async () => {
  const wrongParticipantResult = gameResult('result-wrong-participant', 21, {
    participant_id: 'participant-2',
  });
  const report = await identityReport(
    identityDataset(pick('pick-1'), wrongParticipantResult, 'win'),
  );

  assert.equal(report.grading.agreements, 0);
  assert.equal(report.grading.resolvable, 0);
  assert.equal(
    report.grading.unresolvable_itemized[0]?.reason,
    'game_result_participant_mismatch',
  );
});

test('P1-A: correct event and participant but an incompatible market is unresolvable', async () => {
  const wrongMarketResult = gameResult('result-wrong-market', 21, {
    market_key: 'rebounds-all-game-ou',
  });
  const report = await identityReport(
    identityDataset(pick('pick-1'), wrongMarketResult, 'win'),
  );

  assert.equal(report.grading.agreements, 0);
  assert.equal(report.grading.resolvable, 0);
  assert.equal(
    report.grading.unresolvable_itemized[0]?.reason,
    'game_result_market_mismatch',
  );
});

test('P1-A: a proven event + participant + market recomputes the grade', async () => {
  const report = await identityReport(
    identityDataset(pick('pick-1'), gameResult('result-1', 21), 'win'),
  );

  assert.equal(report.grading.resolvable, 1);
  assert.equal(report.grading.agreements, 1);
  assert.equal(report.grading.unresolvable, 0);
});

test('P1-A: an event-level total with a legitimately null participant stays valid', async () => {
  const totalPick = pick('pick-total', {
    market: 'game_total_ou',
    market_type_id: 'game_total_ou',
    selection: 'over',
    line: 210.5,
    participant_id: null,
    metadata: {
      eventId: 'event-1',
      providerEventId: 'provider-event-1',
      providerMarketKey: 'points-all-game-ou',
      marketUniverseId: 'universe-total',
    },
  });
  const totalResult = gameResult('result-total', 215, {
    participant_id: null,
    market_key: 'points-all-game-ou',
  });
  const report = await identityReport(
    identityDataset(totalPick, totalResult, 'win', [
      universe('universe-total', {
        participant_id: null,
        provider_participant_id: null,
      }),
    ]),
  );

  assert.equal(report.grading.resolvable, 1);
  assert.equal(report.grading.agreements, 1);
  assert.equal(report.grading.unresolvable, 0);
});

test('P1-A negative control: without identity validation the wrong-event row WOULD have agreed', async () => {
  const wrongEventResult = gameResult('result-wrong', 21, { event_id: 'event-2' });
  const row = pick('pick-1');

  // The mutation: drop the identity check. Everything downstream of it is
  // unchanged, and it produces the recorded result exactly — so the pre-fix
  // ladder counted this wrong-but-real row as an agreement.
  assert.equal(recomputeGrade(wrongEventResult.actual_value, row.line!, 'over'), 'win');

  // The identity check is therefore the only thing standing between a real
  // game_results id from another event and a fabricated agreement.
  const identity = buildPickIdentityContext(
    row,
    universe('universe-1'),
    new Map([[event.id, event], [otherEvent.id, otherEvent]]),
    new Map([[event.external_id!, event]]),
    new Map(),
  );
  assert.equal(
    validateGameResultIdentity(identity, wrongEventResult),
    'game_result_event_mismatch',
  );
  assert.equal(validateGameResultIdentity(identity, gameResult('result-1', 21)), null);

  // And the report agrees: unresolvable, not an agreement.
  const report = await identityReport(identityDataset(row, wrongEventResult, 'win'));
  assert.equal(report.grading.agreements, 0);
  assert.equal(
    report.grading.unresolvable_itemized[0]?.reason,
    'game_result_event_mismatch',
  );
});

test('P1-A: pick-side identity never reads the referenced game_results row', () => {
  // A real decoy: the referenced game result names a DIFFERENT event that also
  // exists in the events map. If identity were derived from the game result the
  // audit would resolve `event-2` and then validate that row against itself.
  const decoyEvent = { ...event, id: 'event-2', external_id: 'ext-event-2' };
  const decoyIdentity = buildPickIdentityContext(
    pick('pick-decoy', { metadata: { eventId: 'event-1' } }),
    null,
    new Map([[event.id, event], [decoyEvent.id, decoyEvent]]),
    new Map([[event.external_id!, event], [decoyEvent.external_id!, decoyEvent]]),
    new Map(),
  );
  assert.equal(decoyIdentity.event?.id, 'event-1');
  assert.equal(
    validateGameResultIdentity(decoyIdentity, {
      ...gameResult('result-decoy', 21),
      event_id: 'event-2',
    }),
    'game_result_event_mismatch',
  );

  const identity = buildPickIdentityContext(
    pick('pick-1', { metadata: { eventId: 'event-1' } }),
    null,
    new Map([[event.id, event]]),
    new Map([[event.external_id!, event]]),
    new Map(),
  );
  assert.equal(identity.event?.id, 'event-1');
  // No provider market key is derivable without universe/metadata/alias, so the
  // audit fails closed rather than borrowing the game result's market key.
  assert.equal(identity.providerMarketKey, null);
  assert.equal(
    validateGameResultIdentity(identity, gameResult('result-1', 21)),
    'game_result_identity_unverifiable',
  );
});

// ---------------------------------------------------------------------------
// UTV2-1745 P1-B — CLV must read the canonical production closing-line source,
// provider_offer_history, with production's resolver semantics:
//   DatabaseProviderOfferRepository.findClosingLine
//     .eq('provider_event_id') .eq('provider_market_key')
//     .lte('snapshot_at', before)   participant: eq / is null
//     bookmaker_key filtered only when declared
//     .order('snapshot_at', desc).limit(1)
//   apps/api/src/clv-service.ts: pinnacle pass, then consensus pass.
// ---------------------------------------------------------------------------

interface CapturedRead {
  table: string;
  params: URLSearchParams;
}

const HISTORY_COLUMNS = [
  'id',
  'provider_event_id',
  'provider_market_key',
  'provider_participant_id',
  'provider_key',
  'bookmaker_key',
  'is_closing',
  'line',
  'over_odds',
  'under_odds',
  'snapshot_at',
] as const;

function historyRow(overrides: Partial<ClosingOfferRow> & { id: string }): ClosingOfferRow {
  return {
    provider_event_id: 'provider-event-1',
    provider_market_key: 'points-all-game-ou',
    provider_participant_id: 'PROVIDER_PLAYER_1',
    provider_key: 'sgo',
    bookmaker_key: null,
    is_closing: false,
    line: 20.5,
    over_odds: -105,
    under_odds: -115,
    snapshot_at: '2026-06-30T22:00:00Z',
    ...overrides,
  };
}

/**
 * A PostgREST stand-in that actually honours eq / is.null / lte, order and
 * limit, so the filter assertions below are semantic and not just string
 * matching on a URL.
 */
function fakePostgrest(
  rowsByTable: Readonly<Record<string, readonly ClosingOfferRow[]>>,
  captured: CapturedRead[],
) {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input));
    const table = url.pathname.split('/').pop()!;
    captured.push({ table, params: new URLSearchParams(url.search) });

    let rows = [...(rowsByTable[table] ?? [])];
    for (const [column, filter] of url.searchParams.entries()) {
      if (['select', 'order', 'limit', 'offset'].includes(column)) continue;
      const value = (row: ClosingOfferRow) =>
        (row as unknown as Record<string, unknown>)[column];
      if (filter === 'is.null') rows = rows.filter((row) => value(row) === null);
      else if (filter.startsWith('eq.')) {
        rows = rows.filter((row) => String(value(row)) === filter.slice(3));
      } else if (filter.startsWith('lte.')) {
        rows = rows.filter((row) => String(value(row)) <= filter.slice(4));
      } else throw new Error(`unsupported filter ${column}=${filter}`);
    }

    const order = url.searchParams.get('order');
    if (order === 'snapshot_at.desc') {
      rows.sort((left, right) =>
        (right.snapshot_at ?? '').localeCompare(left.snapshot_at ?? ''),
      );
    }
    const limit = url.searchParams.get('limit');
    if (limit) rows = rows.slice(0, Number(limit));

    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}`,
      },
    });
  };
}

function historyClient(
  rows: readonly ClosingOfferRow[],
  captured: CapturedRead[],
  table: string = CLOSING_LINE_TABLE,
): ReadOnlyPostgrestClient {
  return new ReadOnlyPostgrestClient(
    'https://example.supabase.co',
    'read-key',
    fakePostgrest({ [table]: rows }, captured),
  );
}

/** The pick used by the CLV tests: participant-scoped, priced both ways. */
function clvDataset(row: PickRow = pick('pick-1')): TruthAuditDataset {
  return {
    settlements: [settlement('settlement-1', row.id, 'win', 'result-1')],
    picksById: new Map([[row.id, row]]),
    gameResultsById: new Map([['result-1', gameResult('result-1', 21)]]),
    eventsById: new Map([[event.id, event]]),
    eventsByExternalId: new Map([[event.external_id!, event]]),
    participantsById: new Map([[participant.id, participant]]),
    marketUniverseById: new Map([
      // closing_line null: production's market_universe provenance
      // short-circuit must not fire and mask the provider_offer_history
      // result under test.
      ['universe-1', universe('universe-1', { closing_line: null })],
    ]),
    // Production resolves the offer-lookup market key through the alias table
    // only (clv-service.ts), never through metadata, so the alias rows must be
    // present for the lookup to query the provider-native key.
    supersededSettlementIds: new Set<string>(),
    providerMarketKeysByType: new Map([
      ['player_points_ou', 'points-all-game-ou'],
      ['game_total_ou', 'points-all-game-ou'],
    ]),
  };
}

async function clvReport(dataset: TruthAuditDataset, lookup: ClosingOfferLookup) {
  return buildPickTruthAuditReport(dataset, lookup, {
    projectRef: 'test-project',
    requestedSampleSize: 1,
    gradingPopulation: 1,
    auditablePopulation: 1,
    rowCounts: [],
    generatedAt: '2026-08-30T00:00:00Z',
  });
}

test('P1-B: the audit reads provider_offer_history, never legacy provider_offers', async () => {
  const captured: CapturedRead[] = [];
  const client = historyClient([historyRow({ id: 'offer-1' })], captured);
  await clvReport(clvDataset(), createClosingOfferLookup(client));

  assert.ok(captured.length > 0);
  assert.deepEqual([...new Set(captured.map((call) => call.table))], [
    'provider_offer_history',
  ]);
  assert.equal(
    captured.some((call) => call.table === 'provider_offers'),
    false,
  );
  assert.equal(CLOSING_LINE_TABLE, 'provider_offer_history');
  for (const column of HISTORY_COLUMNS) {
    assert.ok(captured[0]!.params.get('select')!.split(',').includes(column));
  }
});

test('P1-B: snapshots after the closing cutoff are excluded', async () => {
  const cutoff = resolveEventStartTime(event)!;
  assert.equal(cutoff, '2026-06-30T23:00:00Z');

  const captured: CapturedRead[] = [];
  const client = historyClient(
    [
      // The only row before the cutoff prices neither side.
      historyRow({ id: 'before', snapshot_at: '2026-06-30T22:00:00Z', over_odds: null, under_odds: null }),
      // A post-cutoff row that WOULD resolve CLV if the cutoff were dropped.
      historyRow({ id: 'after', snapshot_at: '2026-06-30T23:30:00Z' }),
    ],
    captured,
  );
  const report = await clvReport(clvDataset(), createClosingOfferLookup(client));

  assert.equal(captured[0]!.params.get('snapshot_at'), `lte.${cutoff}`);
  // The post-cutoff row never reached selection.
  assert.deepEqual(report.clv.failure_class_counts, { missing_priced_side: 1 });
});

test('P1-B: the latest eligible pre-cutoff snapshot is the one selected', async () => {
  const captured: CapturedRead[] = [];
  const client = historyClient(
    [
      historyRow({ id: 'old', snapshot_at: '2026-06-30T20:00:00Z', over_odds: null }),
      historyRow({ id: 'latest', snapshot_at: '2026-06-30T22:50:00Z', over_odds: -105 }),
      historyRow({ id: 'older', snapshot_at: '2026-06-30T18:00:00Z', over_odds: null }),
      historyRow({ id: 'post-cutoff', snapshot_at: '2026-07-01T02:00:00Z', over_odds: null }),
    ],
    captured,
  );
  const report = await clvReport(clvDataset(), createClosingOfferLookup(client));

  assert.equal(captured[0]!.params.get('order'), 'snapshot_at.desc');
  assert.equal(captured[0]!.params.get('limit'), '1');
  // 'latest' is the newest pre-cutoff row and is the only one with a priced
  // over side, so CLV resolves exactly when that row is the one chosen.
  assert.equal(report.clv.resolvable, 1);
  assert.deepEqual(report.clv.failure_class_counts, {});
});

test('P1-B: an event-level market queries a null participant', async () => {
  const totalPick = pick('pick-total', {
    market: 'game_total_ou',
    market_type_id: 'game_total_ou',
    line: 210.5,
    participant_id: null,
    metadata: {
      eventId: 'event-1',
      providerEventId: 'provider-event-1',
      providerMarketKey: 'points-all-game-ou',
      marketUniverseId: 'universe-1',
    },
  });
  const dataset = clvDataset(totalPick);
  dataset.marketUniverseById = new Map([
    ['universe-1', universe('universe-1', {
      closing_line: null,
      participant_id: null,
      provider_participant_id: null,
    })],
  ]);
  dataset.gameResultsById = new Map([
    ['result-1', gameResult('result-1', 215, { participant_id: null })],
  ]);

  const captured: CapturedRead[] = [];
  const client = historyClient(
    [historyRow({ id: 'event-level', provider_participant_id: null, line: 210.5 })],
    captured,
  );
  const report = await clvReport(dataset, createClosingOfferLookup(client));

  assert.equal(captured[0]!.params.get('provider_participant_id'), 'is.null');
  assert.equal(report.clv.resolvable, 1);
});

test('P1-B: a participant-scoped market requires the matching participant', async () => {
  const captured: CapturedRead[] = [];
  const client = historyClient(
    [
      historyRow({ id: 'other-player', provider_participant_id: 'PROVIDER_PLAYER_2' }),
      historyRow({ id: 'event-level', provider_participant_id: null }),
    ],
    captured,
  );
  const report = await clvReport(clvDataset(), createClosingOfferLookup(client));

  assert.equal(
    captured[0]!.params.get('provider_participant_id'),
    'eq.PROVIDER_PLAYER_1',
  );
  // Neither stored row belongs to this pick's participant, so nothing resolves.
  assert.deepEqual(report.clv.failure_class_counts, { missing_closing_line: 1 });
});

test('P1-B: production bookmaker preference and consensus fallback are preserved', async () => {
  // Pinnacle preferred even though a newer consensus row exists.
  const preferenceCaptured: CapturedRead[] = [];
  const preferenceClient = historyClient(
    [
      historyRow({ id: 'pinnacle', bookmaker_key: 'pinnacle', snapshot_at: '2026-06-30T20:00:00Z', over_odds: -101 }),
      historyRow({ id: 'consensus', bookmaker_key: null, snapshot_at: '2026-06-30T22:50:00Z', over_odds: null }),
    ],
    preferenceCaptured,
  );
  const preferred = await clvReport(clvDataset(), createClosingOfferLookup(preferenceClient));
  assert.equal(preferenceCaptured[0]!.params.get('bookmaker_key'), 'eq.pinnacle');
  // Only the pinnacle row prices the over side; resolving proves it won.
  assert.equal(preferred.clv.resolvable, 1);
  assert.equal(preferenceCaptured.length, 1, 'the consensus pass must not run once pinnacle resolves');

  // With no pinnacle row, production falls back to an unfiltered consensus pass.
  const fallbackCaptured: CapturedRead[] = [];
  const fallbackClient = historyClient(
    [historyRow({ id: 'consensus', bookmaker_key: 'draftkings', over_odds: -105 })],
    fallbackCaptured,
  );
  const fallback = await clvReport(clvDataset(), createClosingOfferLookup(fallbackClient));
  assert.equal(fallbackCaptured.length, 2);
  assert.equal(fallbackCaptured[0]!.params.get('bookmaker_key'), 'eq.pinnacle');
  assert.equal(fallbackCaptured[1]!.params.has('bookmaker_key'), false);
  assert.equal(fallback.clv.resolvable, 1);
});

test('P1-B negative control: reverting the lookup to provider_offers fails the controls', async () => {
  const rows = [historyRow({ id: 'offer-1', over_odds: -105 })];

  // Baseline: the corrected lookup reads canonical history and resolves CLV.
  const captured: CapturedRead[] = [];
  const corrected = await clvReport(
    clvDataset(),
    createClosingOfferLookup(historyClient(rows, captured)),
  );
  assert.equal(corrected.clv.resolvable, 1);
  assert.equal(captured[0]!.table, 'provider_offer_history');

  // The mutation: the pre-fix lookup, which read legacy provider_offers with a
  // provider_key/is_closing filter and no closing cutoff.
  const mutatedCaptured: CapturedRead[] = [];
  const mutatedClient = historyClient(rows, mutatedCaptured, CLOSING_LINE_TABLE);
  const mutatedLookup: ClosingOfferLookup = async (criteria) => {
    const response = await mutatedClient.read<ClosingOfferRow>({
      table: 'provider_offers',
      select: HISTORY_COLUMNS.join(','),
      filters: {
        provider_event_id: `eq.${criteria.providerEventId}`,
        provider_market_key: `eq.${criteria.providerMarketKey}`,
        provider_key: 'eq.sgo',
        provider_participant_id: criteria.providerParticipantId
          ? `eq.${criteria.providerParticipantId}`
          : 'is.null',
        is_closing: 'eq.true',
      },
      order: 'snapshot_at.desc',
      limit: 100,
    });
    return response.rows;
  };
  const mutated = await clvReport(clvDataset(), mutatedLookup);

  // Control 1 (table identity) fails under the mutation.
  assert.equal(mutatedCaptured[0]!.table, 'provider_offers');
  assert.throws(() =>
    assert.deepEqual([...new Set(mutatedCaptured.map((call) => call.table))], [
      'provider_offer_history',
    ]),
  );
  // Control 2 (cutoff) fails under the mutation: no snapshot_at bound is sent.
  assert.equal(mutatedCaptured[0]!.params.has('snapshot_at'), false);
  // And the audit's answer changes: the legacy table holds nothing.
  assert.deepEqual(mutated.clv.failure_class_counts, { missing_closing_line: 1 });
});


// ---------------------------------------------------------------------------
// Review round 2 — cohort truth, alias determinism, measured report fields.
// ---------------------------------------------------------------------------

test('a settlement superseded by a later correction is never counted as an agreement', async () => {
  // The pick's grade agrees, so without the supersession check this scores a
  // clean agreement against a settlement the pipeline has already corrected.
  const base = identityDataset(
    pick('pick-1', {
      market: 'player_points_ou',
      market_type_id: 'player_points_ou',
      line: 20.5,
      selection: 'over',
      participant_id: participant.id,
    }),
    gameResult('result-1', 21, {
      participant_id: participant.id,
      market_key: 'player_points_ou',
    }),
    'win',
  );

  const clean = await identityReport(base);
  assert.equal(clean.grading.agreements, 1);
  assert.equal(clean.grading.unresolvable, 0);

  const superseded = await identityReport({
    ...base,
    supersededSettlementIds: new Set(['settlement-1']),
  });
  assert.equal(superseded.grading.agreements, 0);
  assert.equal(superseded.grading.resolvable, 0);
  assert.equal(superseded.grading.unresolvable, 1);
  assert.equal(
    superseded.grading.unresolvable_itemized[0]?.reason,
    'settlement_superseded_by_correction',
  );
});

test('provider market alias resolution is deterministic, mirroring providerMarketKeyPriority', () => {
  // Deliberately unsorted, with all four priority classes for one market type.
  const index = buildProviderMarketKeyIndex([
    { market_type_id: 'player_points_ou', provider_market_key: 'points-ou' },
    { market_type_id: 'player_points_ou', provider_market_key: 'points-all-ou' },
    { market_type_id: 'player_points_ou', provider_market_key: 'points-all-game-ou' },
    { market_type_id: 'player_points_ou', provider_market_key: 'points-game-ou' },
  ]);
  // A last-wins Map build would have returned 'points-game-ou'.
  assert.equal(index.get('player_points_ou'), 'points-all-game-ou');

  // Same priority class -> localeCompare, not insertion order.
  const tie = buildProviderMarketKeyIndex([
    { market_type_id: 'game_total_ou', provider_market_key: 'zz-total-ou' },
    { market_type_id: 'game_total_ou', provider_market_key: 'aa-total-ou' },
  ]);
  assert.equal(tie.get('game_total_ou'), 'aa-total-ou');

  // Reversing the input must not change the answer.
  const reversed = buildProviderMarketKeyIndex([
    { market_type_id: 'game_total_ou', provider_market_key: 'aa-total-ou' },
    { market_type_id: 'game_total_ou', provider_market_key: 'zz-total-ou' },
  ]);
  assert.equal(reversed.get('game_total_ou'), tie.get('game_total_ou'));
});

test('read_only evidence is measured from the transport, not asserted', async () => {
  const report = await buildPickTruthAuditReport(
    identityDataset(pick('pick-1'), gameResult('result-1', 21), 'win'),
    async () => [],
    {
      projectRef: 'test-project',
      requestedSampleSize: 1,
      gradingPopulation: 1,
      auditablePopulation: 1,
      rowCounts: [],
      generatedAt: '2026-08-30T00:00:00Z',
      transportEvidence: () => ({ methods: { GET: 41 }, requests: 41 }),
    },
  );
  assert.deepEqual(report.read_only, {
    database_writes_performed: 0,
    http_methods_issued: { GET: 41 },
    requests_issued: 41,
    non_get_requests: 0,
  });

  // A hypothetical write would surface, rather than being masked by a literal 0.
  const contaminated = await buildPickTruthAuditReport(
    identityDataset(pick('pick-1'), gameResult('result-1', 21), 'win'),
    async () => [],
    {
      projectRef: 'test-project',
      requestedSampleSize: 1,
      gradingPopulation: 1,
      auditablePopulation: 1,
      rowCounts: [],
      generatedAt: '2026-08-30T00:00:00Z',
      transportEvidence: () => ({ methods: { GET: 40, POST: 1 }, requests: 41 }),
    },
  );
  assert.equal(contaminated.read_only.non_get_requests, 1);
  assert.equal(contaminated.read_only.database_writes_performed, 1);
});


// Each of the two P1-A hardening mechanisms below is isolated deliberately: the
// combined attack is blocked by either one alone, so a single scenario cannot
// tell you whether both are load-bearing.

test('P1-A drift guard: a game-total market_type_id on a player pick is not event-scoped', async () => {
  // market_type_id claims a game total, but everything else says player prop.
  // Without clv-service.ts's drift guard the audit would treat this as
  // event-scoped, accept the null-participant game_results row, and agree.
  const drifted = pick('pick-drift', {
    market: 'player_points_ou',
    market_type_id: 'game_total_ou',
    participant_id: participant.id,
    line: 20.5,
    selection: 'over',
  });
  const eventScopedRow = gameResult('result-drift', 21, {
    participant_id: null,
    market_key: 'points-all-game-ou',
  });

  const dataset = {
    ...identityDataset(drifted, eventScopedRow, 'win'),
    // Alias the player market onto the same provider key so the ONLY thing
    // standing between this pick and an apparent agreement is the drift guard.
    providerMarketKeysByType: new Map([
      ['player_points_ou', 'points-all-game-ou'],
      ['game_total_ou', 'points-all-game-ou'],
    ]),
  };

  const identity = buildPickIdentityContext(
    drifted,
    dataset.marketUniverseById.get('universe-1') ?? null,
    dataset.eventsById,
    dataset.eventsByExternalId,
    dataset.providerMarketKeysByType,
  );
  assert.equal(identity.eventScoped, false);
  assert.equal(identity.marketIdentityConflict, false, 'market claims must be consistent here');
  assert.equal(
    validateGameResultIdentity(identity, eventScopedRow),
    'game_result_participant_mismatch',
  );

  const report = await identityReport(dataset);
  assert.equal(report.grading.agreements, 0);
  assert.equal(report.grading.unresolvable, 1);
});

test('P1-A conflict detection: an unaliasable extra market claim is unverifiable', async () => {
  // Event and participant both match, and the game_results market_key IS a
  // legitimate candidate — the only defect is that the pick separately claims a
  // provider market key that maps to nothing in the candidate set.
  const conflicted = pick('pick-conflict', {
    metadata: {
      eventId: 'event-1',
      providerEventId: 'provider-event-1',
      providerMarketKey: 'rebounds-all-game-ou',
      providerParticipantId: 'PROVIDER_PLAYER_1',
      marketUniverseId: 'universe-1',
    },
  });
  const matchingRow = gameResult('result-conflict', 21);

  const dataset = {
    ...identityDataset(conflicted, matchingRow, 'win'),
    providerMarketKeysByType: new Map([['player_points_ou', 'points-all-game-ou']]),
  };

  const identity = buildPickIdentityContext(
    conflicted,
    dataset.marketUniverseById.get('universe-1') ?? null,
    dataset.eventsById,
    dataset.eventsByExternalId,
    dataset.providerMarketKeysByType,
  );
  assert.equal(identity.eventScoped, false);
  assert.equal(identity.marketIdentityConflict, true);
  assert.equal(
    validateGameResultIdentity(identity, matchingRow),
    'game_result_identity_unverifiable',
  );

  const report = await identityReport(dataset);
  assert.equal(report.grading.agreements, 0);
  assert.equal(report.grading.unresolvable, 1);
  assert.equal(
    report.grading.unresolvable_itemized[0]?.reason,
    'game_result_identity_unverifiable',
  );
});
