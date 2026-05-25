/**
 * UTV2-1092: INIT-1.2.3 — Replay Divergence Engine
 *
 * Tests that ReplayDivergenceEngine detects all divergences between
 * replay output and historical production output, halts the run by throwing,
 * emits a report, and routes it for governance escalation.
 *
 * Adversarial scenario: inject a subtle non-deterministic output;
 * the engine must classify it as divergence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReplayDivergenceEngine } from './replay-divergence.js';
import type { ReplayDivergenceReport } from './replay-types.js';

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function makeEngine(runId = 'run-test-001'): ReplayDivergenceEngine {
  return new ReplayDivergenceEngine({ runId });
}

function baseOutput(): Record<string, unknown> {
  return {
    pick_id: 'pick-abc',
    score: 0.85,
    status: 'validated',
    metadata: { tier: 'vip', confidence: 0.9 },
  };
}

// ─────────────────────────────────────────────────────────────
// no divergence
// ─────────────────────────────────────────────────────────────

test('identical outputs: no throw, no report', () => {
  const engine = makeEngine();
  const expected = baseOutput();
  const actual = { ...baseOutput() };

  engine.compare('ingestion', 'pick-abc', expected, actual);
  assert.equal(engine.hasDivergence(), false);
  assert.equal(engine.getReports().length, 0);
});

// ─────────────────────────────────────────────────────────────
// divergence detection
// ─────────────────────────────────────────────────────────────

test('changed field value: throws and creates report', () => {
  const engine = makeEngine();
  const expected = baseOutput();
  const actual = { ...baseOutput(), score: 0.84 }; // subtle 0.01 change

  assert.throws(
    () => engine.compare('ingestion', 'pick-abc', expected, actual),
    /divergence/i
  );
  assert.equal(engine.hasDivergence(), true);
  assert.equal(engine.getReports().length, 1);
});

test('missing field in actual: throws', () => {
  const engine = makeEngine();
  const expected = baseOutput();
  const actual = { pick_id: 'pick-abc', score: 0.85, status: 'validated' }; // metadata missing

  assert.throws(
    () => engine.compare('scoring', 'pick-abc', expected, actual),
    /divergence/i
  );
});

test('extra field in actual: throws', () => {
  const engine = makeEngine();
  const expected = baseOutput();
  const actual = { ...baseOutput(), unexpected_field: 'injected' };

  assert.throws(
    () => engine.compare('promotion', 'pick-abc', expected, actual),
    /divergence/i
  );
});

test('type mismatch (number vs string): throws', () => {
  const engine = makeEngine();
  const expected = baseOutput();
  const actual = { ...baseOutput(), score: '0.85' }; // string instead of number

  assert.throws(
    () => engine.compare('distribution', 'pick-abc', expected, actual),
    /divergence/i
  );
});

// ─────────────────────────────────────────────────────────────
// ADVERSARIAL: subtle non-deterministic output
// ─────────────────────────────────────────────────────────────

test('ADVERSARIAL: floating point non-determinism is detected', () => {
  const engine = makeEngine();
  const expected = { pick_id: 'pick-ndt', score: 0.8500000000000001 };
  const actual = { pick_id: 'pick-ndt', score: 0.85 }; // subtly different

  // JSON.stringify differences will catch this if the representations differ
  const jsonExpected = JSON.stringify(expected.score);
  const jsonActual = JSON.stringify(actual.score);

  if (jsonExpected !== jsonActual) {
    assert.throws(() => engine.compare('ingestion', 'pick-ndt', expected, actual), /divergence/i);
  } else {
    // If JS collapses them to the same float repr, they ARE equal — no divergence expected
    engine.compare('ingestion', 'pick-ndt', expected, actual);
    assert.equal(engine.hasDivergence(), false);
  }
});

test('ADVERSARIAL: nested object divergence is detected', () => {
  const engine = makeEngine();
  const expected = { pick_id: 'pick-nested', metadata: { tier: 'vip', confidence: 0.9 } };
  const actual = { pick_id: 'pick-nested', metadata: { tier: 'vip', confidence: 0.89 } }; // subtle change

  assert.throws(
    () => engine.compare('scoring', 'pick-nested', expected, actual),
    /divergence/i
  );
});

test('ADVERSARIAL: null vs undefined is detected as divergence', () => {
  const engine = makeEngine();
  const expected: Record<string, unknown> = { pick_id: 'pick-null', settlement_status: null };
  const actual: Record<string, unknown> = { pick_id: 'pick-null', settlement_status: undefined };

  // JSON.stringify(null) !== JSON.stringify(undefined) → divergence
  assert.throws(
    () => engine.compare('ingestion', 'pick-null', expected, actual),
    /divergence/i
  );
});

// ─────────────────────────────────────────────────────────────
// report content
// ─────────────────────────────────────────────────────────────

test('report contains run_id, stage, item_id, severity=critical', () => {
  const engine = makeEngine('run-report-test');
  const expected = baseOutput();
  const actual = { ...baseOutput(), score: 0.7 };
  const emittedReports: ReplayDivergenceReport[] = [];
  engine.on('divergence', (r: ReplayDivergenceReport) => emittedReports.push(r));

  try {
    engine.compare('ingestion', 'pick-abc', expected, actual);
  } catch {
    // expected
  }

  assert.equal(emittedReports.length, 1);
  const report = emittedReports[0]!;
  assert.equal(report.run_id, 'run-report-test');
  assert.equal(report.stage, 'ingestion');
  assert.equal(report.item_id, 'pick-abc');
  assert.equal(report.severity, 'critical');
  assert.ok(report.report_id.length > 0, 'report_id should be non-empty');
  assert.ok(report.detected_at, 'detected_at should be set');
});

test('report field_diffs lists all changed fields', () => {
  const engine = makeEngine();
  const expected = { pick_id: 'pick-abc', score: 0.85, status: 'validated' };
  const actual = { pick_id: 'pick-abc', score: 0.7, status: 'draft' }; // two fields changed

  try {
    engine.compare('ingestion', 'pick-abc', expected, actual);
  } catch {
    // expected
  }

  const report = engine.getReports()[0]!;
  const diffFields = report.field_diffs.map(d => d.field);
  assert.ok(diffFields.includes('score'), 'score diff should be recorded');
  assert.ok(diffFields.includes('status'), 'status diff should be recorded');
});

test('divergence event fires before throw — enables governance routing', () => {
  const engine = makeEngine();
  const expected = baseOutput();
  const actual = { ...baseOutput(), score: 0.0 };

  let eventFired = false;
  engine.on('divergence', () => {
    eventFired = true;
  });

  try {
    engine.compare('ingestion', 'pick-abc', expected, actual);
  } catch {
    // expected
  }

  assert.ok(eventFired, "'divergence' event must fire for governance routing");
});

test('report remains accessible after throw (for proof bundle)', () => {
  const engine = makeEngine();
  const expected = baseOutput();
  const actual = { ...baseOutput(), score: 0.0 };

  try {
    engine.compare('ingestion', 'pick-abc', expected, actual);
  } catch {
    // expected
  }

  // Reports are accessible via getReports() even after the throw
  assert.equal(engine.getReports().length, 1);
  assert.equal(engine.hasDivergence(), true);
});
