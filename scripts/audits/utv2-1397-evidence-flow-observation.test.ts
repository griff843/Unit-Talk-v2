import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runEvidenceFlowObservation } from './utv2-1397-evidence-flow-observation.js';

function baseRow(overrides: Record<string, unknown>) {
  return {
    id: 'pick-default',
    source: 'alert-agent',
    selection: 'default selection',
    status: 'posted',
    promotion_status: 'suppressed',
    promotion_target: null,
    created_at: '2026-07-01T00:00:00.000Z',
    metadata: {},
    ...overrides,
  };
}

test('UTV2-1397: a source with zero real rows reports INSUFFICIENT_DATA, not PASS/FAIL', async () => {
  const now = new Date('2026-07-02T00:00:00.000Z');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-flow-'));

  const summary = await runEvidenceFlowObservation({
    now,
    outDir,
    rows: [
      baseRow({ source: 'alert-agent', metadata: { testRun: true } }),
      baseRow({ source: 'model-driven', metadata: { proof_issue: 'UTV2-1022' } }),
      baseRow({ source: 'smart-form', selection: 'UTV2-1022 RISK PROOF x' }),
    ],
  });

  const bySource = summary['by_source'] as Record<string, { real_sample_count: number; verdict: string }>;
  assert.equal(bySource['alert-agent']?.real_sample_count, 0);
  assert.equal(bySource['alert-agent']?.verdict, 'INSUFFICIENT_DATA');
  assert.equal(bySource['model-driven']?.verdict, 'INSUFFICIENT_DATA');
  assert.equal(bySource['smart-form']?.verdict, 'INSUFFICIENT_DATA');
  assert.equal(summary['overall_verdict'], 'INSUFFICIENT_DATA');
});

test('UTV2-1397: a real (non-fixture) row is counted and classified per-source', async () => {
  const now = new Date('2026-07-02T00:00:00.000Z');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-flow-'));

  const summary = await runEvidenceFlowObservation({
    now,
    outDir,
    rows: [
      baseRow({
        id: 'real-1',
        source: 'model-driven',
        promotion_status: 'promoted',
        metadata: { domainAnalysis: { realEdge: 0.03 } },
      }),
      baseRow({ id: 'fixture-1', source: 'model-driven', metadata: { testRun: true } }),
    ],
  });

  const bySource = summary['by_source'] as Record<
    string,
    { real_sample_count: number; excluded_fixture_count: number; domain_analysis_present_pct: number; verdict: string }
  >;
  assert.equal(bySource['model-driven']?.real_sample_count, 1);
  assert.equal(bySource['model-driven']?.excluded_fixture_count, 1);
  assert.equal(bySource['model-driven']?.domain_analysis_present_pct, 100);
  assert.equal(bySource['model-driven']?.verdict, 'PASS');
  assert.equal(bySource['alert-agent']?.verdict, 'INSUFFICIENT_DATA');
  assert.equal(summary['overall_verdict'], 'PARTIAL', 'mixed PASS + INSUFFICIENT_DATA sources yields PARTIAL overall');
});

test('UTV2-1397: majority confidence-fallback on a populated source is PARTIAL, not PASS', async () => {
  const now = new Date('2026-07-02T00:00:00.000Z');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-flow-'));

  const summary = await runEvidenceFlowObservation({
    now,
    outDir,
    rows: [
      baseRow({ id: 'r1', source: 'smart-form', metadata: { domainAnalysis: { confidenceDelta: 0.1 } } }),
      baseRow({ id: 'r2', source: 'smart-form', metadata: { domainAnalysis: { confidenceDelta: 0.2 } } }),
      baseRow({ id: 'r3', source: 'smart-form', metadata: { domainAnalysis: { realEdge: 0.02 } } }),
    ],
  });

  const bySource = summary['by_source'] as Record<string, { verdict: string; edge_source_quality: Record<string, number> }>;
  assert.equal(bySource['smart-form']?.edge_source_quality['confidence-fallback'], 2);
  assert.equal(bySource['smart-form']?.verdict, 'PARTIAL');
});

test('UTV2-1397: does not read or claim delivery status when absent from metadata', async () => {
  const now = new Date('2026-07-02T00:00:00.000Z');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-flow-'));

  const summary = await runEvidenceFlowObservation({
    now,
    outDir,
    rows: [baseRow({ id: 'r1', source: 'alert-agent', metadata: { domainAnalysis: { realEdge: 0.01 } } })],
  });

  const bySource = summary['by_source'] as Record<string, { delivery_status: unknown }>;
  assert.equal(bySource['alert-agent']?.delivery_status, null, 'delivery_status must be null, not fabricated, when not naturally present');
});
