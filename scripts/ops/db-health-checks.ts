/**
 * UTV2-1632 — the DB Health Tripwire's check logic, with no I/O of any kind.
 *
 * Split out of `db-health-tripwire.ts` because that module opens a privileged
 * database connection, and `scripts/ci/privileged-db-client-guard.ts` forbids
 * any path from a `pnpm test` entrypoint to a module that constructs a client
 * directly. The unit tests need the evaluators and the receipt gate; they must
 * not drag the driver in behind them.
 *
 * The separation is worth more than the guard that forced it. Every function
 * here takes an already-fetched row and returns a verdict, so a test can prove
 * that a measured value is genuinely compared against a threshold without a
 * database being reachable at all — which is the property this whole lane
 * exists to establish.
 */
import path from 'node:path';

export const RECEIPT_SCHEMA = 'db-health-tripwire-receipt/v1';
export const LINEAR_ISSUE_ID = 'UTV2-1300';
export const DEFAULT_RECEIPT_PATH = path.join('artifacts', 'db-health-tripwire-receipt.json');

/** Exit code for "the harness could not run the checks". Distinct from a finding. */
export const EXIT_HARNESS_ERROR = 2;

export const HOT_TABLES = [
  'system_runs',
  'raw_payloads',
  'odds_snapshots',
  'provider_offer_history',
  'game_results',
] as const;
export const TOAST_BLOAT_TABLES = ['raw_payloads', 'odds_snapshots'] as const;

export type TableName = (typeof HOT_TABLES)[number];

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export type ThresholdSource = 'default' | 'env' | 'dispatch_override';

export interface ThresholdSpec {
  key: string;
  unit: string;
  kind: 'int' | 'float';
  fallback: number;
}

/**
 * The complete set of tunable thresholds. An override naming anything outside
 * this set is a harness error: the override input must not be able to reach
 * connection targets, credentials, or table selection.
 */
export const THRESHOLD_SPECS: readonly ThresholdSpec[] = [
  { key: 'SYSTEM_RUNS_SIZE_THRESHOLD_MB', unit: 'MB', kind: 'int', fallback: 500 },
  { key: 'RAW_PAYLOADS_SIZE_THRESHOLD_MB', unit: 'MB', kind: 'int', fallback: 300 },
  { key: 'ODDS_SNAPSHOTS_SIZE_THRESHOLD_MB', unit: 'MB', kind: 'int', fallback: 300 },
  { key: 'PROVIDER_OFFER_HISTORY_SIZE_THRESHOLD_MB', unit: 'MB', kind: 'int', fallback: 300 },
  { key: 'GAME_RESULTS_SIZE_THRESHOLD_MB', unit: 'MB', kind: 'int', fallback: 300 },
  { key: 'AUTOVACUUM_STALENESS_HOURS', unit: 'hours', kind: 'int', fallback: 24 },
  { key: 'STATEMENT_TIMEOUT_RATE_THRESHOLD', unit: 'events/hour', kind: 'int', fallback: 3 },
  { key: 'TOAST_BLOAT_RATIO_THRESHOLD', unit: 'ratio', kind: 'float', fallback: 0.8 },
] as const;

export const SIZE_THRESHOLD_KEY_BY_TABLE: Record<TableName, string> = {
  system_runs: 'SYSTEM_RUNS_SIZE_THRESHOLD_MB',
  raw_payloads: 'RAW_PAYLOADS_SIZE_THRESHOLD_MB',
  odds_snapshots: 'ODDS_SNAPSHOTS_SIZE_THRESHOLD_MB',
  provider_offer_history: 'PROVIDER_OFFER_HISTORY_SIZE_THRESHOLD_MB',
  game_results: 'GAME_RESULTS_SIZE_THRESHOLD_MB',
};

export interface ResolvedThreshold {
  key: string;
  value: number;
  unit: string;
  source: ThresholdSource;
}

export type ThresholdTable = Record<string, ResolvedThreshold>;

/** Thrown for any condition meaning "the checks could not be run as configured". */
export class HarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HarnessError';
  }
}

function parseNumeric(spec: ThresholdSpec, raw: string, origin: string): number {
  const value = spec.kind === 'int' ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    throw new HarnessError(
      `threshold ${spec.key} from ${origin} is not a finite number: ${JSON.stringify(raw)}`,
    );
  }
  if (value <= 0) {
    throw new HarnessError(
      `threshold ${spec.key} from ${origin} must be greater than zero, got ${value}`,
    );
  }
  return value;
}

/**
 * Resolve every threshold, recording where its value came from.
 *
 * Precedence: dispatch override > environment > compiled default. Unknown
 * override keys and unparseable values fail closed rather than being ignored,
 * so a typo in a dispatch input cannot silently run default thresholds and then
 * be reported as a demonstration.
 */
export function resolveThresholds(env: NodeJS.ProcessEnv = process.env): ThresholdTable {
  const rawOverrides = (env['TRIPWIRE_THRESHOLD_OVERRIDES'] ?? '').trim();
  let overrides: Record<string, unknown> = {};

  if (rawOverrides) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawOverrides);
    } catch (err) {
      throw new HarnessError(
        `TRIPWIRE_THRESHOLD_OVERRIDES is not valid JSON: ${(err as Error).message}`,
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HarnessError('TRIPWIRE_THRESHOLD_OVERRIDES must be a JSON object');
    }
    overrides = parsed as Record<string, unknown>;

    const known = new Set(THRESHOLD_SPECS.map((spec) => spec.key));
    const unknown = Object.keys(overrides).filter((key) => !known.has(key));
    if (unknown.length > 0) {
      throw new HarnessError(
        `TRIPWIRE_THRESHOLD_OVERRIDES names unknown threshold key(s): ${unknown.join(', ')}. ` +
          `Overrides may only touch: ${[...known].join(', ')}`,
      );
    }
  }

  const table: ThresholdTable = {};
  for (const spec of THRESHOLD_SPECS) {
    if (Object.prototype.hasOwnProperty.call(overrides, spec.key)) {
      table[spec.key] = {
        key: spec.key,
        value: parseNumeric(spec, String(overrides[spec.key]), 'TRIPWIRE_THRESHOLD_OVERRIDES'),
        unit: spec.unit,
        source: 'dispatch_override',
      };
      continue;
    }
    const fromEnv = env[spec.key];
    if (fromEnv !== undefined && fromEnv.trim() !== '') {
      table[spec.key] = {
        key: spec.key,
        value: parseNumeric(spec, fromEnv.trim(), `environment variable ${spec.key}`),
        unit: spec.unit,
        source: 'env',
      };
      continue;
    }
    table[spec.key] = { key: spec.key, value: spec.fallback, unit: spec.unit, source: 'default' };
  }
  return table;
}

export function hasOverriddenThreshold(thresholds: ThresholdTable): boolean {
  return Object.values(thresholds).some((entry) => entry.source === 'dispatch_override');
}

function threshold(thresholds: ThresholdTable, key: string): ResolvedThreshold {
  const entry = thresholds[key];
  if (!entry) throw new HarnessError(`threshold ${key} was not resolved`);
  return entry;
}

// ---------------------------------------------------------------------------
// Check outcomes
// ---------------------------------------------------------------------------

export type CheckStatus = 'pass' | 'tripped' | 'not_run';
export type Severity = 'warn' | 'critical';
export type TripwireOutcome = 'checks_passed' | 'checks_tripped' | 'harness_error';

export interface CheckOutcome {
  /** Stable machine name of the check, e.g. `table_size`. */
  check: string;
  /** What the check was applied to — a table name, or null for global checks. */
  subject: string | null;
  status: CheckStatus;
  measured: {
    /** Numeric measurement, or null when the quantity does not exist. */
    value: number | null;
    unit: string;
    display: string;
    /**
     * Did this check look at real data?
     *
     * Distinct from `value !== null`, because "this table has never been
     * analysed" is a genuine observation that trips the check while having no
     * number attached. Conflating the two made the execution gate reject a
     * correctly-evaluated production finding on the first live run.
     */
    observed: boolean;
  };
  threshold: {
    key: string | null;
    value: number | null;
    unit: string;
    source: ThresholdSource | null;
  };
  severity: Severity | null;
  detail: string;
}

export interface ReceiptCounts {
  total: number;
  executed: number;
  passed: number;
  tripped: number;
  not_run: number;
}

export interface RunContext {
  workflow: string | null;
  run_id: string | null;
  run_attempt: string | null;
  job: string | null;
  sha: string | null;
  ref: string | null;
  event: string | null;
}

export type LinearAlertDisposition =
  | 'posted'
  | 'failed'
  | 'skipped_no_api_key'
  | 'suppressed_threshold_override'
  | 'not_applicable';

export interface TripwireReceipt {
  schema: string;
  issue: string;
  generated_at: string;
  outcome: TripwireOutcome;
  harness_error: string | null;
  run: RunContext;
  target: { kind: string; project_ref: string | null; host: string | null };
  read_only: { mechanism: string; observed_transaction_read_only: string | null };
  thresholds: ThresholdTable;
  threshold_override_active: boolean;
  counts: ReceiptCounts;
  checks: CheckOutcome[];
  linear_alert: LinearAlertDisposition;
}

export function readRunContext(env: NodeJS.ProcessEnv = process.env): RunContext {
  const read = (key: string): string | null => {
    const value = env[key];
    return value && value.trim() ? value.trim() : null;
  };
  return {
    workflow: read('GITHUB_WORKFLOW'),
    run_id: read('GITHUB_RUN_ID'),
    run_attempt: read('GITHUB_RUN_ATTEMPT'),
    job: read('GITHUB_JOB'),
    sha: read('GITHUB_SHA'),
    ref: read('GITHUB_REF'),
    event: read('GITHUB_EVENT_NAME'),
  };
}

export function countChecks(checks: readonly CheckOutcome[]): ReceiptCounts {
  return {
    total: checks.length,
    executed: checks.filter((c) => c.status !== 'not_run').length,
    passed: checks.filter((c) => c.status === 'pass').length,
    tripped: checks.filter((c) => c.status === 'tripped').length,
    not_run: checks.filter((c) => c.status === 'not_run').length,
  };
}

/**
 * The outcome is derived from the check rows, never declared independently.
 * A run that evaluated nothing is a harness error, not a pass — the whole point
 * of UTV2-1632.
 */
export function deriveOutcome(checks: readonly CheckOutcome[]): TripwireOutcome {
  const counts = countChecks(checks);
  if (counts.executed === 0) return 'harness_error';
  if (counts.tripped > 0) return 'checks_tripped';
  return 'checks_passed';
}

// ---------------------------------------------------------------------------
// Pure check evaluators
//
// Each takes an already-fetched row and returns the outcome row. Keeping the
// comparison free of I/O is what lets a unit test prove the logic evaluates a
// value against a threshold, independently of whether a database was reachable.
// ---------------------------------------------------------------------------

export interface VacuumRow {
  relname: string;
  last_vacuum: Date | null;
  last_autovacuum: Date | null;
  last_analyze: Date | null;
  last_autoanalyze: Date | null;
  n_dead_tup: string;
  n_live_tup: string;
  dead_tup_pct: string | null;
}

export interface SizeRow {
  relname: string;
  table_size: string;
  total_size: string;
  total_bytes: string;
}

export interface ToastBloatRow {
  relname: string;
  heap_size: string;
  toast_plus_index_size: string;
  total_size: string;
  toast_pct: string | null;
}

const HOURS = 60 * 60 * 1000;
const DEAD_TUPLE_PCT_LIMIT = 20;
const DEAD_TUPLE_ABSOLUTE_LIMIT = 100_000;

export function evaluateAutovacuumRow(
  row: VacuumRow,
  thresholds: ThresholdTable,
  now: Date,
): CheckOutcome {
  const limit = threshold(thresholds, 'AUTOVACUUM_STALENESS_HOURS');
  const cutoff = new Date(now.getTime() - limit.value * HOURS);

  const staleAnalyze = row.last_analyze === null || row.last_analyze < cutoff;
  const missingVacuum = row.last_vacuum === null;
  const missingAutovacuum = row.last_autovacuum === null;
  const deadTuplePct = row.dead_tup_pct === null ? 0 : Number.parseFloat(row.dead_tup_pct);
  const deadTuples = Number.parseInt(row.n_dead_tup, 10);

  const hoursSinceAnalyze =
    row.last_analyze === null ? null : (now.getTime() - row.last_analyze.getTime()) / HOURS;

  const reasons = [
    staleAnalyze
      ? `last_analyze=${row.last_analyze ? row.last_analyze.toISOString() : 'never run'}`
      : null,
    missingVacuum ? 'last_vacuum=never run' : null,
    missingAutovacuum ? 'last_autovacuum=never run' : null,
    deadTuplePct > DEAD_TUPLE_PCT_LIMIT ? `dead_tup_pct=${deadTuplePct.toFixed(2)}%` : null,
  ].filter((reason): reason is string => reason !== null);

  const tripped = reasons.length > 0;
  const severity: Severity | null = !tripped
    ? null
    : missingVacuum ||
        deadTuplePct > DEAD_TUPLE_PCT_LIMIT ||
        (Number.isFinite(deadTuples) && deadTuples > DEAD_TUPLE_ABSOLUTE_LIMIT)
      ? 'critical'
      : 'warn';

  const observedDetail =
    `last_vacuum=${row.last_vacuum ? row.last_vacuum.toISOString() : 'never run'}, ` +
    `last_autovacuum=${row.last_autovacuum ? row.last_autovacuum.toISOString() : 'never run'}, ` +
    `last_analyze=${row.last_analyze ? row.last_analyze.toISOString() : 'never run'}, ` +
    `dead_tup=${row.n_dead_tup}, live_tup=${row.n_live_tup}, ` +
    `dead_tup_pct=${deadTuplePct.toFixed(2)}%`;

  return {
    check: 'autovacuum_staleness',
    subject: row.relname,
    status: tripped ? 'tripped' : 'pass',
    measured: {
      value: hoursSinceAnalyze === null ? null : Number(hoursSinceAnalyze.toFixed(2)),
      unit: 'hours since last_analyze',
      display: observedDetail,
      observed: true,
    },
    threshold: { key: limit.key, value: limit.value, unit: limit.unit, source: limit.source },
    severity,
    detail: tripped
      ? `vacuum/analyze signal on ${row.relname}: ${reasons.join(', ')}; ${observedDetail}`
      : `${row.relname} vacuum/analyze within ${limit.value}h and dead tuples under ` +
        `${DEAD_TUPLE_PCT_LIMIT}%; ${observedDetail}`,
  };
}

export function evaluateSizeRow(row: SizeRow, thresholds: ThresholdTable): CheckOutcome {
  const key = SIZE_THRESHOLD_KEY_BY_TABLE[row.relname as TableName];
  if (!key) {
    return {
      check: 'table_size',
      subject: row.relname,
      status: 'not_run',
      measured: { value: null, unit: 'MB', display: row.total_size, observed: false },
      threshold: { key: null, value: null, unit: 'MB', source: null },
      severity: null,
      detail: `${row.relname} is not a monitored hot table; no size threshold is defined`,
    };
  }

  const limit = threshold(thresholds, key);
  const bytes = Number.parseInt(row.total_bytes, 10);

  if (!Number.isFinite(bytes)) {
    return {
      check: 'table_size',
      subject: row.relname,
      status: 'not_run',
      measured: { value: null, unit: 'MB', display: row.total_size, observed: false },
      threshold: { key: limit.key, value: limit.value, unit: limit.unit, source: limit.source },
      severity: null,
      detail: `${row.relname} total size was not numeric: ${JSON.stringify(row.total_bytes)}`,
    };
  }

  const megabytes = bytes / 1024 / 1024;
  const tripped = megabytes > limit.value;
  return {
    check: 'table_size',
    subject: row.relname,
    status: tripped ? 'tripped' : 'pass',
    measured: {
      value: Number(megabytes.toFixed(2)),
      unit: 'MB',
      display: `${row.total_size} total (heap ${row.table_size})`,
      observed: true,
    },
    threshold: { key: limit.key, value: limit.value, unit: limit.unit, source: limit.source },
    severity: tripped ? (megabytes > limit.value * 2 ? 'critical' : 'warn') : null,
    detail:
      `${row.relname} total size ${row.total_size} (heap ${row.table_size}) ` +
      `${tripped ? 'exceeds' : 'is within'} threshold ${limit.value}${limit.unit}`,
  };
}

export function evaluateToastRow(row: ToastBloatRow, thresholds: ThresholdTable): CheckOutcome {
  const limit = threshold(thresholds, 'TOAST_BLOAT_RATIO_THRESHOLD');
  const limitPct = limit.value * 100;
  const toastPct = row.toast_pct === null ? null : Number.parseFloat(row.toast_pct);

  if (toastPct === null || !Number.isFinite(toastPct)) {
    return {
      check: 'toast_bloat',
      subject: row.relname,
      status: 'not_run',
      measured: { value: null, unit: '%', display: row.total_size, observed: false },
      threshold: { key: limit.key, value: limitPct, unit: '%', source: limit.source },
      severity: null,
      detail: `${row.relname} TOAST ratio was not computable (total relation size is zero or null)`,
    };
  }

  const tripped = toastPct > limitPct;
  return {
    check: 'toast_bloat',
    subject: row.relname,
    status: tripped ? 'tripped' : 'pass',
    measured: {
      value: Number(toastPct.toFixed(1)),
      unit: '%',
      display:
        `heap=${row.heap_size}, toast_plus_index=${row.toast_plus_index_size}, ` +
        `total=${row.total_size}`,
      observed: true,
    },
    threshold: { key: limit.key, value: limitPct, unit: '%', source: limit.source },
    severity: tripped ? (toastPct > 90 ? 'critical' : 'warn') : null,
    detail:
      `${row.relname} TOAST+index ratio ${toastPct.toFixed(1)}% ` +
      `${tripped ? 'exceeds' : 'is within'} ${limitPct.toFixed(0)}%; ` +
      `heap=${row.heap_size}, toast_plus_index=${row.toast_plus_index_size}, ` +
      `total=${row.total_size}`,
  };
}

export function maxEventsInOneHour(timestamps: readonly Date[]): number {
  const sorted = [...timestamps].sort((a, b) => a.getTime() - b.getTime());
  let max = 0;
  let start = 0;
  for (let end = 0; end < sorted.length; end += 1) {
    while ((sorted[end] as Date).getTime() - (sorted[start] as Date).getTime() > HOURS) {
      start += 1;
    }
    max = Math.max(max, end - start + 1);
  }
  return max;
}

export function evaluateStatementTimeoutRate(
  timestamps: readonly Date[],
  windowTotal: number,
  thresholds: ThresholdTable,
): CheckOutcome {
  const limit = threshold(thresholds, 'STATEMENT_TIMEOUT_RATE_THRESHOLD');
  const peak = maxEventsInOneHour(timestamps);
  const tripped = peak > limit.value;
  return {
    check: 'statement_timeout_rate',
    subject: null,
    status: tripped ? 'tripped' : 'pass',
    measured: {
      value: peak,
      unit: 'events/hour',
      display: `${windowTotal} statement timeouts in the last 6h; peak 1h window=${peak}`,
      observed: true,
    },
    threshold: { key: limit.key, value: limit.value, unit: limit.unit, source: limit.source },
    severity: tripped ? (peak > 10 ? 'critical' : 'warn') : null,
    detail:
      `${windowTotal} statement timeouts in last 6h; peak 1h window=${peak}, ` +
      `threshold=${limit.value}/h`,
  };
}

/**
 * A check that could not be measured. Recorded explicitly so an unreachable
 * data source lowers the executed count instead of contributing an invisible
 * pass — the previous implementation returned an empty alert list here, which
 * is indistinguishable from "measured and healthy".
 */
export function notRunCheck(check: string, subject: string | null, reason: string): CheckOutcome {
  return {
    check,
    subject,
    status: 'not_run',
    measured: { value: null, unit: 'n/a', display: 'not measured', observed: false },
    threshold: { key: null, value: null, unit: 'n/a', source: null },
    severity: null,
    detail: reason,
  };
}

// ---------------------------------------------------------------------------
// Receipt gate — hostile verification that the checks actually executed
// ---------------------------------------------------------------------------

export interface GateResult {
  verdict: 'PASS' | 'FAIL';
  reasons: string[];
}

/**
 * Verify a receipt proves execution. Deliberately hostile: counts are
 * recomputed from the check rows rather than trusted, the outcome is
 * re-derived, and when this process is itself running inside a GitHub Actions
 * run the receipt must belong to that same run — so a receipt committed to the
 * repository, or left over from an earlier run, cannot satisfy the gate.
 */
export function gateReceipt(receipt: unknown, env: NodeJS.ProcessEnv = process.env): GateResult {
  const reasons: string[] = [];

  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return { verdict: 'FAIL', reasons: ['receipt is not a JSON object'] };
  }
  const r = receipt as Partial<TripwireReceipt>;

  if (r.schema !== RECEIPT_SCHEMA) {
    reasons.push(`receipt schema is ${JSON.stringify(r.schema)}, expected ${RECEIPT_SCHEMA}`);
  }
  if (!Array.isArray(r.checks)) {
    return { verdict: 'FAIL', reasons: [...reasons, 'receipt has no checks[] array'] };
  }

  const checks = r.checks as CheckOutcome[];
  const recomputed = countChecks(checks);

  if (recomputed.executed === 0) {
    reasons.push(
      'receipt reports zero executed checks — the tripwire started but evaluated nothing. ' +
        'This is the exact defect UTV2-1632 exists to prevent, so it fails closed.',
    );
  }
  if (JSON.stringify(r.counts) !== JSON.stringify(recomputed)) {
    reasons.push(
      `declared counts ${JSON.stringify(r.counts)} do not match counts recomputed from ` +
        `checks[]: ${JSON.stringify(recomputed)}`,
    );
  }

  if (r.outcome === 'harness_error') {
    reasons.push(`receipt outcome is harness_error: ${r.harness_error ?? 'no reason recorded'}`);
  } else {
    const derived = deriveOutcome(checks);
    if (r.outcome !== derived) {
      reasons.push(
        `declared outcome ${JSON.stringify(r.outcome)} does not match derived ${derived}`,
      );
    }
  }

  for (const [index, check] of checks.entries()) {
    if (typeof check?.check !== 'string' || !check.check) {
      reasons.push(`checks[${index}] has no check name`);
      continue;
    }
    if (check.status === 'not_run') continue;
    if (check.measured?.observed !== true) {
      reasons.push(
        `checks[${index}] (${check.check}) reached a ${check.status} verdict without observing ` +
          'anything; a verdict must rest on data the check actually read',
      );
    }
    if (check.threshold?.value === null || check.threshold?.value === undefined) {
      reasons.push(`checks[${index}] (${check.check}) is ${check.status} but carries no threshold`);
    }
  }

  if (r.read_only?.observed_transaction_read_only !== 'on') {
    reasons.push(
      'receipt does not record Postgres reporting transaction_read_only=on, so the run cannot ' +
        'be shown to have been read-only (recorded: ' +
        `${JSON.stringify(r.read_only?.observed_transaction_read_only)})`,
    );
  }

  const currentRunId = (env['GITHUB_RUN_ID'] ?? '').trim();
  if (currentRunId) {
    if (r.run?.run_id !== currentRunId) {
      reasons.push(
        `receipt belongs to run ${JSON.stringify(r.run?.run_id)} but this gate is running in ` +
          `run ${currentRunId}; a receipt from another run proves nothing about this one`,
      );
    }
    const attempt = (env['GITHUB_RUN_ATTEMPT'] ?? '').trim();
    if (attempt && r.run?.run_attempt !== attempt) {
      reasons.push(
        `receipt belongs to run attempt ${JSON.stringify(r.run?.run_attempt)}, expected ${attempt}`,
      );
    }
  }

  return { verdict: reasons.length === 0 ? 'PASS' : 'FAIL', reasons };
}

/** Human-readable table used for both the console and the GitHub step summary. */
export function renderCheckTable(checks: readonly CheckOutcome[]): string {
  const lines = [
    '| Check | Subject | Measured | Threshold | Source | Verdict |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const c of checks) {
    const measured =
      c.measured.value !== null
        ? `${c.measured.value} ${c.measured.unit}`
        : c.measured.observed
          ? c.measured.display
          : 'not measured';
    const limit = c.threshold.value === null ? 'n/a' : `${c.threshold.value} ${c.threshold.unit}`;
    const verdict =
      c.status === 'tripped'
        ? `TRIPPED (${c.severity ?? 'warn'})`
        : c.status === 'pass'
          ? 'PASS'
          : 'NOT RUN';
    lines.push(
      `| ${c.check} | ${c.subject ?? '—'} | ${measured} | ${limit} | ` +
        `${c.threshold.source ?? '—'} | ${verdict} |`,
    );
  }
  return lines.join('\n');
}
