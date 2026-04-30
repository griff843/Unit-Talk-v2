import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHarnessOutput,
  compareClvParity,
  compareFeatureParity,
  compareOfferParity,
  comparePickSnapshotParity,
  parseCliArgs,
  type OfferIdentityRow,
} from './provider-offer-parity-harness.js';

function makeOffer(overrides: Partial<OfferIdentityRow> = {}): OfferIdentityRow {
  return {
    identity_key: 'sgo:event-1:points-all-game-ou:player-1:pinnacle',
    provider_key: 'sgo',
    provider_event_id: 'event-1',
    provider_market_key: 'points-all-game-ou',
    provider_participant_id: 'player-1',
    bookmaker_key: 'pinnacle',
    sport_key: 'NBA',
    line: 24.5,
    over_odds: -110,
    under_odds: -110,
    devig_mode: 'PAIRED',
    snapshot_at: '2026-04-30T12:00:00.000Z',
    is_opening: false,
    is_closing: false,
    change_reason: null,
    ...overrides,
  };
}

test('parseCliArgs reads targeted and fail-closed flags', () => {
  const options = parseCliArgs([
    '--event-id',
    'evt-1',
    '--pick-id=pick-1',
    '--provider',
    'sgo',
    '--window-hours',
    '12',
    '--sample-size',
    '25',
    '--fail-on-mismatch',
    '--json',
  ]);

  assert.deepEqual(options.eventIds, ['evt-1']);
  assert.deepEqual(options.pickIds, ['pick-1']);
  assert.equal(options.provider, 'sgo');
  assert.equal(options.windowHours, 12);
  assert.equal(options.sampleSize, 25);
  assert.equal(options.failOnMismatch, true);
  assert.equal(options.json, true);
});

test('compareOfferParity passes exact current match', () => {
  const legacy = [makeOffer()];
  const next = [makeOffer()];

  const report = compareOfferParity('current', 'Hot Current Offer Parity', legacy, next, {
    freshnessToleranceSeconds: 0,
  });

  assert.equal(report.status, 'passed');
  assert.equal(report.matches, 1);
  assert.equal(report.mismatches, 0);
});

test('compareOfferParity fails when current row is missing', () => {
  const report = compareOfferParity(
    'current',
    'Hot Current Offer Parity',
    [makeOffer()],
    [],
    { freshnessToleranceSeconds: 0 },
  );

  assert.equal(report.status, 'failed');
  assert.equal(report.missingNew, 1);
  assert.equal(report.mismatchesDetail[0]?.severity, 'blocker');
});

test('compareOfferParity fails on line mismatch', () => {
  const report = compareOfferParity(
    'opening',
    'Opening Line Parity',
    [makeOffer({ line: 24.5, is_opening: true })],
    [makeOffer({ line: 25.5, is_opening: true })],
  );

  assert.equal(report.status, 'failed');
  assert.match(report.mismatchesDetail[0]?.message ?? '', /line/i);
});

test('compareOfferParity fails on odds mismatch', () => {
  const report = compareOfferParity(
    'closing',
    'Closing Line Parity',
    [makeOffer({ over_odds: -110, is_closing: true })],
    [makeOffer({ over_odds: -105, is_closing: true })],
  );

  assert.equal(report.status, 'failed');
  assert.match(report.mismatchesDetail[0]?.message ?? '', /over_odds/i);
});

test('comparePickSnapshotParity fails when required snapshot is missing', () => {
  const report = comparePickSnapshotParity(
    [
      {
        pick_id: 'pick-1',
        status: 'settled',
        source: 'system-pick-scanner',
        created_at: '2026-04-30T12:00:00.000Z',
        posted_at: '2026-04-30T12:05:00.000Z',
        settled_at: '2026-04-30T14:00:00.000Z',
        market: 'Player Points',
        market_type_id: 'player_points_ou',
        selection: 'Over',
        odds: -110,
        provider_event_id: 'event-1',
        provider_market_key: 'points-all-game-ou',
        provider_participant_id: 'player-1',
        bookmaker_key: 'pinnacle',
        event_start_time: '2026-04-30T15:00:00.000Z',
      },
    ],
    [],
    [],
  );

  assert.equal(report.status, 'failed');
  assert.ok(
    report.mismatchesDetail.some(
      (detail) =>
        detail.message.includes('Required pick snapshot missing') ||
        detail.message.includes('Legacy equivalent snapshot missing'),
    ),
  );
});

test('comparePickSnapshotParity requires posting proof for posted picks', () => {
  const report = comparePickSnapshotParity(
    [
      {
        pick_id: 'pick-posted-1',
        status: 'posted',
        source: 'system-pick-scanner',
        created_at: '2026-04-30T12:00:00.000Z',
        posted_at: '2026-04-30T12:05:00.000Z',
        settled_at: null,
        market: 'Player Points',
        market_type_id: 'player_points_ou',
        selection: 'Over',
        odds: -110,
        provider_event_id: 'event-1',
        provider_market_key: 'points-all-game-ou',
        provider_participant_id: 'player-1',
        bookmaker_key: 'pinnacle',
        event_start_time: '2026-04-30T15:00:00.000Z',
      },
    ],
    [
      {
        pickId: 'pick-posted-1',
        snapshotKind: 'submission',
        providerEventId: 'event-1',
        providerMarketKey: 'points-all-game-ou',
        providerParticipantId: 'player-1',
        bookmakerKey: 'pinnacle',
        line: 24.5,
        overOdds: -110,
        underOdds: -110,
        sourceSnapshotAt: '2026-04-30T12:00:00.000Z',
        capturedAt: '2026-04-30T12:00:00.000Z',
      },
    ],
    [
      {
        pickId: 'pick-posted-1',
        snapshotKind: 'submission',
        providerEventId: 'event-1',
        providerMarketKey: 'points-all-game-ou',
        providerParticipantId: 'player-1',
        bookmakerKey: 'pinnacle',
        line: 24.5,
        overOdds: -110,
        underOdds: -110,
        sourceSnapshotAt: '2026-04-30T12:00:00.000Z',
        capturedAt: '2026-04-30T12:00:00.000Z',
      },
    ],
  );

  assert.equal(report.status, 'failed');
  assert.ok(report.mismatchesDetail.some((detail) => detail.message.includes('posting')));
});

test('compareClvParity fails on direction mismatch', () => {
  const report = compareClvParity([
    {
      pickId: 'pick-1',
      legacySubmissionValue: 24.5,
      legacyClosingValue: 26.5,
      newSubmissionValue: 24.5,
      newClosingValue: 22.5,
    },
  ]);

  assert.equal(report.status, 'failed');
  assert.match(report.mismatchesDetail[0]?.message ?? '', /CLV direction/i);
});

test('documented expected mismatch can be warning only', () => {
  const key = 'sgo:event-1:points-all-game-ou:player-1:pinnacle';
  const report = compareOfferParity(
    'current',
    'Hot Current Offer Parity',
    [makeOffer({ identity_key: key })],
    [],
    {
      documentedExpectedMismatchKeys: new Set([key]),
    },
  );

  assert.equal(report.mismatchesDetail[0]?.severity, 'expected/documented');
});

test('compareFeatureParity blocks cleanly when entry point is missing', () => {
  const report = compareFeatureParity(null, 'Missing feature adapter');

  assert.equal(report.status, 'blocked');
  assert.equal(report.blockedReason, 'Missing feature adapter');
});

test('buildHarnessOutput JSON shape is stable', () => {
  const passed = compareOfferParity(
    'current',
    'Hot Current Offer Parity',
    [makeOffer()],
    [makeOffer()],
    { freshnessToleranceSeconds: 0 },
  );
  const blocked = compareFeatureParity(null, 'Missing feature adapter');
  const emptyArea = compareOfferParity('opening', 'Opening Line Parity', [], [], {});
  const output = buildHarnessOutput(
    {
      provider: 'sgo',
      windowHours: 24,
      sampledEventIds: ['event-1'],
      sampledPickIds: ['pick-1'],
    },
    {
      current: passed,
      opening: emptyArea,
      closing: emptyArea,
      pickSnapshots: emptyArea,
      clv: emptyArea,
      scannerScoring: emptyArea,
      commandCenter: emptyArea,
      modelFeatures: blocked,
    },
    true,
  );

  assert.deepEqual(Object.keys(output), [
    'inputs',
    'reports',
    'mismatchDetails',
    'verdict',
    'exitCode',
  ]);
  assert.equal(output.verdict, 'PARITY BLOCKED');
  assert.equal(output.exitCode, 2);
});
