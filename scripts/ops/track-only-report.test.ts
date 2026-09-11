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
