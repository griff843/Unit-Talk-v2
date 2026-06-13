import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateTriggers,
  recommend,
  DEVELOPING_THRESHOLD,
  HEARTBEAT_HOURS,
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
