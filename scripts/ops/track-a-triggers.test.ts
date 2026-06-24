import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateTriggers,
  recommend,
  DEVELOPING_THRESHOLD,
  HEARTBEAT_HOURS,
  PROVIDER_FRESHNESS_THRESHOLD_MINUTES,
  STALE_PRICE_SHARE_THRESHOLD,
  type TrackASnapshot,
} from './track-a-triggers.js';

function snap(over: Partial<TrackASnapshot> = {}): TrackASnapshot {
  return {
    capturedAt: '2026-06-13T00:00:00.000Z',
    settledClvPathNative: 0,
    closingForClvTotal: 177,
    closingForClvBackfilled: 172,
    closingForClvNative: 5,
    wellFormedPendingPlayerProps: 1848,
    wellFormedSettledPlayerProps: 219,
    clvComputed: 386,
    clvMissingEventContext: 1960,
    clvMissingClosingLine: 212,
    suppressPicks: 9829,
    publicDiscordRecentPosts: null,
    errors: [],
    // Front-of-funnel defaults: healthy state (no rejections, fresh data, full coverage)
    stalePriceRejections: 0,
    candidatesScanned: 100,
    providerOfferMaxAgeMinutes: 10,
    providerOfferMedianAgeMinutes: 5,
    upcomingEventsWithPropCoverage: 5,
    upcomingEventsTotal: 5,
    ingestorPropsFetched: 200,
    ...over,
  };
}

test('first run establishes a baseline report', () => {
  const r = evaluateTriggers({ current: snap(), previous: null, hoursSinceLastReport: null });
  assert.equal(r.shouldReport, true);
  assert.equal(r.isBaseline, true);
  assert.match(r.reasons.join(' '), /baseline/);
});

test('steady state within 24h does not report', () => {
  const prev = snap();
  const r = evaluateTriggers({ current: snap(), previous: prev, hoursSinceLastReport: 6 });
  assert.equal(r.shouldReport, false);
  assert.equal(r.isHeartbeat, false);
  assert.deepEqual(r.reasons, []);
});

test('24h of silence emits a heartbeat', () => {
  const prev = snap();
  const r = evaluateTriggers({
    current: snap(),
    previous: prev,
    hoursSinceLastReport: HEARTBEAT_HOURS + 1,
  });
  assert.equal(r.shouldReport, true);
  assert.equal(r.isHeartbeat, true);
});

test('no heartbeat when hoursSinceLastReport is unknown', () => {
  const r = evaluateTriggers({ current: snap(), previous: snap(), hoursSinceLastReport: null });
  assert.equal(r.shouldReport, false);
});

test('settled CLV-path increase triggers a report', () => {
  const prev = snap({ settledClvPathNative: 0 });
  const cur = snap({ settledClvPathNative: 1 });
  const r = evaluateTriggers({ current: cur, previous: prev, hoursSinceLastReport: 6 });
  assert.equal(r.shouldReport, true);
  assert.match(r.reasons.join(' '), /settled CLV-path increased 0 → 1/);
});

test('crossing the DEVELOPING threshold recommends re-trigger', () => {
  const prev = snap({ settledClvPathNative: 49 });
  const cur = snap({ settledClvPathNative: DEVELOPING_THRESHOLD });
  const r = evaluateTriggers({ current: cur, previous: prev, hoursSinceLastReport: 6 });
  assert.equal(r.shouldReport, true);
  assert.match(r.recommendation, /re-trigger/i);
  assert.match(r.reasons.join(' '), /DEVELOPING threshold met/);
});

test('new native closing_for_clv row triggers a report', () => {
  const prev = snap({ closingForClvNative: 5 });
  const cur = snap({ closingForClvNative: 6 });
  const r = evaluateTriggers({ current: cur, previous: prev, hoursSinceLastReport: 6 });
  assert.equal(r.shouldReport, true);
  assert.match(r.reasons.join(' '), /new native closing_for_clv/);
});

test('new well-formed player-prop settlement triggers a report', () => {
  const prev = snap({ wellFormedSettledPlayerProps: 219 });
  const cur = snap({ wellFormedSettledPlayerProps: 220 });
  const r = evaluateTriggers({ current: cur, previous: prev, hoursSinceLastReport: 6 });
  assert.equal(r.shouldReport, true);
  assert.match(r.reasons.join(' '), /player-prop settlement/);
});

test('read errors surface as a blocker and escalation recommendation', () => {
  const cur = snap({ errors: ['picks -> HTTP 500'] });
  const r = evaluateTriggers({ current: cur, previous: snap(), hoursSinceLastReport: 6 });
  assert.equal(r.shouldReport, true);
  assert.match(r.reasons.join(' '), /blocker/);
  assert.match(r.recommendation, /escalate/i);
});

test('recommend never certifies and stays in continue-monitoring below threshold', () => {
  assert.match(recommend(snap()), /continue monitoring/);
  assert.doesNotMatch(recommend(snap()), /certif/i);
});

test('backfilled-only closing rows do NOT count toward the threshold metric', () => {
  // 172 backfilled + 5 native; native settled CLV-path is 0 → below threshold, no spurious trigger.
  const s = snap({ settledClvPathNative: 0, closingForClvBackfilled: 172, closingForClvNative: 5 });
  const r = evaluateTriggers({ current: s, previous: snap(), hoursSinceLastReport: 6 });
  assert.equal(r.shouldReport, false);
});

// --- Front-of-funnel trigger tests (UTV2-1278) ---

test('FRONT_OF_FUNNEL_BLOCKER fires when stale price share exceeds 50%', () => {
  // 51/100 = 51% > STALE_PRICE_SHARE_THRESHOLD (50%)
  const cur = snap({ stalePriceRejections: 51, candidatesScanned: 100 });
  const r = evaluateTriggers({ current: cur, previous: snap(), hoursSinceLastReport: 6 });
  assert.equal(r.shouldReport, true);
  assert.match(r.reasons.join(' '), /FRONT_OF_FUNNEL_BLOCKER/);
  assert.match(r.reasons.join(' '), /stale_price_data/);
});

test('FRONT_OF_FUNNEL_BLOCKER does NOT fire at exactly 50% (boundary is exclusive)', () => {
  // 50/100 = exactly 50% — threshold is >, not >=
  const cur = snap({ stalePriceRejections: 50, candidatesScanned: 100 });
  const r = evaluateTriggers({ current: cur, previous: snap(), hoursSinceLastReport: 6 });
  assert.equal(r.shouldReport, false);
  assert.ok(!r.reasons.join(' ').includes('FRONT_OF_FUNNEL_BLOCKER'));
});

test('FRONT_OF_FUNNEL_BLOCKER does NOT fire when candidatesScanned is zero (no telemetry)', () => {
  // No scan cycle data — avoid division by zero / spurious trigger
  const cur = snap({ stalePriceRejections: 0, candidatesScanned: 0 });
  const r = evaluateTriggers({ current: cur, previous: snap(), hoursSinceLastReport: 6 });
  assert.equal(r.shouldReport, false);
});

test('PROVIDER_FRESHNESS_STALE fires when max offer age exceeds threshold', () => {
  const staleMinutes = PROVIDER_FRESHNESS_THRESHOLD_MINUTES + 1;
  const cur = snap({ providerOfferMaxAgeMinutes: staleMinutes, providerOfferMedianAgeMinutes: 20 });
  const r = evaluateTriggers({ current: cur, previous: snap(), hoursSinceLastReport: 6 });
  assert.equal(r.shouldReport, true);
  assert.match(r.reasons.join(' '), /PROVIDER_FRESHNESS_STALE/);
  assert.match(r.reasons.join(' '), /ingestor may be stalled/);
});

test('PROVIDER_FRESHNESS_STALE does NOT fire when max age is within threshold', () => {
  const cur = snap({ providerOfferMaxAgeMinutes: PROVIDER_FRESHNESS_THRESHOLD_MINUTES - 1 });
  const r = evaluateTriggers({ current: cur, previous: snap(), hoursSinceLastReport: 6 });
  assert.equal(r.shouldReport, false);
  assert.ok(!r.reasons.join(' ').includes('PROVIDER_FRESHNESS_STALE'));
});

test('PROVIDER_FRESHNESS_STALE does NOT fire when providerOfferMaxAgeMinutes is null', () => {
  // null means no upcoming events or query failed — do not spuriously trigger
  const cur = snap({ providerOfferMaxAgeMinutes: null, upcomingEventsTotal: 0, upcomingEventsWithPropCoverage: 0 });
  const r = evaluateTriggers({ current: cur, previous: snap(), hoursSinceLastReport: 6 });
  assert.equal(r.shouldReport, false);
});

test('NO_PROP_COVERAGE fires when upcoming events exist but zero have fresh props', () => {
  const cur = snap({ upcomingEventsTotal: 3, upcomingEventsWithPropCoverage: 0 });
  const r = evaluateTriggers({ current: cur, previous: snap(), hoursSinceLastReport: 6 });
  assert.equal(r.shouldReport, true);
  assert.match(r.reasons.join(' '), /NO_PROP_COVERAGE/);
  assert.match(r.reasons.join(' '), /SGO player prop ingestion may be failing/);
});

test('NO_PROP_COVERAGE does NOT fire when upcomingEventsTotal is zero (no games today)', () => {
  const cur = snap({ upcomingEventsTotal: 0, upcomingEventsWithPropCoverage: 0 });
  const r = evaluateTriggers({ current: cur, previous: snap(), hoursSinceLastReport: 6 });
  assert.equal(r.shouldReport, false);
  assert.ok(!r.reasons.join(' ').includes('NO_PROP_COVERAGE'));
});

test('NO_PROP_COVERAGE does NOT fire when at least one event has coverage', () => {
  const cur = snap({ upcomingEventsTotal: 5, upcomingEventsWithPropCoverage: 1 });
  const r = evaluateTriggers({ current: cur, previous: snap(), hoursSinceLastReport: 6 });
  assert.equal(r.shouldReport, false);
  assert.ok(!r.reasons.join(' ').includes('NO_PROP_COVERAGE'));
});

test('recommend surfaces NO_PROP_COVERAGE investigation when no prop coverage on game day', () => {
  const s = snap({ upcomingEventsTotal: 5, upcomingEventsWithPropCoverage: 0 });
  assert.match(recommend(s), /SGO player prop ingestion/);
});

test('recommend surfaces PROVIDER_FRESHNESS investigation when offers are stale', () => {
  const s = snap({
    upcomingEventsWithPropCoverage: 5, // no NO_PROP_COVERAGE trigger
    providerOfferMaxAgeMinutes: PROVIDER_FRESHNESS_THRESHOLD_MINUTES + 10,
  });
  assert.match(recommend(s), /provider offer freshness/);
});

test('recommend surfaces stale price rejection investigation when majority are rejected', () => {
  const s = snap({
    upcomingEventsWithPropCoverage: 5, // no NO_PROP_COVERAGE trigger
    providerOfferMaxAgeMinutes: 10, // no PROVIDER_FRESHNESS_STALE
    stalePriceRejections: 60,
    candidatesScanned: 100,
  });
  assert.match(recommend(s), /stale price rejections/);
});

test('stale price threshold constant is exported with expected value', () => {
  assert.equal(STALE_PRICE_SHARE_THRESHOLD, 0.5);
});

test('provider freshness threshold constant is exported with expected value', () => {
  assert.equal(PROVIDER_FRESHNESS_THRESHOLD_MINUTES, 30);
});
