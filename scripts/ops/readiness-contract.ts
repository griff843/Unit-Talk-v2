#!/usr/bin/env tsx
/**
 * Measurement for `docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md`.
 *
 * ## Why this exists
 *
 * The contract is the authoritative definition of production readiness and the
 * stated exit criterion for the whole recovery mission. Its six dimensions each
 * carry a "Current status" line — and every one of those lines is prose, written
 * by hand, last touched 2026-04-30. Dimension 1 still reads "Worker is DOWN as of
 * 2026-04-30". The worker has since been deployed and deliberately parked; the
 * sentence is simultaneously stale and, read literally, wrong.
 *
 * A gate whose verdict is a paragraph cannot be passed, only argued. This module
 * measures the contract's metrics instead, so "does production readiness pass"
 * has a mechanical answer that nobody has to be trusted for.
 *
 * `readiness-refresh.ts` is a different instrument and stays as it is: it measures
 * operational hygiene (deploy alignment, observer health, proof coverage). The six
 * contract dimensions — provenance quality, settlement/CLV coverage, routing
 * trust, performance evidence — are product truth, and nothing measured them.
 *
 * ## The three rules this holds
 *
 * 1. **Unknown is never pass.** A metric that cannot be measured is recorded as
 *    `unknown` with the reason, and a blocking dimension carrying an unknown can
 *    never make the contract PASS. Several metrics land there today; that is the
 *    honest reading, and naming them is more useful than a status line that
 *    implies someone checked.
 * 2. **Fixtures are excluded, always.** The production `picks` table is heavily
 *    contaminated with CI and proof fixtures. A provenance share computed over
 *    unfiltered rows is not a measurement of the product, it is a measurement of
 *    the test suite. Every population here goes through {@link isMeasurablePick}.
 * 3. **Read-only.** The only database surface is {@link ContractReader}, whose
 *    methods issue selects. `readiness-contract.test.ts` scans this source to keep
 *    it that way.
 *
 * Usage:
 *   pnpm ops:readiness-contract              # measure and write the artifact
 *   pnpm ops:readiness-contract -- --json    # also print it
 *   pnpm ops:readiness-contract -- --out X   # write elsewhere
 *   pnpm ops:readiness-contract -- --evidence-block docs/.../block.json
 *
 * Exit codes: 0 measured and written; 1 could not be written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createPrivilegedClient } from '@unit-talk/db/privileged-client-boundary';
import {
  CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
  extractProjectRefFromUrl,
} from '@unit-talk/db/target-identity';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

export const CONTRACT_DOC = 'docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md';
export const CANONICAL_ARTIFACT_PATH =
  'docs/06_status/readiness/production-readiness-contract.json';
export const SCHEMA_VERSION = 1;
export const GENERATOR_VERSION = '1.0.0';

/**
 * Every threshold, transcribed from the contract's own tables.
 *
 * They live here as data so a drift between this file and the document is a
 * one-line diff rather than a reading exercise. `readiness-contract.test.ts`
 * asserts each number still appears in the document.
 */
export const CONTRACT_THRESHOLDS = {
  // Dimension 1 — Runtime Health
  workerUptimePct: 99.0,
  workerHeartbeatMaxMinutes: 30,
  outboxDeliverySuccessPct: 99.0,
  outboxStuckMaxMinutes: 10,
  outboxStuckMaxCount: 0,
  unresolvedTripMaxCount: 0,
  // Dimension 2 — Score Provenance Quality
  marketBackedSharePct: 20,
  unknownShareMaxPct: 60,
  anyEdgeAttributionPct: 40,
  // Dimension 3 — Settlement / CLV Coverage
  automatedSettlementPct: 85,
  clvResolvedPct: 60,
  settlementCorrectionMaxPct: 2,
  // Dimension 4 — Routing Trust
  topTierMarketBackedPct: 30,
  suppressionExplicitPct: 100,
  // Dimension 6 — Performance Evidence
  settledSampleMin: 100,
  clvPlusRatePct: 48,
  negativeEdgeTopTierMaxCount: 0,
} as const;

export const WINDOWS = {
  runtimeDays: 7,
  provenanceDays: 30,
  settlementDays: 30,
  performanceDays: 30,
} as const;

// ── Result shapes ────────────────────────────────────────────────────────────

export type MetricStatus = 'pass' | 'fail' | 'unknown';

export interface ContractMetric {
  id: string;
  title: string;
  /** Human-readable threshold, exactly as the contract states it. */
  threshold: string;
  status: MetricStatus;
  /** The number that was read, or null when nothing could be read. */
  measured: number | null;
  unit: 'percent' | 'count' | 'minutes' | null;
  evidence: string;
  /** Non-null only when `status` is `unknown`. */
  unmeasurable_reason: string | null;
}

export interface ContractDimension {
  id: string;
  title: string;
  blocking: boolean;
  status: MetricStatus;
  metrics: ContractMetric[];
}

export type ContractVerdict = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface ContractReport {
  schema_version: number;
  generator_version: string;
  contract_doc: string;
  observed_at: string;
  verdict: ContractVerdict;
  dimensions: ContractDimension[];
  /** Metrics nothing in this repository can currently measure, and why. */
  unmeasurable: { id: string; reason: string }[];
}

// ── Fixture exclusion ────────────────────────────────────────────────────────

/**
 * Sources that are never a real capper submission.
 *
 * Kept identical to `scripts/product-truth-scoreboard.ts` and
 * `scripts/audits/utv2-1382-scoring-validation.ts`. Three measurement surfaces
 * disagreeing about what counts as production would be worse than none of them
 * existing.
 */
export const NON_PRODUCTION_SOURCES = new Set([
  'api',
  'test',
  'proof',
  't1-proof',
  'synthetic',
  'canary-proof',
]);

export type JsonRecord = Record<string, unknown>;

export interface PickLike {
  id?: string | null;
  source?: string | null;
  selection?: string | null;
  status?: string | null;
  created_at?: string | null;
  metadata?: unknown;
}

export function jsonRecord(value: unknown): JsonRecord {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * True when a row is a real production pick rather than a CI or proof fixture.
 *
 * This is the single most load-bearing predicate in the file. The production
 * `picks` table has carried a large majority of fixture rows since April 2026,
 * so a share computed without it reports the shape of the test suite and calls
 * it product truth — which is exactly the kind of number that reads as evidence
 * and is not.
 */
export function isMeasurablePick(pick: PickLike | null | undefined): boolean {
  if (!pick) return false;
  if (NON_PRODUCTION_SOURCES.has((pick.source ?? '').trim().toLowerCase())) return false;

  const metadata = jsonRecord(pick.metadata);
  if (metadata['testRun']) return false;
  if (metadata['proof_issue'] != null) return false;
  if (metadata['proof_fixture_id'] != null) return false;
  if (typeof pick.selection === 'string' && /proof/i.test(pick.selection)) return false;

  return true;
}

// ── Edge provenance classification ───────────────────────────────────────────

export type EdgeQuality = 'market-backed' | 'confidence-fallback' | 'unknown';

/**
 * Classifies where a pick's edge came from.
 *
 * Reads `edgeProvenance` first (written since UTV2-985) and falls back to the
 * legacy `realEdgeSource` shape, because the 30-day window still contains rows
 * written before that field existed. A row that carries neither is `unknown` —
 * not `confidence-fallback`. The distinction matters: the contract has a
 * separate ceiling for the unknown share precisely so that missing attribution
 * cannot be quietly folded into a category that looks measured.
 */
export function classifyEdgeQuality(metadata: unknown): EdgeQuality {
  const meta = jsonRecord(metadata);

  const provenance = jsonRecord(meta['edgeProvenance']);
  const method = provenance['method'];
  if (method === 'market-devigged') return 'market-backed';
  if (method === 'confidence-delta') return 'confidence-fallback';
  if (typeof method === 'string' && method.length > 0) return 'unknown';

  const domainAnalysis = jsonRecord(meta['domainAnalysis']);
  const legacySource =
    (typeof meta['realEdgeSource'] === 'string' ? (meta['realEdgeSource'] as string) : null) ??
    (typeof domainAnalysis['realEdgeSource'] === 'string'
      ? (domainAnalysis['realEdgeSource'] as string)
      : null);

  if (legacySource === 'confidence-delta') return 'confidence-fallback';
  if (
    legacySource === 'pinnacle' ||
    legacySource === 'consensus' ||
    legacySource === 'sgo' ||
    legacySource === 'single-book'
  ) {
    return 'market-backed';
  }

  // No attribution field at all, on either shape.
  return 'unknown';
}

/** A pick has edge attribution when its provenance is stated, either way. */
export function hasEdgeAttribution(metadata: unknown): boolean {
  return classifyEdgeQuality(metadata) !== 'unknown';
}

// ── Metric construction ──────────────────────────────────────────────────────

export function pct(count: number, total: number): number {
  if (total === 0) return 0;
  return Number(((count / total) * 100).toFixed(2));
}

export function metric(input: {
  id: string;
  title: string;
  threshold: string;
  measured: number;
  unit: ContractMetric['unit'];
  passes: boolean;
  evidence: string;
}): ContractMetric {
  return {
    id: input.id,
    title: input.title,
    threshold: input.threshold,
    status: input.passes ? 'pass' : 'fail',
    measured: input.measured,
    unit: input.unit,
    evidence: input.evidence,
    unmeasurable_reason: null,
  };
}

export function unmeasurable(input: {
  id: string;
  title: string;
  threshold: string;
  reason: string;
}): ContractMetric {
  return {
    id: input.id,
    title: input.title,
    threshold: input.threshold,
    status: 'unknown',
    measured: null,
    unit: null,
    evidence: `NOT MEASURED: ${input.reason}. Never scored as passing.`,
    unmeasurable_reason: input.reason,
  };
}

/**
 * A dimension is only as good as its weakest metric, and `fail` outranks
 * `unknown`: a measured failure is a fact about production, whereas an unknown
 * is a fact about our instrumentation. Reporting UNKNOWN over a known FAIL would
 * hide the more actionable of the two.
 */
export function rollUpDimension(metrics: ContractMetric[]): MetricStatus {
  if (metrics.some((m) => m.status === 'fail')) return 'fail';
  if (metrics.some((m) => m.status === 'unknown')) return 'unknown';
  return 'pass';
}

/**
 * The contract's own rule, quoted: "All six dimensions are fail-closed. One
 * failing dimension blocks the gate regardless of the others."
 *
 * PASS therefore requires every blocking dimension to be measured AND passing.
 * There is no path from an unknown to a PASS, which is the entire point.
 */
export function computeContractVerdict(dimensions: ContractDimension[]): ContractVerdict {
  const blocking = dimensions.filter((d) => d.blocking);
  if (blocking.some((d) => d.status === 'fail')) return 'FAIL';
  if (blocking.some((d) => d.status === 'unknown')) return 'UNKNOWN';
  return 'PASS';
}

// ── Dimension 1: Runtime Health ──────────────────────────────────────────────

export interface OutboxRow {
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  attempt_count?: number | null;
}

export interface ReceiptRow {
  status?: string | null;
  receipt_type?: string | null;
  recorded_at?: string | null;
}

export interface SystemRunRow {
  run_type?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  status?: string | null;
}

export interface RuntimeInput {
  now: Date;
  /** Every `system_runs` row in the window; this module filters by run_type. */
  systemRuns: SystemRunRow[];
  outbox: OutboxRow[];
  receipts: ReceiptRow[];
}

export const HEARTBEAT_RUN_TYPE = 'worker.heartbeat';
export const CIRCUIT_OPEN_RUN_TYPE = 'worker.circuit-open';

const STUCK_STATUSES = new Set(['pending', 'processing', 'claimed']);

export function measureRuntimeHealth(input: RuntimeInput): ContractDimension {
  const { now, systemRuns, outbox, receipts } = input;
  const metrics: ContractMetric[] = [];
  const heartbeats = systemRuns.filter((row) => row.run_type === HEARTBEAT_RUN_TYPE);

  // Worker uptime, stated as a proxy rather than dressed up as a real one.
  //
  // There is no uptime series in this schema. What exists is a heartbeat row per
  // interval, so coverage of expected intervals over the window is the closest
  // honest reading — and it is reported under its own name so nobody mistakes it
  // for process uptime. A parked worker emits no heartbeat, so this correctly
  // reports 0% rather than pretending containment is health.
  const windowStart = new Date(now.getTime() - WINDOWS.runtimeDays * 86_400_000);
  const inWindow = heartbeats.filter((row) => {
    const at = row.started_at ? Date.parse(row.started_at) : NaN;
    return Number.isFinite(at) && at >= windowStart.getTime() && at <= now.getTime();
  });
  const expectedBeats = Math.floor(
    (WINDOWS.runtimeDays * 24 * 60) / CONTRACT_THRESHOLDS.workerHeartbeatMaxMinutes,
  );
  const beatCoverage = pct(Math.min(inWindow.length, expectedBeats), expectedBeats);
  metrics.push(
    metric({
      id: 'worker_uptime',
      title: 'Worker uptime (heartbeat interval coverage)',
      threshold: `>= ${CONTRACT_THRESHOLDS.workerUptimePct}% over ${WINDOWS.runtimeDays} days`,
      measured: beatCoverage,
      unit: 'percent',
      passes: beatCoverage >= CONTRACT_THRESHOLDS.workerUptimePct,
      evidence:
        `${inWindow.length} worker.heartbeat rows in the ${WINDOWS.runtimeDays}-day window ` +
        `against ${expectedBeats} expected at one per ${CONTRACT_THRESHOLDS.workerHeartbeatMaxMinutes}m. ` +
        'Heartbeat coverage is a proxy for uptime: this schema carries no uptime series. ' +
        'A deliberately parked worker emits no heartbeat and is reported here as 0%.',
    }),
  );

  // Stuck outbox rows — a snapshot, per the contract.
  const stuckCutoff = now.getTime() - CONTRACT_THRESHOLDS.outboxStuckMaxMinutes * 60_000;
  const stuck = outbox.filter((row) => {
    if (!STUCK_STATUSES.has((row.status ?? '').trim().toLowerCase())) return false;
    const at = row.created_at ? Date.parse(row.created_at) : NaN;
    return Number.isFinite(at) && at < stuckCutoff;
  });
  metrics.push(
    metric({
      id: 'outbox_stuck_rows',
      title: `Outbox rows stuck longer than ${CONTRACT_THRESHOLDS.outboxStuckMaxMinutes} minutes`,
      threshold: `== ${CONTRACT_THRESHOLDS.outboxStuckMaxCount}`,
      measured: stuck.length,
      unit: 'count',
      passes: stuck.length <= CONTRACT_THRESHOLDS.outboxStuckMaxCount,
      evidence:
        `${stuck.length} of ${outbox.length} outbox rows are in ${[...STUCK_STATUSES].join('/')} ` +
        `and older than ${CONTRACT_THRESHOLDS.outboxStuckMaxMinutes}m at ${now.toISOString()}.`,
    }),
  );

  // Unresolved circuit-breaker trips.
  //
  // The worker writes a `worker.circuit-open` run and leaves it `running` until
  // the breaker closes, so an unresolved trip is exactly a still-running row of
  // that type. Counting dead-letter rows instead — the obvious-looking proxy —
  // would report 1,953 governance holds as breaker trips, which is a policy
  // decision being read as an outage.
  const openTrips = systemRuns.filter(
    (row) =>
      row.run_type === CIRCUIT_OPEN_RUN_TYPE &&
      (row.status ?? '').trim().toLowerCase() === 'running' &&
      !row.finished_at,
  );
  metrics.push(
    metric({
      id: 'unresolved_circuit_breaker_trips',
      title: 'Unresolved circuit breaker trips at proof time',
      threshold: `== ${CONTRACT_THRESHOLDS.unresolvedTripMaxCount}`,
      measured: openTrips.length,
      unit: 'count',
      passes: openTrips.length <= CONTRACT_THRESHOLDS.unresolvedTripMaxCount,
      evidence:
        `${openTrips.length} ${CIRCUIT_OPEN_RUN_TYPE} runs are still 'running' with no finished_at ` +
        `at ${now.toISOString()}.`,
    }),
  );

  // Delivery success rate over the window.
  const receiptWindowStart = now.getTime() - WINDOWS.runtimeDays * 86_400_000;
  const windowReceipts = receipts.filter((row) => {
    const at = row.recorded_at ? Date.parse(row.recorded_at) : NaN;
    return Number.isFinite(at) && at >= receiptWindowStart;
  });
  if (windowReceipts.length === 0) {
    metrics.push(
      unmeasurable({
        id: 'outbox_delivery_success_rate',
        title: 'Outbox delivery success rate',
        threshold: `>= ${CONTRACT_THRESHOLDS.outboxDeliverySuccessPct}% over ${WINDOWS.runtimeDays} days`,
        reason:
          `no distribution_receipts rows exist in the ${WINDOWS.runtimeDays}-day window, so there is ` +
          'no attempt population to compute a rate over. A rate over zero attempts is not 100%',
      }),
    );
  } else {
    const succeeded = windowReceipts.filter(
      (row) => (row.status ?? '').trim().toLowerCase() === 'success',
    );
    const rate = pct(succeeded.length, windowReceipts.length);
    metrics.push(
      metric({
        id: 'outbox_delivery_success_rate',
        title: 'Outbox delivery success rate',
        threshold: `>= ${CONTRACT_THRESHOLDS.outboxDeliverySuccessPct}% over ${WINDOWS.runtimeDays} days`,
        measured: rate,
        unit: 'percent',
        passes: rate >= CONTRACT_THRESHOLDS.outboxDeliverySuccessPct,
        evidence: `${succeeded.length}/${windowReceipts.length} delivery receipts recorded success in the window.`,
      }),
    );
  }

  // The two latency metrics and the end-to-end latency metric have no source.
  for (const spec of [
    {
      id: 'api_p99_submission',
      title: 'API p99 latency (pick submission)',
      threshold: '<= 2000 ms',
    },
    {
      id: 'api_p99_operator_detail',
      title: 'API p99 latency (operator pick detail)',
      threshold: '<= 1500 ms',
    },
  ]) {
    metrics.push(
      unmeasurable({
        ...spec,
        reason:
          'no request-latency telemetry is persisted anywhere this repository can read — ' +
          'there is no latency table, and the Loki stack is not queried from here. ' +
          'Closing this needs a latency series, not a different query',
      }),
    );
  }
  metrics.push(
    unmeasurable({
      id: 'pipeline_e2e_latency',
      title: 'Pipeline end-to-end latency (submit -> grade)',
      threshold: '<= 15 min for >= 95% of picks',
      reason:
        'the contract measures submit -> grade, and no column records when a pick was graded as ' +
        'distinct from when it was settled. settlement_records.settled_at happens after the game, ' +
        'so measuring against it would report hours and call it a pipeline latency breach',
    }),
  );

  return {
    id: 'runtime_health',
    title: 'Dimension 1: Runtime Health',
    blocking: true,
    status: rollUpDimension(metrics),
    metrics,
  };
}

// ── Dimension 2: Score Provenance Quality ────────────────────────────────────

export function measureScoreProvenance(picks: PickLike[]): ContractDimension {
  const measurable = picks.filter(isMeasurablePick);
  const excluded = picks.length - measurable.length;

  if (measurable.length === 0) {
    const reason =
      `no production picks in the ${WINDOWS.provenanceDays}-day window after excluding ` +
      `${excluded} fixture rows; a share over an empty population is not 0% and not 100%`;
    const metrics = [
      unmeasurable({
        id: 'market_backed_share',
        title: 'Market-backed share (real-edge + consensus-edge)',
        threshold: `>= ${CONTRACT_THRESHOLDS.marketBackedSharePct}%`,
        reason,
      }),
      unmeasurable({
        id: 'unknown_share',
        title: 'Unknown share',
        threshold: `<= ${CONTRACT_THRESHOLDS.unknownShareMaxPct}%`,
        reason,
      }),
      unmeasurable({
        id: 'edge_attribution_share',
        title: 'Picks with any edge attribution',
        threshold: `>= ${CONTRACT_THRESHOLDS.anyEdgeAttributionPct}%`,
        reason,
      }),
    ];
    return {
      id: 'score_provenance',
      title: 'Dimension 2: Score Provenance Quality',
      blocking: true,
      status: rollUpDimension(metrics),
      metrics,
    };
  }

  let marketBacked = 0;
  let unknown = 0;
  for (const pick of measurable) {
    const quality = classifyEdgeQuality(pick.metadata);
    if (quality === 'market-backed') marketBacked += 1;
    else if (quality === 'unknown') unknown += 1;
  }
  const attributed = measurable.length - unknown;

  const suffix =
    `Population: ${measurable.length} production picks over ${WINDOWS.provenanceDays} days ` +
    `(${excluded} fixture rows excluded).`;

  const marketBackedPct = pct(marketBacked, measurable.length);
  const unknownPct = pct(unknown, measurable.length);
  const attributedPct = pct(attributed, measurable.length);

  const metrics = [
    metric({
      id: 'market_backed_share',
      title: 'Market-backed share (real-edge + consensus-edge)',
      threshold: `>= ${CONTRACT_THRESHOLDS.marketBackedSharePct}%`,
      measured: marketBackedPct,
      unit: 'percent',
      passes: marketBackedPct >= CONTRACT_THRESHOLDS.marketBackedSharePct,
      evidence: `${marketBacked} market-backed. ${suffix}`,
    }),
    metric({
      id: 'unknown_share',
      title: 'Unknown share',
      threshold: `<= ${CONTRACT_THRESHOLDS.unknownShareMaxPct}%`,
      measured: unknownPct,
      unit: 'percent',
      passes: unknownPct <= CONTRACT_THRESHOLDS.unknownShareMaxPct,
      evidence: `${unknown} picks carry no edge attribution on either the current or legacy shape. ${suffix}`,
    }),
    metric({
      id: 'edge_attribution_share',
      title: 'Picks with any edge attribution',
      threshold: `>= ${CONTRACT_THRESHOLDS.anyEdgeAttributionPct}%`,
      measured: attributedPct,
      unit: 'percent',
      passes: attributedPct >= CONTRACT_THRESHOLDS.anyEdgeAttributionPct,
      evidence: `${attributed} picks state a provenance, market-backed or confidence-fallback. ${suffix}`,
    }),
  ];

  return {
    id: 'score_provenance',
    title: 'Dimension 2: Score Provenance Quality',
    blocking: true,
    status: rollUpDimension(metrics),
    metrics,
  };
}

// ── Dimension 3: Settlement / CLV Coverage ───────────────────────────────────

export interface SettlementRow {
  id?: string | null;
  pick_id?: string | null;
  result?: string | null;
  settled_at?: string | null;
  source?: string | null;
  settled_by?: string | null;
  corrects_id?: string | null;
  payload?: unknown;
  picks?: PickLike | null;
}

export interface ClvSnapshotRow {
  pick_id?: string | null;
  snapshot_kind?: string | null;
}

/**
 * Settlement sources that mean "a machine did it", not "a person did it".
 *
 * `grading` is the one that matters: it is the literal value
 * `apps/api/src/settlement-service.ts` writes on every automated settlement. The
 * rest are accepted so an older or renamed writer does not get silently counted
 * as manual, which would understate automation rather than overstate it.
 */
const AUTOMATED_SETTLEMENT_SOURCES = new Set([
  'grading',
  'grading-cron',
  'grading-service',
  'auto',
  'automated',
  'system',
]);

export function isAutomatedSettlement(row: SettlementRow): boolean {
  const source = (row.source ?? '').trim().toLowerCase();
  if (source) return AUTOMATED_SETTLEMENT_SOURCES.has(source);
  const by = (row.settled_by ?? '').trim().toLowerCase();
  return by === 'system' || by === 'grading-cron' || by === 'auto';
}

export function measureSettlementCoverage(input: {
  settlements: SettlementRow[];
  clvSnapshots: ClvSnapshotRow[];
}): ContractDimension {
  const settlements = input.settlements.filter((row) => isMeasurablePick(row.picks));
  const excluded = input.settlements.length - settlements.length;
  const metrics: ContractMetric[] = [];

  const emptyReason =
    `no production settlements in the ${WINDOWS.settlementDays}-day window after excluding ` +
    `${excluded} fixture rows`;

  if (settlements.length === 0) {
    metrics.push(
      unmeasurable({
        id: 'automated_settlement_share',
        title: 'Picks with automated settlement',
        threshold: `>= ${CONTRACT_THRESHOLDS.automatedSettlementPct}% of graded picks`,
        reason: emptyReason,
      }),
      unmeasurable({
        id: 'clv_resolved_share',
        title: 'Picks with resolved CLV at close',
        threshold: `>= ${CONTRACT_THRESHOLDS.clvResolvedPct}% of settled picks`,
        reason: emptyReason,
      }),
      unmeasurable({
        id: 'settlement_correction_rate',
        title: 'Settlements subsequently corrected',
        threshold: `<= ${CONTRACT_THRESHOLDS.settlementCorrectionMaxPct}%`,
        reason: emptyReason,
      }),
    );
  } else {
    const automated = settlements.filter(isAutomatedSettlement);
    const automatedPct = pct(automated.length, settlements.length);
    metrics.push(
      metric({
        id: 'automated_settlement_share',
        title: 'Picks with automated settlement',
        threshold: `>= ${CONTRACT_THRESHOLDS.automatedSettlementPct}% of graded picks`,
        measured: automatedPct,
        unit: 'percent',
        passes: automatedPct >= CONTRACT_THRESHOLDS.automatedSettlementPct,
        evidence: `${automated.length}/${settlements.length} settlements came from an automated source (${excluded} fixture rows excluded).`,
      }),
    );

    // CLV coverage per the contract's stated mechanism: an immutable pick-linked
    // closing snapshot. `provider_offers` rows predate UTV2-803 and explicitly do
    // not satisfy this gate, so they are not consulted here.
    const closingByPick = new Set(
      input.clvSnapshots
        .filter((row) => (row.snapshot_kind ?? '') === 'closing_for_clv')
        .map((row) => row.pick_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    );
    const covered = settlements.filter(
      (row) => typeof row.pick_id === 'string' && closingByPick.has(row.pick_id),
    );
    const clvPct = pct(covered.length, settlements.length);
    metrics.push(
      metric({
        id: 'clv_resolved_share',
        title: 'Picks with resolved CLV at close',
        threshold: `>= ${CONTRACT_THRESHOLDS.clvResolvedPct}% of settled picks`,
        measured: clvPct,
        unit: 'percent',
        passes: clvPct >= CONTRACT_THRESHOLDS.clvResolvedPct,
        evidence:
          `${covered.length}/${settlements.length} settled picks have a pick_offer_snapshots row with ` +
          "snapshot_kind = 'closing_for_clv'. Pre-UTV2-803 provider_offers rows are not consulted: " +
          'the contract states they do not satisfy this gate.',
      }),
    );

    // The contract's denominator is automated settlements, not all settlements:
    // "<= 2% of automated settlements subsequently corrected". Using every
    // settlement would dilute the rate with operator work the metric is not about.
    if (automated.length === 0) {
      metrics.push(
        unmeasurable({
          id: 'settlement_correction_rate',
          title: 'Automated settlements subsequently corrected',
          threshold: `<= ${CONTRACT_THRESHOLDS.settlementCorrectionMaxPct}%`,
          reason:
            'no automated settlements in the window, so the contract\'s denominator is empty; ' +
            'a correction rate over zero automated settlements is not 0%',
        }),
      );
    } else {
      const correctedIds = new Set(
        settlements
          .map((row) => row.corrects_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      );
      const corrected = automated.filter(
        (row) => typeof row.id === 'string' && correctedIds.has(row.id),
      );
      const correctedPct = pct(corrected.length, automated.length);
      metrics.push(
        metric({
          id: 'settlement_correction_rate',
          title: 'Automated settlements subsequently corrected',
          threshold: `<= ${CONTRACT_THRESHOLDS.settlementCorrectionMaxPct}%`,
          measured: correctedPct,
          unit: 'percent',
          passes: correctedPct <= CONTRACT_THRESHOLDS.settlementCorrectionMaxPct,
          evidence:
            `${corrected.length}/${automated.length} automated settlements are named by a later ` +
            "row's corrects_id. The original row is never mutated, so the correction is counted " +
            'against the settlement that was corrected, not the one that corrected it.',
        }),
      );
    }
  }

  metrics.push(
    unmeasurable({
      id: 'manual_grading_backlog',
      title: 'Manual grading backlog',
      threshold: '<= 5% of picks ungraded > 48h after game end',
      reason:
        'the threshold is anchored to game end, and picks carry no settled game-end timestamp ' +
        'that can be joined here. Measuring from pick creation instead would answer a different question',
    }),
  );

  return {
    id: 'settlement_clv_coverage',
    title: 'Dimension 3: Settlement / CLV Coverage',
    blocking: true,
    status: rollUpDimension(metrics),
    metrics,
  };
}

// ── Dimension 4: Routing Trust ───────────────────────────────────────────────

export interface PromotionRow {
  pick_id?: string | null;
  target?: string | null;
  status?: string | null;
  reason?: string | null;
  picks?: PickLike | null;
}

export const TOP_TIER_TARGETS = new Set(['trader-insights', 'exclusive-insights']);

export function measureRoutingTrust(promotions: PromotionRow[]): ContractDimension {
  const production = promotions.filter((row) => isMeasurablePick(row.picks));
  const metrics: ContractMetric[] = [];

  const topTier = production.filter((row) =>
    TOP_TIER_TARGETS.has((row.target ?? '').trim().toLowerCase()),
  );
  if (topTier.length === 0) {
    metrics.push(
      unmeasurable({
        id: 'top_tier_market_backed_share',
        title: 'Top-tier picks with market-backed edge',
        threshold: `>= ${CONTRACT_THRESHOLDS.topTierMarketBackedPct}%`,
        reason: `no production promotions to ${[...TOP_TIER_TARGETS].join(' or ')} in the window`,
      }),
    );
  } else {
    const backed = topTier.filter(
      (row) => classifyEdgeQuality(row.picks?.metadata) === 'market-backed',
    );
    const share = pct(backed.length, topTier.length);
    metrics.push(
      metric({
        id: 'top_tier_market_backed_share',
        title: 'Top-tier picks with market-backed edge',
        threshold: `>= ${CONTRACT_THRESHOLDS.topTierMarketBackedPct}%`,
        measured: share,
        unit: 'percent',
        passes: share >= CONTRACT_THRESHOLDS.topTierMarketBackedPct,
        evidence: `${backed.length}/${topTier.length} top-tier promotions carry a market-backed edge.`,
      }),
    );
  }

  // "Suppression always explicit" is a 100% requirement, so it is measured as a
  // count of violations rather than a share: one unexplained suppression is a
  // failure, and a share would round it away in a large population.
  const suppressed = production.filter(
    (row) => (row.status ?? '').trim().toLowerCase() === 'suppressed',
  );
  const unexplained = suppressed.filter((row) => !(row.reason ?? '').trim());
  metrics.push(
    metric({
      id: 'suppression_always_explicit',
      title: 'Suppressed picks carrying an explicit reason',
      threshold: `${CONTRACT_THRESHOLDS.suppressionExplicitPct}%`,
      measured: unexplained.length,
      unit: 'count',
      passes: unexplained.length === 0,
      evidence:
        `${unexplained.length} of ${suppressed.length} suppressed promotions carry no reason. ` +
        'Measured as a violation count, not a share: the threshold is 100%, and one silent ' +
        'suppression rounds to nothing in a large population.',
    }),
  );

  return {
    id: 'routing_trust',
    title: 'Dimension 4: Routing Trust',
    blocking: true,
    status: rollUpDimension(metrics),
    metrics,
  };
}

// ── Dimension 5: Operator Decision Support ───────────────────────────────────

/**
 * Every requirement in this dimension is about what a rendered page shows —
 * "no cell rendering em-dash, N/A or blank where real data should be". That is a
 * property of the running console against real rows, not of the database and not
 * of the source.
 *
 * A source-level check here would be worse than nothing: it would report `pass`
 * for a component that exists and renders a placeholder, which is the exact
 * violation the contract names.
 */
export function measureOperatorSupport(): ContractDimension {
  const metrics = [
    unmeasurable({
      id: 'operator_surface_audit',
      title: 'Operator surfaces render real data, no placeholders',
      threshold: 'zero placeholder cells across pick detail, picks list, review queue, held queue, settlement',
      reason:
        'this is a property of rendered pages against real rows. It needs the console deployed and ' +
        'an audit of >= 10 picks per status type; a source-level check would pass a component that ' +
        'renders a placeholder, which is the violation itself',
    }),
  ];
  return {
    id: 'operator_decision_support',
    title: 'Dimension 5: Operator Decision Support',
    blocking: true,
    status: rollUpDimension(metrics),
    metrics,
  };
}

// ── Dimension 6: Performance Evidence ────────────────────────────────────────

export interface PerformanceInput {
  settlements: SettlementRow[];
  promotions: PromotionRow[];
}

/**
 * Reads the CLV percentage out of a settlement payload.
 *
 * The field is `clvPercent`, matching `readClvPercent` in both
 * `apps/api/src/grading-service.ts` and `apps/api/src/alert-query-service.ts`.
 * The contract text points at `pick_promotion_history.metadata.clv` instead —
 * that table has no `metadata` column and never had one, so following the
 * document literally would measure nothing. Reading the field the settlement
 * writer actually produces is the closer reading of what the contract means.
 */
export function readClvPercent(payload: unknown): number | null {
  return finiteNumber(jsonRecord(payload)['clvPercent']);
}

export function measurePerformanceEvidence(input: PerformanceInput): ContractDimension {
  const settlements = input.settlements.filter(
    (row) => isMeasurablePick(row.picks) && isAutomatedSettlement(row),
  );
  const metrics: ContractMetric[] = [];

  metrics.push(
    metric({
      id: 'settled_sample_size',
      title: 'Settled picks with automated grading',
      threshold: `>= ${CONTRACT_THRESHOLDS.settledSampleMin} over ${WINDOWS.performanceDays} days`,
      measured: settlements.length,
      unit: 'count',
      passes: settlements.length >= CONTRACT_THRESHOLDS.settledSampleMin,
      evidence:
        `${settlements.length} automated settlements on production picks in the window. ` +
        'Simulation and backtest rows are excluded by construction: this reads settlement_records only.',
    }),
  );

  const withClv = settlements.map((row) => readClvPercent(row.payload)).filter((v): v is number => v !== null);
  if (withClv.length === 0) {
    metrics.push(
      unmeasurable({
        id: 'clv_plus_rate',
        title: 'CLV+ rate',
        threshold: `>= ${CONTRACT_THRESHOLDS.clvPlusRatePct}% of settled picks`,
        reason: 'no settlement payload in the window carries a CLV value to classify',
      }),
    );
  } else {
    const positive = withClv.filter((v) => v > 0);
    const rate = pct(positive.length, withClv.length);
    metrics.push(
      metric({
        id: 'clv_plus_rate',
        title: 'CLV+ rate',
        threshold: `>= ${CONTRACT_THRESHOLDS.clvPlusRatePct}% of settled picks`,
        measured: rate,
        unit: 'percent',
        passes: rate >= CONTRACT_THRESHOLDS.clvPlusRatePct,
        evidence: `${positive.length}/${withClv.length} settlements with a CLV value are positive.`,
      }),
    );
  }

  // No provably-negative routing: a top-tier pick whose edge is negative AND
  // whose provenance is stated. An unknown-provenance pick is excluded by the
  // contract's own wording (`edgeSource != 'unknown'`), because a negative
  // number with no stated source is not provably anything.
  const topTier = input.promotions.filter(
    (row) =>
      isMeasurablePick(row.picks) && TOP_TIER_TARGETS.has((row.target ?? '').trim().toLowerCase()),
  );
  const provablyNegative = topTier.filter((row) => {
    const meta = jsonRecord(row.picks?.metadata);
    if (!hasEdgeAttribution(meta)) return false;
    const edge =
      finiteNumber(jsonRecord(meta['promotionScores'])['edge']) ??
      finiteNumber(jsonRecord(meta['domainAnalysis'])['realEdge']) ??
      finiteNumber(meta['realEdge']);
    return edge !== null && edge < 0;
  });
  metrics.push(
    metric({
      id: 'no_provably_negative_routing',
      title: 'Top-tier picks with a stated negative edge',
      threshold: `== ${CONTRACT_THRESHOLDS.negativeEdgeTopTierMaxCount}`,
      measured: provablyNegative.length,
      unit: 'count',
      passes: provablyNegative.length <= CONTRACT_THRESHOLDS.negativeEdgeTopTierMaxCount,
      evidence:
        `${provablyNegative.length} of ${topTier.length} top-tier promotions have edge < 0 with a stated ` +
        'provenance. Unknown-provenance picks are excluded, per the contract wording.',
    }),
  );

  metrics.push(
    unmeasurable({
      id: 'calibration_gap',
      title: 'Win rate vs implied probability',
      threshold: '<= 0.15 over >= 100 settled picks',
      reason:
        'implied probability requires the odds the pick was taken at, and settlement_records carries ' +
        'the outcome but not the entry price. Closing this needs the entry odds joined per settled ' +
        'pick, not a different aggregation of what is already read here',
    }),
  );

  return {
    id: 'performance_evidence',
    title: 'Dimension 6: Performance Evidence',
    blocking: true,
    status: rollUpDimension(metrics),
    metrics,
  };
}

// ── Report assembly ──────────────────────────────────────────────────────────

export interface ContractInput {
  now: Date;
  runtime: RuntimeInput;
  provenancePicks: PickLike[];
  settlements: SettlementRow[];
  clvSnapshots: ClvSnapshotRow[];
  promotions: PromotionRow[];
}

export function buildContractReport(input: ContractInput): ContractReport {
  const dimensions: ContractDimension[] = [
    measureRuntimeHealth(input.runtime),
    measureScoreProvenance(input.provenancePicks),
    measureSettlementCoverage({
      settlements: input.settlements,
      clvSnapshots: input.clvSnapshots,
    }),
    measureRoutingTrust(input.promotions),
    measureOperatorSupport(),
    measurePerformanceEvidence({
      settlements: input.settlements,
      promotions: input.promotions,
    }),
  ];

  return {
    schema_version: SCHEMA_VERSION,
    generator_version: GENERATOR_VERSION,
    contract_doc: CONTRACT_DOC,
    observed_at: input.now.toISOString(),
    verdict: computeContractVerdict(dimensions),
    dimensions,
    unmeasurable: dimensions
      .flatMap((d) => d.metrics)
      .filter((m) => m.unmeasurable_reason !== null)
      .map((m) => ({ id: m.id, reason: m.unmeasurable_reason as string })),
  };
}

export function formatContractReport(report: ContractReport): string {
  const lines = [
    `Production Readiness Contract — ${report.verdict} (observed ${report.observed_at})`,
    `Contract: ${report.contract_doc}`,
    '',
  ];
  for (const dimension of report.dimensions) {
    lines.push(`${dimension.status.toUpperCase().padEnd(7)} ${dimension.title}`);
    for (const m of dimension.metrics) {
      const value = m.measured === null ? '—' : `${m.measured}${m.unit === 'percent' ? '%' : ''}`;
      lines.push(`  ${m.status.padEnd(7)} ${m.title}: ${value} (needs ${m.threshold})`);
    }
    lines.push('');
  }
  if (report.unmeasurable.length > 0) {
    lines.push(`${report.unmeasurable.length} metric(s) nothing can currently measure:`);
    for (const item of report.unmeasurable) lines.push(`  - ${item.id}: ${item.reason}`);
  }
  return lines.join('\n');
}

/**
 * Renders the report as the `readiness_tier: "production"` block that §5.2 of
 * the contract requires inside a T1 evidence bundle.
 *
 * This exists so the bundle is generated from the same measurement that decides
 * the verdict. The alternative — a human transcribing numbers into the JSON by
 * hand — is exactly how a bundle ends up self-consistent and unconstrained by
 * anything: every field agrees with every other field and none of them agree
 * with production.
 *
 * `threshold_pass` is false for any dimension that is not `pass`, unknown
 * included. The contract's own schema has no third state, so an unmeasured
 * dimension has to render as not-passing or the block would assert something
 * nobody measured.
 */
export function toEvidenceBundleBlock(
  report: ContractReport,
  pipelineVersion: string,
): Record<string, unknown> {
  const find = (id: string): ContractMetric | undefined =>
    report.dimensions.flatMap((d) => d.metrics).find((m) => m.id === id);
  const value = (id: string): number | null => find(id)?.measured ?? null;
  const dimension = (id: string): ContractDimension | undefined =>
    report.dimensions.find((d) => d.id === id);
  const passed = (id: string): boolean => dimension(id)?.status === 'pass';

  const provenance = dimension('score_provenance');
  const provenanceTotal = provenance?.metrics
    .find((m) => m.id === 'market_backed_share')
    ?.evidence.match(/Population: (\d+)/)?.[1];

  return {
    readiness_tier: 'production',
    proof_date: report.observed_at,
    pipeline_version: pipelineVersion,
    dimensions: {
      runtime_health: {
        worker_uptime_7d_pct: value('worker_uptime'),
        outbox_success_rate_7d_pct: value('outbox_delivery_success_rate'),
        stuck_pick_count: value('outbox_stuck_rows'),
        circuit_breaker_trips_open: value('unresolved_circuit_breaker_trips'),
        threshold_pass: passed('runtime_health'),
      },
      score_provenance: {
        window_days: WINDOWS.provenanceDays,
        total_picks: provenanceTotal ? Number(provenanceTotal) : null,
        market_backed_pct: value('market_backed_share'),
        unknown_pct: value('unknown_share'),
        threshold_pass: passed('score_provenance'),
      },
      settlement_clv: {
        auto_graded_pct: value('automated_settlement_share'),
        clv_coverage_pct: value('clv_resolved_share'),
        clv_proof_table: 'pick_offer_snapshots',
        clv_snapshot_kind: 'closing_for_clv',
        manual_backlog_pct: value('manual_grading_backlog'),
        threshold_pass: passed('settlement_clv_coverage'),
      },
      routing_trust: {
        top_tier_market_backed_pct: value('top_tier_market_backed_share'),
        suppression_explicit_pct: passed('routing_trust') ? 100.0 : null,
        threshold_pass: passed('routing_trust'),
      },
      operator_surfaces: {
        surfaces_audited: [],
        placeholder_violations: null,
        threshold_pass: passed('operator_decision_support'),
      },
      performance_evidence: {
        settled_pick_count: value('settled_sample_size'),
        calibration_gap: value('calibration_gap'),
        clv_positive_rate: value('clv_plus_rate'),
        threshold_pass: passed('performance_evidence'),
      },
    },
    overall_pass: report.verdict === 'PASS',
    unmeasured_metrics: report.unmeasurable,
  };
}

export function writeContractReport(report: ContractReport, outPath: string): void {
  const absolute = path.isAbsolute(outPath) ? outPath : path.join(REPO_ROOT, outPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

// ── Read-only database access ────────────────────────────────────────────────

/**
 * The only database surface in this module. Every method reads.
 *
 * There is deliberately no insert/update/upsert/delete/rpc member to reach for,
 * and the test suite scans this file to keep it that way — the same guarantee
 * `readiness-refresh.ts` holds, for the same reason: a measurement instrument
 * that can write is a mutation waiting for a bad day.
 */
export interface ContractReader {
  projectRef: string;
  selectRows(
    table: string,
    columns: string,
    options?: { sinceColumn?: string; sinceIso?: string; limit?: number },
  ): Promise<Record<string, unknown>[]>;
}

export async function collectContractInput(
  reader: ContractReader,
  now: Date,
): Promise<ContractInput> {
  const iso = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  const [systemRuns, outbox, receipts, provenancePicks, settlements, clvSnapshots, promotions] =
    await Promise.all([
      reader.selectRows('system_runs', 'run_type,started_at,finished_at,status', {
        sinceColumn: 'started_at',
        sinceIso: iso(WINDOWS.runtimeDays),
      }),
      reader.selectRows('distribution_outbox', 'status,created_at,updated_at,attempt_count'),
      reader.selectRows('distribution_receipts', 'status,receipt_type,recorded_at', {
        sinceColumn: 'recorded_at',
        sinceIso: iso(WINDOWS.runtimeDays),
      }),
      reader.selectRows('picks', 'id,source,selection,status,created_at,metadata', {
        sinceColumn: 'created_at',
        sinceIso: iso(WINDOWS.provenanceDays),
      }),
      reader.selectRows(
        'settlement_records',
        'id,pick_id,result,settled_at,source,settled_by,corrects_id,payload,picks!inner(id,source,selection,status,metadata)',
        { sinceColumn: 'settled_at', sinceIso: iso(WINDOWS.settlementDays) },
      ),
      reader.selectRows('pick_offer_snapshots', 'pick_id,snapshot_kind', {
        sinceColumn: 'captured_at',
        sinceIso: iso(WINDOWS.settlementDays),
      }),
      reader.selectRows(
        'pick_promotion_history',
        'pick_id,target,status,reason,picks!inner(id,source,selection,status,metadata)',
        { sinceColumn: 'created_at', sinceIso: iso(WINDOWS.performanceDays) },
      ),
    ]);

  return {
    now,
    runtime: {
      now,
      // `system_runs` carries every run type. The run_type filters live in
      // measureRuntimeHealth so the reader interface stays a plain select and the
      // tests can drive both heartbeat and circuit-breaker cases from one array.
      systemRuns: systemRuns as SystemRunRow[],
      outbox: outbox as OutboxRow[],
      receipts: receipts as ReceiptRow[],
    },
    provenancePicks: provenancePicks as PickLike[],
    settlements: settlements as SettlementRow[],
    clvSnapshots: clvSnapshots as ClvSnapshotRow[],
    promotions: promotions as PromotionRow[],
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main(argv: string[]): Promise<number> {
  const wantsJson = argv.includes('--json');
  const outIndex = argv.indexOf('--out');
  const outPath = outIndex >= 0 ? argv[outIndex + 1] : CANONICAL_ARTIFACT_PATH;
  if (!outPath) {
    process.stderr.write('--out requires a path\n');
    return 1;
  }

  const supabaseUrl = process.env['SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl || !serviceRoleKey) {
    process.stderr.write(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to measure the contract.\n',
    );
    return 1;
  }

  const projectRef = extractProjectRefFromUrl(supabaseUrl).projectRef ?? 'unknown';
  if (projectRef !== CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF) {
    // A contract measured against staging is a false production report, and it
    // would be indistinguishable from a real one once written to the artifact.
    process.stderr.write(
      `Refusing to measure the production readiness contract against project "${projectRef}". ` +
        `Only ${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF} is canonical production.\n`,
    );
    return 1;
  }

  const client = createPrivilegedClient(
    supabaseUrl,
    serviceRoleKey,
    { auth: { persistSession: false } },
    'readiness-contract production read',
  );
  const reader: ContractReader = {
    projectRef,
    async selectRows(table, columns, options) {
      const pageSize = 1000;
      const rows: Record<string, unknown>[] = [];
      for (let from = 0; ; from += pageSize) {
        let query = client.from(table).select(columns).range(from, from + pageSize - 1);
        if (options?.sinceColumn && options.sinceIso) {
          query = query.gte(options.sinceColumn, options.sinceIso);
        }
        const { data, error } = await query;
        if (error) throw new Error(`${table} read failed: ${error.message}`);
        const page = (data ?? []) as unknown as Record<string, unknown>[];
        rows.push(...page);
        if (page.length < pageSize) break;
        if (options?.limit && rows.length >= options.limit) break;
      }
      return rows;
    },
  };

  const report = buildContractReport(await collectContractInput(reader, new Date()));
  writeContractReport(report, outPath);

  // The §5.2 evidence block, generated from the same measurement rather than
  // transcribed from it. See toEvidenceBundleBlock.
  const evidenceIndex = argv.indexOf('--evidence-block');
  if (evidenceIndex >= 0) {
    const evidencePath = argv[evidenceIndex + 1];
    if (!evidencePath) {
      process.stderr.write('--evidence-block requires a path\n');
      return 1;
    }
    const { execFileSync } = await import('node:child_process');
    const pipelineVersion = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    const absolute = path.isAbsolute(evidencePath)
      ? evidencePath
      : path.join(REPO_ROOT, evidencePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(
      absolute,
      `${JSON.stringify(toEvidenceBundleBlock(report, pipelineVersion), null, 2)}\n`,
      'utf8',
    );
  }
  process.stdout.write(`${formatContractReport(report)}\n`);
  if (wantsJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
