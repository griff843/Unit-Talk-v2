import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateAgeFinding,
  parseThreshold,
  resolveIngestorAlertThresholds,
} from './ingestor-alert-check.js';

test('ingestor alert thresholds prefer canonical provider-offer staleness env', () => {
  const thresholds = resolveIngestorAlertThresholds({
    UNIT_TALK_INGESTOR_OFFER_STALE_MINUTES: '45',
    INGESTOR_ALERT_OFFERS_THRESHOLD_MINUTES: '15',
    INGESTOR_ALERT_RESULTS_THRESHOLD_MINUTES: '90',
    INGESTOR_ALERT_CYCLE_THRESHOLD_MINUTES: '10',
  });

  assert.deepEqual(thresholds, {
    offers: 45,
    results: 90,
    cycle: 10,
  });
});

test('ingestor alert threshold parser rejects invalid values', () => {
  assert.equal(parseThreshold('0', 30), 30);
  assert.equal(parseThreshold('-5', 30), 30);
  assert.equal(parseThreshold('abc', 30), 30);
  assert.equal(parseThreshold('31', 30), 31);
});

test('ingestor alert finding trips when latest provider snapshot exceeds threshold', () => {
  const now = new Date('2026-04-21T16:00:00.000Z');
  const finding = evaluateAgeFinding(
    'offers',
    '2026-04-21T15:20:00.000Z',
    30,
    null,
    now,
  );

  assert.equal(finding.level, 'CRITICAL');
  assert.equal(finding.ageMinutes, 40);
  assert.match(finding.message, /threshold: 30m/);
});
