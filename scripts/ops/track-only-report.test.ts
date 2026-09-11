import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPickReport,
  buildPreconditions,
  classifyResultProvenance,
  firstBlockerOf,
  parseCli,
  type LoadedPickContext,
} from './track-only-report.ts';
import {
  computeTrackOnlyStats,
  profitUnits,
  toStatsInput,
  type StatsInputPick,
} from './track-only/stats.ts';
import {
  MONEYLINE_RESULT_MARKET_KEY,
  OPERATOR_INGESTION_SOURCE,
  OPERATOR_PROVIDER_KEY,
  buildExternalId,
  buildResultSource,
  USAGE as ATTEST_USAGE,
  parseCli as parseAttestCli,
  planAttestation,
  slugifyEventName,
  validateAttestation,
  type AttestationInput,
} from './track-only/operator-attest-result.ts';
import {
  assertFixtureIsIdentifiable,
  buildStagingResultsPayload,
  runSgoJourneyProof,
  STAGING_FIXTURE_PREFIX,
} from './track-only/sgo-journey-proof.ts';

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    event_name: 'Dodgers @ Brewers',
    event_date: '2026-09-09',
    status: 'completed',
    external_id: 'operator:MLB:2026-09-09:dodgers-at-brewers',
    sport_id: 'MLB',
    metadata: {
      providerKey: 'operator',
      ingestionSource: 'operator.attestation',
      ingestionCycleRunId: 'run-1',
    },
    ...overrides,
  } as never;
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gr-1',
    event_id: 'evt-1',
    participant_id: 'p-dodgers',
    market_key: 'game_moneyline_win',
    actual_value: 1,
    source: 'operator:griff843',
    sourced_at: '2026-09-10T01:00:00Z',
    ...overrides,
  } as never;
}

function pick(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pick-1',
    capper_id: 'griff843',
    sport_id: 'MLB',
    market: 'moneyline',
    market_type_id: 'moneyline',
    selection: 'Dodgers',
    line: null,
    odds: -110,
    stake_units: 3,
    status: 'validated',
    created_at: '2026-09-09T03:34:48Z',
    participant_id: null,
    metadata: {
      eventName: 'Dodgers @ Brewers',
      sport: 'MLB',
      distributionMode: 'track-only',
    },
    ...overrides,
  } as never;
}

function context(overrides: Partial<LoadedPickContext> = {}): LoadedPickContext {
  return {
    pick: pick(),
    event: event(),
    results: [result()],
    settlements: [],
    delivery: {
      distribution_outbox: 0,
      command_center_delivery_mappings: 0,
      execution_intents: 0,
    },
    ...overrides,
  } as LoadedPickContext;
}

test('an operator source is classified operator, never sgo', () => {
  assert.equal(classifyResultProvenance('operator:griff843'), 'operator');
  assert.equal(classifyResultProvenance('operator'), 'operator');
  assert.equal(classifyResultProvenance('sgo'), 'sgo');
  assert.equal(classifyResultProvenance('sgo-historical'), 'sgo');
  assert.equal(classifyResultProvenance('the-odds-api'), 'other');
  assert.equal(classifyResultProvenance(null), 'none');
});

test('a fully attested event and result clears every precondition', () => {
  const checks = buildPreconditions({ event: event(), results: [result()] });
  assert.deepEqual(
    checks.map((check) => check.state),
    ['pass', 'pass', 'pass', 'pass'],
  );
  assert.equal(firstBlockerOf(checks), null);
});

test('each missing precondition is reported as the first blocker in order', () => {
  const cases: Array<[string, ReturnType<typeof buildPreconditions>]> = [
    ['event_resolved', buildPreconditions({ event: null, results: [] })],
    [
      'event_completed',
      buildPreconditions({
        event: event({ status: 'scheduled' }),
        results: [result()],
      }),
    ],
    [
      'event_provenance_populated',
      buildPreconditions({
        event: event({ metadata: { providerKey: 'operator' } }),
        results: [result()],
      }),
    ],
    ['result_present', buildPreconditions({ event: event(), results: [] })],
  ];

  for (const [expected, checks] of cases) {
    assert.equal(firstBlockerOf(checks), expected);
  }
});

test('a missing external_id fails provenance even when metadata is complete', () => {
  const checks = buildPreconditions({
    event: event({ external_id: null }),
    results: [result()],
  });
  const provenance = checks.find(
    (check) => check.id === 'event_provenance_populated',
  );
  assert.equal(provenance?.state, 'fail');
  assert.match(provenance?.detail ?? '', /external_id/);
});

test('a correction is an append: the newest row is current and the older one is history', () => {
  const report = buildPickReport(
    context({
      results: [
        result({ id: 'gr-1', source: 'operator:griff843', actual_value: 1 }),
        result({
          id: 'gr-2',
          source: 'operator:griff843:correction-1',
          actual_value: 0,
          sourced_at: '2026-09-10T04:00:00Z',
        }),
      ],
    }),
  );

  assert.equal(report.resultProvenance.source, 'operator:griff843:correction-1');
  assert.equal(report.resultProvenance.attestationDepth, 2);
  assert.deepEqual(report.resultProvenance.supersededSources, [
    'operator:griff843',
  ]);
  assert.equal(report.resultProvenance.class, 'operator');
});

test('an unattested pick reports its blocker and no result provenance', () => {
  const report = buildPickReport(context({ event: null, results: [] }));
  assert.equal(report.firstBlocker, 'event_resolved');
  assert.equal(report.resultProvenance.class, 'none');
  assert.equal(report.resultProvenance.attestationDepth, 0);
});

test('any delivery row makes deliveryClean false', () => {
  const clean = buildPickReport(context());
  assert.equal(clean.deliveryClean, true);

  const dirty = buildPickReport(
    context({
      delivery: {
        distribution_outbox: 1,
        command_center_delivery_mappings: 0,
        execution_intents: 0,
      },
    }),
  );
  assert.equal(dirty.deliveryClean, false);
});

test('the CLI refuses a host that is not the declared project', () => {
  assert.throws(
    () =>
      parseCli(
        ['--url', 'https://evil.example.com', '--read-key', 'k'],
        {} as NodeJS.ProcessEnv,
      ),
    /refusing unexpected target/,
  );

  const options = parseCli(
    ['--url', 'https://zfzdnfwdarxucxtaojxm.supabase.co', '--read-key', 'k'],
    {} as NodeJS.ProcessEnv,
  );
  assert.equal(options.projectRef, 'zfzdnfwdarxucxtaojxm');
});

test('the CLI refuses to run without credentials rather than defaulting', () => {
  assert.throws(
    () => parseCli([], {} as NodeJS.ProcessEnv),
    /are required/,
  );
});


// ===========================================================================
// UTV2-1889 -- the stats aggregate and the operator attestation CLI.
//
// These tests live in this file rather than beside their modules because
// `test:ops` enumerates test files individually in the root `package.json`,
// and `package.json` is inside another active lane's `file_scope_lock`. A new
// `*.test.ts` that is not reachable from a package script fails `pnpm verify`
// closed with WIRING_TEST_UNWIRED_NEW, so an unwired test file would be worse
// than no test file. Same resolution as UTV2-1840.
// ===========================================================================

function statsPick(over: Partial<StatsInputPick> = {}): StatsInputPick {
  return {
    pickId: over.pickId ?? 'p1',
    odds: over.odds === undefined ? -110 : over.odds,
    stakeUnits: over.stakeUnits === undefined ? 3 : over.stakeUnits,
    latestSettlement:
      over.latestSettlement === undefined
        ? { result: 'win', stakeUnits: null }
        : over.latestSettlement,
  };
}

test('a -110 winner returns the right profit, not the stake', () => {
  // 3 units at -110 risks 3 to win 3 * (100/110) = 2.7273.
  assert.equal(profitUnits('win', -110, 3), (3 * 100) / 110);
  assert.equal(profitUnits('loss', -110, 3), -3);
  assert.equal(profitUnits('push', -110, 3), 0);
});

test('a positive-odds winner pays the underdog price', () => {
  assert.equal(profitUnits('win', 150, 2), 3);
});

test('ROI is net over units risked', () => {
  const stats = computeTrackOnlyStats([
    statsPick({ pickId: 'w', latestSettlement: { result: 'win', stakeUnits: null } }),
    statsPick({
      pickId: 'l',
      latestSettlement: { result: 'loss', stakeUnits: null },
    }),
  ]);
  assert.equal(stats.record.win, 1);
  assert.equal(stats.record.loss, 1);
  assert.equal(stats.record.decided, 2);
  assert.equal(stats.units.staked, 6);
  // 2.7273 - 3 = -0.2727
  assert.equal(stats.units.net, -0.2727);
  assert.equal(stats.units.roi, -0.0455);
  assert.equal(stats.units.measuredOver, 2);
  assert.deepEqual(stats.excluded, []);
});

test('a push is a real decision with zero profit, and its stake was still risked', () => {
  const stats = computeTrackOnlyStats([
    statsPick({
      pickId: 'pu',
      latestSettlement: { result: 'push', stakeUnits: null },
    }),
  ]);
  assert.equal(stats.record.push, 1);
  assert.equal(stats.record.decided, 1);
  assert.equal(stats.units.net, 0);
  // Deliberate: units risked includes a push. Excluding it would inflate the ROI
  // magnitude of the surrounding record.
  assert.equal(stats.units.staked, 3);
  assert.equal(stats.units.roi, 0);
});

test('void and cancelled are not decisions and never enter the record or ROI', () => {
  const stats = computeTrackOnlyStats([
    statsPick({
      pickId: 'v',
      latestSettlement: { result: 'void', stakeUnits: null },
    }),
    statsPick({
      pickId: 'c',
      latestSettlement: { result: 'cancelled', stakeUnits: null },
    }),
  ]);
  assert.equal(stats.record.decided, 0);
  assert.equal(stats.nonDecisions.void, 1);
  assert.equal(stats.nonDecisions.cancelled, 1);
  assert.equal(stats.units.roi, null);
  assert.equal(stats.pending, 0);
});

test('an empty cohort reports null ROI, never 0', () => {
  const stats = computeTrackOnlyStats([]);
  assert.equal(stats.cohortSize, 0);
  assert.equal(stats.units.roi, null);
  assert.equal(stats.units.staked, null);
  assert.equal(stats.units.net, null);
});

test('an all-pending cohort reports null ROI, never 0', () => {
  const stats = computeTrackOnlyStats([
    statsPick({ pickId: 'a', latestSettlement: null }),
    statsPick({ pickId: 'b', latestSettlement: { result: null, stakeUnits: null } }),
  ]);
  assert.equal(stats.pending, 2);
  assert.equal(stats.units.roi, null);
});

test('a decided pick with no stake is counted in the record but named in excluded', () => {
  const stats = computeTrackOnlyStats([
    statsPick({ pickId: 'nostake', stakeUnits: null }),
  ]);
  // The verdict is real, so the record must not lose it...
  assert.equal(stats.record.win, 1);
  assert.equal(stats.record.decided, 1);
  // ...but it must not be priced as a zero either.
  assert.equal(stats.units.roi, null);
  assert.equal(stats.units.measuredOver, 0);
  assert.equal(stats.excluded.length, 1);
  assert.match(stats.excluded[0]!.reason, /stake_units is null/);
});

test('a decided pick with null odds is excluded rather than priced at zero', () => {
  const stats = computeTrackOnlyStats([statsPick({ pickId: 'noodds', odds: null })]);
  assert.equal(stats.record.decided, 1);
  assert.equal(stats.units.measuredOver, 0);
  assert.match(stats.excluded[0]!.reason, /odds are null/);
});

test('an unrecognised result is excluded, NOT folded into pending', () => {
  const stats = computeTrackOnlyStats([
    statsPick({
      pickId: 'weird',
      latestSettlement: { result: 'partially_won', stakeUnits: null },
    }),
  ]);
  // This is the assertion that matters: pending shrinks as picks settle, so an
  // unrecognised verdict parked there would look like ordinary backlog forever.
  assert.equal(stats.pending, 0);
  assert.equal(stats.record.decided, 0);
  assert.equal(stats.excluded.length, 1);
  assert.match(stats.excluded[0]!.reason, /not a recognised outcome/);
});

test("the settlement's own stake wins over the pick's", () => {
  const stats = computeTrackOnlyStats([
    statsPick({
      pickId: 'corrected',
      stakeUnits: 3,
      latestSettlement: { result: 'loss', stakeUnits: 1 },
    }),
  ]);
  assert.equal(stats.units.staked, 1);
  assert.equal(stats.units.net, -1);
});

test('measuredOver exposes a partially-priced record instead of hiding it', () => {
  const stats = computeTrackOnlyStats([
    statsPick({ pickId: 'ok' }),
    statsPick({ pickId: 'unpriceable', stakeUnits: null }),
  ]);
  assert.equal(stats.record.decided, 2);
  assert.equal(stats.units.measuredOver, 1);
  // A reader comparing these two numbers can see the ROI covers half the record.
  assert.notEqual(stats.units.measuredOver, stats.record.decided);
});

test('odds inside (-100, 100) express no price and are refused', () => {
  assert.equal(profitUnits('win', 0, 1), null);
  assert.equal(profitUnits('win', 50, 1), null);
  assert.equal(profitUnits('win', -50, 1), null);
});

test('the adapter reports no settlement row as pending, not as a null result', () => {
  const input = toStatsInput({
    pickId: 'p',
    odds: -110,
    stakeUnits: 3,
    settlement: { rows: 0, result: null, stakeUnits: null },
  });
  assert.equal(input.latestSettlement, null);
  assert.equal(computeTrackOnlyStats([input]).pending, 1);
});

test('the adapter preserves an in-progress settlement row as a row', () => {
  const input = toStatsInput({
    pickId: 'p',
    odds: -110,
    stakeUnits: 3,
    settlement: { rows: 1, result: null, stakeUnits: null },
  });
  // Distinct from the case above: the row exists and can later be corrected.
  assert.notEqual(input.latestSettlement, null);
  assert.equal(input.latestSettlement?.result, null);
  assert.equal(computeTrackOnlyStats([input]).pending, 1);
});

test("the adapter carries the settlement's own stake through to the price", () => {
  const input = toStatsInput({
    pickId: 'corrected',
    odds: -110,
    stakeUnits: 3,
    settlement: { rows: 2, result: 'loss', stakeUnits: 1 },
  });
  // If this field were dropped, the pick's 3 units would be priced instead of the
  // settled 1 and the ROI would be wrong with nothing on the pick row to show it.
  const stats = computeTrackOnlyStats([input]);
  assert.equal(stats.units.staked, 1);
  assert.equal(stats.units.net, -1);
});


function attestation(
  overrides: Partial<AttestationInput> = {},
): AttestationInput {
  return {
    sport: 'MLB',
    eventDate: '2026-09-09',
    eventName: 'Dodgers @ Brewers',
    attestedBy: 'griff843',
    evidence: 'MLB.com box score, final 5-3 Dodgers',
    sides: [
      { participantId: '8a4dcd49', role: 'away', outcome: 1 },
      { participantId: '34f1a51c', role: 'home', outcome: 0 },
    ],
    ...overrides,
  };
}

const attestContext = {
  runId: 'run-1',
  eventId: 'evt-1',
  attestedAt: '2026-09-10T01:00:00Z',
};

test('the external id is prefixed, slugged and stable', () => {
  assert.equal(slugifyEventName('Dodgers @ Brewers'), 'dodgers-brewers');
  assert.equal(
    buildExternalId(attestation()),
    'operator:MLB:2026-09-09:dodgers-brewers',
  );
  assert.equal(
    buildExternalId(attestation()),
    buildExternalId(attestation({ evidence: 'a different source' })),
    'the id must not vary with fields that are not part of the event identity',
  );
});

test('an event name with no alphanumerics is refused rather than slugged to empty', () => {
  assert.throws(() => slugifyEventName('@@@'), /empty slug/);
});

test('every field an attestation depends on is required', () => {
  const cases: Array<[Partial<AttestationInput>, RegExp]> = [
    [{ sport: '' }, /sport is required/],
    [{ eventDate: '09-09-2026' }, /YYYY-MM-DD/],
    [{ eventName: '' }, /eventName is required/],
    [{ attestedBy: '' }, /attestedBy is required/],
    [{ evidence: '' }, /evidence is required/],
  ];
  for (const [override, expected] of cases) {
    assert.throws(() => validateAttestation(attestation(override)), expected);
  }
});

test('the sides must be one home, one away, two distinct participants', () => {
  assert.throws(
    () =>
      validateAttestation(
        attestation({ sides: [{ participantId: 'a', role: 'home', outcome: 1 }] }),
      ),
    /expected exactly 2 sides/,
  );
  assert.throws(
    () =>
      validateAttestation(
        attestation({
          sides: [
            { participantId: 'a', role: 'home', outcome: 1 },
            { participantId: 'b', role: 'home', outcome: 0 },
          ],
        }),
      ),
    /exactly one home and one away/,
  );
  assert.throws(
    () =>
      validateAttestation(
        attestation({
          sides: [
            { participantId: 'a', role: 'home', outcome: 1 },
            { participantId: 'a', role: 'away', outcome: 0 },
          ],
        }),
      ),
    /distinct participants/,
  );
});

test('an outcome outside {0, 0.5, 1} is refused, and the pair must sum to 1', () => {
  assert.throws(
    () =>
      validateAttestation(
        attestation({
          sides: [
            { participantId: 'a', role: 'home', outcome: 5 },
            { participantId: 'b', role: 'away', outcome: 0 },
          ],
        }),
      ),
    /outcome must be 1, 0 or 0.5/,
  );

  // Two winners is arithmetically legal per-side and incoherent as a game.
  assert.throws(
    () =>
      validateAttestation(
        attestation({
          sides: [
            { participantId: 'a', role: 'home', outcome: 1 },
            { participantId: 'b', role: 'away', outcome: 1 },
          ],
        }),
      ),
    /must sum to 1/,
  );

  // A push on both sides is the one legal non-winner shape.
  assert.doesNotThrow(() =>
    validateAttestation(
      attestation({
        sides: [
          { participantId: 'a', role: 'home', outcome: 0.5 },
          { participantId: 'b', role: 'away', outcome: 0.5 },
        ],
      }),
    ),
  );
});

test('the result market key is the dedicated one, not the ambiguous production key', () => {
  // Asserted as a literal on purpose. Comparing the written row against the
  // exported constant only proves the module agrees with itself; production
  // holds 280 `points-all-game-ml` rows carrying an unattributed *score*, so
  // the value of this constant is the load-bearing fact, not its consistency.
  assert.equal(MONEYLINE_RESULT_MARKET_KEY, 'game_moneyline_win');
  assert.notEqual(MONEYLINE_RESULT_MARKET_KEY, 'points-all-game-ml');

  for (const write of planAttestation(attestation(), attestContext).filter(
    (w) => w.table === 'game_results',
  )) {
    assert.equal(write.row['market_key'], 'game_moneyline_win');
  }
});

test('the writer and the reader agree on the market key and the provenance pair', () => {
  // These three values are declared independently in two modules: the operator
  // CLI that WRITES the attested result, and the grading pass that READS it. A
  // coherent rename on either side alone -- constant plus that side's own test --
  // would leave the writer emitting a key the reader refuses, and the only
  // symptom would be a `moneyline_result_market_key_unsupported` skip reason
  // buried in a pass detail. Nothing else in the repository compares them, so
  // this assertion is the coupling's only enforcement.
  const grading = readFileSync(
    new URL('../../apps/api/src/grading-service.ts', import.meta.url),
    'utf8',
  );

  const literal = (name: string): string => {
    const hit = grading.match(
      new RegExp(`const ${name}\\s*=\\s*'([^']+)'`),
    );
    assert.ok(hit, `grading-service.ts no longer declares ${name}`);
    return hit![1]!;
  };

  assert.equal(
    literal('MONEYLINE_RESULT_MARKET_KEY'),
    MONEYLINE_RESULT_MARKET_KEY,
    'the grading pass reads a different market key than the operator CLI writes',
  );

  // The same coupling, one level up: the provider and its required ingestion
  // source are what make the attested event trusted at all, and grading keys
  // them to each other rather than accepting a flat allow-list.
  const provenance = grading.match(
    /REQUIRED_INGESTION_SOURCE_BY_PROVIDER: Record<string, string> = \{([^}]*)\}/,
  );
  assert.ok(provenance, 'grading-service.ts no longer keys provenance by provider');
  const entry = provenance![1]!.match(
    new RegExp(`${OPERATOR_PROVIDER_KEY}:\\s*'([^']+)'`),
  );
  assert.ok(
    entry,
    `grading-service.ts no longer trusts provider ${OPERATOR_PROVIDER_KEY}`,
  );
  assert.equal(
    entry![1],
    OPERATOR_INGESTION_SOURCE,
    'the grading pass requires a different ingestion source than the operator CLI records',
  );
});

test('the plan writes the event, both links and both results under the dedicated market key', () => {
  const writes = planAttestation(attestation(), attestContext);
  assert.deepEqual(
    writes.map((write) => `${write.verb} ${write.table}`),
    [
      'upsert events',
      'upsert event_participants',
      'upsert event_participants',
      'insert game_results',
      'insert game_results',
    ],
  );

  for (const write of writes.filter((w) => w.table === 'game_results')) {
    assert.equal(
      write.row['market_key'],
      MONEYLINE_RESULT_MARKET_KEY,
      'a moneyline result must never be written under points-all-game-ml',
    );
    assert.notEqual(write.row['participant_id'], null);
  }
});

test('the event carries operator provenance pointing at the run that attested it', () => {
  const [eventWrite] = planAttestation(attestation(), attestContext);
  const metadata = eventWrite?.row['metadata'] as Record<string, unknown>;
  assert.equal(metadata['providerKey'], OPERATOR_PROVIDER_KEY);
  assert.equal(metadata['ingestionSource'], OPERATOR_INGESTION_SOURCE);
  assert.equal(metadata['ingestionCycleRunId'], attestContext.runId);
  assert.equal(metadata['attestedBy'], 'griff843');
  assert.equal(metadata['evidence'], 'MLB.com box score, final 5-3 Dodgers');
  assert.equal(eventWrite?.row['status'], 'completed');
  assert.equal(eventWrite?.onConflict, 'external_id');
});

test('the event never claims to be provider data', () => {
  const [eventWrite] = planAttestation(attestation(), attestContext);
  const metadata = eventWrite?.row['metadata'] as Record<string, unknown>;
  assert.notEqual(metadata['providerKey'], 'sgo');
  assert.notEqual(metadata['ingestionSource'], 'ingestor.cycle');
  const external = String(eventWrite?.row['external_id']);
  assert.ok(external.startsWith('operator:'));
});

test('a correction is an append under a distinct source, not an overwrite', () => {
  const original = buildResultSource({ attestedBy: 'griff843' });
  const correction = buildResultSource({
    attestedBy: 'griff843',
    correctionOf: 'evt-1',
  });
  const second = buildResultSource({
    attestedBy: 'griff843',
    correctionOf: 'evt-1',
    correctionIndex: 2,
  });

  assert.equal(original, 'operator:griff843');
  assert.equal(correction, 'operator:griff843:correction-1');
  assert.equal(second, 'operator:griff843:correction-2');
  assert.equal(new Set([original, correction, second]).size, 3);

  // `source` is part of game_results' unique key, so distinct sources cannot
  // collide and the original row survives as history.
  const corrected = planAttestation(
    attestation({ correctionOf: 'evt-1' }),
    attestContext,
  ).filter((write) => write.table === 'game_results');
  for (const write of corrected) {
    assert.equal(write.row['source'], correction);
    assert.equal(write.verb, 'insert');
  }
});

test('the CLI refuses any host but the declared project ref', () => {
  const argv = [
    '--url', 'https://evil.example.com',
    '--write-key', 'k',
    '--sport', 'MLB',
    '--event-date', '2026-09-09',
    '--event-name', 'Dodgers @ Brewers',
    '--attested-by', 'griff843',
    '--evidence', 'box score',
    '--home-participant', '34f1a51c', '--home-outcome', '0',
    '--away-participant', '8a4dcd49', '--away-outcome', '1',
  ];
  assert.throws(
    () => parseAttestCli(argv, {} as NodeJS.ProcessEnv),
    /refusing unexpected target/,
  );

  const good = [...argv];
  good[1] = 'https://zfzdnfwdarxucxtaojxm.supabase.co';
  const options = parseAttestCli(good, {} as NodeJS.ProcessEnv);
  assert.equal(options.apply, false, 'dry run must be the default');
  assert.equal(options.input.sides.length, 2);
});

test('--apply is opt-in and never inferred', () => {
  const base = [
    '--url', 'https://zfzdnfwdarxucxtaojxm.supabase.co',
    '--write-key', 'k',
    '--sport', 'MLB',
    '--event-date', '2026-09-09',
    '--event-name', 'Dodgers @ Brewers',
    '--attested-by', 'griff843',
    '--evidence', 'box score',
    '--home-participant', '34f1a51c', '--home-outcome', '0',
    '--away-participant', '8a4dcd49', '--away-outcome', '1',
  ];
  assert.equal(parseAttestCli(base, {} as NodeJS.ProcessEnv).apply, false);
  assert.equal(parseAttestCli([...base, '--apply'], {} as NodeJS.ProcessEnv).apply, true);
});

test('the CLI refuses to run without credentials rather than defaulting', () => {
  assert.throws(
    () => parseAttestCli(['--sport', 'MLB'], {} as NodeJS.ProcessEnv),
    /are required/,
  );
});

test('the --help text names every flag the parser actually reads', () => {
  // The runbook for this procedure is the USAGE string, so it is the one place
  // a wrong flag name costs an operator a failed production run. A comment
  // citing the coupling would document it; this asserts it.
  const documented = new Set(ATTEST_USAGE.match(/--[a-z-]+/g) ?? []);
  const source = readFileSync(
    new URL('./track-only/operator-attest-result.ts', import.meta.url),
    'utf8',
  );
  // Straight-quoted names only. The two interpolated side flags are added
  // below by name, because a regex that also caught `flags.get(`${role}-x`)`
  // would extract fragments of the interpolation instead of the flag.
  const read = new Set(
    [...source.matchAll(/flags\.get\('([a-z-]+)'\)/g)].map(
      (m) => `--${m[1]}`,
    ),
  );
  // The two side flags are built by interpolation over ['home','away'].
  for (const role of ['home', 'away']) {
    read.add(`--${role}-participant`);
    read.add(`--${role}-outcome`);
  }
  const undocumented = [...read].filter((f) => !documented.has(f));
  assert.deepEqual(
    undocumented,
    [],
    `these flags are read by the CLI but absent from --help: ${undocumented.join(", ")}`,
  );
  // And the inverse: --help must not promise a flag that does nothing.
  assert.ok(documented.has('--apply'));
  assert.ok(documented.has('--correction-of'));
  assert.ok(!documented.has('--correction'.concat('X')));
});

// ---------------------------------------------------------------------------
// UTV2-1889 -- SGO submission-to-result journey proof.
//
// These live here rather than beside the module because `test:ops` is an explicit
// file list, not a glob, and `package.json` is outside this lane's pinned
// file_scope_lock. Same resolution UTV2-1840 took for the same reason.
// ---------------------------------------------------------------------------

// The whole point of these assertions is that they run the SHIPPED normalizer and the
// SHIPPED classifier. If a future change repairs a gap, the corresponding test here
// fails and has to be rewritten deliberately -- which is the intended alarm, not a
// nuisance. Each test names the gap it pins.

test('the real SGO normalizer emits <statId>-all-<period>-<betType>, erasing the side from the key', async () => {
  const report = await runSgoJourneyProof({ pickMarket: 'moneyline' });

  const keys = report.parse.scoredMarkets.map((m) => m.baseMarketKey).sort();
  // `points-home-game-ml-home` and `points-away-game-ml-away` BOTH normalize to the
  // same key. The `-all-` segment is a hardcoded literal in the normalizer's template,
  // so the side cannot survive into the market key -- which is exactly why
  // `providerSide` had to be added as a separate field (UTV2-1868).
  assert.deepEqual(keys, [
    'points-all-game-ml',
    'points-all-game-ml',
    'points-all-game-ou',
  ]);
});

test('GAP A: SGO_GAME_LINE_CANONICAL_ID never matches a moneyline, so the raw key is written', async () => {
  const report = await runSgoJourneyProof({ pickMarket: 'moneyline' });

  const moneylineWrites = report.resolve.writes.filter(
    (w) => w.baseMarketKey === 'points-all-game-ml',
  );
  assert.equal(moneylineWrites.length, 2);
  for (const write of moneylineWrites) {
    assert.equal(write.canonicalTableMatched, false);
    // NOT 'game_ml_mlb' -- the table's key 'mlb-ml-all-game' is a shape the
    // normalizer's template cannot produce.
    assert.equal(write.writtenMarketKey, 'points-all-game-ml');
    assert.notEqual(write.writtenMarketKey, 'game_ml_mlb');
  }

  // The one entry that IS reachable, for contrast -- so this test cannot pass by the
  // table being ignored altogether.
  const totalWrite = report.resolve.writes.find(
    (w) => w.baseMarketKey === 'points-all-game-ou',
  );
  assert.equal(totalWrite?.canonicalTableMatched, true);
  assert.equal(totalWrite?.writtenMarketKey, 'game_total_ou');

  assert.ok(report.gaps.some((g) => g.id === 'A-canonical-table-unreachable'));
});

test('GAP B: the resolver writes a raw team score where grading expects 1 | 0 | 0.5', async () => {
  const report = await runSgoJourneyProof({
    pickMarket: 'moneyline',
    payload: buildStagingResultsPayload({ homeScore: 3, awayScore: 5 }),
  });

  const values = report.resolve.writes
    .filter((w) => w.providerSide !== null)
    .map((w) => w.writtenActualValue)
    .sort();
  assert.deepEqual(values, [3, 5]);
  // Neither 3 nor 5 is a moneyline outcome. The away side won, and that fact exists
  // only in the COMPARISON of the two rows -- never in either row alone.
  for (const value of values) {
    assert.ok(![1, 0, 0.5].includes(value));
  }

  assert.ok(report.gaps.some((g) => g.id === 'B-raw-score-is-not-an-outcome'));
});

test('GAP C: the journey does not complete -- no written key is one grading looks for', async () => {
  const report = await runSgoJourneyProof({ pickMarket: 'moneyline' });

  assert.equal(report.journeyCompletes, false);
  assert.deepEqual(report.joinedMarketKeys, []);
  // Grading looks for the pick's own key and its static alias...
  assert.deepEqual(report.grade.staticCandidateMarketKeys.sort(), [
    'game_moneyline_win',
    'moneyline',
  ]);
  // ...and the resolver writes neither.
  const written = report.resolve.writes.map((w) => w.writtenMarketKey);
  assert.ok(!written.includes('moneyline'));
  assert.ok(!written.includes('game_moneyline_win'));

  assert.ok(report.gaps.some((g) => g.id === 'C-no-market-key-join'));
});

test('the grading classifier does reach a moneyline rule, so the gap is the join and not the classifier', async () => {
  const report = await runSgoJourneyProof({ pickMarket: 'moneyline' });

  // Worth pinning separately: the moneyline family and the `usesLine: false` fix are
  // real and working. A reader must not conclude from the failing journey that
  // moneyline grading was never wired -- it was; it just has nothing to join to.
  assert.equal(report.grade.rule.family, 'game_moneyline');
  assert.equal(report.grade.rule.gradeable, true);
  assert.equal(report.grade.rule.usesLine, false);
  assert.equal(report.grade.rule.participantRequirement, 'required');
});

test('a game total DOES complete the journey, which is what makes the moneyline failure specific', async () => {
  const report = await runSgoJourneyProof({ pickMarket: 'game_total_ou' });

  // This is the control. The same fixture, the same real code, a different market --
  // and the join succeeds. Without it, the four gaps above could be explained by the
  // harness being wrong rather than by the code.
  assert.equal(report.journeyCompletes, true);
  assert.deepEqual(report.joinedMarketKeys, ['game_total_ou']);
  assert.equal(report.grade.rule.family, 'game_total');
  assert.ok(!report.gaps.some((g) => g.id === 'C-no-market-key-join'));
});

test('the proof refuses a fixture that could be mistaken for real data', () => {
  assert.throws(
    () => assertFixtureIsIdentifiable({ data: [{ eventID: 'real-mlb-2026-09-09' }] }),
    /does not carry UTV2-1889-STAGING-FIXTURE/,
  );
  // An empty payload must not read as a pass either.
  assert.throws(() => assertFixtureIsIdentifiable({ data: [] }), /vacuous/);
  assert.doesNotThrow(() => assertFixtureIsIdentifiable(buildStagingResultsPayload()));
});

test('the fixture is served without reaching the provider', async () => {
  // If the injected transport were bypassed, this would attempt a real request with a
  // non-credential key and fail. Completing the parse is the evidence that no paid
  // call was made -- SGO activation is unapproved.
  const report = await runSgoJourneyProof({ pickMarket: 'moneyline' });
  assert.equal(report.parse.events.length, 1);
  assert.ok(report.fixtureEventId.startsWith(STAGING_FIXTURE_PREFIX));
});
