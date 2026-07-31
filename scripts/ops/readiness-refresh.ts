#!/usr/bin/env tsx
/**
 * UTV2-1626 — the readiness ledger generator.
 *
 * ## Why this file exists
 *
 * `docs/06_status/readiness/readiness-score.json` is the input to the Readiness
 * Regression Gate that runs on every pull request. Until this lane there was no
 * generator for it: `readiness-refresh.yml` only opened a GitHub issue when the
 * file got old, and the file itself was written by hand during a lane. Twenty-six
 * consecutive "successful" scheduled runs later, the ledger was 13 days stale and
 * every pull request was red for a production condition nobody could confirm was
 * still true.
 *
 * A gate whose input is never re-measured is worse than no gate: a real regression
 * and a forgotten artifact look identical, so every lane learns to ignore both.
 *
 * ## The contract this generator holds
 *
 * 1. Every dimension is MEASURED. Nothing is defaulted, assumed, or carried
 *    forward from the previous ledger — the previous file is never read here.
 * 2. A dimension that cannot be measured is recorded as `unknown` with the reason,
 *    and `unknown` is never scored as passing (see {@link computeVerdict}).
 * 3. Every dimension records WHEN (`observed_at`) and HOW (`method`) it was
 *    measured, so staleness is detectable per dimension, not only per file.
 * 4. Reads are READ-ONLY and, for database dimensions, only against the canonical
 *    production project. A measurement taken against staging would be a false
 *    production ledger, so a non-production target yields `unknown`, not a value.
 *
 * ## Read-only guarantee
 *
 * The only database surface in this file is {@link ReadOnlyDb}, whose two methods
 * issue `select` reads. There is no insert/update/upsert/delete/rpc path to reach,
 * and `readiness-refresh.test.ts` scans this source to keep it that way.
 *
 * Usage:
 *   pnpm ops:readiness-refresh                 # measure and write the canonical ledger
 *   pnpm ops:readiness-refresh -- --json       # also print the ledger to stdout
 *   pnpm ops:readiness-refresh -- --out /tmp/x # write elsewhere (never the canonical file)
 *
 * Exit codes:
 *   0 — a ledger was measured and written
 *   1 — the ledger could not be written (nothing was persisted; caller must fail)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPrivilegedClient } from '@unit-talk/db/privileged-client-boundary';
import {
  CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
  extractProjectRefFromUrl,
} from '../ci/isolated-proof-attestation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** The one path the Readiness Regression Gate reads. */
export const CANONICAL_LEDGER_PATH = 'docs/06_status/readiness/readiness-score.json';

export const READINESS_LEDGER_SCHEMA_VERSION = 2;

/**
 * Bumped whenever measurement semantics change, so a ledger can be attributed to
 * the code that produced it rather than to "some earlier version of the script".
 */
export const GENERATOR_VERSION = '1.0.0';

/**
 * Freshness contract. The refresher runs every 6h; `max_age_hours` is the SLA an
 * alert fires on, `hard_stale_hours` is where the pull-request gate stops trusting
 * the ledger at all.
 */
export const FRESHNESS_CONTRACT = {
  max_age_hours: 24,
  hard_stale_hours: 48,
} as const;

/** Measurement thresholds. Every one is stated in the dimension evidence too. */
export const THRESHOLDS = {
  ingestorCycleMaxMinutes: 30,
  ingestorOfferMaxMinutes: 30,
  workerHeartbeatMaxMinutes: 30,
  outboxStaleProcessingMinutes: 5,
  outboxStalePendingMinutes: 30,
  dbTripwireMaxHours: 12,
  ciRunMaxHours: 24,
  scheduledObserverMaxHours: 26,
  proofCoverageWindowDays: 30,
} as const;

/**
 * Scheduled observers whose own health is measured (issue §3). These are the jobs
 * that are supposed to notice production problems; when one of them is failing,
 * the correct reading is "we are not observing", which is a different condition
 * from "production is broken".
 */
export const SCHEDULED_OBSERVERS = [
  'ingestor-staleness-alert.yml',
  'grading-staleness-check.yml',
  'pipeline-health-monitor.yml',
  'db-health-tripwire.yml',
  'reconcile-stale-lanes.yml',
] as const;

export const QUEUE_SEMANTICS_VERSION = '1.0';
export const QUEUE_SEMANTICS_DOC = 'docs/05_operations/QUEUE_READINESS_SEMANTICS.md';

// ── Ledger shape ─────────────────────────────────────────────────────────────

export type DimensionStatus = 'pass' | 'fail' | 'unknown';
export type MethodKind = 'supabase_read' | 'github_api' | 'repo_scan' | 'not_measurable';
export type Verdict = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
export type Observability = 'complete' | 'degraded';

export interface MeasurementMethod {
  kind: MethodKind;
  /** Where the reading came from, identity only — never a credential. */
  source: string;
  /** The exact read performed, specific enough to re-run by hand. */
  query: string;
}

export interface ReadinessDimension {
  id: string;
  title: string;
  blocking: boolean;
  status: DimensionStatus;
  /** When THIS dimension was read. Null only when it could not be read at all. */
  observed_at: string | null;
  method: MeasurementMethod;
  evidence: string;
  /** Raw observed values, so a reader can recompute the verdict from the data. */
  measured: Record<string, unknown> | null;
  unreadable_reason: string | null;
}

export interface ReadinessLedger {
  schema_version: number;
  generated_at: string;
  observation_window: { started_at: string; completed_at: string };
  generator: {
    script: string;
    generator_version: string;
    git_head_sha: string | null;
    run_url: string | null;
  };
  freshness: { max_age_hours: number; hard_stale_hours: number };
  target: {
    supabase_project_ref: string | null;
    expected_production_project_ref: string;
    production_target_confirmed: boolean;
  };
  main_sha: string | null;
  deployed_sha: string | null;
  verdict: Verdict;
  observability: Observability;
  dimensions: ReadinessDimension[];
  blockers: string[];
  unreadable: string[];
  open_gap_count: number;
  queue_semantics_version: string;
  queue_semantics_doc: string;
}

// ── Reader interfaces (injected, so probes are testable without network) ──────

export interface DbFilter {
  column: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt';
  value: string | number;
}

export interface ReadOnlyDb {
  projectRef: string;
  latestRow(
    table: string,
    columns: string,
    filters: DbFilter[],
    orderColumn: string,
  ): Promise<Record<string, unknown> | null>;
  countRows(table: string, filters: DbFilter[]): Promise<number>;
}

export interface WorkflowRun {
  id: number;
  head_sha: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface GithubReader {
  repo: string;
  /**
   * Names of the steps that failed in a run. This is what separates "the observer
   * ran and reported a problem" from "the observer could not run" — a distinction
   * a run-level conclusion of "failure" cannot make on its own.
   */
  failedSteps(runId: number): Promise<string[]>;
  headSha(branch: string): Promise<string>;
  latestRun(workflowFile: string, options?: { branch?: string; status?: string }): Promise<WorkflowRun | null>;
  commitsBetween(base: string, head: string): Promise<number | null>;
}

export interface ProbeContext {
  now: Date;
  db: ReadOnlyDb | null;
  dbUnavailableReason: string | null;
  github: GithubReader | null;
  githubUnavailableReason: string | null;
  repoRoot: string;
}

// ── Small helpers ────────────────────────────────────────────────────────────

export function minutesBetween(from: string, to: Date): number {
  return Math.round((to.getTime() - new Date(from).getTime()) / 60_000);
}

export function hoursBetween(from: string, to: Date): number {
  return Math.round(((to.getTime() - new Date(from).getTime()) / 3_600_000) * 10) / 10;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unreadable(
  base: Pick<ReadinessDimension, 'id' | 'title' | 'blocking' | 'method'>,
  reason: string,
  now: Date,
): ReadinessDimension {
  return {
    ...base,
    status: 'unknown',
    // The attempt happened now even though it produced no reading; recording it
    // keeps "we tried and could not see" distinguishable from "never ran".
    observed_at: now.toISOString(),
    evidence: `UNREADABLE at ${now.toISOString()}: ${reason}. Not scored as passing.`,
    measured: null,
    unreadable_reason: reason,
  };
}

function requireDb(ctx: ProbeContext): ReadOnlyDb {
  if (!ctx.db) {
    throw new Error(
      ctx.dbUnavailableReason ?? 'no read-only production database handle was available',
    );
  }
  return ctx.db;
}

function requireGithub(ctx: ProbeContext): GithubReader {
  if (!ctx.github) {
    throw new Error(ctx.githubUnavailableReason ?? 'no GitHub API reader was available');
  }
  return ctx.github;
}

// ── Verdict computation (pure) ───────────────────────────────────────────────

/**
 * RED beats UNKNOWN: a blocking dimension measured as failing means production IS
 * red, whatever else could not be read. UNKNOWN beats GREEN: an unread blocking
 * dimension can never be scored as passing — that is the whole fail-closed rule.
 */
export function computeVerdict(dimensions: ReadinessDimension[]): Verdict {
  const blocking = dimensions.filter((dimension) => dimension.blocking);
  if (blocking.some((dimension) => dimension.status === 'fail')) return 'RED';
  if (blocking.some((dimension) => dimension.status === 'unknown')) return 'UNKNOWN';
  if (dimensions.some((dimension) => dimension.status !== 'pass')) return 'YELLOW';
  return 'GREEN';
}

/**
 * Observer health, reported separately from the product condition: a ledger can be
 * a trustworthy RED (everything read, something is broken) or an untrustworthy
 * anything (a reading failed). Collapsing the two is the defect this lane fixes.
 */
export function computeObservability(dimensions: ReadinessDimension[]): Observability {
  return dimensions.some((dimension) => dimension.status === 'unknown') ? 'degraded' : 'complete';
}

// ── Probes ───────────────────────────────────────────────────────────────────

export async function probeDeploySha(ctx: ProbeContext): Promise<ReadinessDimension> {
  const base = {
    id: 'deploy_sha_alignment',
    title: 'Production SHA matches main HEAD',
    blocking: true,
    method: {
      kind: 'github_api' as const,
      source: 'github:actions/runs',
      query:
        'latest successful run of deploy.yml on main (head_sha) vs commits/main (sha); ' +
        'compare base...head for commit distance',
    },
  };

  try {
    const github = requireGithub(ctx);
    const [mainSha, deployRun] = await Promise.all([
      github.headSha('main'),
      github.latestRun('deploy.yml', { branch: 'main', status: 'success' }),
    ]);

    if (!deployRun) {
      return {
        ...base,
        status: 'fail',
        observed_at: ctx.now.toISOString(),
        evidence: `No successful deploy.yml run exists on main. main HEAD is ${mainSha}; nothing has been proven deployed.`,
        measured: { main_sha: mainSha, deployed_sha: null, successful_deploy_runs: 0 },
        unreadable_reason: null,
      };
    }

    const aligned = deployRun.head_sha === mainSha;
    const behind = aligned ? 0 : await github.commitsBetween(deployRun.head_sha, mainSha);
    const ageHours = hoursBetween(deployRun.updated_at, ctx.now);

    return {
      ...base,
      status: aligned ? 'pass' : 'fail',
      observed_at: ctx.now.toISOString(),
      evidence: aligned
        ? `Last successful deploy (${deployRun.html_url}, ${deployRun.updated_at}) shipped ${deployRun.head_sha}, which is main HEAD.`
        : `Last successful deploy (${deployRun.html_url}, ${deployRun.updated_at}, ${ageHours}h ago) shipped ${deployRun.head_sha}; main HEAD is ${mainSha}` +
          (behind === null ? ' (commit distance unreadable).' : `, ${behind} commits ahead.`),
      measured: {
        main_sha: mainSha,
        deployed_sha: deployRun.head_sha,
        deploy_run_url: deployRun.html_url,
        deploy_run_completed_at: deployRun.updated_at,
        deploy_age_hours: ageHours,
        commits_ahead: behind,
      },
      unreadable_reason: null,
    };
  } catch (error) {
    return unreadable(base, errorMessage(error), ctx.now);
  }
}

export async function probeIngestorHealth(ctx: ProbeContext): Promise<ReadinessDimension> {
  const base = {
    id: 'ingestor_health',
    title: `Ingestor cycled successfully within ${THRESHOLDS.ingestorCycleMaxMinutes} minutes`,
    blocking: true,
    method: {
      kind: 'supabase_read' as const,
      source: `supabase:${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF}`,
      query:
        "system_runs where run_type='ingestor.cycle' order by started_at desc limit 1; " +
        "provider_cycle_status where stage_status='merged' order by updated_at desc limit 1; " +
        'game_results order by created_at desc limit 1',
    },
  };

  try {
    const db = requireDb(ctx);
    const [cycle, merged, result] = await Promise.all([
      db.latestRow(
        'system_runs',
        'status, started_at',
        [{ column: 'run_type', op: 'eq', value: 'ingestor.cycle' }],
        'started_at',
      ),
      db.latestRow(
        'provider_cycle_status',
        'updated_at, provider_key, league, freshness_status',
        [{ column: 'stage_status', op: 'eq', value: 'merged' }],
        'updated_at',
      ),
      db.latestRow('game_results', 'created_at', [], 'created_at'),
    ]);

    const cycleStartedAt = typeof cycle?.['started_at'] === 'string' ? (cycle['started_at'] as string) : null;
    const cycleStatus = typeof cycle?.['status'] === 'string' ? (cycle['status'] as string) : null;
    const mergedAt = typeof merged?.['updated_at'] === 'string' ? (merged['updated_at'] as string) : null;
    const resultAt = typeof result?.['created_at'] === 'string' ? (result['created_at'] as string) : null;

    const cycleAge = cycleStartedAt ? minutesBetween(cycleStartedAt, ctx.now) : null;
    const offerAge = mergedAt ? minutesBetween(mergedAt, ctx.now) : null;

    const failures: string[] = [];
    if (cycleAge === null) failures.push('no ingestor.cycle row exists');
    else if (cycleAge > THRESHOLDS.ingestorCycleMaxMinutes)
      failures.push(`latest ingestor.cycle started ${cycleStartedAt} (${cycleAge}m old, threshold ${THRESHOLDS.ingestorCycleMaxMinutes}m)`);
    if (cycleStatus && cycleStatus !== 'success' && cycleStatus !== 'completed')
      failures.push(`latest ingestor.cycle status is "${cycleStatus}"`);
    if (offerAge === null) failures.push('no merged provider_cycle_status row exists');
    else if (offerAge > THRESHOLDS.ingestorOfferMaxMinutes)
      failures.push(`latest merged provider cycle updated ${mergedAt} (${offerAge}m old, threshold ${THRESHOLDS.ingestorOfferMaxMinutes}m)`);

    return {
      ...base,
      status: failures.length === 0 ? 'pass' : 'fail',
      observed_at: ctx.now.toISOString(),
      evidence:
        failures.length === 0
          ? `Latest ingestor.cycle started ${cycleStartedAt} (${cycleAge}m, status ${cycleStatus}); latest merged provider cycle ${mergedAt} (${offerAge}m); latest game_results row ${resultAt}.`
          : `${failures.join('; ')}. Latest game_results row: ${resultAt ?? 'none'}. Read-only observation; no restart or mutation performed.`,
      measured: {
        latest_cycle_started_at: cycleStartedAt,
        latest_cycle_status: cycleStatus,
        latest_cycle_age_minutes: cycleAge,
        latest_merged_cycle_at: mergedAt,
        latest_merged_cycle_age_minutes: offerAge,
        latest_game_result_at: resultAt,
      },
      unreadable_reason: null,
    };
  } catch (error) {
    return unreadable(base, errorMessage(error), ctx.now);
  }
}

export async function probeWorkerOutboxHealth(ctx: ProbeContext): Promise<ReadinessDimension> {
  const base = {
    id: 'worker_outbox_health',
    title: 'Worker heartbeat current and no stuck outbox rows',
    blocking: true,
    method: {
      kind: 'supabase_read' as const,
      source: `supabase:${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF}`,
      query:
        "system_runs where run_type='worker.heartbeat' order by started_at desc limit 1; " +
        "count distribution_outbox where status='processing' and updated_at < now-5m; " +
        "count distribution_outbox where status='pending' and attempt_count>0 and updated_at < now-30m; " +
        "count distribution_outbox where status in ('pending','processing')",
    },
  };

  try {
    const db = requireDb(ctx);
    const staleProcessingBefore = new Date(
      ctx.now.getTime() - THRESHOLDS.outboxStaleProcessingMinutes * 60_000,
    ).toISOString();
    const stalePendingBefore = new Date(
      ctx.now.getTime() - THRESHOLDS.outboxStalePendingMinutes * 60_000,
    ).toISOString();

    const [heartbeat, pending, processing, staleUnknown, stuckRetryable] = await Promise.all([
      db.latestRow(
        'system_runs',
        'status, started_at',
        [{ column: 'run_type', op: 'eq', value: 'worker.heartbeat' }],
        'started_at',
      ),
      db.countRows('distribution_outbox', [{ column: 'status', op: 'eq', value: 'pending' }]),
      db.countRows('distribution_outbox', [{ column: 'status', op: 'eq', value: 'processing' }]),
      // Bucket 5 (stale-unknown): processing past the expected processing window.
      db.countRows('distribution_outbox', [
        { column: 'status', op: 'eq', value: 'processing' },
        { column: 'updated_at', op: 'lt', value: staleProcessingBefore },
      ]),
      // Bucket 4 gone bad: attempted, still pending, past the retry window.
      db.countRows('distribution_outbox', [
        { column: 'status', op: 'eq', value: 'pending' },
        { column: 'attempt_count', op: 'gt', value: 0 },
        { column: 'updated_at', op: 'lt', value: stalePendingBefore },
      ]),
    ]);

    const heartbeatAt = typeof heartbeat?.['started_at'] === 'string' ? (heartbeat['started_at'] as string) : null;
    const heartbeatStatus = typeof heartbeat?.['status'] === 'string' ? (heartbeat['status'] as string) : null;
    const heartbeatAge = heartbeatAt ? minutesBetween(heartbeatAt, ctx.now) : null;

    const failures: string[] = [];
    if (heartbeatAge === null) failures.push('no worker.heartbeat row exists');
    else if (heartbeatAge > THRESHOLDS.workerHeartbeatMaxMinutes)
      failures.push(`worker.heartbeat is ${heartbeatAge}m old (threshold ${THRESHOLDS.workerHeartbeatMaxMinutes}m), last status "${heartbeatStatus}"`);
    if (staleUnknown > 0)
      failures.push(`${staleUnknown} bucket:stale_unknown rows (processing > ${THRESHOLDS.outboxStaleProcessingMinutes}m)`);
    if (stuckRetryable > 0)
      failures.push(`${stuckRetryable} attempted rows still pending after ${THRESHOLDS.outboxStalePendingMinutes}m`);

    return {
      ...base,
      status: failures.length === 0 ? 'pass' : 'fail',
      observed_at: ctx.now.toISOString(),
      evidence:
        `Queue buckets per ${QUEUE_SEMANTICS_DOC} v${QUEUE_SEMANTICS_VERSION}: pending=${pending}, processing=${processing}, ` +
        `stale_unknown=${staleUnknown}, attempted-and-stuck=${stuckRetryable}. ` +
        `worker.heartbeat ${heartbeatAt ?? 'none'} (${heartbeatAge ?? 'n/a'}m, status ${heartbeatStatus ?? 'n/a'}). ` +
        (failures.length === 0 ? 'No stuck rows.' : `FAIL: ${failures.join('; ')}.`),
      measured: {
        heartbeat_started_at: heartbeatAt,
        heartbeat_status: heartbeatStatus,
        heartbeat_age_minutes: heartbeatAge,
        pending_count: pending,
        processing_count: processing,
        stale_unknown_count: staleUnknown,
        stuck_retryable_count: stuckRetryable,
      },
      unreadable_reason: null,
    };
  } catch (error) {
    return unreadable(base, errorMessage(error), ctx.now);
  }
}

export async function probeDeadLetterCount(ctx: ProbeContext): Promise<ReadinessDimension> {
  const base = {
    id: 'dead_letter_count',
    title: 'Dead-letter queue: zero true delivery failures',
    blocking: true,
    method: {
      kind: 'supabase_read' as const,
      source: `supabase:${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF}`,
      query:
        "count distribution_outbox where status='dead_letter'; " +
        "count distribution_outbox where status='dead_letter' and attempt_count=0 (bucket:governance_hold); " +
        "count distribution_outbox where status='dead_letter' and attempt_count>0 (bucket:true_failure)",
    },
  };

  try {
    const db = requireDb(ctx);
    const [total, governanceHolds, trueFailures] = await Promise.all([
      db.countRows('distribution_outbox', [{ column: 'status', op: 'eq', value: 'dead_letter' }]),
      db.countRows('distribution_outbox', [
        { column: 'status', op: 'eq', value: 'dead_letter' },
        { column: 'attempt_count', op: 'eq', value: 0 },
      ]),
      db.countRows('distribution_outbox', [
        { column: 'status', op: 'eq', value: 'dead_letter' },
        { column: 'attempt_count', op: 'gt', value: 0 },
      ]),
    ]);

    return {
      ...base,
      status: trueFailures === 0 ? 'pass' : 'fail',
      observed_at: ctx.now.toISOString(),
      evidence:
        `${total} dead_letter rows: ${governanceHolds} bucket:governance_hold (attempt_count=0) + ` +
        `${trueFailures} bucket:true_failure (attempt_count>0). Governance holds do not fail readiness under ` +
        `${QUEUE_SEMANTICS_DOC} v${QUEUE_SEMANTICS_VERSION}; true delivery failures do.`,
      measured: {
        dead_letter_total: total,
        governance_hold_count: governanceHolds,
        true_failure_count: trueFailures,
      },
      unreadable_reason: null,
    };
  } catch (error) {
    return unreadable(base, errorMessage(error), ctx.now);
  }
}

export async function probeDbTripwires(ctx: ProbeContext): Promise<ReadinessDimension> {
  const base = {
    id: 'db_tripwires',
    title: 'No CRITICAL DB tripwires active',
    blocking: true,
    method: {
      kind: 'github_api' as const,
      source: 'github:actions/runs/db-health-tripwire.yml',
      query: 'latest completed run of db-health-tripwire.yml (conclusion, completed_at)',
    },
  };

  try {
    const github = requireGithub(ctx);
    const run = await github.latestRun('db-health-tripwire.yml');

    if (!run || run.status !== 'completed') {
      return unreadable(
        base,
        run
          ? `latest db-health-tripwire.yml run is ${run.status}, not completed`
          : 'no db-health-tripwire.yml run exists',
        ctx.now,
      );
    }

    const ageHours = hoursBetween(run.updated_at, ctx.now);
    if (ageHours > THRESHOLDS.dbTripwireMaxHours) {
      return unreadable(
        base,
        `latest db-health-tripwire.yml run finished ${run.updated_at} (${ageHours}h ago, max ${THRESHOLDS.dbTripwireMaxHours}h) — ` +
          'the observer is not current, so tripwire state cannot be read from it',
        ctx.now,
      );
    }

    if (run.conclusion === 'success') {
      return {
        ...base,
        status: 'pass',
        observed_at: ctx.now.toISOString(),
        evidence: `db-health-tripwire.yml run ${run.html_url} concluded success at ${run.updated_at} (${ageHours}h ago); no CRITICAL tripwire fired.`,
        measured: { run_url: run.html_url, conclusion: run.conclusion, completed_at: run.updated_at, age_hours: ageHours },
        unreadable_reason: null,
      };
    }

    // A red observer run is genuinely ambiguous from the outside: "the checks ran
    // and a tripwire fired" and "the observer could not run at all" both conclude
    // "failure". Verified on 2026-07-30 — run 30573430796 reports its failing step
    // as "Run DB health checks", which reads like a fired tripwire, while the log
    // shows exit 127: the step's `tsx` binary was not on PATH and no check ever
    // executed. A step-name heuristic would have published that as a production
    // DB failure. So a red observer yields `unknown`, with the failed steps
    // recorded — absence of tripwires is only provable from a green observer, and
    // a real tripwire is alerted by the observer's own workflow.
    const failedSteps = await github.failedSteps(run.id);
    return unreadable(
      base,
      `db-health-tripwire.yml run ${run.html_url} concluded "${run.conclusion}" (failed step(s): ${failedSteps.join(', ') || 'unreported'}) — ` +
        'a red observer cannot distinguish a fired tripwire from a broken observation, so tripwire state is unproven',
      ctx.now,
    );
  } catch (error) {
    return unreadable(base, errorMessage(error), ctx.now);
  }
}

export async function probeCiVerify(ctx: ProbeContext): Promise<ReadinessDimension> {
  const base = {
    id: 'pnpm_verify',
    title: 'CI verify green on main HEAD',
    blocking: false,
    method: {
      kind: 'github_api' as const,
      source: 'github:actions/runs/ci.yml',
      query: 'latest completed run of ci.yml on main (head_sha, conclusion) vs commits/main',
    },
  };

  try {
    const github = requireGithub(ctx);
    const [mainSha, run] = await Promise.all([
      github.headSha('main'),
      github.latestRun('ci.yml', { branch: 'main' }),
    ]);

    if (!run || run.status !== 'completed') {
      return unreadable(
        base,
        run ? `latest ci.yml run on main is ${run.status}` : 'no ci.yml run exists on main',
        ctx.now,
      );
    }

    const onHead = run.head_sha === mainSha;
    const ageHours = hoursBetween(run.updated_at, ctx.now);

    return {
      ...base,
      status: run.conclusion === 'success' && onHead ? 'pass' : 'fail',
      observed_at: ctx.now.toISOString(),
      evidence:
        `ci.yml run ${run.html_url} on ${run.head_sha} concluded "${run.conclusion}" at ${run.updated_at} (${ageHours}h ago). ` +
        (onHead ? 'That commit is main HEAD.' : `main HEAD is ${mainSha}, so main HEAD itself has no completed CI result.`),
      measured: {
        main_sha: mainSha,
        run_head_sha: run.head_sha,
        conclusion: run.conclusion,
        completed_at: run.updated_at,
        on_main_head: onHead,
      },
      unreadable_reason: null,
    };
  } catch (error) {
    return unreadable(base, errorMessage(error), ctx.now);
  }
}

export async function probeScheduledObservers(ctx: ProbeContext): Promise<ReadinessDimension> {
  const base = {
    id: 'scheduled_observer_health',
    title: 'Scheduled production observers are running and green',
    blocking: false,
    method: {
      kind: 'github_api' as const,
      source: 'github:actions/runs',
      query: `latest run of each of: ${SCHEDULED_OBSERVERS.join(', ')}`,
    },
  };

  try {
    const github = requireGithub(ctx);
    const observers = await Promise.all(
      SCHEDULED_OBSERVERS.map(async (workflow) => {
        const run = await github.latestRun(workflow);
        // The failed step names are what let a reader classify the failure —
        // "the alert fired" and "the alert could not run" both conclude "failure".
        const failedSteps =
          run && run.conclusion !== null && run.conclusion !== 'success'
            ? await github.failedSteps(run.id)
            : [];
        return {
          workflow,
          conclusion: run?.conclusion ?? null,
          completed_at: run?.updated_at ?? null,
          age_hours: run ? hoursBetween(run.updated_at, ctx.now) : null,
          run_url: run?.html_url ?? null,
          failed_steps: failedSteps,
        };
      }),
    );

    const failing = observers.filter((observer) => observer.conclusion !== null && observer.conclusion !== 'success');
    const missing = observers.filter((observer) => observer.conclusion === null);
    const stale = observers.filter(
      (observer) => observer.age_hours !== null && observer.age_hours > THRESHOLDS.scheduledObserverMaxHours,
    );

    const problems = [
      ...failing.map(
        (observer) =>
          `${observer.workflow} concluded "${observer.conclusion}"` +
          (observer.failed_steps.length > 0 ? ` (failed step: ${observer.failed_steps.join(', ')})` : ''),
      ),
      ...missing.map((observer) => `${observer.workflow} has no run`),
      ...stale.map((observer) => `${observer.workflow} last ran ${observer.age_hours}h ago`),
    ];

    return {
      ...base,
      status: problems.length === 0 ? 'pass' : 'fail',
      observed_at: ctx.now.toISOString(),
      evidence:
        problems.length === 0
          ? `All ${observers.length} scheduled observers ran within ${THRESHOLDS.scheduledObserverMaxHours}h and concluded success.`
          : `Observer problems (these are observer failures, not by themselves product failures): ${problems.join('; ')}.`,
      measured: { observers },
      unreadable_reason: null,
    };
  } catch (error) {
    return unreadable(base, errorMessage(error), ctx.now);
  }
}

/**
 * Merge-SHA binding coverage over lanes closed inside a rolling window. The window
 * exists because the binding convention post-dates many archived manifests;
 * scoring against all history would measure the convention's age, not today's
 * discipline.
 */
export function measureProofCoverage(
  repoRoot: string,
  now: Date,
  windowDays: number = THRESHOLDS.proofCoverageWindowDays,
): { considered: string[]; bound: string[]; unbound: string[] } {
  const lanesDir = path.join(repoRoot, 'docs', '06_status', 'lanes');
  const cutoff = new Date(now.getTime() - windowDays * 86_400_000);
  const considered: string[] = [];
  const bound: string[] = [];
  const unbound: string[] = [];

  const files = fs.existsSync(lanesDir)
    ? fs.readdirSync(lanesDir).filter((name) => name.endsWith('.json'))
    : [];

  for (const file of files) {
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(lanesDir, file), 'utf8')) as Record<string, unknown>;
    } catch {
      continue;
    }
    const status = manifest['status'];
    const closedAt = manifest['closed_at'];
    const issueId = manifest['issue_id'];
    if (status !== 'done' || typeof closedAt !== 'string' || typeof issueId !== 'string') continue;
    if (new Date(closedAt) < cutoff) continue;

    considered.push(issueId);
    const verification = path.join(repoRoot, 'docs', '06_status', 'proof', issueId, 'verification.md');
    const text = fs.existsSync(verification) ? fs.readFileSync(verification, 'utf8') : '';
    if (/merge[\s_-]*sha\D{0,20}[0-9a-f]{7,40}/i.test(text)) bound.push(issueId);
    else unbound.push(issueId);
  }

  return { considered, bound, unbound };
}

export async function probeProofCoverage(ctx: ProbeContext): Promise<ReadinessDimension> {
  const base = {
    id: 'proof_coverage',
    title: `Lanes closed in the last ${THRESHOLDS.proofCoverageWindowDays} days carry merge-SHA-bound proof`,
    blocking: false,
    method: {
      kind: 'repo_scan' as const,
      source: 'repo:docs/06_status/lanes + docs/06_status/proof',
      query: `manifests with status=done and closed_at within ${THRESHOLDS.proofCoverageWindowDays}d; verification.md must contain a merge SHA`,
    },
  };

  try {
    const coverage = measureProofCoverage(ctx.repoRoot, ctx.now);
    if (coverage.considered.length === 0) {
      return unreadable(
        base,
        `no lane closed within the last ${THRESHOLDS.proofCoverageWindowDays} days, so coverage has no sample to measure`,
        ctx.now,
      );
    }

    return {
      ...base,
      status: coverage.unbound.length === 0 ? 'pass' : 'fail',
      observed_at: ctx.now.toISOString(),
      evidence:
        `${coverage.bound.length}/${coverage.considered.length} lanes closed in the window carry a merge-SHA binding in verification.md` +
        (coverage.unbound.length > 0 ? `; unbound: ${coverage.unbound.join(', ')}.` : '.'),
      measured: {
        considered: coverage.considered.length,
        bound: coverage.bound.length,
        unbound: coverage.unbound,
      },
      unreadable_reason: null,
    };
  } catch (error) {
    return unreadable(base, errorMessage(error), ctx.now);
  }
}

/**
 * Kept as a named dimension because the readiness ledger has always carried it and
 * silently dropping it would look like the gap closed. There is no mechanical
 * measurement of constitutional convergence in this repo — `constitution:check`
 * proves structural preservation, not convergence percentage — so it is recorded
 * `unknown`, never `pass`.
 */
export async function probeConstitutionConvergence(ctx: ProbeContext): Promise<ReadinessDimension> {
  return unreadable(
    {
      id: 'constitution_convergence',
      title: 'Constitutional convergence >= 80%',
      blocking: false,
      method: {
        kind: 'not_measurable',
        source: 'none',
        query:
          'no mechanical convergence measurement exists; constitution:check proves artifact preservation and structure only',
      },
    },
    'convergence percentage has no generator in this repo — previous ledgers carried a hand-entered "~68%", which this generator refuses to reproduce as a measurement',
    ctx.now,
  );
}

export const PROBES = [
  probeDeploySha,
  probeIngestorHealth,
  probeWorkerOutboxHealth,
  probeDeadLetterCount,
  probeDbTripwires,
  probeCiVerify,
  probeScheduledObservers,
  probeProofCoverage,
  probeConstitutionConvergence,
] as const;

// ── Ledger assembly ──────────────────────────────────────────────────────────

export interface LedgerMeta {
  gitHeadSha: string | null;
  runUrl: string | null;
}

export async function collectLedger(ctx: ProbeContext, meta: LedgerMeta): Promise<ReadinessLedger> {
  const startedAt = ctx.now.toISOString();
  const dimensions: ReadinessDimension[] = [];
  for (const probe of PROBES) {
    dimensions.push(await probe(ctx));
  }
  const completedAt = new Date().toISOString();

  const deployDimension = dimensions.find((dimension) => dimension.id === 'deploy_sha_alignment');
  const mainSha = (deployDimension?.measured?.['main_sha'] as string | undefined) ?? null;
  const deployedSha = (deployDimension?.measured?.['deployed_sha'] as string | undefined) ?? null;

  return {
    schema_version: READINESS_LEDGER_SCHEMA_VERSION,
    generated_at: completedAt,
    observation_window: { started_at: startedAt, completed_at: completedAt },
    generator: {
      script: 'scripts/ops/readiness-refresh.ts',
      generator_version: GENERATOR_VERSION,
      git_head_sha: meta.gitHeadSha,
      run_url: meta.runUrl,
    },
    freshness: { ...FRESHNESS_CONTRACT },
    target: {
      supabase_project_ref: ctx.db?.projectRef ?? null,
      expected_production_project_ref: CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
      production_target_confirmed: ctx.db !== null,
    },
    main_sha: mainSha,
    deployed_sha: deployedSha,
    verdict: computeVerdict(dimensions),
    observability: computeObservability(dimensions),
    dimensions,
    blockers: dimensions.filter((d) => d.blocking && d.status === 'fail').map((d) => d.id),
    unreadable: dimensions.filter((d) => d.status === 'unknown').map((d) => d.id),
    open_gap_count: dimensions.filter((d) => d.status !== 'pass').length,
    queue_semantics_version: QUEUE_SEMANTICS_VERSION,
    queue_semantics_doc: QUEUE_SEMANTICS_DOC,
  };
}

// ── Real readers ─────────────────────────────────────────────────────────────

/** Minimal structural view of the supabase-js query builder — read paths only. */
interface QueryResult {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
  count?: number | null;
}
interface FilterBuilder extends PromiseLike<QueryResult> {
  eq(column: string, value: string | number): FilterBuilder;
  neq(column: string, value: string | number): FilterBuilder;
  gt(column: string, value: string | number): FilterBuilder;
  gte(column: string, value: string | number): FilterBuilder;
  lt(column: string, value: string | number): FilterBuilder;
  order(column: string, options: { ascending: boolean }): FilterBuilder;
  limit(count: number): FilterBuilder;
}
interface ReadOnlyClient {
  from(table: string): { select(columns: string, options?: { count?: 'exact'; head?: boolean }): FilterBuilder };
}

function applyFilters(builder: FilterBuilder, filters: DbFilter[]): FilterBuilder {
  return filters.reduce((query, filter) => {
    switch (filter.op) {
      case 'eq':
        return query.eq(filter.column, filter.value);
      case 'neq':
        return query.neq(filter.column, filter.value);
      case 'gt':
        return query.gt(filter.column, filter.value);
      case 'gte':
        return query.gte(filter.column, filter.value);
      case 'lt':
        return query.lt(filter.column, filter.value);
    }
  }, builder);
}

export function wrapReadOnlyClient(client: ReadOnlyClient, projectRef: string): ReadOnlyDb {
  return {
    projectRef,
    async latestRow(table, columns, filters, orderColumn) {
      const { data, error } = await applyFilters(client.from(table).select(columns), filters)
        .order(orderColumn, { ascending: false })
        .limit(1);
      if (error) throw new Error(`${table} read failed: ${error.message}`);
      return data?.[0] ?? null;
    },
    async countRows(table, filters) {
      const { count, error } = await applyFilters(
        client.from(table).select('id', { count: 'exact', head: true }),
        filters,
      );
      if (error) throw new Error(`${table} count failed: ${error.message}`);
      if (count === null || count === undefined) throw new Error(`${table} count returned no value`);
      return count;
    },
  };
}

/**
 * A production handle, or a stated reason there is none. A staging or unidentified
 * target never yields a handle: publishing a staging reading as production
 * readiness would be exactly the fabricated-measurement failure this lane exists
 * to prevent.
 */
export function resolveProductionDb(env: NodeJS.ProcessEnv): {
  db: ReadOnlyDb | null;
  reason: string | null;
} {
  const url = env['SUPABASE_URL'];
  const key = env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    return {
      db: null,
      reason:
        'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not present in this environment, so no production read was possible',
    };
  }
  const { projectRef, host } = extractProjectRefFromUrl(url);
  if (projectRef !== CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF) {
    return {
      db: null,
      reason:
        `resolved database target ${projectRef ?? `unidentified (host=${host ?? 'unparseable'})`} is not canonical production ` +
        `${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF}; a non-production reading is not a production readiness measurement`,
    };
  }
  // UTV2-1628: the driver is constructed at the boundary, not here. This call
  // site is already production-only by the check above, and the boundary refuses
  // production from a restricted context (node:test, staging-only policy) — which
  // is the correct outcome: a readiness measurement taken from inside the test
  // suite would not be a production readiness measurement either.
  const client = createPrivilegedClient(url, key, { auth: { persistSession: false } }, 'readiness-refresh production read') as unknown as ReadOnlyClient;
  return { db: wrapReadOnlyClient(client, projectRef), reason: null };
}

function ghApi(endpoint: string): unknown {
  const stdout = execFileSync('gh', ['api', endpoint], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(stdout) as unknown;
}

export function createGithubReader(): { github: GithubReader | null; reason: string | null } {
  try {
    const repo = execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
      encoding: 'utf8',
    }).trim();
    if (!repo) return { github: null, reason: 'gh could not resolve the current repository' };

    return {
      github: {
        repo,
        async headSha(branch) {
          const commit = ghApi(`repos/${repo}/commits/${branch}`) as { sha?: string };
          if (!commit.sha) throw new Error(`commits/${branch} returned no sha`);
          return commit.sha;
        },
        async latestRun(workflowFile, options = {}) {
          const params = new URLSearchParams({ per_page: '1' });
          if (options.branch) params.set('branch', options.branch);
          if (options.status) params.set('status', options.status);
          const response = ghApi(
            `repos/${repo}/actions/workflows/${workflowFile}/runs?${params.toString()}`,
          ) as { workflow_runs?: WorkflowRun[] };
          return response.workflow_runs?.[0] ?? null;
        },
        async failedSteps(runId) {
          const response = ghApi(`repos/${repo}/actions/runs/${runId}/jobs`) as {
            jobs?: { steps?: { name?: string; conclusion?: string | null }[] }[];
          };
          return (response.jobs ?? []).flatMap((job) =>
            (job.steps ?? [])
              .filter((step) => step.conclusion === 'failure')
              .map((step) => step.name ?? 'unnamed step'),
          );
        },
        async commitsBetween(baseSha, headSha) {
          try {
            const comparison = ghApi(`repos/${repo}/compare/${baseSha}...${headSha}`) as { ahead_by?: number };
            return typeof comparison.ahead_by === 'number' ? comparison.ahead_by : null;
          } catch {
            return null;
          }
        },
      },
      reason: null,
    };
  } catch (error) {
    return { github: null, reason: `gh CLI unavailable or unauthenticated: ${errorMessage(error)}` };
  }
}

function gitHeadSha(repoRoot: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export function formatSummary(ledger: ReadinessLedger): string {
  const lines = [
    `READINESS LEDGER — generated_at ${ledger.generated_at}`,
    `  verdict:       ${ledger.verdict}`,
    `  observability: ${ledger.observability}`,
    `  target:        ${ledger.target.supabase_project_ref ?? 'no production DB handle'}`,
    '',
  ];
  for (const dimension of ledger.dimensions) {
    const mark = dimension.status === 'pass' ? 'PASS' : dimension.status === 'fail' ? 'FAIL' : 'UNKN';
    lines.push(`  [${mark}] ${dimension.id}${dimension.blocking ? ' (blocking)' : ''}`);
    lines.push(`         ${dimension.evidence}`);
  }
  if (ledger.blockers.length > 0) lines.push('', `  blockers:  ${ledger.blockers.join(', ')}`);
  if (ledger.unreadable.length > 0) lines.push(`  unreadable: ${ledger.unreadable.join(', ')}`);
  return lines.join('\n');
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const outIndex = argv.indexOf('--out');
  const outPath = path.resolve(
    REPO_ROOT,
    outIndex >= 0 && argv[outIndex + 1] ? (argv[outIndex + 1] as string) : CANONICAL_LEDGER_PATH,
  );

  const { db, reason: dbReason } = resolveProductionDb(process.env);
  const { github, reason: githubReason } = createGithubReader();

  const ledger = await collectLedger(
    {
      now: new Date(),
      db,
      dbUnavailableReason: dbReason,
      github,
      githubUnavailableReason: githubReason,
      repoRoot: REPO_ROOT,
    },
    {
      gitHeadSha: gitHeadSha(REPO_ROOT),
      runUrl:
        process.env['GITHUB_SERVER_URL'] && process.env['GITHUB_REPOSITORY'] && process.env['GITHUB_RUN_ID']
          ? `${process.env['GITHUB_SERVER_URL']}/${process.env['GITHUB_REPOSITORY']}/actions/runs/${process.env['GITHUB_RUN_ID']}`
          : null,
    },
  );

  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.error(`[readiness-refresh] FAILED to persist ledger to ${outPath}: ${errorMessage(error)}`);
    return 1;
  }

  console.log(formatSummary(ledger));
  console.log(`\n[readiness-refresh] wrote ${path.relative(REPO_ROOT, outPath)}`);
  if (argv.includes('--json')) console.log(JSON.stringify(ledger, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`[readiness-refresh] unhandled error: ${errorMessage(error)}`);
      process.exit(1);
    },
  );
}
