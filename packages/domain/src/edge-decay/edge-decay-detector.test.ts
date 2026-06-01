import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PerformanceCohort } from '../cohorts/performance-cohort.js';
import type { AttributionRecord, AttributionDecomposition } from '../attribution/attribution-engine.js';
import {
  detectEdgeDecay,
  DEFAULT_EDGE_DECAY_THRESHOLD,
  DETECTOR_VERSION,
  type EdgeDecayThreshold,
} from './edge-decay-detector.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeRecord(
  id: string,
  modelAlpha: number,
  confidence: AttributionRecord['confidence'] = 'high',
): AttributionRecord {
  const realized = confidence === 'insufficient_data' ? 0 : 10000;
  return {
    pick_id: id,
    settled_at: '2026-01-01T00:00:00Z',
    result: 'win',
    model_component_bps: modelAlpha,
    execution_component_bps: 0,
    luck_component_bps: realized - modelAlpha,
    realized_pnl_bps: realized,
    components_sum_bps: realized,
    confidence,
    is_reproducible: confidence !== 'insufficient_data',
  };
}

function makeDecomposition(records: readonly AttributionRecord[]): AttributionDecomposition {
  const attributed = records.filter((r) => r.confidence !== 'insufficient_data');
  const byConf = { high: 0, medium: 0, low: 0, insufficient_data: 0 };
  for (const r of records) byConf[r.confidence]++;
  const modelAlpha = attributed.reduce((s, r) => s + r.model_component_bps, 0);
  return {
    total_records: records.length,
    attributed_records: attributed.length,
    excluded_insufficient_data: records.length - attributed.length,
    total_realized_pnl_bps: records.reduce((s, r) => s + r.realized_pnl_bps, 0),
    components: {
      model_alpha_bps: modelAlpha,
      execution_edge_bps: 0,
      luck_bps: 0,
      sum_check_bps: modelAlpha,
    },
    by_confidence: byConf,
    is_reproducible: attributed.length > 0,
    version: '1.0.0',
  };
}

function makeCohort(id: string, records: AttributionRecord[]): PerformanceCohort {
  return {
    cohort_id: id,
    window: { from: '2026-01-01T00:00:00Z', to: '2026-01-31T23:59:59Z' },
    pick_count: records.length,
    attribution_records: records,
    decomposition: makeDecomposition(records),
    is_reproducible: records.every((r) => r.is_reproducible),
    version: '1.0.0',
  };
}

/** Builds n records with the same model alpha value. */
function uniformCohort(id: string, alpha: number, count = 10): PerformanceCohort {
  const records = Array.from({ length: count }, (_, i) =>
    makeRecord(`${id}-p${i}`, alpha),
  );
  return makeCohort(id, records);
}

// ── Validation tests ──────────────────────────────────────────────────────────

test('returns error for empty cohorts array', () => {
  const result = detectEdgeDecay([]);
  assert.equal(result.ok, false);
  assert.ok((result as { ok: false; reason: string }).reason.includes('EDGE_DECAY_INSUFFICIENT_COHORTS'));
});

test('returns error for single cohort (below min_cohorts)', () => {
  const result = detectEdgeDecay([uniformCohort('c1', 500)]);
  assert.equal(result.ok, false);
  assert.ok((result as { ok: false; reason: string }).reason.includes('EDGE_DECAY_INSUFFICIENT_COHORTS'));
});

test('returns error for duplicate cohort IDs', () => {
  const result = detectEdgeDecay([
    uniformCohort('dup', 500),
    uniformCohort('dup', 400),
  ]);
  assert.equal(result.ok, false);
  assert.ok((result as { ok: false; reason: string }).reason.includes('EDGE_DECAY_DUPLICATE_COHORT_IDS'));
});

test('returns error for cohort missing cohort_id', () => {
  const bad = { ...uniformCohort('', 500), cohort_id: '' };
  const result = detectEdgeDecay([bad, uniformCohort('c2', 400)]);
  assert.equal(result.ok, false);
});

// ── Insufficient data ─────────────────────────────────────────────────────────

test('returns insufficient_data when a cohort has only insufficient_data records', () => {
  const insuf = makeCohort('insuf', [
    makeRecord('p1', 0, 'insufficient_data'),
    makeRecord('p2', 0, 'insufficient_data'),
  ]);
  const normal = uniformCohort('normal', 500);
  const result = detectEdgeDecay([normal, insuf]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.signal.status, 'insufficient_data');
  assert.equal(result.signal.should_escalate, false);
  assert.equal(result.signal.is_reproducible, false);
});

// ── No-signal cases ───────────────────────────────────────────────────────────

test('no_signal when model alpha is stable across cohorts', () => {
  const result = detectEdgeDecay([
    uniformCohort('c1', 500),
    uniformCohort('c2', 500),
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.signal.status, 'no_signal');
  assert.equal(result.signal.should_escalate, false);
  assert.equal(result.signal.significant_comparisons.length, 0);
});

test('no_signal when delta is below min_delta_bps threshold', () => {
  // 30 bps delta, below default 50 bps threshold
  const result = detectEdgeDecay([
    uniformCohort('c1', 500),
    uniformCohort('c2', 470),
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.signal.status, 'no_signal');
  assert.equal(result.signal.should_escalate, false);
});

// ── Recovering status ─────────────────────────────────────────────────────────

test('recovering when trend is positive and no significant decay pairs', () => {
  const result = detectEdgeDecay([
    uniformCohort('c1', 400),
    uniformCohort('c2', 430),
    uniformCohort('c3', 460),
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.signal.status, 'recovering');
  assert.equal(result.signal.should_escalate, false);
  assert.ok(result.signal.trend_slope_bps_per_cohort !== null);
  assert.ok((result.signal.trend_slope_bps_per_cohort ?? 0) > 0);
});

// ── Degrading / escalation tests ──────────────────────────────────────────────

test('escalates on injected significant decay — single pair', () => {
  // Large consistent decay: 1000 bps drop with tight variance
  const earlyRecords = Array.from({ length: 20 }, (_, i) =>
    makeRecord(`e-p${i}`, 1000 + (i % 3) * 5),
  );
  const lateRecords = Array.from({ length: 20 }, (_, i) =>
    makeRecord(`l-p${i}`, 100 + (i % 3) * 5),
  );
  const result = detectEdgeDecay([
    makeCohort('early', earlyRecords),
    makeCohort('late', lateRecords),
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.signal.status, 'degrading');
  assert.equal(result.signal.should_escalate, true);
  assert.equal(result.signal.significant_comparisons.length, 1);
  const firstComp = result.signal.significant_comparisons[0]!;
  assert.ok(firstComp.delta_model_alpha_bps < -50);
  assert.ok(firstComp.is_significant);
});

test('escalates when consecutive_to_escalate pairs are met across 3 cohorts', () => {
  const high = Array.from({ length: 15 }, (_, i) => makeRecord(`h-p${i}`, 800 + i));
  const mid = Array.from({ length: 15 }, (_, i) => makeRecord(`m-p${i}`, 400 + i));
  const low = Array.from({ length: 15 }, (_, i) => makeRecord(`l-p${i}`, 100 + i));
  const result = detectEdgeDecay([
    makeCohort('c1', high),
    makeCohort('c2', mid),
    makeCohort('c3', low),
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.signal.should_escalate, true);
  assert.equal(result.signal.status, 'degrading');
  assert.ok(result.signal.significant_comparisons.length >= 1);
});

test('no escalation when consecutive_to_escalate is 2 but only 1 significant pair', () => {
  const threshold: EdgeDecayThreshold = {
    ...DEFAULT_EDGE_DECAY_THRESHOLD,
    consecutive_to_escalate: 2,
  };
  const high = Array.from({ length: 15 }, (_, i) => makeRecord(`h-p${i}`, 800 + i));
  const mid = Array.from({ length: 15 }, (_, i) => makeRecord(`m-p${i}`, 400 + i));
  const stable = Array.from({ length: 15 }, (_, i) => makeRecord(`s-p${i}`, 410 + i));
  const result = detectEdgeDecay(
    [makeCohort('c1', high), makeCohort('c2', mid), makeCohort('c3', stable)],
    threshold,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Only 1 consecutive significant pair (c1→c2), not 2.
  assert.equal(result.signal.should_escalate, false);
});

// ── Trend slope ───────────────────────────────────────────────────────────────

test('trend slope is negative for monotonically decaying cohorts', () => {
  const result = detectEdgeDecay([
    uniformCohort('c1', 1000),
    uniformCohort('c2', 700),
    uniformCohort('c3', 400),
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.signal.trend_slope_bps_per_cohort !== null);
  assert.ok((result.signal.trend_slope_bps_per_cohort ?? 0) < 0);
});

test('trend slope is null for a single cohort pair handled by min_cohorts=1 override', () => {
  // With min_cohorts=1, a single cohort is valid but slope still requires ≥2 means.
  const threshold: EdgeDecayThreshold = { ...DEFAULT_EDGE_DECAY_THRESHOLD, min_cohorts: 1 };
  const result = detectEdgeDecay([uniformCohort('only', 500)], threshold);
  // Single cohort: no comparisons, slope is null (2 cohorts needed for slope).
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.signal.trend_slope_bps_per_cohort, null);
});

// ── Structural invariants ─────────────────────────────────────────────────────

test('cohort_ids in signal match input order', () => {
  const result = detectEdgeDecay([
    uniformCohort('week-1', 500),
    uniformCohort('week-2', 480),
    uniformCohort('week-3', 460),
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual([...result.signal.cohort_ids], ['week-1', 'week-2', 'week-3']);
});

test('detector_version matches exported constant', () => {
  const result = detectEdgeDecay([
    uniformCohort('c1', 500),
    uniformCohort('c2', 490),
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.signal.detector_version, DETECTOR_VERSION);
});

test('threshold in signal reflects passed threshold', () => {
  const custom: EdgeDecayThreshold = {
    min_cohorts: 2,
    significance_level: 0.01,
    min_delta_bps: 100,
    consecutive_to_escalate: 2,
  };
  const result = detectEdgeDecay([uniformCohort('c1', 500), uniformCohort('c2', 490)], custom);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.signal.threshold, custom);
});

// ── Replay safety ─────────────────────────────────────────────────────────────

test('identical inputs always produce identical output (replay-safe)', () => {
  const cohorts = [
    uniformCohort('c1', 800),
    uniformCohort('c2', 300),
  ];
  const r1 = detectEdgeDecay(cohorts);
  const r2 = detectEdgeDecay(cohorts);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  if (!r1.ok || !r2.ok) return;
  assert.deepEqual(r1.signal, r2.signal);
});

test('significant_comparisons reference correct cohort IDs', () => {
  const high = Array.from({ length: 15 }, (_, i) => makeRecord(`h${i}`, 1000));
  const low = Array.from({ length: 15 }, (_, i) => makeRecord(`l${i}`, 100));
  const result = detectEdgeDecay([makeCohort('early', high), makeCohort('late', low)]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const comp = result.signal.significant_comparisons[0]!;
  assert.equal(comp.earlier_cohort_id, 'early');
  assert.equal(comp.later_cohort_id, 'late');
});
