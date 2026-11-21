#!/usr/bin/env tsx

/**
 * UTV2-1736 — provider_offer_history partition coverage monitor.
 *
 * This script is READ-ONLY with respect to schema. It never issues DDL: it
 * measures forward partition coverage, decides whether a pre-expiry condition
 * has been reached, and writes that decision to the real operations sink
 * (`system_runs` + the immutable `audit_log`). Applying the DDL it emits is a
 * separate, explicitly approved production action.
 *
 * Why a monitor and not an auto-provisioner: provider_offer_history has NO
 * DEFAULT partition, deliberately. Running out of forward coverage therefore
 * fails ingestion closed rather than misfiling rows. That is the safe failure
 * mode, but it is only safe if somebody is told before it happens — which is
 * what this script exists to do.
 */

import { pathToFileURL } from 'node:url';

export const ISSUE_ID = 'UTV2-1736';
export const PARTITION_PARENT = 'provider_offer_history';
export const RUN_TYPE = 'ops.partition_coverage';
export const AUDIT_ENTITY_TYPE = 'partition_coverage';

/** Forward-coverage thresholds, in days remaining. */
export const DEFAULT_WARN_DAYS = 30;
export const DEFAULT_CRITICAL_DAYS = 14;

export type CoverageLevel = 'OK' | 'WARNING' | 'CRITICAL';

export interface CoverageThresholds {
  warnDays: number;
  criticalDays: number;
}

export interface CoverageInput {
  /** UTC dates (YYYY-MM-DD) that currently have an attached daily partition. */
  existingPartitionDays: readonly string[];
  /** The day coverage is measured from, normally "today" in UTC. */
  today: string;
}

export interface CoverageReport {
  today: string;
  /** Last day of the unbroken run of coverage starting at `today`. */
  coveredThroughDay: string | null;
  /** Days of unbroken forward coverage including `today`. 0 when today is uncovered. */
  forwardDaysRemaining: number;
  /** Days at or after `today` that are missing, up to the last known partition. */
  missingDays: string[];
  totalPartitions: number;
}

export interface PreExpiryVerdict {
  level: CoverageLevel;
  forwardDaysRemaining: number;
  thresholds: CoverageThresholds;
  message: string;
}

export function toDayString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDays(day: string, delta: number): string {
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${ISSUE_ID}: invalid day "${day}"`);
  }
  parsed.setUTCDate(parsed.getUTCDate() + delta);
  return toDayString(parsed);
}

export function partitionNameForDay(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`${ISSUE_ID}: invalid day "${day}"`);
  }
  return `${PARTITION_PARENT}_p${day.replaceAll('-', '')}`;
}

export function dayFromPartitionName(name: string): string | null {
  const match = /^provider_offer_history_p(\d{4})(\d{2})(\d{2})$/.exec(name);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/**
 * Forward coverage is the UNBROKEN run starting at `today`. A partition that
 * exists on the far side of a gap does not count as coverage: ingestion would
 * fail on the first uncovered day regardless of what sits behind it.
 */
export function computeCoverage(input: CoverageInput): CoverageReport {
  const present = new Set(input.existingPartitionDays);

  let forwardDaysRemaining = 0;
  let cursor = input.today;
  while (present.has(cursor)) {
    forwardDaysRemaining += 1;
    cursor = addDays(cursor, 1);
  }

  const coveredThroughDay = forwardDaysRemaining > 0 ? addDays(cursor, -1) : null;

  const futureDays = [...present].filter((day) => day >= input.today).sort();
  const lastKnown = futureDays.at(-1) ?? null;

  const missingDays: string[] = [];
  if (lastKnown !== null) {
    for (let day = input.today; day <= lastKnown; day = addDays(day, 1)) {
      if (!present.has(day)) {
        missingDays.push(day);
      }
    }
  }

  return {
    today: input.today,
    coveredThroughDay,
    forwardDaysRemaining,
    missingDays,
    totalPartitions: present.size,
  };
}

export function evaluatePreExpiry(
  report: CoverageReport,
  thresholds: CoverageThresholds = {
    warnDays: DEFAULT_WARN_DAYS,
    criticalDays: DEFAULT_CRITICAL_DAYS,
  },
): PreExpiryVerdict {
  if (thresholds.criticalDays > thresholds.warnDays) {
    throw new Error(`${ISSUE_ID}: criticalDays must be <= warnDays`);
  }

  const remaining = report.forwardDaysRemaining;
  let level: CoverageLevel = 'OK';
  if (remaining <= thresholds.criticalDays) {
    level = 'CRITICAL';
  } else if (remaining <= thresholds.warnDays) {
    level = 'WARNING';
  }

  const covered = report.coveredThroughDay ?? 'NONE';
  const message =
    level === 'OK'
      ? `${PARTITION_PARENT} forward coverage OK: ${remaining} day(s) remaining, covered through ${covered}.`
      : `${PARTITION_PARENT} forward coverage ${level}: only ${remaining} day(s) remaining ` +
        `(covered through ${covered}; warn<=${thresholds.warnDays}, critical<=${thresholds.criticalDays}). ` +
        `There is no DEFAULT partition, so ingestion fails closed once coverage runs out.`;

  return { level, forwardDaysRemaining: remaining, thresholds, message };
}

/**
 * Emits the DDL that would close the gap. This function returns text; it does
 * not execute anything. Applying it to production is a separate approved step.
 */
export function buildProvisioningSql(fromDay: string, throughDay: string): string {
  if (throughDay < fromDay) {
    throw new Error(`${ISSUE_ID}: throughDay must be >= fromDay`);
  }
  return [
    `-- ${ISSUE_ID}: provision ${PARTITION_PARENT} daily partitions ${fromDay}..${throughDay}`,
    `-- Lean index shape (parent-inherited only). No DEFAULT partition.`,
    `DO $$`,
    `DECLARE d date; v_name text;`,
    `BEGIN`,
    `  FOR d IN SELECT gs::date FROM generate_series(DATE '${fromDay}', DATE '${throughDay}', INTERVAL '1 day') gs`,
    `  LOOP`,
    `    v_name := format('${PARTITION_PARENT}_p%s', to_char(d, 'YYYYMMDD'));`,
    `    IF to_regclass('public.' || v_name) IS NOT NULL THEN CONTINUE; END IF;`,
    `    EXECUTE format('CREATE TABLE public.%I PARTITION OF public.${PARTITION_PARENT} FOR VALUES FROM (%L) TO (%L)',`,
    `      v_name, d::timestamptz, (d + 1)::timestamptz);`,
    `  END LOOP;`,
    `END; $$;`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Operations sink
// ---------------------------------------------------------------------------

export interface SystemRunSink {
  startRun(input: {
    runType: string;
    actor?: string | undefined;
    details: Record<string, unknown>;
  }): Promise<{ id: string }>;
  completeRun(input: {
    runId: string;
    status: 'succeeded' | 'failed' | 'cancelled';
    details?: Record<string, unknown> | undefined;
  }): Promise<unknown>;
}

export interface AuditSink {
  record(input: {
    entityType: string;
    entityRef?: string | null | undefined;
    action: string;
    actor?: string | undefined;
    payload: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface CoverageCheckOptions {
  listPartitionDays: () => Promise<readonly string[]>;
  runs: SystemRunSink;
  audit: AuditSink;
  now?: Date | undefined;
  thresholds?: CoverageThresholds | undefined;
  actor?: string | undefined;
}

export interface CoverageCheckResult {
  report: CoverageReport;
  verdict: PreExpiryVerdict;
  runId: string;
  sinkWrites: { systemRun: boolean; auditLog: boolean };
}

/**
 * The one entry point that reaches the real sink. A pre-expiry condition is not
 * considered detected until BOTH a system_runs row and an immutable audit_log
 * receipt exist — a predicate that only returns a value has alerted nobody.
 */
export async function runPartitionCoverageCheck(
  options: CoverageCheckOptions,
): Promise<CoverageCheckResult> {
  const now = options.now ?? new Date();
  const today = toDayString(now);
  const actor = options.actor ?? `${ISSUE_ID}:partition-provisioner`;

  const run = await options.runs.startRun({
    runType: RUN_TYPE,
    actor,
    details: { issue_id: ISSUE_ID, parent: PARTITION_PARENT, today },
  });

  const existingPartitionDays = await options.listPartitionDays();
  const report = computeCoverage({ existingPartitionDays, today });
  const verdict = evaluatePreExpiry(report, options.thresholds);

  const payload: Record<string, unknown> = {
    issue_id: ISSUE_ID,
    parent: PARTITION_PARENT,
    level: verdict.level,
    message: verdict.message,
    today,
    covered_through_day: report.coveredThroughDay,
    forward_days_remaining: report.forwardDaysRemaining,
    missing_days: report.missingDays,
    total_partitions: report.totalPartitions,
    thresholds: verdict.thresholds,
    run_id: run.id,
  };

  await options.audit.record({
    entityType: AUDIT_ENTITY_TYPE,
    entityRef: PARTITION_PARENT,
    action: `partition_coverage.${verdict.level.toLowerCase()}`,
    actor,
    payload,
  });

  await options.runs.completeRun({
    runId: run.id,
    // A CRITICAL coverage verdict is an operational failure, and the run row
    // must say so: a 'succeeded' run carrying a critical payload is exactly the
    // aggregate-status conflation that hides incidents.
    status: verdict.level === 'CRITICAL' ? 'failed' : 'succeeded',
    details: payload,
  });

  return {
    report,
    verdict,
    runId: run.id,
    sinkWrites: { systemRun: true, auditLog: true },
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const emitSql = argv.includes('--emit-sql');

  const { loadEnvironment } = await import('@unit-talk/config');
  const { createDatabaseRepositoryBundle, createServiceRoleDatabaseConnectionConfig } =
    await import('@unit-talk/db');
  const { createPrivilegedClient } = await import('@unit-talk/db/privileged-client-boundary');

  const environment = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(environment);
  const repositories = createDatabaseRepositoryBundle(connection);
  const db = createPrivilegedClient(
    environment.SUPABASE_URL as string,
    environment.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false } },
  );

  const result = await runPartitionCoverageCheck({
    listPartitionDays: async () => {
      const response = await db.rpc('list_provider_offer_history_partition_days');
      if (response.error) {
        throw new Error(`${ISSUE_ID}: partition listing failed: ${response.error.message}`);
      }
      return ((response.data ?? []) as { partition_day: string }[]).map((row) => row.partition_day);
    },
    runs: repositories.runs,
    audit: repositories.audit,
  });

  console.log(JSON.stringify({ ok: result.verdict.level !== 'CRITICAL', ...result }, null, 2));

  if (emitSql && result.report.forwardDaysRemaining >= 0) {
    const from = result.report.coveredThroughDay
      ? addDays(result.report.coveredThroughDay, 1)
      : result.report.today;
    console.log(buildProvisioningSql(from, addDays(from, 89)));
  }

  return result.verdict.level === 'CRITICAL' ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
