import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  CIRCUIT_OPEN_RUN_TYPE,
  CONTRACT_DOC,
  CONTRACT_THRESHOLDS,
  HEARTBEAT_RUN_TYPE,
  REPO_ROOT,
  WINDOWS,
  buildContractReport,
  classifyEdgeQuality,
  computeContractVerdict,
  isAutomatedSettlement,
  isMeasurablePick,
  measurePerformanceEvidence,
  measureRoutingTrust,
  measureRuntimeHealth,
  measureScoreProvenance,
  measureSettlementCoverage,
  readClvPercent,
  rollUpDimension,
  toEvidenceBundleBlock,
  type ContractDimension,
  type ContractInput,
  type ContractMetric,
  type PickLike,
  type PromotionRow,
  type SettlementRow,
  type SystemRunRow,
} from './readiness-contract.js';

const NOW = new Date('2026-09-02T12:00:00.000Z');
const CONTRACT_TEXT = fs.readFileSync(path.join(REPO_ROOT, CONTRACT_DOC), 'utf8');

const metricById = (dimension: ContractDimension, id: string): ContractMetric => {
  const found = dimension.metrics.find((m) => m.id === id);
  assert.ok(found, `expected a metric with id ${id}`);
  return found;
};

const productionPick = (overrides: Partial<PickLike> = {}): PickLike => ({
  id: 'pick-1',
  source: 'smart-form',
  selection: 'Over 24.5',
  status: 'settled',
  created_at: NOW.toISOString(),
  metadata: {},
  ...overrides,
});

const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

// ── The document is the authority; this file must not drift from it ──────────

test('every threshold this module enforces is stated in the contract document', () => {
  // Each entry is the set of spellings that would satisfy the check. The document
  // writes 99.0%, which JS renders as "99", so a value gets both forms and either
  // one counts — a formatting difference is not a drifted threshold.
  const percent = (n: number) => [`${n}%`, `${n.toFixed(1)}%`];
  const thresholds: [string, string[]][] = [
    ['worker uptime', percent(CONTRACT_THRESHOLDS.workerUptimePct)],
    ['outbox delivery success', percent(CONTRACT_THRESHOLDS.outboxDeliverySuccessPct)],
    ['outbox stuck window', [`${CONTRACT_THRESHOLDS.outboxStuckMaxMinutes} minutes`]],
    ['market-backed share', percent(CONTRACT_THRESHOLDS.marketBackedSharePct)],
    ['unknown share', percent(CONTRACT_THRESHOLDS.unknownShareMaxPct)],
    ['edge attribution', percent(CONTRACT_THRESHOLDS.anyEdgeAttributionPct)],
    ['automated settlement', percent(CONTRACT_THRESHOLDS.automatedSettlementPct)],
    ['CLV resolved', percent(CONTRACT_THRESHOLDS.clvResolvedPct)],
    ['settlement correction', percent(CONTRACT_THRESHOLDS.settlementCorrectionMaxPct)],
    ['top-tier market-backed', percent(CONTRACT_THRESHOLDS.topTierMarketBackedPct)],
    ['settled sample', [`${CONTRACT_THRESHOLDS.settledSampleMin} picks`]],
    ['CLV+ rate', percent(CONTRACT_THRESHOLDS.clvPlusRatePct)],
  ];

  for (const [name, spellings] of thresholds) {
    assert.ok(
      spellings.some((value) => CONTRACT_TEXT.includes(value)),
      `the ${name} threshold (${spellings.join(' or ')}) is enforced here but does not appear in ` +
        `${CONTRACT_DOC}. The document is the authority: change it there, or this module is ` +
        'measuring something it invented.',
    );
  }
});

test('the CLV proof mechanism this module uses is the one the contract names', () => {
  assert.ok(CONTRACT_TEXT.includes("snapshot_kind = 'closing_for_clv'"));
  assert.ok(CONTRACT_TEXT.includes('provider_offers'));
});

// ── Fixture exclusion ────────────────────────────────────────────────────────

test('fixture rows are excluded from every measured population', () => {
  assert.equal(isMeasurablePick(productionPick()), true);
  assert.equal(isMeasurablePick(productionPick({ source: 'proof' })), false);
  assert.equal(isMeasurablePick(productionPick({ source: 'T1-Proof' })), false);
  assert.equal(isMeasurablePick(productionPick({ metadata: { testRun: true } })), false);
  assert.equal(isMeasurablePick(productionPick({ metadata: { proof_issue: 'UTV2-1' } })), false);
  assert.equal(
    isMeasurablePick(productionPick({ metadata: { proof_fixture_id: 'abc' } })),
    false,
  );
  assert.equal(isMeasurablePick(productionPick({ selection: 'PROOF Over 1.5' })), false);
  assert.equal(isMeasurablePick(null), false);
});

test('excluding fixtures changes the provenance answer, so the exclusion is load-bearing', () => {
  // One real unknown-provenance pick, buried under nine market-backed fixtures.
  // Without the exclusion this window reads as 90% market-backed — a PASS built
  // entirely out of the test suite.
  const marketBacked = { edgeProvenance: { method: 'market-devigged' } };
  const picks: PickLike[] = [
    productionPick({ id: 'real', metadata: {} }),
    ...Array.from({ length: 9 }, (_, i) =>
      productionPick({ id: `fx-${i}`, source: 'proof', metadata: marketBacked }),
    ),
  ];

  const dimension = measureScoreProvenance(picks);
  const share = metricById(dimension, 'market_backed_share');
  assert.equal(share.measured, 0);
  assert.equal(share.status, 'fail');

  const unfiltered = measureScoreProvenance(
    picks.map((p) => ({ ...p, source: 'smart-form', metadata: p.metadata })),
  );
  assert.equal(metricById(unfiltered, 'market_backed_share').measured, 90);
});

// ── Edge provenance classification ───────────────────────────────────────────

test('a pick with no attribution at all is unknown, not confidence-fallback', () => {
  // This is the distinction the contract's separate unknown ceiling exists for.
  // Folding missing attribution into a named category would make the unknown
  // share look measured when nothing was measured.
  assert.equal(classifyEdgeQuality({}), 'unknown');
  assert.equal(classifyEdgeQuality(null), 'unknown');
  assert.equal(classifyEdgeQuality({ edgeProvenance: { method: 'something-new' } }), 'unknown');
});

test('both the current and the legacy provenance shapes are read', () => {
  assert.equal(
    classifyEdgeQuality({ edgeProvenance: { method: 'market-devigged' } }),
    'market-backed',
  );
  assert.equal(
    classifyEdgeQuality({ edgeProvenance: { method: 'confidence-delta' } }),
    'confidence-fallback',
  );
  assert.equal(classifyEdgeQuality({ realEdgeSource: 'pinnacle' }), 'market-backed');
  assert.equal(
    classifyEdgeQuality({ domainAnalysis: { realEdgeSource: 'consensus' } }),
    'market-backed',
  );
  assert.equal(classifyEdgeQuality({ realEdgeSource: 'confidence-delta' }), 'confidence-fallback');
});

// ── Fail-closed roll-up ──────────────────────────────────────────────────────

test('a measured failure outranks an unknown within a dimension', () => {
  const mk = (status: ContractMetric['status']): ContractMetric => ({
    id: status,
    title: status,
    threshold: '',
    status,
    measured: null,
    unit: null,
    evidence: '',
    unmeasurable_reason: status === 'unknown' ? 'because' : null,
  });
  assert.equal(rollUpDimension([mk('pass'), mk('unknown'), mk('fail')]), 'fail');
  assert.equal(rollUpDimension([mk('pass'), mk('unknown')]), 'unknown');
  assert.equal(rollUpDimension([mk('pass'), mk('pass')]), 'pass');
});

test('an unknown blocking dimension can never produce PASS', () => {
  const dim = (status: ContractDimension['status']): ContractDimension => ({
    id: status,
    title: status,
    blocking: true,
    status,
    metrics: [],
  });
  assert.equal(computeContractVerdict([dim('pass'), dim('pass')]), 'PASS');
  assert.equal(computeContractVerdict([dim('pass'), dim('unknown')]), 'UNKNOWN');
  assert.equal(computeContractVerdict([dim('unknown'), dim('fail')]), 'FAIL');
});

// ── Dimension 1 ──────────────────────────────────────────────────────────────

const runtimeInput = (overrides: {
  systemRuns?: SystemRunRow[];
  outbox?: Parameters<typeof measureRuntimeHealth>[0]['outbox'];
  receipts?: Parameters<typeof measureRuntimeHealth>[0]['receipts'];
} = {}) => ({
  now: NOW,
  systemRuns: overrides.systemRuns ?? [],
  outbox: overrides.outbox ?? [],
  receipts: overrides.receipts ?? [],
});

test('a parked worker reports 0% uptime rather than passing on silence', () => {
  const dimension = measureRuntimeHealth(runtimeInput());
  const uptime = metricById(dimension, 'worker_uptime');
  assert.equal(uptime.measured, 0);
  assert.equal(uptime.status, 'fail');
});

test('full heartbeat coverage passes the uptime metric', () => {
  const expected = Math.floor(
    (WINDOWS.runtimeDays * 24 * 60) / CONTRACT_THRESHOLDS.workerHeartbeatMaxMinutes,
  );
  const systemRuns: SystemRunRow[] = Array.from({ length: expected }, (_, i) => ({
    run_type: HEARTBEAT_RUN_TYPE,
    started_at: minutesAgo(i * CONTRACT_THRESHOLDS.workerHeartbeatMaxMinutes),
    status: 'succeeded',
  }));
  const dimension = measureRuntimeHealth(runtimeInput({ systemRuns }));
  assert.equal(metricById(dimension, 'worker_uptime').measured, 100);
  assert.equal(metricById(dimension, 'worker_uptime').status, 'pass');
});

test('runs of other types are not counted as worker heartbeats', () => {
  const systemRuns: SystemRunRow[] = Array.from({ length: 500 }, () => ({
    run_type: 'ingestor.cycle',
    started_at: minutesAgo(5),
    status: 'succeeded',
  }));
  assert.equal(metricById(measureRuntimeHealth(runtimeInput({ systemRuns })), 'worker_uptime').measured, 0);
});

test('a held dead-letter row is not reported as a circuit breaker trip', () => {
  // Production carries ~1,953 governance_hold dead letters. Counting dead letters
  // as trips would fail this metric forever on a policy decision, which is the
  // exact conflation the metric must not make.
  const dimension = measureRuntimeHealth(
    runtimeInput({
      outbox: Array.from({ length: 1953 }, () => ({
        status: 'dead_letter',
        created_at: daysAgo(3),
        attempt_count: 0,
      })),
    }),
  );
  const trips = metricById(dimension, 'unresolved_circuit_breaker_trips');
  assert.equal(trips.measured, 0);
  assert.equal(trips.status, 'pass');
});

test('an open circuit breaker run fails the trip metric; a closed one does not', () => {
  const open = measureRuntimeHealth(
    runtimeInput({
      systemRuns: [{ run_type: CIRCUIT_OPEN_RUN_TYPE, started_at: minutesAgo(20), status: 'running' }],
    }),
  );
  assert.equal(metricById(open, 'unresolved_circuit_breaker_trips').status, 'fail');

  const closed = measureRuntimeHealth(
    runtimeInput({
      systemRuns: [
        {
          run_type: CIRCUIT_OPEN_RUN_TYPE,
          started_at: minutesAgo(20),
          finished_at: minutesAgo(5),
          status: 'succeeded',
        },
      ],
    }),
  );
  assert.equal(metricById(closed, 'unresolved_circuit_breaker_trips').status, 'pass');
});

test('outbox rows stuck past the threshold fail; fresh ones do not', () => {
  const dimension = measureRuntimeHealth(
    runtimeInput({
      outbox: [
        { status: 'pending', created_at: minutesAgo(45), attempt_count: 0 },
        { status: 'processing', created_at: minutesAgo(2), attempt_count: 1 },
        { status: 'delivered', created_at: minutesAgo(600), attempt_count: 1 },
      ],
    }),
  );
  const stuck = metricById(dimension, 'outbox_stuck_rows');
  assert.equal(stuck.measured, 1);
  assert.equal(stuck.status, 'fail');
});

test('a delivery success rate over zero attempts is unknown, not 100%', () => {
  const dimension = measureRuntimeHealth(runtimeInput());
  const rate = metricById(dimension, 'outbox_delivery_success_rate');
  assert.equal(rate.status, 'unknown');
  assert.equal(rate.measured, null);
  assert.ok(rate.unmeasurable_reason);
});

test('the latency metrics report unknown with a named reason, never pass', () => {
  const dimension = measureRuntimeHealth(runtimeInput());
  for (const id of ['api_p99_submission', 'api_p99_operator_detail', 'pipeline_e2e_latency']) {
    const m = metricById(dimension, id);
    assert.equal(m.status, 'unknown');
    assert.ok(m.unmeasurable_reason && m.unmeasurable_reason.length > 20);
  }
  assert.equal(dimension.status, 'fail'); // uptime fails outright on an empty input
});

// ── Dimension 2 ──────────────────────────────────────────────────────────────

test('a share over an empty production population is unknown, not zero', () => {
  const dimension = measureScoreProvenance([productionPick({ source: 'proof' })]);
  assert.equal(dimension.status, 'unknown');
  for (const m of dimension.metrics) {
    assert.equal(m.status, 'unknown');
    assert.equal(m.measured, null);
  }
});

test('provenance shares are computed over production picks only', () => {
  const picks: PickLike[] = [
    ...Array.from({ length: 3 }, (_, i) =>
      productionPick({ id: `mb-${i}`, metadata: { edgeProvenance: { method: 'market-devigged' } } }),
    ),
    ...Array.from({ length: 2 }, (_, i) =>
      productionPick({ id: `cf-${i}`, metadata: { edgeProvenance: { method: 'confidence-delta' } } }),
    ),
    ...Array.from({ length: 5 }, (_, i) => productionPick({ id: `uk-${i}`, metadata: {} })),
  ];
  const dimension = measureScoreProvenance(picks);
  assert.equal(metricById(dimension, 'market_backed_share').measured, 30);
  assert.equal(metricById(dimension, 'unknown_share').measured, 50);
  assert.equal(metricById(dimension, 'edge_attribution_share').measured, 50);
  assert.equal(metricById(dimension, 'market_backed_share').status, 'pass');
  assert.equal(metricById(dimension, 'unknown_share').status, 'pass');
  assert.equal(metricById(dimension, 'edge_attribution_share').status, 'pass');
});

// ── Dimension 3 ──────────────────────────────────────────────────────────────

const settlement = (overrides: Partial<SettlementRow> = {}): SettlementRow => ({
  id: 's1',
  pick_id: 'pick-1',
  result: 'win',
  settled_at: daysAgo(1),
  source: 'grading',
  settled_by: 'system',
  corrects_id: null,
  payload: { clvPercent: 1.5 },
  picks: productionPick(),
  ...overrides,
});

test("the automated settlement source is the literal value settlement-service writes", () => {
  assert.equal(isAutomatedSettlement(settlement({ source: 'grading' })), true);
  assert.equal(isAutomatedSettlement(settlement({ source: 'operator' })), false);
});

test('CLV coverage counts only closing_for_clv snapshots joined to settled picks', () => {
  const settlements = [
    settlement({ id: 's1', pick_id: 'a' }),
    settlement({ id: 's2', pick_id: 'b' }),
  ];
  const dimension = measureSettlementCoverage({
    settlements,
    clvSnapshots: [
      { pick_id: 'a', snapshot_kind: 'closing_for_clv' },
      // Wrong kind on the other pick: it must not count.
      { pick_id: 'b', snapshot_kind: 'opening' },
    ],
  });
  const clv = metricById(dimension, 'clv_resolved_share');
  assert.equal(clv.measured, 50);
  assert.equal(clv.status, 'fail');
});

test('the correction rate is taken over automated settlements, per the contract wording', () => {
  // 1 automated settlement, corrected; 98 manual settlements, uncorrected.
  // Over all settlements that reads as ~1% and passes. Over the contract's stated
  // denominator it is 100% and fails.
  const settlements: SettlementRow[] = [
    settlement({ id: 'auto-1', source: 'grading' }),
    ...Array.from({ length: 98 }, (_, i) =>
      settlement({ id: `man-${i}`, source: 'operator', settled_by: 'operator' }),
    ),
    settlement({ id: 'fix-1', source: 'operator', settled_by: 'operator', corrects_id: 'auto-1' }),
  ];
  const dimension = measureSettlementCoverage({ settlements, clvSnapshots: [] });
  const rate = metricById(dimension, 'settlement_correction_rate');
  assert.equal(rate.measured, 100);
  assert.equal(rate.status, 'fail');
});

test('the manual grading backlog is unknown because game end is not joinable here', () => {
  const dimension = measureSettlementCoverage({ settlements: [settlement()], clvSnapshots: [] });
  const backlog = metricById(dimension, 'manual_grading_backlog');
  assert.equal(backlog.status, 'unknown');
  assert.match(backlog.unmeasurable_reason ?? '', /game end/i);
});

// ── Dimension 4 ──────────────────────────────────────────────────────────────

const promotion = (overrides: Partial<PromotionRow> = {}): PromotionRow => ({
  pick_id: 'pick-1',
  target: 'trader-insights',
  status: 'promoted',
  reason: null,
  picks: productionPick({ metadata: { edgeProvenance: { method: 'market-devigged' } } }),
  ...overrides,
});

test('a single silent suppression fails, even in a large population', () => {
  const promotions: PromotionRow[] = [
    ...Array.from({ length: 999 }, () =>
      promotion({ status: 'suppressed', reason: 'stale_line' }),
    ),
    promotion({ status: 'suppressed', reason: '   ' }),
  ];
  const dimension = measureRoutingTrust(promotions);
  const explicit = metricById(dimension, 'suppression_always_explicit');
  assert.equal(explicit.measured, 1);
  assert.equal(explicit.status, 'fail');
  assert.equal(dimension.status, 'fail');
});

test('top-tier market-backed share is measured over top-tier targets only', () => {
  const dimension = measureRoutingTrust([
    promotion({ target: 'trader-insights' }),
    promotion({
      target: 'best-bets',
      picks: productionPick({ metadata: {} }),
    }),
  ]);
  assert.equal(metricById(dimension, 'top_tier_market_backed_share').measured, 100);
});

test('no top-tier promotions makes the share unknown, not 100%', () => {
  const dimension = measureRoutingTrust([promotion({ target: 'best-bets' })]);
  assert.equal(metricById(dimension, 'top_tier_market_backed_share').status, 'unknown');
});

// ── Dimension 5 ──────────────────────────────────────────────────────────────

test('operator surfaces are unknown until a rendered-surface audit exists', () => {
  const report = buildContractReport(emptyInput());
  const dimension = report.dimensions.find((d) => d.id === 'operator_decision_support');
  assert.ok(dimension);
  assert.equal(dimension.status, 'unknown');
  assert.ok(dimension.metrics.every((m) => m.status !== 'pass'));
});

// ── Dimension 6 ──────────────────────────────────────────────────────────────

test('CLV+ is read from payload.clvPercent, the field the writers actually produce', () => {
  assert.equal(readClvPercent({ clvPercent: 2.5 }), 2.5);
  assert.equal(readClvPercent({ clv: 2.5 }), null);
  assert.equal(readClvPercent(null), null);
});

test('CLV+ rate counts only settlements that carry a CLV value', () => {
  const dimension = measurePerformanceEvidence({
    settlements: [
      settlement({ id: 'a', payload: { clvPercent: 1 } }),
      settlement({ id: 'b', payload: { clvPercent: -1 } }),
      settlement({ id: 'c', payload: { clvPercent: null, clvStatus: 'missing_pick_odds' } }),
    ],
    promotions: [],
  });
  const rate = metricById(dimension, 'clv_plus_rate');
  // 1 of 2 valued settlements is positive. The null-CLV row is excluded from the
  // denominator rather than counted as a miss, which would understate the rate.
  assert.equal(rate.measured, 50);
  assert.equal(rate.status, 'pass');
  assert.match(rate.evidence, /1\/2/);
});

test('a negative-edge top-tier pick with no stated provenance is not counted', () => {
  // The contract says `edge < 0` AND `edgeSource != 'unknown'`. A negative number
  // with no stated source is not provably anything.
  const unattributed = measurePerformanceEvidence({
    settlements: [],
    promotions: [
      promotion({ picks: productionPick({ metadata: { promotionScores: { edge: -0.4 } } }) }),
    ],
  });
  assert.equal(metricById(unattributed, 'no_provably_negative_routing').measured, 0);

  const attributed = measurePerformanceEvidence({
    settlements: [],
    promotions: [
      promotion({
        picks: productionPick({
          metadata: {
            edgeProvenance: { method: 'market-devigged' },
            promotionScores: { edge: -0.4 },
          },
        }),
      }),
    ],
  });
  assert.equal(metricById(attributed, 'no_provably_negative_routing').measured, 1);
  assert.equal(metricById(attributed, 'no_provably_negative_routing').status, 'fail');
});

test('manual settlements do not count toward the automated-grading sample size', () => {
  const dimension = measurePerformanceEvidence({
    settlements: Array.from({ length: 150 }, (_, i) =>
      settlement({ id: `m-${i}`, source: 'operator', settled_by: 'operator' }),
    ),
    promotions: [],
  });
  const sample = metricById(dimension, 'settled_sample_size');
  assert.equal(sample.measured, 0);
  assert.equal(sample.status, 'fail');
});

// ── Whole report ─────────────────────────────────────────────────────────────

function emptyInput(): ContractInput {
  return {
    now: NOW,
    runtime: { now: NOW, systemRuns: [], outbox: [], receipts: [] },
    provenancePicks: [],
    settlements: [],
    clvSnapshots: [],
    promotions: [],
  };
}

test('an empty production window never reports PASS', () => {
  const report = buildContractReport(emptyInput());
  assert.notEqual(report.verdict, 'PASS');
  assert.equal(report.dimensions.length, 6);
  assert.ok(report.dimensions.every((d) => d.blocking));
  assert.ok(report.unmeasurable.length > 0);
  for (const item of report.unmeasurable) {
    assert.ok(item.reason.length > 20, `${item.id} needs a real reason, not a label`);
  }
});

test('every unmeasurable metric names why, and none of them is scored pass', () => {
  const report = buildContractReport(emptyInput());
  for (const m of report.dimensions.flatMap((d) => d.metrics)) {
    if (m.unmeasurable_reason !== null) {
      assert.equal(m.status, 'unknown');
      assert.equal(m.measured, null);
    } else {
      assert.notEqual(m.status, 'unknown');
    }
  }
});

test('the evidence bundle block reports threshold_pass false for an unknown dimension', () => {
  const block = toEvidenceBundleBlock(buildContractReport(emptyInput()), 'abc123');
  assert.equal(block['readiness_tier'], 'production');
  assert.equal(block['pipeline_version'], 'abc123');
  assert.equal(block['overall_pass'], false);
  const dimensions = block['dimensions'] as Record<string, Record<string, unknown>>;
  for (const [name, value] of Object.entries(dimensions)) {
    assert.equal(value['threshold_pass'], false, `${name} must not claim a pass it did not measure`);
  }
  assert.equal(dimensions['settlement_clv']?.['clv_proof_table'], 'pick_offer_snapshots');
  assert.equal(dimensions['settlement_clv']?.['clv_snapshot_kind'], 'closing_for_clv');
  assert.ok(Array.isArray(block['unmeasured_metrics']));
});

test('the evidence bundle block carries every field the contract schema names', () => {
  const block = toEvidenceBundleBlock(buildContractReport(emptyInput()), 'abc123');
  const dimensions = block['dimensions'] as Record<string, Record<string, unknown>>;
  const required: Record<string, string[]> = {
    runtime_health: [
      'worker_uptime_7d_pct',
      'outbox_success_rate_7d_pct',
      'stuck_pick_count',
      'circuit_breaker_trips_open',
    ],
    score_provenance: ['window_days', 'total_picks', 'market_backed_pct', 'unknown_pct'],
    settlement_clv: [
      'auto_graded_pct',
      'clv_coverage_pct',
      'clv_proof_table',
      'clv_snapshot_kind',
      'manual_backlog_pct',
    ],
    routing_trust: ['top_tier_market_backed_pct', 'suppression_explicit_pct'],
    operator_surfaces: ['surfaces_audited', 'placeholder_violations'],
    performance_evidence: ['settled_pick_count', 'calibration_gap', 'clv_positive_rate'],
  };
  for (const [dimensionName, fields] of Object.entries(required)) {
    const actual = dimensions[dimensionName];
    assert.ok(actual, `missing dimension ${dimensionName}`);
    for (const field of fields) {
      assert.ok(field in actual, `${dimensionName}.${field} is required by ${CONTRACT_DOC} §5.2`);
    }
  }
});

// ── The instrument must stay read-only ───────────────────────────────────────

test('this module cannot write to the database', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'scripts/ops/readiness-contract.ts'), 'utf8');
  for (const forbidden of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
    assert.ok(
      !source.includes(forbidden),
      `readiness-contract.ts must never call ${forbidden} — it measures production, it does not change it.`,
    );
  }
});
