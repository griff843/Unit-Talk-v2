import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CLOSING_LINE_TABLE,
  ReadOnlyPostgrestClient,
  buildPickIdentityContext,
  buildPickTruthAuditReport,
  buildProviderMarketKeyIndex,
  createMarketUniverseClosingLookup,
  readRetainedEventStartTime,
  usesNullParticipantForClosingLookup,
  buildGradingClvContext,
  gradingContextEventId,
  normalizeDisplayName,
  resolveClosingCutoff,
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
  readByIds,
  loadAuditDataset,
  participantNameKey,
  asProductionClosingLine,
  selectLatestClosingOffer,
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
  // Not "does a method with one of these names exist" — that cannot fail. The
  // real property is that the ONLY transport member is read(), it always sends
  // GET, and it refuses redirects (which could otherwise turn into a non-GET).
  assert.deepEqual(calls.map((call) => call.redirect), ['error', 'error']);
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

  // Everything downstream of the identity check is satisfied by this row: the
  // recomputed grade equals the recorded one, so with the check removed the
  // ladder reaches agreement. That is what makes the check load-bearing rather
  // than decorative.
  assert.equal(recomputeGrade(wrongEventResult.actual_value, row.line!, 'over'), 'win');
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
      else if (filter === 'not.is.null') rows = rows.filter((row) => value(row) !== null);
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
  // Asserted against production's rule (metadata.starts_at, else the event date
  // at 23:59:59Z) rather than against resolveEventStartTime itself, which would
  // only prove the helper agrees with itself.
  const startsAt = (event.metadata as { starts_at: string }).starts_at;
  assert.equal(startsAt, '2026-06-30T23:00:00Z');
  const cutoff = resolveEventStartTime(event)!;
  assert.equal(cutoff, startsAt);
  // And the event-date fallback is the other half of production's rule.
  assert.equal(
    resolveEventStartTime({ ...event, metadata: {} }),
    `${event.event_date}T23:59:59Z`,
  );

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


// ---------------------------------------------------------------------------
// Review round 3 — defects found by the second adversarial pass.
// ---------------------------------------------------------------------------

test('P1-A: a metadata market key cannot validate itself into the candidate set', async () => {
  // No market_universe row, so metadata.providerMarketKey is the only provider
  // spelling the pick carries. An earlier revision seeded the candidate set
  // FROM that value and then "checked" it against the set it had populated, so
  // the claim validated itself and a real game_results row for the wrong market
  // was accepted — a rebounds row graded against a points line.
  const lying = pick('pick-lying', {
    market: 'player_points_ou',
    market_type_id: 'player_points_ou',
    line: 20.5,
    selection: 'over',
    participant_id: participant.id,
    metadata: { eventId: 'event-1', providerMarketKey: 'rebounds-all-game-ou' },
  });
  const rebounds = gameResult('result-rebounds', 9, {
    market_key: 'rebounds-all-game-ou',
  });

  const aliases = new Map([
    ['player_points_ou', 'points-all-game-ou'],
    ['player_rebounds_ou', 'rebounds-all-game-ou'],
  ]);
  const identity = buildPickIdentityContext(lying, null, new Map([[event.id, event]]),
    new Map([[event.external_id!, event]]), aliases);

  assert.equal(identity.marketIdentityConflict, true);
  assert.deepEqual([...identity.marketKeyCandidates].sort(),
    ['player_points_ou', 'points_all_game_ou']);
  assert.equal(
    validateGameResultIdentity(identity, rebounds),
    'game_result_identity_unverifiable',
  );

  const report = await identityReport({
    ...identityDataset(lying, rebounds, 'loss', []),
    providerMarketKeysByType: aliases,
  });
  assert.equal(report.grading.agreements, 0);
  assert.equal(report.grading.unresolvable, 1);
});

test('P1-A: pick-side provenance still seeds identity when the alias table has no mapping', async () => {
  // The mirror image of the test above: with no alias entry there is no
  // authoritative provider spelling, so agreeing provenance is the only source
  // of one and must still be usable. Failing closed here would be a regression.
  const row = pick('pick-1');
  const identity = buildPickIdentityContext(row, universe('universe-1'),
    new Map([[event.id, event]]), new Map([[event.external_id!, event]]), new Map());

  assert.equal(identity.marketIdentityConflict, false);
  assert.ok(identity.marketKeyCandidates.has('points_all_game_ou'));
  assert.equal(validateGameResultIdentity(identity, gameResult('result-1', 21)), null);
});

test('P1-B: the closing cutoff is the pick\'s retained event start time, not the event date', async () => {
  // clv-service.ts's readRetainedEventStartTime: for event-scoped totals
  // production prefers metadata.eventStartTime/eventTime over anything derived
  // from the event row. Using the event-derived value sends a LATER cutoff and
  // selects an in-play snapshot production would never see.
  const total = pick('pick-total', {
    market: 'game_total_ou',
    market_type_id: 'game_total_ou',
    participant_id: null,
    metadata: {
      eventId: 'event-1',
      providerEventId: 'provider-event-1',
      eventStartTime: '2026-06-30T18:00:00Z',
      marketUniverseId: 'universe-1',
    },
  });

  assert.equal(readRetainedEventStartTime(total), '2026-06-30T18:00:00Z');
  // The event says 23:00Z; the pick says 18:00Z; production uses the pick's.
  assert.equal(resolveEventStartTime(event), '2026-06-30T23:00:00Z');
  assert.equal(resolveClosingCutoff(total, event), '2026-06-30T18:00:00Z');
  // A player prop is NOT on that path and keeps the event-derived cutoff.
  assert.equal(resolveClosingCutoff(pick('pick-1'), event), '2026-06-30T23:00:00Z');

  const captured: CapturedRead[] = [];
  const client = historyClient(
    // The only snapshot is three hours after tipoff — an in-play line.
    [historyRow({ id: 'in-play', snapshot_at: '2026-06-30T21:00:00Z' })],
    captured,
  );
  const report = await clvReport(clvDataset(total), createClosingOfferLookup(client));

  assert.equal(captured[0]!.params.get('snapshot_at'), 'lte.2026-06-30T18:00:00Z');
  assert.equal(report.clv.resolvable, 0);
  assert.deepEqual(report.clv.failure_class_counts, { missing_closing_line: 1 });
});

test('a moneyline pick with no participant is not a structural blocker', async () => {
  // Production sends a null participant for moneyline, so a team moneyline pick
  // carrying metadata.teamId rather than a participant is normal, not broken.
  const moneyline = pick('pick-ml', {
    market: 'moneyline',
    market_type_id: 'moneyline',
    line: null,
    selection: 'home',
    participant_id: null,
    metadata: { eventId: 'event-1', providerEventId: 'provider-event-1', teamId: 'team-1' },
  });
  assert.equal(usesNullParticipantForClosingLookup(moneyline), true);

  const report = await identityReport(identityDataset(moneyline, gameResult('result-1', 21), 'win', []));
  assert.equal(report.structural.missing_participant, 0);
  // It is still declined for CLV, under its own named reason rather than a
  // participant complaint.
  assert.equal(
    report.clv.failures_itemized[0]?.reason,
    'moneyline_clv_unreachable_on_grading_path',
  );
});

test('the market_universe closing lookup mirrors findClosingLineByProviderKey', async () => {
  const captured: CapturedRead[] = [];
  const client = historyClient([], captured, 'market_universe');
  const lookup = createMarketUniverseClosingLookup(client);

  await lookup({
    providerEventId: 'provider-event-1',
    providerMarketKey: 'points-all-game-ou',
    providerParticipantId: 'PROVIDER_PLAYER_1',
  });
  assert.equal(captured[0]!.table, 'market_universe');
  assert.equal(captured[0]!.params.get('closing_line'), 'not.is.null');
  assert.equal(captured[0]!.params.get('provider_participant_id'), 'eq.PROVIDER_PLAYER_1');
  // findClosingLineByProviderKey does NOT filter provider_key.
  assert.equal(captured[0]!.params.has('provider_key'), false);

  await lookup({
    providerEventId: 'provider-event-1',
    providerMarketKey: 'points-all-game-ou',
    providerParticipantId: null,
  });
  assert.equal(captured[1]!.params.get('provider_participant_id'), 'is.null');

  // Production branches on `=== null`, so an empty string is an eq filter.
  await lookup({
    providerEventId: 'provider-event-1',
    providerMarketKey: 'points-all-game-ou',
    providerParticipantId: '',
  });
  assert.equal(captured[2]!.params.get('provider_participant_id'), 'eq.');
});

test('the odds gate mirrors production exactly and does not refuse zero odds', async () => {
  // clv-service.ts gates only on !Number.isFinite(pick.odds ?? null). An extra
  // `|| pick.odds === 0` would refuse a pick production still prices.
  const zeroOdds = pick('pick-zero', { odds: 0 });
  const report = await clvReport(
    clvDataset(zeroOdds),
    createClosingOfferLookup(historyClient([historyRow({ id: 'offer-1' })], [])),
  );
  assert.equal(report.clv.failure_class_counts['missing_pick_odds'], undefined);
  assert.equal(report.clv.resolvable, 1);

  const nullOdds = pick('pick-null', { odds: null });
  const declined = await clvReport(
    clvDataset(nullOdds),
    createClosingOfferLookup(historyClient([historyRow({ id: 'offer-1' })], [])),
  );
  assert.deepEqual(declined.clv.failure_class_counts, { missing_pick_odds: 1 });
});


// ---------------------------------------------------------------------------
// Review round 4 — defects found by the third adversarial pass.
// ---------------------------------------------------------------------------

test('P1-A: a provider market key OWNED by another market cannot seed identity', async () => {
  // The `no alias mapping` branch was a hole: with no alias row for the pick's
  // canonical market, its own metadata claim became the candidate set and
  // validated itself. `rebounds-all-game-ou` belongs to player_rebounds_ou, so a
  // points pick claiming it is asserting another market's identity, and a real
  // rebounds game_results row must not be allowed to grade a points line.
  const lying = pick('pick-unaliased', {
    market: 'Points O/U',
    market_type_id: 'Points O/U',
    metadata: { eventId: 'event-1', providerMarketKey: 'rebounds-all-game-ou' },
  });
  const rebounds = gameResult('result-reb', 9, { market_key: 'rebounds-all-game-ou' });
  const owners = new Map<string, ReadonlySet<string>>([
    ['rebounds-all-game-ou', new Set(['player_rebounds_ou'])],
  ]);

  const identity = buildPickIdentityContext(lying, null, new Map([[event.id, event]]),
    new Map([[event.external_id!, event]]), new Map(), owners);
  assert.equal(identity.marketIdentityConflict, true);
  assert.equal(
    validateGameResultIdentity(identity, rebounds),
    'game_result_identity_unverifiable',
  );

  // Without the reverse index the claim seeds the set and the rebounds row is
  // admitted — the exact defect. This is the negative control.
  const unguarded = buildPickIdentityContext(lying, null, new Map([[event.id, event]]),
    new Map([[event.external_id!, event]]), new Map());
  assert.equal(unguarded.marketIdentityConflict, false);
  assert.equal(validateGameResultIdentity(unguarded, rebounds), null);
  assert.equal(recomputeGrade(rebounds.actual_value, lying.line!, 'over'), 'loss');
});

test('P1-A: a provider key that no market_type_id owns may still seed identity', async () => {
  // The other direction: refusing a genuinely unmapped key would deny identity
  // the pick legitimately has.
  const row = pick('pick-unmapped', {
    market: 'Points O/U',
    market_type_id: 'Points O/U',
    metadata: { eventId: 'event-1', providerMarketKey: 'points-all-game-ou' },
  });
  const identity = buildPickIdentityContext(row, null, new Map([[event.id, event]]),
    new Map([[event.external_id!, event]]), new Map(), new Map());
  assert.equal(identity.marketIdentityConflict, false);
  assert.equal(validateGameResultIdentity(identity, gameResult('result-1', 21)), null);
});

test('P1-B: CLV uses the event production graded against, not a reconstruction', async () => {
  // settlement_records rows with source='grading' are written by
  // recordGradedSettlement, which passes preResolvedContext and so bypasses
  // resolvePickEventContext entirely. Production's provider event id is the
  // GRADING event's external_id and its cutoff is that event's start time.
  const row = pick('pick-1', {
    metadata: {
      eventId: 'event-2',                    // a different event on the pick
      providerEventId: 'provider-event-2',
      providerMarketKey: 'points-all-game-ou',
      marketUniverseId: 'universe-1',
      providerParticipantId: 'STALE_PLAYER',
    },
  });
  const dataset: TruthAuditDataset = {
    ...clvDataset(row),
    // Every OTHER source of event identity points at event-2, so only the
    // grading context can produce provider-event-1. Without it the audit falls
    // back to the reconstruction and queries the wrong game.
    marketUniverseById: new Map([
      ['universe-1', universe('universe-1', {
        closing_line: null,
        event_id: 'event-2',
        provider_event_id: 'provider-event-2',
        provider_participant_id: 'STALE_PLAYER',
      })],
    ]),
    settlements: [{
      ...settlement('settlement-1', row.id, 'win', 'result-1'),
      // What production recorded when it graded: event-1.
      payload: {
        gradingContext: { gameResultId: 'result-1', eventId: 'event-1' },
        clvStatus: 'computed',
      },
    }],
    eventsById: new Map([[event.id, event], [otherEvent.id, otherEvent]]),
    eventsByExternalId: new Map([
      [event.external_id!, event],
      [otherEvent.external_id!, otherEvent],
    ]),
  };

  assert.equal(gradingContextEventId(dataset.settlements[0]!), 'event-1');
  const context = buildGradingClvContext(
    dataset.settlements[0]!, row, dataset.eventsById, dataset.participantsById,
  );
  // Event identity and cutoff come from the graded event; the participant comes
  // from the participants table, not from the pick's stale metadata claim.
  assert.deepEqual(context, {
    providerEventId: 'provider-event-1',
    eventStartTime: '2026-06-30T23:00:00Z',
    participantExternalId: 'PROVIDER_PLAYER_1',
  });

  const captured: CapturedRead[] = [];
  const client = historyClient([historyRow({ id: 'offer-1' })], captured);
  const report = await clvReport(dataset, createClosingOfferLookup(client));
  assert.equal(captured[0]!.params.get('provider_event_id'), 'eq.provider-event-1');
  assert.equal(captured[0]!.params.get('snapshot_at'), 'lte.2026-06-30T23:00:00Z');
  assert.equal(captured[0]!.params.get('provider_participant_id'), 'eq.PROVIDER_PLAYER_1');
  assert.equal(report.clv.resolvable, 1);
});

test('the grading event is used for CLV only, never to prove pick identity', async () => {
  // gradingContext.eventId is a persisted COPY of game_results.event_id
  // (apps/api/src/grading-service.ts sets `eventId: gameResult.event_id`), so
  // admitting it into the identity proof would restore the circularity P1-A
  // exists to remove: the referenced row would supply the event it is checked
  // against. It must not rescue a wrong-event row.
  const row = pick('pick-1', { metadata: {} });
  const wrongEvent = gameResult('result-wrong', 21, { event_id: 'event-2' });
  const dataset: TruthAuditDataset = {
    ...identityDataset(row, wrongEvent, 'win', []),
    settlements: [{
      ...settlement('settlement-1', row.id, 'win', 'result-wrong'),
      payload: {
        gradingContext: { gameResultId: 'result-wrong', eventId: 'event-2' },
        clvStatus: 'computed',
      },
    }],
  };
  const report = await identityReport(dataset);
  assert.equal(report.grading.agreements, 0);
  assert.deepEqual(report.grading.unresolvable_itemized.map((f) => f.reason), [
    'game_result_identity_unverifiable',
  ]);
});

test('the name-based participant fallback mirrors production uniqueness', async () => {
  // buildCLVContextFromGradingEvent falls back to a UNIQUE normalized
  // display_name match when the pick carries no participant_id.
  assert.equal(normalizeDisplayName('Paolo  Banchero!'), 'paolo banchero');
  const row = pick('pick-name', {
    participant_id: null,
    metadata: { eventId: 'event-1', player: 'Paolo Banchero', sport: 'NBA' },
  });
  const settled = {
    ...settlement('settlement-1', row.id, 'win', 'result-1'),
    payload: { gradingContext: { gameResultId: 'result-1', eventId: 'event-1' }, clvStatus: 'computed' },
  };
  const named: ParticipantRow = {
    id: 'participant-9', external_id: 'PAOLO_BANCHERO_1_NBA',
    display_name: 'Paolo Banchero', participant_type: 'player', sport: 'NBA',
  };
  const key = participantNameKey('NBA', 'Paolo Banchero');
  const unique = buildGradingClvContext(settled, row, new Map([[event.id, event]]),
    new Map(), new Map([[key, [named]]]));
  assert.equal(unique?.participantExternalId, 'PAOLO_BANCHERO_1_NBA');

  // Two players share the normalized name WITHIN the same sport: production
  // resolves null, not a guess.
  const ambiguous = buildGradingClvContext(settled, row, new Map([[event.id, event]]),
    new Map(), new Map([[key, [named, { ...named, id: 'participant-10' }]]]));
  assert.equal(ambiguous?.participantExternalId, null);
});

test('the name-fallback pool is scoped to the pick sport, as production scopes it', async () => {
  // Production calls participants.listByType('player', metadata.sport) and
  // listByType applies `.eq('sport', sport)` only when sport is truthy, so the
  // pool is per-sport. Pooling every sport together diverges in BOTH directions:
  // a name shared across two sports reads as ambiguous (denying CLV production
  // has), and the resulting null participant emits is.null, which can match an
  // event-scoped history row production's eq.<player> query never sees.
  const nba: ParticipantRow = {
    id: 'participant-nba', external_id: 'CHRIS_JOHNSON_1_NBA',
    display_name: 'Chris Johnson', participant_type: 'player', sport: 'NBA',
  };
  const nfl: ParticipantRow = {
    ...nba, id: 'participant-nfl', external_id: 'CHRIS_JOHNSON_1_NFL', sport: 'NFL',
  };
  const row = pick('pick-sport', {
    participant_id: null,
    metadata: { eventId: 'event-1', player: 'Chris Johnson', sport: 'NBA' },
  });
  const settled = {
    ...settlement('settlement-1', row.id, 'win', 'result-1'),
    payload: { gradingContext: { gameResultId: 'result-1', eventId: 'event-1' }, clvStatus: 'computed' },
  };
  const scoped = new Map([
    [participantNameKey('NBA', 'Chris Johnson'), [nba]],
    [participantNameKey('NFL', 'Chris Johnson'), [nfl]],
  ]);
  // The NBA pick sees exactly one Chris Johnson and resolves, as production does.
  const resolved = buildGradingClvContext(settled, row, new Map([[event.id, event]]),
    new Map(), scoped);
  assert.equal(resolved?.participantExternalId, 'CHRIS_JOHNSON_1_NBA');

  // Negative control: the SAME two players in one flat pool -- what the audit
  // built before this fix -- read as ambiguous and resolve to null, denying the
  // participant production resolves. This is the divergence, reproduced.
  const flat = new Map([[participantNameKey(null, 'Chris Johnson'), [nba, nfl]]]);
  const unsported = pick('pick-sport-2', {
    participant_id: null,
    metadata: { eventId: 'event-1', player: 'Chris Johnson' },
  });
  const collapsed = buildGradingClvContext(settled, unsported, new Map([[event.id, event]]),
    new Map(), flat);
  assert.equal(collapsed?.participantExternalId, null);

  // A pick with no sport is matched against the all-players pool, because
  // production's listByType('player', undefined) returns every player rather
  // than none. A unique name there still resolves.
  const soloFlat = new Map([[participantNameKey(null, 'Chris Johnson'), [nba]]]);
  const unsportedUnique = buildGradingClvContext(settled, unsported,
    new Map([[event.id, event]]), new Map(), soloFlat);
  assert.equal(unsportedUnique?.participantExternalId, 'CHRIS_JOHNSON_1_NBA');
});

test('zero closing odds are missing_priced_side, exactly as production reports them', async () => {
  // readClosingSideOdds gates on Number.isFinite alone -- but it RETURNS the
  // raw number and both callers test it for truthiness:
  // `if (!pricedSide) return 'missing_priced_side'` (clv-service.ts:415) and the
  // same falsy check at :542. Zero is falsy. Reading readClosingSideOdds in
  // isolation says production prices zero odds; the callers say it does not,
  // and the callers are the semantics. Pricing them here would claim CLV
  // production does not have and suppress a real persisted-status mismatch.
  const captured: CapturedRead[] = [];
  const client = historyClient([historyRow({ id: 'offer-1', over_odds: 0 })], captured);
  const report = await clvReport(clvDataset(), createClosingOfferLookup(client));
  assert.equal(report.clv.resolvable, 0);
  assert.deepEqual(report.clv.failure_class_counts, { missing_priced_side: 1 });

  // Negative control: the SAME offer with a non-zero price on the same side
  // resolves, so the refusal above is caused by the zero and nothing else.
  const priced = historyClient([historyRow({ id: 'offer-1', over_odds: -110 })], []);
  const pricedReport = await clvReport(clvDataset(), createClosingOfferLookup(priced));
  assert.equal(pricedReport.clv.resolvable, 1);
  assert.deepEqual(pricedReport.clv.failure_class_counts, {});
});

test('the offer lookup takes its event id from events.external_id, not market_universe', async () => {
  // Production never derives the offer-lookup event id from market_universe:
  // that row owns the provenance short-circuit, not this query. A stale
  // provider_event_id there would otherwise query a different game.
  const row = pick('pick-1', { metadata: { eventId: 'event-1', marketUniverseId: 'universe-1' } });
  const dataset: TruthAuditDataset = {
    ...clvDataset(row),
    marketUniverseById: new Map([
      ['universe-1', universe('universe-1', {
        closing_line: null,
        provider_event_id: 'STALE-PROVIDER-EVENT',
      })],
    ]),
  };
  const captured: CapturedRead[] = [];
  const client = historyClient([historyRow({ id: 'offer-1' })], captured);
  await clvReport(dataset, createClosingOfferLookup(client));
  assert.equal(captured[0]!.params.get('provider_event_id'), 'eq.provider-event-1');
});

test('the participant external id comes from the participants table first', async () => {
  // Production resolves it from participants.findById(pick.participant_id). A
  // stale market_universe.provider_participant_id must not win.
  const row = pick('pick-1', { metadata: { eventId: 'event-1', marketUniverseId: 'universe-1' } });
  const dataset: TruthAuditDataset = {
    ...clvDataset(row),
    marketUniverseById: new Map([
      ['universe-1', universe('universe-1', {
        closing_line: null,
        provider_participant_id: 'STALE_PLAYER',
      })],
    ]),
  };
  const captured: CapturedRead[] = [];
  const client = historyClient([historyRow({ id: 'offer-1' })], captured);
  await clvReport(dataset, createClosingOfferLookup(client));
  assert.equal(captured[0]!.params.get('provider_participant_id'), 'eq.PROVIDER_PLAYER_1');
});

test('an external_id shared by two events is unverifiable, not a mismatch', async () => {
  // The by-external-id index is last-wins. Silentlyselecting one of two events and
  // then reporting game_result_event_mismatch claims CONTRADICTED identity,
  // which is a stronger and more misleading statement than the truth.
  const row = pick('pick-1', {
    metadata: { providerEventId: 'shared-external' },
  });
  const twin: EventRow = { ...otherEvent, id: 'event-3', external_id: 'shared-external' };
  const first: EventRow = { ...event, external_id: 'shared-external' };
  const identity = buildPickIdentityContext(
    row, null,
    new Map([[first.id, first], [twin.id, twin]]),
    new Map([['shared-external', twin]]),
    new Map(), new Map(),
    new Set(['shared-external']),
  );
  assert.equal(identity.event, null);
  assert.equal(
    validateGameResultIdentity(identity, gameResult('result-1', 21)),
    'game_result_identity_unverifiable',
  );
});

test('selection side branches in production order', async () => {
  // clv-service.ts evaluates \bover\b, then \bunder\b, then O<digit>, then
  // U<digit>. Collapsing them into two over/under families flips this case.
  assert.equal(inferSelectionSide('Under O 8 total'), 'under');
  assert.equal(inferSelectionSide('Over U 8 total'), 'over');
  assert.equal(inferSelectionSide('Brunson O 28.5'), 'over');
  assert.equal(inferSelectionSide('Brunson U 28.5'), 'under');
});

test('a null participant issues the offer query, exactly as production does', async () => {
  // Production never bails on a null participant. computeCLVOutcome passes
  // `providerParticipantId: (isMoneyline || isParticipantForbiddenMarket)
  //  ? null : eventContext.participantExternalId` -- possibly null -- straight
  // into findClosingLine, which then filters `.is(provider_participant_id,
  // null)`. An audit that refused to issue the query would attribute a data gap
  // to a participant-resolution defect: exactly the mis-causation this lane
  // exists to eliminate.
  const row = pick('pick-1', {
    participant_id: null,
    metadata: {
      eventId: 'event-1',
      providerEventId: 'provider-event-1',
      providerMarketKey: 'points-all-game-ou',
      marketUniverseId: 'universe-1',
    },
  });
  const dataset: TruthAuditDataset = {
    ...clvDataset(row),
    participantsById: new Map(),
    // No participant identity is recoverable from any source.
    marketUniverseById: new Map([
      ['universe-1', universe('universe-1', {
        closing_line: null,
        participant_id: null,
        provider_participant_id: null,
      })],
    ]),
  };
  const captured: CapturedRead[] = [];
  const report = await clvReport(
    dataset,
    createClosingOfferLookup(historyClient([], captured)),
  );

  // The query WAS issued, with a null participant filter.
  assert.ok(captured.length > 0, 'production issues the lookup; the audit must too');
  assert.equal(captured[0]!.params.get('provider_participant_id'), 'is.null');
  // And the outcome is a data gap, not a participant complaint.
  assert.deepEqual(report.clv.failure_class_counts, { missing_closing_line: 1 });
  assert.equal(
    Object.keys(report.clv.failure_class_counts).includes('missing_participant_context'),
    false,
  );
});

test('a grading context naming an unresolvable event fails closed', async () => {
  // The generic fallback resolver is the audit's model of production's
  // non-grading path. It must NOT be substituted when the settlement names a
  // grading event that cannot be resolved: production would run
  // resolvePickEventContext, which for a player prop also needs a resolved
  // participant, event_participants links and chooseEventForPick proximity
  // selection -- none of which this audit models.
  const row = pick('pick-1');
  const base = clvDataset(row);
  const withGrading: TruthAuditDataset = {
    ...base,
    settlements: [{
      ...base.settlements[0]!,
      payload: {
        gradingContext: { gameResultId: 'result-1', eventId: 'event-MISSING' },
        clvStatus: 'computed',
      },
    }],
  };
  const captured: CapturedRead[] = [];
  const report = await clvReport(
    withGrading,
    createClosingOfferLookup(historyClient([historyRow({ id: 'offer-1' })], captured)),
  );
  assert.deepEqual(report.clv.failure_class_counts, { grading_context_unresolvable: 1 });
  assert.equal(captured.length, 0, 'no offer query is issued on an unmodelled path');

  // Negative control: the same settlement naming a RESOLVABLE grading event
  // takes the modelled path and resolves, so the refusal is caused by the
  // unresolvable event and nothing else.
  const resolvable: TruthAuditDataset = {
    ...base,
    settlements: [{
      ...base.settlements[0]!,
      payload: {
        gradingContext: { gameResultId: 'result-1', eventId: event.id },
        clvStatus: 'computed',
      },
    }],
  };
  const ok = await clvReport(
    resolvable,
    createClosingOfferLookup(historyClient([historyRow({ id: 'offer-1' })], [])),
  );
  assert.equal(ok.clv.resolvable, 1);
});

test('a truncated page is refused, even when it is shorter than the limit', async () => {
  // readByIds budgets `idsChunk.length * rowsPerId` for the WHOLE chunk, so a
  // few ids with many rows can push the rest off the end. A truncated read makes
  // an ambiguous events.external_id look UNIQUE -- failing open in exactly the
  // place the ambiguity guard exists to close.
  //
  // Comparing rows.length to the limit is NOT sufficient: PostgREST caps every
  // response at the project's max_rows setting, so above that cap a truncated
  // page arrives SHORTER than the limit and a length check reads it as complete.
  // The guard compares against Prefer: count=exact instead.
  const serve = (rows: number, total: number | null) =>
    new ReadOnlyPostgrestClient(
      'https://example.supabase.co',
      'read-key',
      async () => new Response(
        JSON.stringify(Array.from({ length: rows }, (_, i) => ({ id: `row-${i}` }))),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            ...(total === null ? {} : { 'content-range': `0-${rows - 1}/${total}` }),
          },
        },
      ),
    );

  // The case a length check misses: 3 rows returned against a limit of 4, so the
  // page is short and looks complete -- but 900 rows match.
  await assert.rejects(
    () => readByIds(serve(3, 900), 'events', 'id', ['a', 'b'], 'external_id', 2),
    /read 3 of 900 matching rows/,
  );

  // A response with no exact count cannot be shown complete, so it is refused
  // rather than assumed.
  await assert.rejects(
    () => readByIds(serve(3, null), 'events', 'id', ['a', 'b'], 'external_id', 2),
    /no exact count/,
  );

  // Negative control: rows.length === count is complete and is accepted, so the
  // refusals above are caused by incompleteness and not by the guard itself.
  const rows = await readByIds<{ id: string }>(
    serve(3, 3), 'events', 'id', ['a', 'b'], 'external_id', 2,
  );
  assert.equal(rows.length, 3);
});

test('a grading context that resolved a null participant is not overridden', async () => {
  // A resolved grading context whose participantExternalId is null is
  // production's OWN answer: it passes that null into findClosingLine and
  // filters is(provider_participant_id, null). Falling through to the
  // market_universe/metadata resolver would send eq.<id> and could find a
  // closing line production never sees -- the same over-claim class as the
  // deleted missing_participant_context bail, reintroduced by a `??`.
  const row = pick('pick-1', {
    participant_id: null,
    metadata: {
      eventId: 'event-1',
      providerEventId: 'provider-event-1',
      providerMarketKey: 'points-all-game-ou',
      marketUniverseId: 'universe-1',
    },
  });
  const base = clvDataset(row);
  const dataset: TruthAuditDataset = {
    ...base,
    // The settlement names a resolvable grading event, so the grading context
    // resolves -- with a null participant, because the pick has no participant_id
    // and no player metadata.
    settlements: [{
      ...base.settlements[0]!,
      payload: {
        gradingContext: { gameResultId: 'result-1', eventId: event.id },
        clvStatus: 'computed',
      },
    }],
    participantsById: new Map(),
    // market_universe still carries a participant. Production never consults it
    // on this path; the audit must not either.
    marketUniverseById: new Map([
      ['universe-1', universe('universe-1', {
        closing_line: null,
        provider_participant_id: 'UNIVERSE_PLAYER',
      })],
    ]),
  };
  const captured: CapturedRead[] = [];
  await clvReport(dataset, createClosingOfferLookup(historyClient([], captured)));

  assert.ok(captured.length > 0, 'the lookup must still be issued');
  assert.equal(captured[0]!.params.get('provider_participant_id'), 'is.null');
});

// ---------------------------------------------------------------------------
// loadAuditDataset completeness guards.
//
// The three guards below sit in loadAuditDataset, which the earlier tests never
// reach: they exercise the pure functions the loader feeds. That left the two
// `assertCompletePage` alias sites and the participants name-fallback pager with
// no control at all -- removing any of them turned no test red. The loader takes
// its transport by injection, so it can be driven end to end from a routing
// fetch stub without touching production or the network.
// ---------------------------------------------------------------------------

type StubPage = { rows: unknown[]; total: number | null };

/**
 * Routes a PostgREST GET to a per-table handler. Every table the loader reads
 * must answer, so an unrouted table is an explicit empty page rather than a
 * silent 404 that would fail the test for the wrong reason.
 */
function routingClient(
  routes: Record<string, (url: URL) => StubPage>,
): ReadOnlyPostgrestClient {
  return new ReadOnlyPostgrestClient(
    'https://example.supabase.co',
    'read-key',
    async (input) => {
      const url = new URL(String(input));
      const table = url.pathname.split('/').pop() ?? '';
      const page = routes[table]?.(url) ?? { rows: [], total: 0 };
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (page.total !== null) {
        headers['content-range'] = page.rows.length === 0
          ? `*/${page.total}`
          : `0-${page.rows.length - 1}/${page.total}`;
      }
      return new Response(JSON.stringify(page.rows), { status: 200, headers });
    },
  );
}

/** One settled, graded, game-result-backed cohort row whose pick takes the
 *  name-based participant fallback (no participant_id, a metadata player). */
const LOADER_SETTLEMENT = {
  id: 'settlement-1',
  pick_id: 'pick-1',
  status: 'settled',
  result: 'win',
  source: 'grading',
  evidence_ref: 'game-result:result-1',
  payload: { gradingContext: { eventId: 'event-1' } },
  settled_at: '2026-06-27T00:00:00Z',
  corrects_id: null,
};
const LOADER_PICK = {
  id: 'pick-1',
  market: 'player_points',
  market_type_id: 'mt-points',
  selection: 'over',
  line: 20.5,
  odds: -110,
  participant_id: null,
  status: 'settled',
  // providerMarketKey is what puts a key into the REVERSE alias read; without
  // it that read has no ids, never runs, and its completeness guard is unproven.
  metadata: {
    player: 'Jane Doe',
    sport: 'NBA',
    eventId: 'event-1',
    providerMarketKey: 'points-all-game-ou',
  },
  created_at: '2026-06-26T00:00:00Z',
};
const LOADER_GAME_RESULT = {
  id: 'result-1',
  event_id: 'event-1',
  participant_id: null,
  market_key: 'points-all-game-ou',
  actual_value: 24,
};

function loaderRoutes(overrides: Record<string, (url: URL) => StubPage> = {}) {
  return {
    settlement_records: (url: URL) => {
      // The corrections read is keyed by corrects_id; the cohort read is not.
      if (url.searchParams.has('corrects_id')
        && url.searchParams.get('corrects_id')!.startsWith('in.')) {
        return { rows: [], total: 0 };
      }
      if (url.searchParams.get('order')) return { rows: [LOADER_SETTLEMENT], total: 1 };
      return { rows: [], total: 1 };
    },
    picks: () => ({ rows: [LOADER_PICK], total: 1 }),
    game_results: () => ({ rows: [LOADER_GAME_RESULT], total: 1 }),
    events: () => ({
      rows: [{
        id: 'event-1',
        external_id: 'provider-event-1',
        event_name: 'A at B',
        event_date: '2026-06-27',
        metadata: { starts_at: '2026-06-27T23:10:00Z' },
      }],
      total: 1,
    }),
    participants: (url: URL) => {
      // The name-fallback pool read is the one filtered by participant_type.
      if (url.searchParams.get('participant_type') === 'eq.player') {
        return { rows: [{
          id: 'participant-1',
          external_id: 'JANE_DOE_1_NBA',
          display_name: 'Jane Doe',
          participant_type: 'player',
          sport: 'NBA',
        }], total: 1 };
      }
      return { rows: [], total: 0 };
    },
    provider_market_aliases: () => ({
      rows: [{
        market_type_id: 'mt-points',
        provider: 'sgo',
        provider_market_key: 'points-all-game-ou',
      }],
      total: 1,
    }),
    ...overrides,
  };
}

test('the participants name-fallback pool is refused when the server stops short', async () => {
  // A SHORT pool is the dangerous direction: production resolves a participant
  // only on a UNIQUE normalized display_name, so a pool missing the second
  // holder of a shared name manufactures a participant production resolves to
  // null. The loop is driven by Prefer: count=exact, never by rows.length.
  await assert.rejects(
    () => loadAuditDataset(
      routingClient(loaderRoutes({
        participants: (url: URL) => (
          url.searchParams.get('participant_type') === 'eq.player'
            ? { rows: [], total: 5 }
            : { rows: [], total: 0 }
        ),
      })),
      2,
    ),
    /participants name-fallback pool: read 0 of 5 rows/,
  );
});

test('the participants name-fallback pool is refused when it carries no exact count', async () => {
  await assert.rejects(
    () => loadAuditDataset(
      routingClient(loaderRoutes({
        participants: (url: URL) => (
          url.searchParams.get('participant_type') === 'eq.player'
            ? { rows: [], total: null }
            : { rows: [], total: 0 }
        ),
      })),
      2,
    ),
    /participants name-fallback page: no exact count/,
  );
});

test('a truncated provider_market_aliases page is refused', async () => {
  // Alias priority ordering decides which provider market key wins, so a
  // truncated alias page changes the RESOLVED key rather than merely shortening
  // a list. Both alias reads carry the guard; the forward read runs first.
  await assert.rejects(
    () => loadAuditDataset(
      routingClient(loaderRoutes({
        provider_market_aliases: () => ({
          rows: [{
            market_type_id: 'mt-points',
            provider: 'sgo',
            provider_market_key: 'points-all-game-ou',
          }],
          total: 9,
        }),
      })),
      2,
    ),
    /provider_market_aliases \(forward, by market_type_id\): read 1 of 9 matching rows/,
  );
});

test('a complete set of pages loads the dataset, so the refusals above are caused by incompleteness', async () => {
  // Negative control for all three guards: identical routing, every page
  // complete. If this failed, the rejections above would prove only that the
  // stub is unusable.
  const loaded = await loadAuditDataset(routingClient(loaderRoutes()), 2);
  assert.equal(loaded.dataset.settlements.length, 1);
  assert.equal(loaded.dataset.picksById.get('pick-1')?.id, 'pick-1');
  assert.equal(loaded.dataset.gameResultsById.get('result-1')?.event_id, 'event-1');
});

test('a truncated reverse provider_market_aliases page is refused', async () => {
  // The forward read throws first when both are truncated, which left the
  // REVERSE guard alive under mutation: deleting it turned no test red. The
  // forward page is complete here so the reverse guard is the only thing that
  // can reject. A foreign market_type_id owning a claimed provider key is what
  // this index exists to surface, so a truncated reverse page hides exactly the
  // conflict that must block identity.
  await assert.rejects(
    () => loadAuditDataset(
      routingClient(loaderRoutes({
        provider_market_aliases: (url: URL) => {
          const row = {
            market_type_id: 'mt-points',
            provider: 'sgo',
            provider_market_key: 'points-all-game-ou',
          };
          const reverse = (url.searchParams.get('provider_market_key') ?? '').startsWith('in.');
          return reverse ? { rows: [row], total: 7 } : { rows: [row], total: 1 };
        },
      })),
      2,
    ),
    /provider_market_aliases \(reverse, by provider_market_key\): read 1 of 7 matching rows/,
  );
});

test('loadAuditDataset builds one candidate pool per sport, and queries each one scoped', async () => {
  // The unit test above proves the LOOKUP is sport-scoped; this proves the POOL
  // the loader builds is too, and that each pool is fetched with the sport
  // filter production sends. Without it the index could still be built flat and
  // the lookup would silently miss every bucket.
  const issued: string[] = [];
  const nba = {
    id: 'participant-nba', external_id: 'CHRIS_JOHNSON_1_NBA',
    display_name: 'Chris Johnson', participant_type: 'player', sport: 'NBA',
  };
  const nfl = { ...nba, id: 'participant-nfl', external_id: 'CHRIS_JOHNSON_1_NFL', sport: 'NFL' };
  const loaded = await loadAuditDataset(
    routingClient(loaderRoutes({
      picks: () => ({
        rows: [
          { ...LOADER_PICK, metadata: { ...LOADER_PICK.metadata, player: 'Chris Johnson', sport: 'NBA' } },
        ],
        total: 1,
      }),
      participants: (url: URL) => {
        if (url.searchParams.get('participant_type') !== 'eq.player') {
          return { rows: [], total: 0 };
        }
        const sport = url.searchParams.get('sport');
        issued.push(sport ?? '(no sport filter)');
        // Each sport-scoped read returns only that sport's player, exactly as
        // PostgREST would with .eq('sport', ...).
        if (sport === 'eq.NBA') return { rows: [nba], total: 1 };
        if (sport === 'eq.NFL') return { rows: [nfl], total: 1 };
        return { rows: [nba, nfl], total: 2 };
      },
    })),
    2,
  );

  // The pool was requested WITH the sport filter production applies.
  assert.deepEqual(issued, ['eq.NBA']);
  // And it is bucketed under the sport-scoped key, not the bare name.
  const index = loaded.dataset.participantsByNormalizedName!;
  assert.equal(index.get(participantNameKey('NBA', 'Chris Johnson'))?.length, 1);
  assert.equal(index.get(participantNameKey(null, 'Chris Johnson')), undefined);
});

test('a closing row production would discard skips the TIER, not just the row', async () => {
  // asClosingLineLike (clv-service.ts:867) nulls any offer whose snapshot_at or
  // provider_key is not a non-empty string. Production applies it AFTER
  // findClosingLine has already returned a single row, so a bad pinnacle row
  // makes production fall through to CONSENSUS -- it does not fall back to the
  // second-latest pinnacle row, which the query never returned.
  const good = historyRow({ id: 'offer-good', snapshot_at: '2026-06-27T20:00:00Z' });
  const bad = { ...historyRow({ id: 'offer-bad' }), provider_key: '' };
  assert.equal(asProductionClosingLine(good)?.id, 'offer-good');
  assert.equal(asProductionClosingLine(bad), null);
  assert.equal(
    asProductionClosingLine({ ...historyRow({ id: 'offer-nosnap' }), snapshot_at: '' }),
    null,
  );

  // The ordering that matters: given a bad LATEST row and a good older row in
  // the same tier, the gate must reject rather than select the older one.
  const latestBad = { ...historyRow({ id: 'offer-late' }), snapshot_at: '2026-06-27T22:00:00Z', provider_key: '' };
  const olderGood = historyRow({ id: 'offer-early', snapshot_at: '2026-06-27T10:00:00Z' });
  assert.equal(asProductionClosingLine(selectLatestClosingOffer([latestBad, olderGood])), null);

  // Negative control: the same two rows with a VALID latest resolve to it, so
  // the rejection above is caused by the gate and not by the selection.
  const latestGood = historyRow({ id: 'offer-late-ok', snapshot_at: '2026-06-27T22:00:00Z' });
  assert.equal(
    asProductionClosingLine(selectLatestClosingOffer([latestGood, olderGood]))?.id,
    'offer-late-ok',
  );
});

test('a whitespace-padded starts_at is passed through untrimmed, as production passes it', async () => {
  // settlement-service.ts:999 tests startsAt.trim().length > 0 but returns
  // startsAt itself. That raw string becomes the `lte.` cutoff filter, so
  // trimming it here would issue a filter production never issues.
  assert.equal(
    resolveEventStartTime({ ...event, metadata: { starts_at: ' 2026-06-27T23:10:00Z ' } }),
    ' 2026-06-27T23:10:00Z ',
  );
  // Blank-but-present falls through to the event_date default, as production does.
  assert.equal(
    resolveEventStartTime({ ...event, metadata: { starts_at: '   ' }, event_date: '2026-06-27' }),
    '2026-06-27T23:59:59Z',
  );
});

/*
 * Round 11 — call-site coverage for the two production gates.
 *
 * The three tests above this block exercise `asProductionClosingLine` and
 * `resolveEventStartTime` as units. A unit test proves the helper is correct;
 * it cannot prove the report actually CALLS it. Deleting either wrapper at its
 * real call site in `buildPickTruthAuditReport`, or reintroducing a trim inside
 * `buildGradingClvContext`, leaves every one of those unit assertions green.
 *
 * These three drive `buildPickTruthAuditReport` end to end and assert on the
 * emitted PostgREST filter and the reported failure class, so each one dies
 * when its own call site is mutated. Each carries a negative control: the same
 * fixture with a VALID row, proving the failure is caused by the gate under
 * test and not by the fixture being unresolvable for some unrelated reason.
 */

test('call site: the pinnacle-tier closing line passes through asProductionClosingLine', async () => {
  // Tier 1 (pinnacle) offers a NEWER-looking row that production rejects for a
  // blank provider_key; tier 2 offers an older but valid one. Correct behaviour
  // is to reject the pinnacle row, fall through to the consensus tier, and
  // resolve. Removing the wrapper at the tier-1 call site accepts the bad row,
  // which prices neither side of the pick, and reports missing_priced_side.
  const captured: CapturedRead[] = [];
  const client = historyClient(
    [
      historyRow({
        id: 'pinnacle-bad',
        bookmaker_key: 'pinnacle',
        provider_key: '',
        snapshot_at: '2026-06-30T22:00:00Z',
        over_odds: 0,
      }),
      historyRow({
        id: 'consensus-good',
        bookmaker_key: null,
        snapshot_at: '2026-06-30T22:50:00Z',
        over_odds: -105,
      }),
    ],
    captured,
  );
  const report = await clvReport(clvDataset(), createClosingOfferLookup(client));

  // Both tiers were queried: the pinnacle row was rejected, not merely unmatched.
  assert.equal(captured.some((call) => call.params.get('bookmaker_key') === 'eq.pinnacle'), true);
  assert.equal(captured.some((call) => call.params.get('bookmaker_key') === null), true);
  assert.equal(report.clv.resolvable, 1);
  assert.deepEqual(report.clv.failure_class_counts, {});
});

test('call site: the consensus-tier closing line passes through asProductionClosingLine', async () => {
  // No pinnacle row at all, so tier 1 returns nothing and tier 2 is the only
  // tier that can supply a closing line. Its single row has a blank
  // provider_key. Correct behaviour rejects it and falls to the
  // market_universe path, whose closing_line is null -> missing_closing_line.
  // Removing the wrapper at the tier-2 call site accepts the bad row instead
  // and reports missing_priced_side.
  const captured: CapturedRead[] = [];
  const client = historyClient(
    [
      historyRow({
        id: 'consensus-bad',
        bookmaker_key: null,
        provider_key: '',
        snapshot_at: '2026-06-30T22:00:00Z',
        over_odds: 0,
      }),
    ],
    captured,
  );
  const report = await clvReport(clvDataset(), createClosingOfferLookup(client));

  assert.equal(report.clv.resolvable, 0);
  assert.deepEqual(report.clv.failure_class_counts, { missing_closing_line: 1 });

  // Negative control: the identical fixture with a valid provider_key resolves,
  // so the failure above is the gate rejecting the row, not the row being
  // unreachable.
  const controlCaptured: CapturedRead[] = [];
  const controlClient = historyClient(
    [
      historyRow({
        id: 'consensus-ok',
        bookmaker_key: null,
        snapshot_at: '2026-06-30T22:00:00Z',
        over_odds: -105,
      }),
    ],
    controlCaptured,
  );
  const control = await clvReport(clvDataset(), createClosingOfferLookup(controlClient));
  assert.equal(control.clv.resolvable, 1);
  assert.deepEqual(control.clv.failure_class_counts, {});
});

test('call site: buildGradingClvContext passes starts_at to the cutoff untrimmed', async () => {
  // The grading path takes its cutoff from buildGradingClvContext's
  // eventStartTime (pick-truth-audit.ts: `gradingClv?.eventStartTime ?? ...`),
  // and that string becomes the `lte.` filter verbatim. Production
  // (settlement-service.ts:999) tests the trimmed value but sends the raw one,
  // so a trim reintroduced inside buildGradingClvContext would issue a filter
  // production never issues -- and would silently RESOLVE CLV that production
  // reports as missing, because a leading space sorts below every digit and
  // therefore excludes every snapshot.
  const paddedStartsAt = ' 2026-06-30T23:00:00Z ';
  const paddedEvent: EventRow = { ...event, metadata: { starts_at: paddedStartsAt } };

  const dataset = clvDataset();
  // A settlement that names its grading event, so buildGradingClvContext is the
  // component that supplies the cutoff rather than resolveClosingCutoff.
  dataset.settlements = [
    {
      ...dataset.settlements[0]!,
      payload: {
        gradingContext: { gameResultId: 'result-1', eventId: 'event-1' },
        clvStatus: 'computed',
      },
    },
  ];
  dataset.eventsById = new Map([[paddedEvent.id, paddedEvent]]);
  dataset.eventsByExternalId = new Map([[paddedEvent.external_id!, paddedEvent]]);

  const captured: CapturedRead[] = [];
  const client = historyClient(
    [historyRow({ id: 'pre-cutoff', snapshot_at: '2026-06-30T22:00:00Z', over_odds: -105 })],
    captured,
  );
  const report = await clvReport(dataset, createClosingOfferLookup(client));

  // The mechanism: the emitted filter is byte-identical to the raw metadata value.
  assert.equal(captured[0]!.params.get('snapshot_at'), `lte.${paddedStartsAt}`);
  // And the consequence production actually has: nothing matches the padded
  // cutoff, so CLV does not resolve.
  assert.equal(report.clv.resolvable, 0);
  assert.deepEqual(report.clv.failure_class_counts, { missing_closing_line: 1 });

  // Negative control: the same dataset with an UNPADDED starts_at resolves
  // against the same snapshot row. This is what makes the assertions above a
  // statement about the padding rather than about the fixture.
  const controlDataset = clvDataset();
  controlDataset.settlements = dataset.settlements;
  const controlCaptured: CapturedRead[] = [];
  const controlClient = historyClient(
    [historyRow({ id: 'pre-cutoff', snapshot_at: '2026-06-30T22:00:00Z', over_odds: -105 })],
    controlCaptured,
  );
  const control = await clvReport(controlDataset, createClosingOfferLookup(controlClient));
  assert.equal(controlCaptured[0]!.params.get('snapshot_at'), 'lte.2026-06-30T23:00:00Z');
  assert.equal(control.clv.resolvable, 1);
});
