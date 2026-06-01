import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createIndependentAdversarialRecord } from './independent-data-path.js';
import { detectManipulation } from './manipulation-detector.js';
import { detectProviderAnomalies } from './provider-anomaly.js';
import {
  ADVERSARIAL_ESCALATION_AUDIT_EVENT_TYPE,
  ADVERSARIAL_ESCALATION_EVENT_TYPE,
  EscalationError,
  buildAdversarialEscalation,
  buildAdversarialEscalationBatch,
} from './escalation.js';

const capturedAt = '2026-06-01T12:00:00.000Z';
const detectedAt = '2026-06-01T12:01:00.000Z';
const escalatedAt = '2026-06-01T12:02:00.000Z';

test('builds a first-class escalation event for quarantine manipulation findings', () => {
  const record = createIndependentAdversarialRecord({
    id: 'escalation-record-line-fabrication',
    rawSnapshot: {
      source: 'provider-a',
      capturedAt,
      payload: {
        eventId: 'event-1',
        offer: { market: 'points', selection: 'player-a', line: 18.5 },
        marketConsensus: { line: 21.5 },
      },
    },
  });
  const finding = detectManipulation({ record, detectedAt });

  const result = buildAdversarialEscalation({ finding, escalatedAt, economicImpact: 0 });

  assert.ok(result.escalationEvent);
  assert.equal(result.escalationEvent.eventType, ADVERSARIAL_ESCALATION_EVENT_TYPE);
  assert.equal(result.escalationEvent.findingId, finding.id);
  assert.equal(result.escalationEvent.recordId, record.id);
  assert.equal(result.escalationEvent.replayKey, record.replayKey);
  assert.equal(result.escalationEvent.classification, 'line_fabrication');
  assert.equal(result.escalationEvent.quarantineSignal, true);
  assert.equal(result.escalationEvent.economicImpactIgnored, true);
  assert.match(result.escalationEvent.id, /^advesc_[a-f0-9]{16}$/);
  assert.equal(result.auditEvent.eventType, ADVERSARIAL_ESCALATION_AUDIT_EVENT_TYPE);
  assert.equal(result.auditEvent.decision, 'escalated');
  assert.equal(result.auditEvent.reason, 'quarantine_signal_present');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.escalationEvent), true);
  assert.equal(Object.isFrozen(result.auditEvent), true);
});

test('audits non-quarantine findings without emitting an escalation event', () => {
  const record = createIndependentAdversarialRecord({
    rawSnapshot: {
      source: 'provider-b',
      capturedAt,
      payload: {
        eventId: 'event-2',
        offer: { market: 'rebounds', selection: 'player-b', line: 8.5, timestamp: capturedAt },
        marketConsensus: { line: 8 },
      },
    },
  });

  const finding = detectManipulation({ record, detectedAt });
  const result = buildAdversarialEscalation({ finding, escalatedAt });

  assert.equal(finding.quarantineSignal, false);
  assert.equal(result.escalationEvent, null);
  assert.equal(result.auditEvent.decision, 'not_escalated');
  assert.equal(result.auditEvent.reason, 'quarantine_signal_absent');
  assert.equal(result.auditEvent.findingId, finding.id);
});

test('ignores economic impact when a quarantine signal is present', () => {
  const record = createIndependentAdversarialRecord({
    rawSnapshot: {
      source: 'provider-c',
      capturedAt,
      payload: {
        eventId: 'event-3',
        offer: { market: 'assists', selection: 'player-c', line: 5.5 },
        volumeSpikeRatio: 7,
      },
    },
  });
  const finding = detectManipulation({ record, detectedAt });

  const zeroImpact = buildAdversarialEscalation({ finding, escalatedAt, economicImpact: 0 });
  const highImpact = buildAdversarialEscalation({ finding, escalatedAt, economicImpact: 1_000_000 });

  assert.ok(zeroImpact.escalationEvent);
  assert.ok(highImpact.escalationEvent);
  assert.deepEqual(zeroImpact.escalationEvent, highImpact.escalationEvent);
  assert.deepEqual(zeroImpact.auditEvent, highImpact.auditEvent);
});

test('routes provider anomaly findings through the same escalation contract', () => {
  const stale = createIndependentAdversarialRecord({
    id: 'stale-escalation-record',
    rawSnapshot: {
      source: 'provider-d',
      capturedAt: '2026-06-01T11:55:00.000Z',
      payload: {
        eventId: 'event-4',
        offer: { market: 'points', selection: 'player-d', line: 20.5, odds: -110 },
      },
    },
  });

  const [report] = detectProviderAnomalies({ records: [stale], detectedAt });
  assert.ok(report);

  const result = buildAdversarialEscalation({ finding: report, escalatedAt });

  assert.ok(result.escalationEvent);
  assert.equal(result.escalationEvent.classification, 'stale_data');
  assert.equal(result.escalationEvent.findingId, report.id);
  assert.equal(result.auditEvent.decision, 'escalated');
});

test('batch escalation preserves input order and freezes the result list', () => {
  const cleanRecord = createIndependentAdversarialRecord({
    rawSnapshot: {
      source: 'provider-e',
      capturedAt,
      payload: {
        eventId: 'event-5',
        offer: { market: 'points', selection: 'player-e', line: 20.5, timestamp: capturedAt },
        marketConsensus: { line: 20 },
      },
    },
  });
  const manipulatedRecord = createIndependentAdversarialRecord({
    rawSnapshot: {
      source: 'provider-f',
      capturedAt,
      payload: {
        eventId: 'event-6',
        offer: { market: 'points', selection: 'player-f', line: 24.5 },
        marketConsensus: { line: 21.5 },
      },
    },
  });
  const cleanFinding = detectManipulation({ record: cleanRecord, detectedAt });
  const manipulatedFinding = detectManipulation({ record: manipulatedRecord, detectedAt });

  const results = buildAdversarialEscalationBatch({
    findings: [cleanFinding, manipulatedFinding],
    escalatedAt,
  });

  assert.equal(results.length, 2);
  assert.equal(results[0]?.auditEvent.findingId, cleanFinding.id);
  assert.equal(results[0]?.escalationEvent, null);
  assert.equal(results[1]?.auditEvent.findingId, manipulatedFinding.id);
  assert.ok(results[1]?.escalationEvent);
  assert.equal(Object.isFrozen(results), true);
});

test('rejects malformed escalation timestamps', () => {
  const record = createIndependentAdversarialRecord({
    rawSnapshot: {
      source: 'provider-g',
      capturedAt,
      payload: {
        eventId: 'event-7',
        offer: { market: 'points', selection: 'player-g', line: 24.5 },
        marketConsensus: { line: 21.5 },
      },
    },
  });
  const finding = detectManipulation({ record, detectedAt });

  assert.throws(
    () => buildAdversarialEscalation({ finding, escalatedAt: '2026-06-01T12:02:00Z' }),
    EscalationError,
  );
});
