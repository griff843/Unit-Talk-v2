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
import os from 'node:os';
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
export const GENERATOR_VERSION = '1.1.0';

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
  /**
   * How old the deploy-time runtime-mode observation may be and still be published
   * as a current reading. Pinned to GitHub's 30-day artifact retention, which is
   * the hard horizon of this evidence channel: past it the artifact is gone and
   * only a live host read (not provisioned) could refresh it.
   */
  runtimeModeObservationMaxHours: 720,
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
  /** Reruns are per-attempt: a downstream-only rerun advances this without re-deploying. */
  run_attempt?: number;
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
  /**
   * The single JSON file inside a run artifact, or a stated reason there is none.
   * "Not found" and "could not be fetched" both return `text: null` with the
   * reason recorded — neither is ever silently treated as "nothing happened".
   */
  downloadRunArtifact(runId: number, artifactName: string): Promise<ArtifactFetch>;
}

export interface ArtifactFetch {
  text: string | null;
  reason: string | null;
}

export interface ProbeContext {
  now: Date;
  db: ReadOnlyDb | null;
  dbUnavailableReason: string | null;
  github: GithubReader | null;
  githubUnavailableReason: string | null;
  repoRoot: string;
  /**
   * The desired-runtime-mode assessment for this observation, computed once by
   * {@link collectLedger} before any mode-conditional probe runs. Absent means
   * "not assessed" and is treated as unreadable — never as "assume active".
   */
  runtimeMode?: RuntimeModeAssessment | null;
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

// ── Desired runtime mode (UTV2-1667) ─────────────────────────────────────────

/**
 * ## Why every dimension needs a declared desired mode
 *
 * Readiness used to score production as if it were always *supposed* to be
 * running. It is not. `deploy.yml` deploys one of two machines: `active`, or
 * `parked` — and in parked mode the ingestor's autorun, its scheduler, the
 * worker's autorun and the API's own schedulers are all deliberately off, and
 * `UNIT_TALK_ENABLED_TARGETS` is forced to `none` so public delivery is
 * impossible (`.github/workflows/deploy.yml`, the "Write .env.production to
 * server" and "Confirm syndicate machine gate" steps).
 *
 * Against that machine, "no ingestor cycle in 30 minutes" is not a failure — it
 * is the contract being honoured. But scoring it `pass` because "nothing is
 * broken" is worse: it turns a deliberately-stopped production into a green
 * ledger. Both readings collapse two different facts ("what was production asked
 * to be" and "what is production doing") into one verdict.
 *
 * So each service is classified into exactly one of six states against the mode
 * its deploy declared:
 *
 * | state             | meaning                                                        |
 * |-------------------|----------------------------------------------------------------|
 * | `active_healthy`  | declared active, runtime contract verified, activity current     |
 * | `active_degraded` | declared active, contract verified, some activity signal short   |
 * | `active_failed`   | declared active, but the contract or the core activity is dead   |
 * | `parked_verified` | declared parked, contract verified, and provably silent since    |
 * | `parked_drift`    | declared parked, but something moved or a parked value differs   |
 * | `unreadable`      | the declaration, the runtime values, or the activity is unproven |
 *
 * `parked_verified` is never reported as ordinary health, and it never produces
 * the failure an unexpectedly dead *active* service produces. `parked_drift` is
 * always a hard failure. `unreadable` is never scored as passing.
 *
 * ## Where the declaration comes from, and why not from here
 *
 * The desired mode is a protected production secret (`SYNDICATE_MACHINE_ENABLED`,
 * readable only by `deploy.yml`'s `production`-environment jobs). This script
 * cannot read it and must never infer it. Instead the promote job — which already
 * proves, per service, the exact running container's compose project, image tag
 * and effective process environment via `docker compose exec` *and* an
 * independent `docker inspect`, and re-reads the public kill switches — publishes
 * that finished proof as a `runtime-mode-receipt/v1` artifact bound to its own
 * `(run_id, run_attempt, stage)`. This script reads that receipt and nothing else
 * for the declaration.
 *
 * The receipt is written only after every one of those assertions has already
 * passed, so a lost receipt degrades the reading to `unreadable`, never to a
 * false `parked_verified` — the loss window only ever fails closed.
 *
 * ## The phase-1 limitation, stated rather than hidden
 *
 * The receipt proves the container state at `observed_at`. Proving it *right now*
 * needs a live read of the deploy host (§12a of
 * `docs/05_operations/DEPLOYMENT_TRUTH_DESIGN.md`), whose observer account,
 * root-owned forced-command wrapper and pinned host keys are not provisioned and
 * not authorised here. So an out-of-band container replacement made after
 * `observed_at` is not detectable by this dimension — the same accepted phase-1
 * limitation the design document records in regression-matrix row 16. It is named
 * in this dimension's own evidence text on every run, never left implicit, and
 * every reading that depends on host observation this script cannot make is
 * reported `unreadable` rather than guessed.
 */
export type DeclaredRuntimeMode = 'active' | 'parked';

export type ServiceRuntimeState =
  | 'active_healthy'
  | 'active_degraded'
  | 'active_failed'
  | 'parked_verified'
  | 'parked_drift'
  | 'unreadable';

/** The services whose desired-mode contract `deploy.yml` declares and verifies. */
export const RUNTIME_MODE_SERVICES = ['api', 'ingestor', 'worker'] as const;
export type RuntimeModeService = (typeof RUNTIME_MODE_SERVICES)[number];

export const RUNTIME_MODE_RECEIPT_SCHEMA = 'runtime-mode-receipt/v1';
export const RUNTIME_MODE_RECEIPT_FILE = 'runtime-mode-receipt.json';

/** Bound to `(run_id, run_attempt)` so a downstream-only rerun cannot borrow an older attempt's proof. */
export function runtimeModeReceiptArtifactName(runId: number, runAttempt: number): string {
  return `runtime-mode-receipt-${runId}-${runAttempt}`;
}

/** The public, Discord-facing delivery targets whose kill switches parked mode requires engaged. */
export const PUBLIC_DELIVERY_TARGETS = ['best-bets', 'trader-insights'] as const;

/**
 * The per-service environment contract each mode must resolve to, mirroring
 * `deploy.yml`'s own `case "$SYNDICATE_MACHINE_MODE"` mapping. Active mode
 * deliberately does not constrain `UNIT_TALK_ENABLED_TARGETS`: its value varies
 * legitimately with the `UNIT_TALK_ENABLED_TARGETS` secret, which is exactly why
 * `deploy.yml` asserts that variable in parked mode only.
 */
export const RUNTIME_MODE_ENV_CONTRACT: Record<
  DeclaredRuntimeMode,
  Record<RuntimeModeService, Record<string, string>>
> = {
  active: {
    api: { SYNDICATE_MACHINE_ENABLED: 'true' },
    ingestor: { UNIT_TALK_INGESTOR_AUTORUN: 'true', UNIT_TALK_INGESTOR_SCHEDULING_ENABLED: 'true' },
    worker: { UNIT_TALK_WORKER_AUTORUN: 'true' },
  },
  parked: {
    api: { SYNDICATE_MACHINE_ENABLED: 'false' },
    ingestor: { UNIT_TALK_INGESTOR_AUTORUN: 'false', UNIT_TALK_INGESTOR_SCHEDULING_ENABLED: 'false' },
    worker: { UNIT_TALK_WORKER_AUTORUN: 'false', UNIT_TALK_ENABLED_TARGETS: 'none' },
  },
};

export interface RuntimeModeReceiptService {
  service: string;
  image: string;
  env: Record<string, string>;
}

export interface RuntimeModeReceiptKillSwitch {
  target: string;
  killed: boolean;
}

export interface RuntimeModeReceipt {
  schema: string;
  run_id: number;
  run_attempt: number;
  stage: string;
  declared_mode: DeclaredRuntimeMode;
  source_sha: string;
  deployed_tag: string;
  compose_project: string;
  observed_at: string;
  services: RuntimeModeReceiptService[];
  kill_switch: RuntimeModeReceiptKillSwitch[];
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) return Number(value);
  return null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Strict, fail-closed. A receipt that is truncated, schema-mismatched, missing a
 * field, or carrying an unrecognised mode is rejected with the reason — never
 * partially honoured and never defaulted, because every one of those shapes is a
 * plausible result of an interrupted write.
 */
export function parseRuntimeModeReceipt(text: string): {
  receipt: RuntimeModeReceipt | null;
  reason: string | null;
} {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    return { receipt: null, reason: `receipt is not valid JSON: ${errorMessage(error)}` };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { receipt: null, reason: 'receipt is not a JSON object' };
  }
  const record = raw as Record<string, unknown>;

  if (record['schema'] !== RUNTIME_MODE_RECEIPT_SCHEMA) {
    return {
      receipt: null,
      reason: `receipt schema is ${JSON.stringify(record['schema'])}, expected "${RUNTIME_MODE_RECEIPT_SCHEMA}"`,
    };
  }

  const runId = asPositiveInt(record['run_id']);
  const runAttempt = asPositiveInt(record['run_attempt']);
  if (runId === null || runAttempt === null) {
    return { receipt: null, reason: 'receipt is not bound to a positive integer (run_id, run_attempt)' };
  }

  const stage = asNonEmptyString(record['stage']);
  if (stage === null) return { receipt: null, reason: 'receipt records no stage' };

  const declaredMode = record['declared_mode'];
  if (declaredMode !== 'active' && declaredMode !== 'parked') {
    return {
      receipt: null,
      reason: `receipt declares mode ${JSON.stringify(declaredMode)}, which is neither "active" nor "parked"`,
    };
  }

  const sourceSha = asNonEmptyString(record['source_sha']);
  const deployedTag = asNonEmptyString(record['deployed_tag']);
  const composeProject = asNonEmptyString(record['compose_project']);
  const observedAt = asNonEmptyString(record['observed_at']);
  if (sourceSha === null) return { receipt: null, reason: 'receipt records no source_sha' };
  if (deployedTag === null) return { receipt: null, reason: 'receipt records no deployed_tag' };
  if (composeProject === null) return { receipt: null, reason: 'receipt records no compose_project' };
  if (observedAt === null || Number.isNaN(new Date(observedAt).getTime())) {
    return { receipt: null, reason: 'receipt records no parseable observed_at timestamp' };
  }

  const rawServices = record['services'];
  if (!Array.isArray(rawServices) || rawServices.length === 0) {
    return { receipt: null, reason: 'receipt records no services' };
  }
  const services: RuntimeModeReceiptService[] = [];
  for (const entry of rawServices) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { receipt: null, reason: 'receipt contains a service entry that is not an object' };
    }
    const service = asNonEmptyString((entry as Record<string, unknown>)['service']);
    const image = asNonEmptyString((entry as Record<string, unknown>)['image']);
    const env = (entry as Record<string, unknown>)['env'];
    if (service === null) return { receipt: null, reason: 'receipt contains a service entry with no service name' };
    if (image === null) return { receipt: null, reason: `receipt records no running image for service ${service}` };
    if (!env || typeof env !== 'object' || Array.isArray(env)) {
      return { receipt: null, reason: `receipt records no environment map for service ${service}` };
    }
    const envMap: Record<string, string> = {};
    for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
      if (typeof value !== 'string') {
        return { receipt: null, reason: `receipt records a non-string value for ${service}.${key}` };
      }
      envMap[key] = value;
    }
    services.push({ service, image, env: envMap });
  }

  const rawKillSwitch = record['kill_switch'];
  if (!Array.isArray(rawKillSwitch)) {
    return { receipt: null, reason: 'receipt records no kill_switch observation' };
  }
  const killSwitch: RuntimeModeReceiptKillSwitch[] = [];
  for (const entry of rawKillSwitch) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { receipt: null, reason: 'receipt contains a kill_switch entry that is not an object' };
    }
    const target = asNonEmptyString((entry as Record<string, unknown>)['target']);
    const killed = (entry as Record<string, unknown>)['killed'];
    if (target === null) return { receipt: null, reason: 'receipt contains a kill_switch entry with no target' };
    if (typeof killed !== 'boolean') {
      return { receipt: null, reason: `receipt records a non-boolean killed value for target ${target}` };
    }
    killSwitch.push({ target, killed });
  }

  return {
    receipt: {
      schema: RUNTIME_MODE_RECEIPT_SCHEMA,
      run_id: runId,
      run_attempt: runAttempt,
      stage,
      declared_mode: declaredMode,
      source_sha: sourceSha,
      deployed_tag: deployedTag,
      compose_project: composeProject,
      observed_at: observedAt,
      services,
      kill_switch: killSwitch,
    },
    reason: null,
  };
}

/** Production activity read live, split by what each service is responsible for. */
export interface RuntimeActivitySignals {
  ingestor: {
    latest_cycle_at: string | null;
    latest_cycle_status: string | null;
    latest_merged_cycle_at: string | null;
    cycles_since_observation: number;
    merged_cycles_since_observation: number;
  };
  worker: {
    latest_heartbeat_at: string | null;
    heartbeats_since_observation: number;
    claims_since_observation: number;
    deliveries_since_observation: number;
    kill_switch: { target: string; killed: boolean | null; actor: string | null; updated_at: string | null }[];
  };
}

export async function readRuntimeActivitySignals(
  db: ReadOnlyDb,
  observedAt: string,
): Promise<RuntimeActivitySignals> {
  const [cycle, merged, heartbeat] = await Promise.all([
    db.latestRow(
      'system_runs',
      'status, started_at',
      [{ column: 'run_type', op: 'eq', value: 'ingestor.cycle' }],
      'started_at',
    ),
    db.latestRow(
      'provider_cycle_status',
      'updated_at',
      [{ column: 'stage_status', op: 'eq', value: 'merged' }],
      'updated_at',
    ),
    db.latestRow(
      'system_runs',
      'status, started_at',
      [{ column: 'run_type', op: 'eq', value: 'worker.heartbeat' }],
      'started_at',
    ),
  ]);

  const [cyclesSince, mergedSince, heartbeatsSince, claimsSince, deliveriesSince] = await Promise.all([
    db.countRows('system_runs', [
      { column: 'run_type', op: 'eq', value: 'ingestor.cycle' },
      { column: 'started_at', op: 'gt', value: observedAt },
    ]),
    db.countRows('provider_cycle_status', [
      { column: 'stage_status', op: 'eq', value: 'merged' },
      { column: 'updated_at', op: 'gt', value: observedAt },
    ]),
    db.countRows('system_runs', [
      { column: 'run_type', op: 'eq', value: 'worker.heartbeat' },
      { column: 'started_at', op: 'gt', value: observedAt },
    ]),
    db.countRows('distribution_outbox', [{ column: 'claimed_at', op: 'gt', value: observedAt }]),
    db.countRows('distribution_outbox', [
      { column: 'status', op: 'eq', value: 'sent' },
      { column: 'updated_at', op: 'gt', value: observedAt },
    ]),
  ]);

  const killSwitch = await Promise.all(
    PUBLIC_DELIVERY_TARGETS.map(async (target) => {
      const row = await db.latestRow(
        'delivery_kill_switch',
        'target, killed, actor, updated_at',
        [{ column: 'target', op: 'eq', value: target }],
        'updated_at',
      );
      return {
        target,
        killed: typeof row?.['killed'] === 'boolean' ? (row['killed'] as boolean) : null,
        actor: typeof row?.['actor'] === 'string' ? (row['actor'] as string) : null,
        updated_at: typeof row?.['updated_at'] === 'string' ? (row['updated_at'] as string) : null,
      };
    }),
  );

  return {
    ingestor: {
      latest_cycle_at: typeof cycle?.['started_at'] === 'string' ? (cycle['started_at'] as string) : null,
      latest_cycle_status: typeof cycle?.['status'] === 'string' ? (cycle['status'] as string) : null,
      latest_merged_cycle_at: typeof merged?.['updated_at'] === 'string' ? (merged['updated_at'] as string) : null,
      cycles_since_observation: cyclesSince,
      merged_cycles_since_observation: mergedSince,
    },
    worker: {
      latest_heartbeat_at: typeof heartbeat?.['started_at'] === 'string' ? (heartbeat['started_at'] as string) : null,
      heartbeats_since_observation: heartbeatsSince,
      claims_since_observation: claimsSince,
      deliveries_since_observation: deliveriesSince,
      kill_switch: killSwitch,
    },
  };
}

export interface ServiceRuntimeAssessment {
  service: RuntimeModeService;
  declared_mode: DeclaredRuntimeMode | null;
  state: ServiceRuntimeState;
  /** Hard-failure findings: parked drift, or an active service that is not running. */
  findings: string[];
  /** Facts that are true and must be surfaced, but do not by themselves set the state. */
  notes: string[];
  unreadable_reason: string | null;
}

export interface RuntimeModeAssessment {
  declared_mode: DeclaredRuntimeMode | null;
  receipt_source: string | null;
  deployed_tag: string | null;
  source_sha: string | null;
  compose_project: string | null;
  observed_at: string | null;
  observation_age_hours: number | null;
  services: ServiceRuntimeAssessment[];
  signals: RuntimeActivitySignals | null;
  unreadable_reason: string | null;
}

function unreadableAssessment(reason: string): RuntimeModeAssessment {
  return {
    declared_mode: null,
    receipt_source: null,
    deployed_tag: null,
    source_sha: null,
    compose_project: null,
    observed_at: null,
    observation_age_hours: null,
    services: RUNTIME_MODE_SERVICES.map((service) => ({
      service,
      declared_mode: null,
      state: 'unreadable' as const,
      findings: [],
      notes: [],
      unreadable_reason: reason,
    })),
    signals: null,
    unreadable_reason: reason,
  };
}

/**
 * Discovery is never scoped to a branch: `deploy.yml`'s `workflow_dispatch`
 * trigger carries no `branches:` restriction, so a tag or non-main dispatch is a
 * real production deploy and filtering it out would silently read an older run's
 * mode as current (DEPLOYMENT_TRUTH_DESIGN.md §2). Attempts are searched newest
 * first because a downstream-only rerun advances `run_attempt` without
 * re-executing promote (§3).
 */
export async function resolveRuntimeModeReceipt(ctx: ProbeContext): Promise<{
  receipt: RuntimeModeReceipt | null;
  source: string | null;
  reason: string | null;
}> {
  const github = requireGithub(ctx);
  const run = await github.latestRun('deploy.yml');
  if (!run) {
    return { receipt: null, source: null, reason: 'no deploy.yml run exists, so no runtime mode has ever been declared' };
  }
  if (run.status !== 'completed') {
    return {
      receipt: null,
      source: run.html_url,
      reason:
        `the most recent deploy.yml run ${run.html_url} is "${run.status}" — a deploy in flight can be changing ` +
        'production right now, so no mode declaration is current',
    };
  }

  const attempts = asPositiveInt(run.run_attempt) ?? 1;
  const misses: string[] = [];
  for (let attempt = attempts; attempt >= 1; attempt -= 1) {
    const name = runtimeModeReceiptArtifactName(run.id, attempt);
    const fetched = await github.downloadRunArtifact(run.id, name);
    if (fetched.text === null) {
      misses.push(`attempt ${attempt}: ${fetched.reason ?? 'no receipt artifact'}`);
      continue;
    }
    const parsed = parseRuntimeModeReceipt(fetched.text);
    const source = `${run.html_url} (attempt ${attempt})`;
    if (!parsed.receipt) {
      // A malformed terminal receipt is exactly the shape an interrupted write
      // leaves behind. Falling through to an older attempt here would report a
      // stale mode as current, so this fails closed instead.
      return { receipt: null, source, reason: `the runtime-mode receipt from ${source} is malformed: ${parsed.reason}` };
    }
    if (parsed.receipt.run_id !== run.id || parsed.receipt.run_attempt !== attempt) {
      return {
        receipt: null,
        source,
        reason:
          `the runtime-mode receipt published by ${source} is bound to run ${parsed.receipt.run_id} ` +
          `attempt ${parsed.receipt.run_attempt} — it is another operation's receipt, not this one's`,
      };
    }
    return { receipt: parsed.receipt, source, reason: null };
  }

  return {
    receipt: null,
    source: run.html_url,
    reason:
      `the most recent deploy.yml run ${run.html_url} (conclusion "${run.conclusion ?? 'none'}") published no ` +
      `runtime-mode receipt on any of its ${attempts} attempt(s): ${misses.join('; ')}`,
  };
}

function receiptService(
  receipt: RuntimeModeReceipt,
  service: RuntimeModeService,
): RuntimeModeReceiptService | null {
  return receipt.services.find((entry) => entry.service === service) ?? null;
}

function classifyService(
  service: RuntimeModeService,
  receipt: RuntimeModeReceipt,
  signals: RuntimeActivitySignals,
  observationAgeHours: number,
  now: Date,
): ServiceRuntimeAssessment {
  const mode = receipt.declared_mode;
  const findings: string[] = [];
  const notes: string[] = [];
  const observed = receiptService(receipt, service);

  if (!observed) {
    return {
      service,
      declared_mode: mode,
      state: 'unreadable',
      findings,
      notes,
      unreadable_reason: `the runtime-mode receipt carries no observation for service "${service}"`,
    };
  }

  // Declared values versus the values the running container actually reported.
  const expected = RUNTIME_MODE_ENV_CONTRACT[mode][service];
  const missing: string[] = [];
  for (const [key, want] of Object.entries(expected)) {
    const got = observed.env[key];
    if (got === undefined) missing.push(key);
    else if (got !== want) findings.push(`${service}.${key} is "${got}", the ${mode} contract requires "${want}"`);
  }
  if (missing.length > 0) {
    return {
      service,
      declared_mode: mode,
      state: 'unreadable',
      findings,
      notes,
      unreadable_reason:
        `the runtime-mode receipt does not carry ${missing.join(', ')} for service "${service}", ` +
        `so its ${mode} contract cannot be checked`,
    };
  }

  if (mode === 'parked') {
    if (service === 'ingestor') {
      const { cycles_since_observation: cycles, merged_cycles_since_observation: mergedCycles } = signals.ingestor;
      if (cycles > 0) findings.push(`${cycles} ingestor.cycle run(s) started after the parked deployment at ${receipt.observed_at}`);
      if (mergedCycles > 0) findings.push(`${mergedCycles} provider cycle(s) merged after the parked deployment at ${receipt.observed_at}`);
      const last = signals.ingestor.latest_cycle_at;
      if (last && new Date(last).getTime() < new Date(receipt.observed_at).getTime()) {
        const silentMinutes = minutesBetween(last, new Date(receipt.observed_at));
        if (silentMinutes > THRESHOLDS.ingestorCycleMaxMinutes) {
          // Distinct fact, deliberately not folded into the parked verdict:
          // ingestion had already stopped BEFORE the machine was parked, so
          // parking does not explain that earlier stoppage.
          notes.push(
            `ingestion had already stopped ${silentMinutes}m before the parked deployment (last ingestor.cycle ${last}, ` +
              `parked at ${receipt.observed_at}) — parked mode explains the silence since, not the stoppage before it`,
          );
        }
      }
    }
    if (service === 'worker') {
      const worker = signals.worker;
      if (worker.heartbeats_since_observation > 0)
        findings.push(`${worker.heartbeats_since_observation} worker.heartbeat run(s) after the parked deployment at ${receipt.observed_at}`);
      if (worker.claims_since_observation > 0)
        findings.push(`${worker.claims_since_observation} outbox row(s) claimed after the parked deployment at ${receipt.observed_at}`);
      if (worker.deliveries_since_observation > 0)
        findings.push(`${worker.deliveries_since_observation} outbox row(s) delivered after the parked deployment at ${receipt.observed_at}`);
      for (const target of worker.kill_switch) {
        if (target.killed === null) findings.push(`delivery_kill_switch has no row for public target "${target.target}"`);
        else if (!target.killed) findings.push(`public delivery kill switch for "${target.target}" is disengaged (killed=false)`);
      }
      const last = worker.latest_heartbeat_at;
      if (last && new Date(last).getTime() < new Date(receipt.observed_at).getTime()) {
        const silentMinutes = minutesBetween(last, new Date(receipt.observed_at));
        if (silentMinutes > THRESHOLDS.workerHeartbeatMaxMinutes) {
          notes.push(
            `the worker had already stopped heartbeating ${silentMinutes}m before the parked deployment ` +
              `(last worker.heartbeat ${last}, parked at ${receipt.observed_at})`,
          );
        }
      }
    }
    if (service === 'api') {
      notes.push(
        'grading-cron deliberately keeps running in parked mode (UNIT_TALK_GRADING_CRON_AUTORUN is not mode-derived in deploy.yml), ' +
          'so its activity is never counted as parked drift',
      );
    }

    if (findings.length > 0) {
      return { service, declared_mode: mode, state: 'parked_drift', findings, notes, unreadable_reason: null };
    }
    if (observationAgeHours > THRESHOLDS.runtimeModeObservationMaxHours) {
      return {
        service,
        declared_mode: mode,
        state: 'unreadable',
        findings,
        notes,
        unreadable_reason:
          `the parked runtime values for "${service}" were observed ${observationAgeHours}h ago, past the ` +
          `${THRESHOLDS.runtimeModeObservationMaxHours}h observation SLA (the GitHub artifact retention horizon); ` +
          'refreshing them needs a live host read (DEPLOYMENT_TRUTH_DESIGN.md §12a), which is not provisioned',
      };
    }
    return { service, declared_mode: mode, state: 'parked_verified', findings, notes, unreadable_reason: null };
  }

  // Declared active: silence is never expected, and staleness stays a hard failure.
  if (findings.length > 0) {
    return { service, declared_mode: mode, state: 'active_failed', findings, notes, unreadable_reason: null };
  }

  const degraded: string[] = [];
  if (service === 'ingestor') {
    const cycleAt = signals.ingestor.latest_cycle_at;
    const cycleAge = cycleAt ? minutesBetween(cycleAt, now) : null;
    if (cycleAge === null) findings.push('declared active but no ingestor.cycle row exists at all');
    else if (cycleAge > THRESHOLDS.ingestorCycleMaxMinutes)
      findings.push(`declared active but the latest ingestor.cycle started ${cycleAt} (${cycleAge}m, threshold ${THRESHOLDS.ingestorCycleMaxMinutes}m)`);
    const status = signals.ingestor.latest_cycle_status;
    if (status && status !== 'success' && status !== 'completed')
      findings.push(`latest ingestor.cycle status is "${status}"`);
    const mergedAt = signals.ingestor.latest_merged_cycle_at;
    const mergedAge = mergedAt ? minutesBetween(mergedAt, now) : null;
    if (mergedAge === null) degraded.push('no merged provider_cycle_status row exists');
    else if (mergedAge > THRESHOLDS.ingestorOfferMaxMinutes)
      degraded.push(`latest merged provider cycle updated ${mergedAt} (${mergedAge}m, threshold ${THRESHOLDS.ingestorOfferMaxMinutes}m)`);
  }
  if (service === 'worker') {
    const heartbeatAt = signals.worker.latest_heartbeat_at;
    const heartbeatAge = heartbeatAt ? minutesBetween(heartbeatAt, now) : null;
    if (heartbeatAge === null) findings.push('declared active but no worker.heartbeat row exists at all');
    else if (heartbeatAge > THRESHOLDS.workerHeartbeatMaxMinutes)
      findings.push(`declared active but worker.heartbeat is ${heartbeatAge}m old (threshold ${THRESHOLDS.workerHeartbeatMaxMinutes}m)`);
    for (const target of signals.worker.kill_switch) {
      if (target.killed === true)
        degraded.push(`public delivery kill switch for "${target.target}" is engaged (killed=true, actor ${target.actor ?? 'unrecorded'}), so an active machine cannot deliver to it`);
    }
  }
  if (service === 'api') {
    notes.push(
      'this dimension has no production activity signal that belongs to the api service alone; its active reading rests on ' +
        "the deploy's own health gate and the verified SYNDICATE_MACHINE_ENABLED value, both bound to observed_at",
    );
  }

  if (findings.length > 0) {
    return { service, declared_mode: mode, state: 'active_failed', findings, notes, unreadable_reason: null };
  }
  if (degraded.length > 0) {
    return { service, declared_mode: mode, state: 'active_degraded', findings: degraded, notes, unreadable_reason: null };
  }
  return { service, declared_mode: mode, state: 'active_healthy', findings, notes, unreadable_reason: null };
}

export async function assessRuntimeMode(ctx: ProbeContext): Promise<RuntimeModeAssessment> {
  let resolved: { receipt: RuntimeModeReceipt | null; source: string | null; reason: string | null };
  try {
    resolved = await resolveRuntimeModeReceipt(ctx);
  } catch (error) {
    return unreadableAssessment(`the declared runtime mode could not be read: ${errorMessage(error)}`);
  }
  if (!resolved.receipt) {
    return unreadableAssessment(resolved.reason ?? 'the declared runtime mode could not be read');
  }
  const receipt = resolved.receipt;

  let signals: RuntimeActivitySignals;
  try {
    signals = await readRuntimeActivitySignals(requireDb(ctx), receipt.observed_at);
  } catch (error) {
    const assessment = unreadableAssessment(
      `production is declared "${receipt.declared_mode}" by ${resolved.source ?? 'the latest deploy run'}, but the ` +
        `activity evidence that would confirm or refute it could not be read: ${errorMessage(error)}`,
    );
    return {
      ...assessment,
      declared_mode: receipt.declared_mode,
      receipt_source: resolved.source,
      deployed_tag: receipt.deployed_tag,
      source_sha: receipt.source_sha,
      compose_project: receipt.compose_project,
      observed_at: receipt.observed_at,
      observation_age_hours: hoursBetween(receipt.observed_at, ctx.now),
      services: assessment.services.map((entry) => ({ ...entry, declared_mode: receipt.declared_mode })),
    };
  }

  const observationAgeHours = hoursBetween(receipt.observed_at, ctx.now);
  return {
    declared_mode: receipt.declared_mode,
    receipt_source: resolved.source,
    deployed_tag: receipt.deployed_tag,
    source_sha: receipt.source_sha,
    compose_project: receipt.compose_project,
    observed_at: receipt.observed_at,
    observation_age_hours: observationAgeHours,
    services: RUNTIME_MODE_SERVICES.map((service) =>
      classifyService(service, receipt, signals, observationAgeHours, ctx.now),
    ),
    signals,
    unreadable_reason: null,
  };
}

/** The state a mode-conditional probe must reason from. Absent assessment is never "assume active". */
export function serviceRuntimeState(
  assessment: RuntimeModeAssessment | null | undefined,
  service: RuntimeModeService,
): ServiceRuntimeState {
  if (!assessment) return 'unreadable';
  return assessment.services.find((entry) => entry.service === service)?.state ?? 'unreadable';
}

export function serviceRuntimeReason(
  assessment: RuntimeModeAssessment | null | undefined,
  service: RuntimeModeService,
): string {
  if (!assessment) return 'the desired runtime mode was not assessed for this observation';
  const entry = assessment.services.find((candidate) => candidate.service === service);
  return (
    entry?.unreadable_reason ??
    assessment.unreadable_reason ??
    `no runtime-mode assessment was recorded for service "${service}"`
  );
}

/** `parked_verified` is stated in full, never abbreviated to "healthy". */
export function describeServiceState(entry: ServiceRuntimeAssessment): string {
  const detail = [...entry.findings, ...entry.notes];
  const suffix = detail.length > 0 ? ` — ${detail.join('; ')}` : '';
  return `${entry.service}=${entry.state}${suffix}`;
}

export function probeServiceRuntimeMode(
  assessment: RuntimeModeAssessment,
  now: Date,
): ReadinessDimension {
  const base = {
    id: 'service_runtime_mode',
    title: 'Every service matches its declared, independently verified runtime mode',
    blocking: true,
    method: {
      kind: 'github_api' as const,
      source: `github:actions/runs/deploy.yml + artifact ${RUNTIME_MODE_RECEIPT_SCHEMA}`,
      query:
        'latest deploy.yml run across ALL refs (no branch filter), newest run_attempt first, ' +
        'artifact runtime-mode-receipt-<run_id>-<run_attempt>; ' +
        'cross-read supabase: system_runs(ingestor.cycle, worker.heartbeat), provider_cycle_status(merged), ' +
        `distribution_outbox(claimed_at, status='sent'), delivery_kill_switch(${PUBLIC_DELIVERY_TARGETS.join(', ')}) ` +
        'restricted to rows newer than the receipt observed_at',
    },
  };

  const states = assessment.services.map((entry) => entry.state);
  const phaseLimit =
    'Phase-1 limitation (DEPLOYMENT_TRUTH_DESIGN.md §12a/row 16): an out-of-band container replacement made after the ' +
    'receipt observed_at is not detectable here — a live host read is not provisioned, so nothing about the current ' +
    'instant is inferred from the receipt.';

  if (states.includes('unreadable')) {
    // One shared cause is stated once. Repeating the same sentence per service
    // makes the ledger unreadable to the person who has to act on it.
    const unreadableServices = assessment.services.filter((entry) => entry.state === 'unreadable');
    const distinct = new Set(unreadableServices.map((entry) => entry.unreadable_reason ?? 'unstated'));
    const reasons =
      distinct.size === 1
        ? [`${unreadableServices.map((entry) => entry.service).join(', ')}: ${[...distinct][0] as string}`]
        : unreadableServices.map((entry) => `${entry.service}: ${entry.unreadable_reason ?? 'unstated'}`);
    return {
      ...base,
      status: 'unknown',
      observed_at: now.toISOString(),
      evidence:
        `UNREADABLE at ${now.toISOString()}: the desired runtime mode of at least one service is unproven. ` +
        `${reasons.join(' | ')}. Not scored as passing, and not scored as an active-service failure either. ${phaseLimit}`,
      measured: {
        declared_mode: assessment.declared_mode,
        receipt_source: assessment.receipt_source,
        observed_at: assessment.observed_at,
        observation_age_hours: assessment.observation_age_hours,
        observation_sla_hours: THRESHOLDS.runtimeModeObservationMaxHours,
        services: assessment.services,
        signals: assessment.signals,
      },
      unreadable_reason: assessment.unreadable_reason ?? reasons.join(' | '),
    };
  }

  const failed = assessment.services.filter(
    (entry) => entry.state === 'parked_drift' || entry.state === 'active_failed' || entry.state === 'active_degraded',
  );

  return {
    ...base,
    status: failed.length === 0 ? 'pass' : 'fail',
    observed_at: now.toISOString(),
    evidence:
      `Declared mode "${assessment.declared_mode}" from ${assessment.receipt_source ?? 'the latest deploy run'}, ` +
      `deployed tag ${assessment.deployed_tag ?? 'unrecorded'} (source_sha ${assessment.source_sha ?? 'unrecorded'}), ` +
      `compose project ${assessment.compose_project ?? 'unrecorded'}, observed ${assessment.observed_at ?? 'never'} ` +
      `(${assessment.observation_age_hours ?? 'n/a'}h ago, SLA ${THRESHOLDS.runtimeModeObservationMaxHours}h). ` +
      `${assessment.services.map(describeServiceState).join(' | ')}. ` +
      (failed.length === 0
        ? 'Every service matches its declared mode. '
        : `FAIL: ${failed.map((entry) => `${entry.service} is ${entry.state}`).join(', ')}. `) +
      `${phaseLimit} Read-only observation; no restart, unpark or mutation performed.`,
    measured: {
      declared_mode: assessment.declared_mode,
      receipt_source: assessment.receipt_source,
      deployed_tag: assessment.deployed_tag,
      source_sha: assessment.source_sha,
      compose_project: assessment.compose_project,
      observed_at: assessment.observed_at,
      observation_age_hours: assessment.observation_age_hours,
      observation_sla_hours: THRESHOLDS.runtimeModeObservationMaxHours,
      services: assessment.services,
      signals: assessment.signals,
    },
    unreadable_reason: null,
  };
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

/**
 * The one place a measured reading becomes a verdict, so the mode rule cannot
 * drift between probes.
 *
 * - **active** — absence of activity is a hard failure, exactly as before.
 * - **parked_verified** — absence is the declared contract and passes, but the
 *   dimension says `parked_verified` in full and never the word "healthy", and
 *   the measured ages are still published so the silence stays visible.
 * - **parked_drift** — the parked contract is broken; hard failure regardless of
 *   what the individual ages say.
 * - **unreadable** — the reading is kept, the verdict is refused. Never `pass`.
 *
 * `stateFailures` (rows stuck mid-flight, and anything else parking does not
 * explain) fail in every mode, including `parked_verified`.
 */
function scoreAgainstDeclaredMode(input: {
  base: Pick<ReadinessDimension, 'id' | 'title' | 'blocking' | 'method'>;
  ctx: ProbeContext;
  service: RuntimeModeService;
  absenceFailures: string[];
  stateFailures: string[];
  measured: Record<string, unknown>;
  observation: string;
  parkedExpectation: string;
  activeThresholds: string;
}): ReadinessDimension {
  const { base, ctx, service, absenceFailures, stateFailures, measured, observation } = input;
  const state = serviceRuntimeState(ctx.runtimeMode, service);
  const closing = 'Read-only observation; no restart, unpark or mutation performed.';

  if (state === 'unreadable') {
    const reason = serviceRuntimeReason(ctx.runtimeMode, service);
    return {
      ...base,
      status: 'unknown',
      observed_at: ctx.now.toISOString(),
      evidence:
        `UNREADABLE at ${ctx.now.toISOString()}: ${observation} Whether that is a failure or the expected silence of a ` +
        `parked machine cannot be decided, because the declared runtime mode for "${service}" is unproven — ${reason}. ` +
        `Not scored as passing. ${closing}`,
      measured,
      unreadable_reason: reason,
    };
  }

  if (state === 'parked_drift') {
    const drift = (ctx.runtimeMode?.services.find((entry) => entry.service === service)?.findings ?? []).join('; ');
    return {
      ...base,
      status: 'fail',
      observed_at: ctx.now.toISOString(),
      evidence:
        `PARKED DRIFT: production is declared parked, but "${service}" broke the parked contract — ${drift || 'see service_runtime_mode'}. ` +
        `${observation} ${stateFailures.length > 0 ? `Also failing: ${stateFailures.join('; ')}. ` : ''}${closing}`,
      measured,
      unreadable_reason: null,
    };
  }

  if (state === 'parked_verified') {
    const notes = ctx.runtimeMode?.services.find((entry) => entry.service === service)?.notes ?? [];
    return {
      ...base,
      status: stateFailures.length === 0 ? 'pass' : 'fail',
      observed_at: ctx.now.toISOString(),
      evidence:
        `PARKED_VERIFIED (not active health): ${input.parkedExpectation} ${observation} ` +
        (absenceFailures.length > 0
          ? `Absence findings, expected under the parked contract and therefore not scored as failures: ${absenceFailures.join('; ')}. `
          : '') +
        (notes.length > 0 ? `Separately, and not explained by parking: ${notes.join('; ')}. ` : '') +
        (stateFailures.length > 0
          ? `FAIL — parking does not explain these: ${stateFailures.join('; ')}. `
          : 'Nothing is stuck mid-flight. ') +
        closing,
      measured,
      unreadable_reason: null,
    };
  }

  // active_healthy | active_degraded | active_failed
  const failures = [...absenceFailures, ...stateFailures];
  return {
    ...base,
    status: failures.length === 0 ? 'pass' : 'fail',
    observed_at: ctx.now.toISOString(),
    evidence:
      `Declared active (${state}); ${input.activeThresholds}. ${observation} ` +
      (failures.length === 0 ? 'No failures. ' : `FAIL: ${failures.join('; ')}. `) +
      closing,
    measured,
    unreadable_reason: null,
  };
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

    // Absence-of-activity failures are the ones a parked machine legitimately
    // explains. Everything else stays a failure in every mode.
    const absenceFailures: string[] = [];
    const stateFailures: string[] = [];
    if (cycleAge === null) absenceFailures.push('no ingestor.cycle row exists');
    else if (cycleAge > THRESHOLDS.ingestorCycleMaxMinutes)
      absenceFailures.push(`latest ingestor.cycle started ${cycleStartedAt} (${cycleAge}m old, threshold ${THRESHOLDS.ingestorCycleMaxMinutes}m)`);
    if (cycleStatus && cycleStatus !== 'success' && cycleStatus !== 'completed')
      absenceFailures.push(`latest ingestor.cycle status is "${cycleStatus}"`);
    if (offerAge === null) absenceFailures.push('no merged provider_cycle_status row exists');
    else if (offerAge > THRESHOLDS.ingestorOfferMaxMinutes)
      absenceFailures.push(`latest merged provider cycle updated ${mergedAt} (${offerAge}m old, threshold ${THRESHOLDS.ingestorOfferMaxMinutes}m)`);

    const measured = {
      latest_cycle_started_at: cycleStartedAt,
      latest_cycle_status: cycleStatus,
      latest_cycle_age_minutes: cycleAge,
      latest_merged_cycle_at: mergedAt,
      latest_merged_cycle_age_minutes: offerAge,
      latest_game_result_at: resultAt,
      declared_runtime_state: serviceRuntimeState(ctx.runtimeMode, 'ingestor'),
    };
    const observation = `Latest ingestor.cycle started ${cycleStartedAt ?? 'never'} (${cycleAge ?? 'n/a'}m, status ${cycleStatus ?? 'n/a'}); latest merged provider cycle ${mergedAt ?? 'never'} (${offerAge ?? 'n/a'}m); latest game_results row ${resultAt ?? 'none'}.`;

    return scoreAgainstDeclaredMode({
      base,
      ctx,
      service: 'ingestor',
      absenceFailures,
      stateFailures,
      measured,
      observation,
      parkedExpectation: `No ingestor.cycle and no merged provider cycle is the declared parked contract (UNIT_TALK_INGESTOR_AUTORUN=false, UNIT_TALK_INGESTOR_SCHEDULING_ENABLED=false), so this silence is expected, not health.`,
      activeThresholds: `thresholds: cycle ${THRESHOLDS.ingestorCycleMaxMinutes}m, merged offers ${THRESHOLDS.ingestorOfferMaxMinutes}m`,
    });
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

    // A missing heartbeat is exactly what a parked worker looks like. Rows stuck
    // mid-flight are not: parking does not clear them, so they fail in every mode.
    const absenceFailures: string[] = [];
    const stateFailures: string[] = [];
    if (heartbeatAge === null) absenceFailures.push('no worker.heartbeat row exists');
    else if (heartbeatAge > THRESHOLDS.workerHeartbeatMaxMinutes)
      absenceFailures.push(`worker.heartbeat is ${heartbeatAge}m old (threshold ${THRESHOLDS.workerHeartbeatMaxMinutes}m), last status "${heartbeatStatus}"`);
    if (staleUnknown > 0)
      stateFailures.push(`${staleUnknown} bucket:stale_unknown rows (processing > ${THRESHOLDS.outboxStaleProcessingMinutes}m)`);
    if (stuckRetryable > 0)
      stateFailures.push(`${stuckRetryable} attempted rows still pending after ${THRESHOLDS.outboxStalePendingMinutes}m`);

    const measured = {
      heartbeat_started_at: heartbeatAt,
      heartbeat_status: heartbeatStatus,
      heartbeat_age_minutes: heartbeatAge,
      pending_count: pending,
      processing_count: processing,
      stale_unknown_count: staleUnknown,
      stuck_retryable_count: stuckRetryable,
      declared_runtime_state: serviceRuntimeState(ctx.runtimeMode, 'worker'),
    };
    const observation =
      `Queue buckets per ${QUEUE_SEMANTICS_DOC} v${QUEUE_SEMANTICS_VERSION}: pending=${pending}, processing=${processing}, ` +
      `stale_unknown=${staleUnknown}, attempted-and-stuck=${stuckRetryable}. ` +
      `worker.heartbeat ${heartbeatAt ?? 'none'} (${heartbeatAge ?? 'n/a'}m, status ${heartbeatStatus ?? 'n/a'}).`;

    return scoreAgainstDeclaredMode({
      base,
      ctx,
      service: 'worker',
      absenceFailures,
      stateFailures,
      measured,
      observation,
      parkedExpectation: `An absent worker.heartbeat is the declared parked contract (UNIT_TALK_WORKER_AUTORUN=false, UNIT_TALK_ENABLED_TARGETS=none), so this silence is expected, not health. Stuck-row counts are still reported above and any row claimed or delivered after the parked deployment is scored as parked drift by service_runtime_mode.`,
      activeThresholds: `threshold: heartbeat ${THRESHOLDS.workerHeartbeatMaxMinutes}m`,
    });
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

  // The desired runtime mode is resolved once, before anything is scored: every
  // mode-conditional probe must reason from the same declaration, and a probe
  // that ran before the mode was known would be scoring against a guess.
  const runtimeMode = await assessRuntimeMode(ctx);
  const modeCtx: ProbeContext = { ...ctx, runtimeMode };
  dimensions.push(probeServiceRuntimeMode(runtimeMode, ctx.now));

  for (const probe of PROBES) {
    dimensions.push(await probe(modeCtx));
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
        async downloadRunArtifact(runId, artifactName) {
          // `gh run download` handles the zip; nothing is executed from the
          // artifact and only the one expected filename is ever read.
          let dir: string | null = null;
          try {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-artifact-'));
            execFileSync('gh', ['run', 'download', String(runId), '-n', artifactName, '-D', dir], {
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'pipe'],
            });
            const file = path.join(dir, RUNTIME_MODE_RECEIPT_FILE);
            if (!fs.existsSync(file)) {
              return {
                text: null,
                reason: `artifact ${artifactName} carries no ${RUNTIME_MODE_RECEIPT_FILE}`,
              };
            }
            return { text: fs.readFileSync(file, 'utf8'), reason: null };
          } catch (error) {
            return {
              text: null,
              reason: `gh run download ${runId} -n ${artifactName} failed: ${errorMessage(error)}`,
            };
          } finally {
            if (dir) fs.rmSync(dir, { recursive: true, force: true });
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

/** Reads the mode straight off the recorded dimension so the summary cannot disagree with the ledger. */
function describeLedgerRuntimeMode(ledger: ReadinessLedger): string {
  const dimension = ledger.dimensions.find((entry) => entry.id === 'service_runtime_mode');
  if (!dimension) return 'not assessed';
  const declared = dimension.measured?.['declared_mode'];
  const services = dimension.measured?.['services'];
  const states = Array.isArray(services)
    ? services
        .map((entry) => {
          const record = entry as { service?: unknown; state?: unknown };
          return `${String(record.service)}=${String(record.state)}`;
        })
        .join(' ')
    : 'no per-service states recorded';
  return `declared ${typeof declared === 'string' ? declared : 'unreadable'} — ${states}`;
}

export function formatSummary(ledger: ReadinessLedger): string {
  const lines = [
    `READINESS LEDGER — generated_at ${ledger.generated_at}`,
    `  verdict:       ${ledger.verdict}`,
    `  observability: ${ledger.observability}`,
    `  runtime mode:  ${describeLedgerRuntimeMode(ledger)}`,
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
