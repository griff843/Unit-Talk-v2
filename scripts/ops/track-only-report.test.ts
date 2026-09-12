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
// UTV2-1889 -- the Track Only stats aggregate.
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

test('the canonical table maps the key the normalizer can emit onto the key grading reads', async () => {
  const report = await runSgoJourneyProof({ pickMarket: 'moneyline' });

  const moneylineWrites = report.resolve.writes.filter(
    (w) => w.baseMarketKey === 'points-all-game-ml',
  );
  assert.equal(moneylineWrites.length, 2);
  for (const write of moneylineWrites) {
    // Before UTV2-1889 this table was keyed `mlb-ml-all-game` -- a shape the
    // normalizer's template cannot produce -- so it never matched and the raw
    // provider key was written instead. Keying it on the emitted shape is the repair.
    assert.equal(write.canonicalTableMatched, true);
    assert.equal(write.writtenMarketKey, 'game_moneyline_win');
    assert.notEqual(write.writtenMarketKey, 'points-all-game-ml');
  }

  // The entry that was always reachable, kept for contrast -- so this test cannot
  // pass by the table having become an unconditional rewrite.
  const totalWrite = report.resolve.writes.find(
    (w) => w.baseMarketKey === 'points-all-game-ou',
  );
  assert.equal(totalWrite?.canonicalTableMatched, true);
  assert.equal(totalWrite?.writtenMarketKey, 'game_total_ou');
});

test('a moneyline row carries an outcome in {1, 0, 0.5} and never a raw team score', async () => {
  const report = await runSgoJourneyProof({
    pickMarket: 'moneyline',
    payload: buildStagingResultsPayload({ homeScore: 3, awayScore: 5 }),
  });

  const moneylineRows = report.resolve.inserted.filter(
    (row) => row.marketKey === 'game_moneyline_win',
  );
  assert.equal(moneylineRows.length, 2);

  const values = moneylineRows.map((row) => row.actualValue).sort();
  assert.deepEqual(values, [0, 1]);
  // 3 and 5 are the scores. Neither may appear: the away side won, and that fact
  // exists only in the COMPARISON of the two rows, never in either score alone.
  assert.ok(!values.includes(3));
  assert.ok(!values.includes(5));

  // And every one of them says whose outcome it is.
  for (const row of moneylineRows) {
    assert.ok(row.participantId, 'a moneyline outcome must name its side');
  }
  assert.equal(new Set(moneylineRows.map((r) => r.participantId)).size, 2);
});

test('the journey completes: the pick settles on a row the resolver wrote, and the settlement counts', async () => {
  const report = await runSgoJourneyProof({ pickMarket: 'moneyline' });

  // The full chain, asserted at each seam rather than only at the end -- a failure
  // anywhere between the parse and the statistic has to name where it happened.
  assert.deepEqual(report.grade.staticCandidateMarketKeys.sort(), [
    'game_moneyline_win',
    'moneyline',
  ]);
  assert.deepEqual(report.joinedMarketKeys, ['game_moneyline_win']);

  assert.equal(report.settle.graded, 1, 'the grading pass must settle exactly this pick');
  // The default fixture is home 3, away 5, and the pick is on the away side.
  assert.equal(report.settle.settlementResult, 'win');
  assert.equal(
    report.settle.evidencePlane,
    true,
    'a Track Only pick settles on the evidence plane, with no lifecycle move',
  );
  assert.equal(
    report.settle.pickStatus,
    'validated',
    'the evidence plane must not advance the pick out of validated',
  );

  assert.equal(report.stats.record.win, 1);
  assert.equal(report.stats.record.decided, 1);
  assert.equal(report.stats.pending, 0);
  assert.deepEqual(report.stats.excluded, []);

  assert.equal(report.journeyCompletes, true);
  assert.deepEqual(report.gaps, []);
});

test('a pick on the losing side grades a loss, so the outcome is read and not assumed', async () => {
  // The control for the test above. Same fixture, same code, the other side --
  // and if the resolver were writing a constant, or grading were defaulting to a
  // win, this is where it would show.
  const report = await runSgoJourneyProof({
    pickMarket: 'moneyline',
    pickSelection: 'Fixture Home Nine',
    pickTeamSide: 'home',
  });

  assert.equal(report.settle.graded, 1);
  assert.equal(report.settle.settlementResult, 'loss');
  assert.equal(report.stats.record.loss, 1);
  assert.equal(report.stats.record.win, 0);
  assert.equal(report.journeyCompletes, true);
});

test('the grading classifier reaches a moneyline rule with usesLine false', async () => {
  const report = await runSgoJourneyProof({ pickMarket: 'moneyline' });

  // Worth pinning separately from the journey: a moneyline has no line, so a rule
  // that demanded one would skip every moneyline on `missing_line` long before the
  // market keys were ever compared.
  assert.equal(report.grade.rule.family, 'game_moneyline');
  assert.equal(report.grade.rule.gradeable, true);
  assert.equal(report.grade.rule.usesLine, false);
  assert.equal(report.grade.rule.participantRequirement, 'required');
});

test('a game total completes the journey too, by a different rule and a different row', async () => {
  const report = await runSgoJourneyProof({
    pickMarket: 'game_total',
    pickSelection: 'Over 7.5',
    pickLine: 7.5,
    pickTeamSide: null,
  });

  // The second market shape. It resolves its event by NAME rather than by
  // participant (participantRequirement is `forbidden` for a game total), reads a
  // quantity rather than an outcome, and settles through the same pass -- so the
  // moneyline result above cannot be an artifact of one hard-coded path.
  assert.equal(report.grade.rule.family, 'game_total');
  assert.equal(report.grade.rule.participantRequirement, 'forbidden');
  assert.deepEqual(report.joinedMarketKeys, ['game_total_ou']);

  const totalRow = report.resolve.inserted.find((row) => row.marketKey === 'game_total_ou');
  assert.equal(totalRow?.actualValue, 8, '3 + 5 -- a total is a quantity, not an outcome');
  assert.equal(totalRow?.participantId, null, 'a total belongs to the game, not a side');

  // Over 7.5 against an actual 8.
  assert.equal(report.settle.settlementResult, 'win');
  assert.equal(report.journeyCompletes, true);
  assert.deepEqual(report.gaps, []);
});

test('every inserted row is attributed to the sgo source, which is what grading trusts', async () => {
  const report = await runSgoJourneyProof({ pickMarket: 'moneyline' });

  // `validateEventProvenanceForGrading` admits only `sgo` and `operator` events, and
  // this journey is the SGO one. If the resolver ever wrote under a different source
  // the rows would still exist and would silently stop being gradeable.
  assert.ok(report.resolve.inserted.length > 0);
  for (const row of report.resolve.inserted) {
    assert.equal(row.source, 'sgo');
  }
  assert.equal(report.resolve.summary.insertedResults, report.resolve.inserted.length);
  assert.equal(report.resolve.summary.skippedTeamSideUnresolved, 0);
  assert.equal(report.resolve.summary.skippedMoneylineOutcomeUnresolved, 0);
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
