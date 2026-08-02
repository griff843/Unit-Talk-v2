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
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'like';
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
  /**
   * Round 22 (PM review of 192b597d): the real implementation's count query
   * must select an actual column of `table` -- not every table in this
   * schema has an `id` column (e.g. `delivery_kill_switch`), and selecting a
   * nonexistent column is a hard PostgREST error, not a soft zero. Defaults
   * to `'id'` for every existing call site that already relies on it;
   * callers against a table with no `id` column must pass one that exists.
   */
  countRows(table: string, filters: DbFilter[], countColumn?: string): Promise<number>;
}

export interface WorkflowRun {
  id: number;
  head_sha: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  /**
   * GitHub's own count of the highest attempt so far for this run. A
   * failed-jobs-only rerun (e.g. re-running only a failed downstream `smoke`
   * job) bumps this and the run's own `updated_at` WITHOUT re-executing an
   * upstream job like `promote` that already succeeded -- see
   * PARKED_CONTRACT_RECEIPT_ARTIFACT_PREFIX's attempt-suffix check for why
   * this matters.
   */
  run_attempt: number;
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
  /**
   * `options.headSha`, when given, restricts candidates to runs whose own
   * `head_sha` matches exactly before selecting by `updated_at` (round 13:
   * the global "most recently executed" selection round 10 added is correct
   * for deployment history, where a re-executed OLDER run genuinely can be
   * the most recent thing that mutated production -- but wrong for a probe
   * that wants "the run for THIS specific commit," where an unrelated
   * older run being rerun must not shadow a newer, already-passing run for
   * the commit actually being asked about).
   */
  latestRun(
    workflowFile: string,
    options?: { branch?: string; status?: string; headSha?: string },
  ): Promise<WorkflowRun | null>;
  commitsBetween(base: string, head: string): Promise<number | null>;
  /**
   * UTV2-1660: the most recent workflow-run artifact whose name starts with
   * `namePrefix`, parsed as JSON. Used to read deploy.yml's parked-contract
   * receipt without depending on raw job-log text — GitHub Actions redacts ANY
   * log content matching ANY registered secret's value, repo/org-wide, which
   * could silently corrupt a log-scraped read of an innocuous field (e.g.
   * "none" or "true") that happens to collide with an unrelated secret's
   * value. An uploaded artifact file is not subject to that live-log
   * redaction. Returns null if the run has no matching artifact.
   *
   * `expectedAttempt`, when given, restricts the match to an artifact named
   * exactly `${namePrefix}${runId}-${expectedAttempt}` (round 11: the
   * receipt is uploaded by deploy.yml's `promote` job, suffixed with
   * `github.run_attempt` as of when `promote` executed; a failed-jobs-only
   * rerun of a later job like `smoke` bumps the run's own current attempt
   * without re-running `promote` or producing a new receipt artifact --
   * passing the run's own current `run_attempt` here means a mismatch is
   * detected as "no artifact" rather than silently returning a receipt from
   * an earlier attempt that may no longer describe current production).
   */
  latestArtifactJson(
    runId: number,
    namePrefix: string,
    expectedAttempt?: number,
  ): Promise<Record<string, unknown> | null>;
  /**
   * Round 14: the same bounded, paginated candidate set `latestRun` selects
   * from, but returned in full (newest-`updated_at`-first) rather than
   * collapsed to a single pick. Callers that must verify a specific job ran
   * in a run's current attempt before trusting it (e.g. probeDeploySha's
   * promote check) can walk this list past a non-promoting candidate to the
   * next one that genuinely mutated production, instead of giving up
   * `unreadable` at the very first candidate.
   */
  listRunsByRecency(workflowFile: string, options?: { branch?: string; status?: string }): Promise<WorkflowRun[]>;
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

// ISO timestamp strings are not safe to compare lexically: a DB-sourced
// timestamp with fractional seconds ("...00.123Z") sorts BEFORE a
// second-precision one ("...00Z") because '.' (0x2E) < 'Z' (0x5A) -- even
// when the fractional one is chronologically later. Always compare parsed
// epoch values instead.
function isAfter(a: string, b: string): boolean {
  return new Date(a).getTime() > new Date(b).getTime();
}

// GitHub's default workflow-run ordering is by creation time, not by when a
// run last actually executed. A manually re-run OLDER run gets another
// attempt on its SAME run object (bumping updated_at) rather than a new
// workflow-run entry, and that attempt can still mutate production --
// trusting position 0 of a created_at-sorted page would stay blind to that
// re-execution being the most recent thing that actually touched production.
// Select by updated_at across the fetched candidates instead.
export function selectMostRecentlyUpdatedRun(runs: WorkflowRun[]): WorkflowRun | null {
  if (runs.length === 0) return null;
  return runs.reduce((latest, run) => (isAfter(run.updated_at, latest.updated_at) ? run : latest));
}

// Round 14: some callers (probeDeploySha) can't just trust the single
// most-recently-updated run -- its current attempt might not have actually
// executed the production-mutating job (round 12's finding). They need the
// FULL candidate list, newest-updated first, so they can walk past a
// non-promoting attempt to the next candidate that genuinely did mutate
// production, instead of giving up at the first (possibly non-promoting)
// candidate.
export function sortByMostRecentlyUpdated(runs: WorkflowRun[]): WorkflowRun[] {
  return [...runs].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
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
        'every run of deploy.yml across every ref (head_sha) vs commits/main (sha), regardless of ' +
        'overall workflow or job conclusion, checked attempt-by-attempt for a deploy-mutation-receipt/' +
        'deploy-rollback-receipt artifact; compare base...head for commit distance',
    },
  };

  try {
    const github = requireGithub(ctx);
    // Round 21 (PM review of 11dcc7ce): a server-side status='success' filter
    // here excludes any run whose OVERALL conclusion is failure -- including
    // one where the container-replacement step succeeded (mutating
    // production) but a downstream job failed afterward, turning the whole
    // workflow run red. That run would never even reach the per-attempt
    // mutation-evidence check below, silently losing a genuine production
    // mutation. Fetch every run on main regardless of overall conclusion;
    // the per-attempt deploy-mutation-receipt check below (round 22) is what
    // actually decides whether production was mutated, not any job's or
    // workflow's aggregate status/conclusion.
    //
    // Round 23 (PM review of cb03437d): a server-side branch='main' filter
    // is the exact same class of blind spot one level up -- deploy.yml's
    // workflow_dispatch is unrestricted (round 8 already established this
    // for the parked-contract-receipt path) and a manual dispatch from a
    // hotfix branch or tag mutates the SAME production host. Restricting
    // discovery to main-only runs means a newer off-main mutation is
    // invisible, letting an older main-only deployment stand in as
    // "currently deployed" -- precisely the drift this dimension exists to
    // catch, since deploy_sha_alignment's whole point is comparing what's
    // ACTUALLY deployed against main's HEAD, not merely the newest thing
    // that happened to run on main. Discovery must scan every ref; the
    // dimension still correctly reports drift/fail when the true deployed
    // tag (from any ref) doesn't match main's HEAD.
    const [mainSha, candidates] = await Promise.all([
      github.headSha('main'),
      github.listRunsByRecency('deploy.yml'),
    ]);

    if (candidates.length === 0) {
      return {
        ...base,
        status: 'fail',
        observed_at: ctx.now.toISOString(),
        evidence: `No deploy.yml run of any kind exists on main. main HEAD is ${mainSha}; nothing has been proven deployed.`,
        measured: { main_sha: mainSha, deployed_sha: null, successful_deploy_runs: 0 },
        unreadable_reason: null,
      };
    }

    // Round 12: the most-recently-updated run isn't automatically trustworthy
    // -- a failed-jobs-only rerun of a downstream job can bump a run's
    // updated_at without re-running the actual production-mutating step.
    // Round 14: rather than giving up unreadable at the first (possibly
    // non-mutating) candidate, walk the full recency-sorted list and use the
    // first one that genuinely mutated production. Round 15: checking ONLY
    // the run's current (latest) attempt was itself wrong -- search every
    // attempt of a candidate (current down to 1), not just the current one,
    // before moving to the next candidate. Round 16: a candidate's run-level
    // updated_at is not a trustworthy proxy for "when did production last
    // get mutated" -- collect the mutation time for every candidate that has
    // one, then select the candidate whose mutation most recently occurred
    // in real wall-clock time.
    //
    // Round 22 (PM review of 192b597d): rounds 12-16 all trusted the
    // `promote` JOB's own conclusion as the signal that production was
    // mutated -- but deploy.yml's promote job runs the health-check loop
    // (and any rollback) in steps AFTER the actual container-replacement
    // step, in the SAME job. A later health-check failure marks the whole
    // JOB as failed even when the container replacement had already
    // genuinely mutated production, discarding real evidence. deploy.yml now
    // writes a `deploy-mutation-receipt` artifact immediately after the
    // container-replacement step succeeds -- independent of the job's
    // eventual overall conclusion -- and a `deploy-rollback-receipt`
    // artifact if the health-check later fails AND a configured rollback
    // succeeds (itself a NEWER, separate production mutation to a different
    // tag). Trust is now keyed to these artifacts' own presence and
    // timestamps, never any job's conclusion field.
    const mutatedCandidates: { candidate: WorkflowRun; deployedTag: string; effectiveAt: string }[] = [];
    const rejectedNonMutating: string[] = [];
    for (const candidate of candidates) {
      let found: { deployedTag: string; effectiveAt: string } | undefined;
      const attemptResults: string[] = [];
      for (let attempt = candidate.run_attempt; attempt >= 1; attempt -= 1) {
        const mutation = await github.latestArtifactJson(
          candidate.id,
          DEPLOY_MUTATION_RECEIPT_ARTIFACT_PREFIX,
          attempt,
        );
        const imageTag = typeof mutation?.['image_tag'] === 'string' ? (mutation['image_tag'] as string) : null;
        const mutatedAt = typeof mutation?.['mutated_at'] === 'string' ? (mutation['mutated_at'] as string) : null;
        if (!imageTag || !mutatedAt) {
          attemptResults.push(`attempt ${attempt}=no mutation evidence`);
          continue;
        }
        const rollback = await github.latestArtifactJson(
          candidate.id,
          DEPLOY_ROLLBACK_RECEIPT_ARTIFACT_PREFIX,
          attempt,
        );
        const rollbackTag =
          typeof rollback?.['rolled_back_to_tag'] === 'string' ? (rollback['rolled_back_to_tag'] as string) : null;
        const rollbackAt =
          typeof rollback?.['rolled_back_at'] === 'string' ? (rollback['rolled_back_at'] as string) : null;
        found =
          rollbackTag && rollbackAt
            ? { deployedTag: rollbackTag, effectiveAt: rollbackAt }
            : { deployedTag: imageTag, effectiveAt: mutatedAt };
        break;
      }
      if (found) {
        mutatedCandidates.push({ candidate, deployedTag: found.deployedTag, effectiveAt: found.effectiveAt });
      } else {
        rejectedNonMutating.push(`${candidate.html_url} (${attemptResults.join(', ')})`);
      }
    }

    if (mutatedCandidates.length === 0) {
      return unreadable(
        base,
        `none of the ${candidates.length} most recent deploy.yml run(s) on main (regardless of overall ` +
        `workflow conclusion) show deploy-mutation-receipt evidence in ANY of their attempts -- refusing to ` +
        `trust any of their tags as the currently deployed SHA: ${rejectedNonMutating.join('; ')}`,
        ctx.now,
      );
    }

    const winner = mutatedCandidates.reduce((latest, entry) =>
      (isAfter(entry.effectiveAt, latest.effectiveAt) ? entry : latest),
    );
    const deployRun = winner.candidate;
    const deployedSha = winner.deployedTag;
    const effectiveAt = winner.effectiveAt;

    const aligned = deployedSha === mainSha;
    const behind = aligned ? 0 : await github.commitsBetween(deployedSha, mainSha);
    const ageHours = hoursBetween(effectiveAt, ctx.now);

    return {
      ...base,
      status: aligned ? 'pass' : 'fail',
      observed_at: ctx.now.toISOString(),
      evidence: aligned
        ? `Last production mutation (${deployRun.html_url}, ${effectiveAt}) shipped ${deployedSha}, which is main HEAD.`
        : `Last production mutation (${deployRun.html_url}, ${effectiveAt}, ${ageHours}h ago) shipped ${deployedSha}; main HEAD is ${mainSha}` +
          (behind === null ? ' (commit distance unreadable).' : `, ${behind} commits ahead.`),
      measured: {
        main_sha: mainSha,
        deployed_sha: deployedSha,
        deploy_run_url: deployRun.html_url,
        deploy_run_completed_at: effectiveAt,
        deploy_age_hours: ageHours,
        commits_ahead: behind,
      },
      unreadable_reason: null,
    };
  } catch (error) {
    return unreadable(base, errorMessage(error), ctx.now);
  }
}

// ── UTV2-1660: parked-vs-active runtime state ───────────────────────────────
//
// A service that is intentionally parked (SYNDICATE_MACHINE_ENABLED=false and
// the matching ingestor/worker autorun flags) is EXPECTED to show no new
// activity. Before this lane, ingestor_health/worker_outbox_health evaluated
// every deployment the same way, so a correctly-parked deployment and an
// unexpectedly-dead active deployment produced the identical `fail` reading —
// exactly the "998h stale ingestor" false alarm that motivated this fix.
//
// `parked_verified` is NOT the same claim as `active_healthy` — it never
// asserts the service is running, only that its declared-and-independently-
// confirmed parked state explains the absence of activity, and that nothing
// resumed operating despite the parked instruction (`parked_drift`, which is
// a HARD failure — worse than an ordinary active failure, since it means the
// containment itself did not hold). When the parked mode/evidence cannot be
// established at all, both probes fall through to the exact unchanged
// active-mode threshold logic below — this function only ever ADDS a more
// specific classification; it never weakens or bypasses an existing check.
export type RuntimeState =
  | 'active_healthy'
  | 'active_degraded'
  | 'active_failed'
  | 'parked_verified'
  | 'parked_drift'
  | 'unreadable';

export const PARKED_CONTRACT_RECEIPT_ARTIFACT_PREFIX = 'parked-contract-receipt-';

// Round 22 (PM review of 192b597d): these two same-run artifacts are written
// by deploy.yml's `promote` job -- deploy-mutation-receipt immediately after
// the container-replacement step succeeds (before the health-check loop
// even starts), and deploy-rollback-receipt only if the health-check later
// fails AND a configured rollback succeeds. Their presence, not any job's
// overall conclusion, is what actually proves production was mutated.
export const DEPLOY_MUTATION_RECEIPT_ARTIFACT_PREFIX = 'deploy-mutation-receipt-';
export const DEPLOY_ROLLBACK_RECEIPT_ARTIFACT_PREFIX = 'deploy-rollback-receipt-';

export interface ParkedContractReceipt {
  schema: string;
  stage: string;
  mode: string;
  requestedValue: string;
  runtimeValue: string;
  ingestorAutorun: string;
  ingestorScheduling: string;
  workerAutorun: string;
  enabledTargets: string;
  releaseTag: string;
  deployedImageNamespace: string;
  killSwitchEngaged: boolean;
  observedAt: string;
}

export interface ParkedContractResolution {
  available: boolean;
  reason: string | null;
  receipt: ParkedContractReceipt | null;
  runUrl: string | null;
  runHeadSha: string | null;
}

function isParkedContractReceipt(value: unknown): value is ParkedContractReceipt {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    record['schema'] === 'parked-contract-receipt/v1' &&
    typeof record['mode'] === 'string' &&
    typeof record['requestedValue'] === 'string' &&
    typeof record['ingestorAutorun'] === 'string' &&
    typeof record['workerAutorun'] === 'string' &&
    typeof record['enabledTargets'] === 'string' &&
    typeof record['releaseTag'] === 'string' &&
    typeof record['observedAt'] === 'string'
  );
}

/**
 * Resolves the most recent production parked-contract evidence, independent of
 * whatever `deploy_sha_alignment` already computed — this file's own contract
 * is that every dimension measures fresh (see module docstring §1), so this is
 * a second, separately-fetched read, not a shared cache.
 */
export async function resolveParkedContractReceipt(ctx: ProbeContext): Promise<ParkedContractResolution> {
  const unavailable = (reason: string): ParkedContractResolution => ({
    available: false,
    reason,
    receipt: null,
    runUrl: null,
    runHeadSha: null,
  });

  if (!ctx.github) {
    return unavailable(ctx.githubUnavailableReason ?? 'no GitHub API reader was available');
  }

  try {
    // Fetch the NEWEST deploy.yml run across EVERY ref, not just main and not
    // just the newest SUCCESSFUL one. Two independent reasons this must not
    // filter by branch: deploy.yml's workflow_dispatch trigger (lines 3-13)
    // is unrestricted -- it can be run manually from any branch or tag, and
    // that run performs the exact same production container replacement as
    // a main-triggered one. A branch:'main' filter would be blind to a
    // newer, non-main-ref run that already mutated production, and could
    // report a genuinely dead deployment as parked_verified using a stale
    // main-branch receipt, or misreport a healthy one as drift. And a
    // server-side status=success filter is separately blind to a newer run
    // that's still in progress or that failed after already mutating
    // production. Trusting an older successful run's receipt while a newer,
    // non-success run exists (on any ref) would report stale evidence as
    // current.
    const run = await ctx.github.latestRun('deploy.yml');
    if (!run) return unavailable('no deploy.yml run exists');
    if (run.status !== 'completed' || run.conclusion !== 'success') {
      return unavailable(
        `the newest deploy.yml run (${run.html_url}) is not a completed success ` +
        `(status=${run.status}, conclusion=${run.conclusion ?? 'null'}) -- refusing to fall back ` +
        `to an older successful run's receipt while the newest run may have changed production state`,
      );
    }

    // Round 11: require the artifact to belong to THIS run's current attempt
    // -- a failed-jobs-only rerun of a later job (e.g. smoke) bumps run_attempt
    // and updated_at without re-running promote or producing a new receipt,
    // so a prefix-only match could silently return an earlier attempt's
    // receipt that no longer describes what most recently touched production.
    const raw = await ctx.github.latestArtifactJson(
      run.id,
      PARKED_CONTRACT_RECEIPT_ARTIFACT_PREFIX,
      run.run_attempt,
    );
    if (!raw) {
      return unavailable(
        `no parked-contract-receipt artifact found for deploy.yml run ${run.html_url} at its current attempt ` +
        `${run.run_attempt} -- if a later attempt re-ran only a downstream job (e.g. smoke) without re-running ` +
        `promote, no receipt exists for that attempt and an earlier attempt's receipt must not be trusted`,
      );
    }
    if (!isParkedContractReceipt(raw)) {
      return unavailable(
        `parked-contract-receipt artifact on ${run.html_url} did not match the expected schema`,
      );
    }
    if (raw.releaseTag !== run.head_sha) {
      return unavailable(
        `parked-contract-receipt releaseTag (${raw.releaseTag}) does not match the deploy run's own head SHA (${run.head_sha}) — refusing to trust a receipt that may belong to a different run`,
      );
    }

    return { available: true, reason: null, receipt: raw, runUrl: run.html_url, runHeadSha: run.head_sha };
  } catch (error) {
    return unavailable(errorMessage(error));
  }
}

/**
 * Independently re-checks the public delivery kill switches right now, rather
 * than trusting the deploy-time receipt's `killSwitchEngaged` claim — the
 * receipt is a point-in-time assertion from whenever that deploy ran; this
 * lane's whole purpose is proving the parked contract STILL holds now.
 */
const REQUIRED_KILL_SWITCH_TARGETS = ['best-bets', 'trader-insights'] as const;

// PM review (round 20, exact-head 4b2fae01): counting rows where killed='false'
// and requiring both counts to be zero fails OPEN when a required target's row
// is missing entirely -- a missing row also counts zero, so an absent
// delivery_kill_switch record for best-bets/trader-insights would be certified
// as engaged. Each required target must instead have EXACTLY ONE authoritative
// row, and that row's own killed column must be strictly true; missing (zero
// rows), duplicate (more than one row), or a value that isn't literally true
// (malformed) all fail closed, same as an unreadable query.
//
// Round 22 (PM review of 192b597d): countRows' real implementation selects a
// hardcoded 'id' column by default -- delivery_kill_switch has no id column
// at all (schema: actor, killed, reason, target, updated_at), so every call
// here failed at the PostgREST level with a real Supabase client, always
// falling through to the catch block and returning null (unreadable). This
// bug predates round 20 -- the original round-1 implementation had the same
// hardcoded-'id' gap, just never exercised against a real client in tests.
// 'target' is the column this query already filters on, so it is guaranteed
// to exist; pass it explicitly as the count column.
async function verifyKillSwitchesEngagedNow(ctx: ProbeContext): Promise<boolean | null> {
  const db = ctx.db;
  if (!db) return null;
  try {
    for (const target of REQUIRED_KILL_SWITCH_TARGETS) {
      const rowCount = await db.countRows(
        'delivery_kill_switch',
        [{ column: 'target', op: 'eq', value: target }],
        'target',
      );
      if (rowCount !== 1) return false;
      const row = await db.latestRow(
        'delivery_kill_switch',
        'killed',
        [{ column: 'target', op: 'eq', value: target }],
        'updated_at',
      );
      if (row?.['killed'] !== true) return false;
    }
    return true;
  } catch {
    return null;
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

    // Unchanged active-mode logic: exactly the same checks and thresholds as
    // before this lane. This is the fallback whenever parked mode cannot be
    // independently established, and it is what still applies verbatim when
    // the deployed mode genuinely is active.
    const failures: string[] = [];
    if (cycleAge === null) failures.push('no ingestor.cycle row exists');
    else if (cycleAge > THRESHOLDS.ingestorCycleMaxMinutes)
      failures.push(`latest ingestor.cycle started ${cycleStartedAt} (${cycleAge}m old, threshold ${THRESHOLDS.ingestorCycleMaxMinutes}m)`);
    if (cycleStatus && cycleStatus !== 'success' && cycleStatus !== 'completed')
      failures.push(`latest ingestor.cycle status is "${cycleStatus}"`);
    if (offerAge === null) failures.push('no merged provider_cycle_status row exists');
    else if (offerAge > THRESHOLDS.ingestorOfferMaxMinutes)
      failures.push(`latest merged provider cycle updated ${mergedAt} (${offerAge}m old, threshold ${THRESHOLDS.ingestorOfferMaxMinutes}m)`);

    const parked = await resolveParkedContractReceipt(ctx);
    const measuredBase = {
      latest_cycle_started_at: cycleStartedAt,
      latest_cycle_status: cycleStatus,
      latest_cycle_age_minutes: cycleAge,
      latest_merged_cycle_at: mergedAt,
      latest_merged_cycle_age_minutes: offerAge,
      latest_game_result_at: resultAt,
    };

    if (parked.available && parked.receipt && parked.receipt.mode === 'parked') {
      const receipt = parked.receipt;
      // Round 15: apps/ingestor/src/index.ts calls reapStaleRuns() BEFORE
      // runIngestorCycles() on every startup -- an accidentally-resumed
      // ingestor's very first action is this reap, not a new cycle.
      // packages/db/src/runtime-repositories.ts's real implementation
      // updates ONLY status='failed' and finished_at on a stale row; it
      // never touches started_at. If that reaped row (or a crash/delay
      // before the first new cycle) is the only post-startup DB evidence,
      // cycleStartedAt above still reflects the OLD, pre-parking value --
      // the ingestor could have genuinely resumed and mutated the DB while
      // this check reads it as no activity. finished_at is the durable
      // signal a started_at-only check misses.
      const ingestorCycleFinishedSinceParking = await db.countRows('system_runs', [
        { column: 'run_type', op: 'eq', value: 'ingestor.cycle' },
        { column: 'finished_at', op: 'gt', value: receipt.observedAt },
      ]);
      const driftReasons: string[] = [];
      if (receipt.ingestorAutorun !== 'false')
        driftReasons.push(`parked-contract receipt reports UNIT_TALK_INGESTOR_AUTORUN="${receipt.ingestorAutorun}", expected "false"`);
      if (receipt.ingestorScheduling !== 'false')
        driftReasons.push(`parked-contract receipt reports UNIT_TALK_INGESTOR_SCHEDULING_ENABLED="${receipt.ingestorScheduling}", expected "false"`);
      if (cycleStartedAt && isAfter(cycleStartedAt, receipt.observedAt))
        driftReasons.push(`an ingestor.cycle started at ${cycleStartedAt}, AFTER the parked deploy was confirmed at ${receipt.observedAt} — the ingestor ran despite being parked`);
      if (mergedAt && isAfter(mergedAt, receipt.observedAt))
        driftReasons.push(`a provider cycle merged at ${mergedAt}, AFTER the parked deploy was confirmed at ${receipt.observedAt}`);
      if (ingestorCycleFinishedSinceParking > 0)
        driftReasons.push(`${ingestorCycleFinishedSinceParking} system_runs row(s) with run_type='ingestor.cycle' show finished_at after the parked deploy was confirmed at ${receipt.observedAt} — a reapStaleRuns() startup mutation or cycle completion despite parked mode, detected even though the reaped row's own started_at predates parking`);

      if (driftReasons.length > 0) {
        return {
          ...base,
          status: 'fail',
          observed_at: ctx.now.toISOString(),
          evidence: `PARKED_DRIFT: ${driftReasons.join('; ')}. Read-only observation; no restart or mutation performed.`,
          measured: {
            ...measuredBase,
            runtime_state: 'parked_drift' satisfies RuntimeState,
            parked_receipt_run_url: parked.runUrl,
            post_parking_ingestor_cycle_finished_count: ingestorCycleFinishedSinceParking,
          },
          unreadable_reason: null,
        };
      }

      return {
        ...base,
        status: 'pass',
        observed_at: ctx.now.toISOString(),
        evidence:
          `parked_verified: production deploy ${parked.runUrl} confirmed SYNDICATE_MACHINE_ENABLED=false, ` +
          `UNIT_TALK_INGESTOR_AUTORUN=false, UNIT_TALK_INGESTOR_SCHEDULING_ENABLED=false at ${receipt.observedAt}; ` +
          `no ingestor activity observed since. This is NOT ordinary active health -- the ingestor is intentionally stopped, ` +
          `not confirmed running. Absence of a fresh cycle is expected under this contract.`,
        measured: {
          ...measuredBase,
          runtime_state: 'parked_verified' satisfies RuntimeState,
          parked_receipt_run_url: parked.runUrl,
          post_parking_ingestor_cycle_finished_count: ingestorCycleFinishedSinceParking,
        },
        unreadable_reason: null,
      };
    }

    const degraded =
      failures.length === 0 &&
      cycleAge !== null &&
      cycleAge > THRESHOLDS.ingestorCycleMaxMinutes / 2;
    const runtimeState: RuntimeState =
      failures.length > 0 ? 'active_failed' : degraded ? 'active_degraded' : 'active_healthy';

    return {
      ...base,
      status: failures.length === 0 ? 'pass' : 'fail',
      observed_at: ctx.now.toISOString(),
      evidence:
        failures.length === 0
          ? `Latest ingestor.cycle started ${cycleStartedAt} (${cycleAge}m, status ${cycleStatus}); latest merged provider cycle ${mergedAt} (${offerAge}m); latest game_results row ${resultAt}.` +
            (degraded ? ` DEGRADED: past ${Math.round(THRESHOLDS.ingestorCycleMaxMinutes / 2)}m of the ${THRESHOLDS.ingestorCycleMaxMinutes}m SLA with no fresher cycle yet.` : '') +
            (parked.available ? '' : ` (parked-mode evidence unavailable: ${parked.reason}; evaluated as active.)`)
          : `${failures.join('; ')}. Latest game_results row: ${resultAt ?? 'none'}. Read-only observation; no restart or mutation performed.` +
            (parked.available ? '' : ` (parked-mode evidence unavailable: ${parked.reason}; evaluated as active.)`),
      measured: { ...measuredBase, runtime_state: runtimeState },
      unreadable_reason: null,
    };
  } catch (error) {
    return {
      ...unreadable(base, errorMessage(error), ctx.now),
      measured: { runtime_state: 'unreadable' satisfies RuntimeState },
    };
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

    // Unchanged active-mode logic: exactly the same checks and thresholds as
    // before this lane (see probeIngestorHealth for the same guarantee).
    const failures: string[] = [];
    if (heartbeatAge === null) failures.push('no worker.heartbeat row exists');
    else if (heartbeatAge > THRESHOLDS.workerHeartbeatMaxMinutes)
      failures.push(`worker.heartbeat is ${heartbeatAge}m old (threshold ${THRESHOLDS.workerHeartbeatMaxMinutes}m), last status "${heartbeatStatus}"`);
    if (staleUnknown > 0)
      failures.push(`${staleUnknown} bucket:stale_unknown rows (processing > ${THRESHOLDS.outboxStaleProcessingMinutes}m)`);
    if (stuckRetryable > 0)
      failures.push(`${stuckRetryable} attempted rows still pending after ${THRESHOLDS.outboxStalePendingMinutes}m`);

    const parked = await resolveParkedContractReceipt(ctx);
    const measuredBase = {
      heartbeat_started_at: heartbeatAt,
      heartbeat_status: heartbeatStatus,
      heartbeat_age_minutes: heartbeatAge,
      pending_count: pending,
      processing_count: processing,
      stale_unknown_count: staleUnknown,
      stuck_retryable_count: stuckRetryable,
    };

    if (parked.available && parked.receipt && parked.receipt.mode === 'parked') {
      const receipt = parked.receipt;
      const killSwitchNow = await verifyKillSwitchesEngagedNow(ctx);
      // A row claimed and delivered quickly, before the 5m/30m "stuck" windows
      // above would elapse, leaves staleUnknown/stuckRetryable both at zero
      // even though the worker plainly ran -- this is the general safety net
      // those stuck-subset counters cannot be.
      //
      // Querying `audit_log` filtered on `actor` was tried and reverted: real
      // production audit_log data (queried live, 2026-08-02) shows the
      // *_outbox actor space is large and unstable -- besides the worker
      // (`worker-dev`/`worker-prod`) and `recap-service`, the submission/
      // promotion pipeline enqueues under actor `submission`/`requeue`, and
      // every one-off T1/T2 live-DB proof lane invents its own actor name
      // (`command-center-proof-*`, `utv2-###-*`, `codex-incident-validation`,
      // etc.). An actor denylist chases an ever-growing list; an allowlist of
      // `worker-dev`/`worker-prod` is just as fragile against a future
      // workerId naming change. Neither is stable enough to depend on.
      //
      // Two signals instead, both tied to a specific worker-exclusive CODE
      // PATH rather than an actor string, so they can't be produced by any
      // other caller regardless of what it names itself:
      //  1. system_runs.run_type='distribution.process': created by
      //     distribution-worker.ts's claim step (line 164), immediately
      //     after claimNext/claimNextAtomic succeeds, before success/failure
      //     is known. Covers the main claim-and-process path in full --
      //     quick success, quick failure, or a still-outstanding claim --
      //     since claimed_at and this run are set in the same code sequence.
      //  2. distribution_outbox.last_error LIKE 'stale claim reaped by%' AND
      //     updated_at > observedAt: apps/worker/src/runner.ts's
      //     reapStaleClaims covers runWorkerCycles's SEPARATE stale-claim-
      //     reaping step (lines 167-183/428-463), which runs before
      //     processNextDistributionWork in the same cycle and creates no
      //     system_runs row. The real (Supabase-backed) implementation of
      //     this reap (packages/db/src/runtime-repositories.ts) writes
      //     `last_error: reason` (reason = "stale claim reaped by
      //     ${workerId}") in the SAME atomic UPDATE that clears claimed_at
      //     and bumps updated_at -- not the separate audit_log.record() call
      //     runner.ts makes afterward, which is NOT atomic with the mutation
      //     (if that later write throws, the reap already happened but the
      //     audit trail wouldn't exist, and an audit_log-based check would
      //     silently miss it). Querying the outbox row's own atomically-
      //     written field instead has no such gap.
      const workerRunsSinceParking = await db.countRows('system_runs', [
        { column: 'run_type', op: 'eq', value: 'distribution.process' },
        { column: 'started_at', op: 'gt', value: receipt.observedAt },
      ]);
      const staleClaimReapsSinceParking = await db.countRows('distribution_outbox', [
        { column: 'last_error', op: 'like', value: 'stale claim reaped by%' },
        { column: 'updated_at', op: 'gt', value: receipt.observedAt },
      ]);
      // Round 13: a row currently claimed (status='processing') with
      // claimed_at after the receipt's observedAt is live evidence of
      // post-parking activity that doesn't require waiting for the 5-minute
      // staleness threshold to elapse, and doesn't depend on
      // repositories.runs.startRun() (a separate, non-atomic write after
      // claimNextAtomic()) having succeeded -- unlike workerRunsSinceParking,
      // this can't miss a claim whose run-record insert failed transiently.
      const liveClaimsSinceParking = await db.countRows('distribution_outbox', [
        { column: 'status', op: 'eq', value: 'processing' },
        { column: 'claimed_at', op: 'gt', value: receipt.observedAt },
      ]);
      const driftReasons: string[] = [];
      if (receipt.workerAutorun !== 'false')
        driftReasons.push(`parked-contract receipt reports UNIT_TALK_WORKER_AUTORUN="${receipt.workerAutorun}", expected "false"`);
      if (receipt.enabledTargets !== 'none')
        driftReasons.push(`parked-contract receipt reports UNIT_TALK_ENABLED_TARGETS="${receipt.enabledTargets}", expected "none"`);
      if (!receipt.killSwitchEngaged)
        driftReasons.push('parked-contract receipt itself did not confirm public kill switches engaged');
      // Round 14: `killSwitchNow === false` is CONFIRMED drift (the recheck
      // ran and proves containment did not hold) -- that belongs in
      // driftReasons alongside every other genuine drift signal below.
      // `killSwitchNow === null` means the RECHECK ITSELF failed (query
      // threw, DB unreachable) -- that is an observability failure, not a
      // confirmed product condition. Folding both into driftReasons turned
      // "we could not check" into a confident `status: 'fail',
      // runtime_state: 'parked_drift'` with `unreadable_reason: null` --
      // a false RED reported as fully-observed. Tracked separately so an
      // unreadable recheck downgrades the dimension to `unknown` only when
      // no OTHER signal already proves genuine drift on its own.
      let killSwitchUnreadable = false;
      if (killSwitchNow === false) {
        driftReasons.push('re-verified NOW: public best-bets/trader-insights kill switches are not both engaged');
      } else if (killSwitchNow === null) {
        killSwitchUnreadable = true;
      }
      if (heartbeatAt && isAfter(heartbeatAt, receipt.observedAt))
        driftReasons.push(`worker.heartbeat ran at ${heartbeatAt}, AFTER the parked deploy was confirmed at ${receipt.observedAt} — the worker started despite UNIT_TALK_WORKER_AUTORUN=false`);
      // Round 13: staleUnknown/stuckRetryable are NOT time-scoped to parking
      // -- they count rows currently over the active-mode staleness
      // threshold regardless of whether that staleness predates parking.
      // A row already stuck in processing (or already pending-with-attempts)
      // BEFORE parking, left untouched by parking itself, eventually crosses
      // the 5m/30m threshold purely by the clock running while parked --
      // producing a false PARKED_DRIFT with no actual post-parking activity.
      // Deliberately excluded here; liveClaimsSinceParking below is the
      // time-scoped replacement for the "currently claimed" case, and
      // workerRunsSinceParking/staleClaimReapsSinceParking already cover
      // claim-and-process and stale-claim-reap respectively.
      if (liveClaimsSinceParking > 0)
        driftReasons.push(`${liveClaimsSinceParking} outbox row(s) currently claimed (status='processing') with claimed_at after the parked deploy was confirmed at ${receipt.observedAt} — live post-parking processing, detected without waiting for the active-mode staleness threshold and independent of whether the accompanying system_runs write succeeded`);
      if (workerRunsSinceParking > 0)
        driftReasons.push(`${workerRunsSinceParking} system_runs row(s) with run_type='distribution.process' started after the parked deploy was confirmed at ${receipt.observedAt} — the worker claimed and began processing despite parked mode (created at the moment of claim, before success/failure is known, so it catches quick success, quick failure, or a still-outstanding claim alike)`);
      if (staleClaimReapsSinceParking > 0)
        driftReasons.push(`${staleClaimReapsSinceParking} outbox row(s) show a stale-claim reap (last_error LIKE 'stale claim reaped by%') updated after ${receipt.observedAt} — the worker's cycle ran and reaped a stuck claim despite parked mode, a separate step that creates no system_runs row and whose audit_log entry is not atomic with the mutation`);

      if (driftReasons.length > 0) {
        return {
          ...base,
          status: 'fail',
          observed_at: ctx.now.toISOString(),
          evidence: `PARKED_DRIFT: ${driftReasons.join('; ')}. Read-only observation; no restart or mutation performed.`,
          measured: {
            ...measuredBase,
            runtime_state: 'parked_drift' satisfies RuntimeState,
            parked_receipt_run_url: parked.runUrl,
            kill_switch_reverified_engaged: killSwitchNow,
            post_parking_worker_run_count: workerRunsSinceParking,
            post_parking_stale_claim_reap_count: staleClaimReapsSinceParking,
            post_parking_live_claim_count: liveClaimsSinceParking,
          },
          unreadable_reason: null,
        };
      }

      if (killSwitchUnreadable) {
        return {
          ...unreadable(
            base,
            `live kill-switch recheck was unreadable (query failed or DB unreachable) for a deployment reporting ` +
            `itself parked (${parked.runUrl}) -- unreadable containment evidence cannot be treated as confirming ` +
            `parked state, but no other signal shows genuine drift either, so this is unproven rather than a ` +
            `confirmed breach`,
            ctx.now,
          ),
          measured: { runtime_state: 'unreadable' satisfies RuntimeState },
        };
      }

      return {
        ...base,
        status: 'pass',
        observed_at: ctx.now.toISOString(),
        evidence:
          `parked_verified: production deploy ${parked.runUrl} confirmed SYNDICATE_MACHINE_ENABLED=false, ` +
          `UNIT_TALK_WORKER_AUTORUN=false, UNIT_TALK_ENABLED_TARGETS=none at ${receipt.observedAt}; kill switches ` +
          `re-verified engaged now; no worker/outbox activity observed since. This is NOT ordinary active health -- ` +
          `the worker is intentionally stopped, not confirmed running. Absence of a fresh heartbeat is expected under this contract.`,
        measured: {
          ...measuredBase,
          runtime_state: 'parked_verified' satisfies RuntimeState,
          parked_receipt_run_url: parked.runUrl,
          kill_switch_reverified_engaged: killSwitchNow,
          post_parking_worker_run_count: workerRunsSinceParking,
          post_parking_stale_claim_reap_count: staleClaimReapsSinceParking,
          post_parking_live_claim_count: liveClaimsSinceParking,
        },
        unreadable_reason: null,
      };
    }

    const degraded =
      failures.length === 0 &&
      heartbeatAge !== null &&
      heartbeatAge > THRESHOLDS.workerHeartbeatMaxMinutes / 2;
    const runtimeState: RuntimeState =
      failures.length > 0 ? 'active_failed' : degraded ? 'active_degraded' : 'active_healthy';

    return {
      ...base,
      status: failures.length === 0 ? 'pass' : 'fail',
      observed_at: ctx.now.toISOString(),
      evidence:
        `Queue buckets per ${QUEUE_SEMANTICS_DOC} v${QUEUE_SEMANTICS_VERSION}: pending=${pending}, processing=${processing}, ` +
        `stale_unknown=${staleUnknown}, attempted-and-stuck=${stuckRetryable}. ` +
        `worker.heartbeat ${heartbeatAt ?? 'none'} (${heartbeatAge ?? 'n/a'}m, status ${heartbeatStatus ?? 'n/a'}). ` +
        (failures.length === 0 ? 'No stuck rows.' : `FAIL: ${failures.join('; ')}.`) +
        (degraded ? ` DEGRADED: past ${Math.round(THRESHOLDS.workerHeartbeatMaxMinutes / 2)}m of the ${THRESHOLDS.workerHeartbeatMaxMinutes}m SLA with no fresher heartbeat yet.` : '') +
        (parked.available ? '' : ` (parked-mode evidence unavailable: ${parked.reason}; evaluated as active.)`),
      measured: { ...measuredBase, runtime_state: runtimeState },
      unreadable_reason: null,
    };
  } catch (error) {
    return {
      ...unreadable(base, errorMessage(error), ctx.now),
      measured: { runtime_state: 'unreadable' satisfies RuntimeState },
    };
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
    // Round 13: mainSha must be resolved BEFORE latestRun, not in parallel --
    // scoping the run lookup to this exact commit (headSha) is what stops an
    // unrelated older run's manual rerun from shadowing the run that
    // actually corresponds to the current head via a newer updated_at.
    const mainSha = await github.headSha('main');
    const run = await github.latestRun('ci.yml', { branch: 'main', headSha: mainSha });

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
  like(column: string, value: string): FilterBuilder;
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
      case 'like':
        return query.like(filter.column, String(filter.value));
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
    async countRows(table, filters, countColumn = 'id') {
      const { count, error } = await applyFilters(
        client.from(table).select(countColumn, { count: 'exact', head: true }),
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

    // Round 12: a single per_page=20 page isn't enough -- if more than 20
    // newer-by-created_at runs exist, a manually re-run OLDER run
    // (selectMostRecentlyUpdatedRun's whole reason for existing) would be
    // excluded from the page entirely and never even considered. Paginate
    // up to a bounded number of pages: deploy.yml is a manually/production-
    // triggered workflow, not high-frequency CI, so PAGES * 100 is a
    // deliberately generous bound, not a silent truncation -- if it's ever
    // insufficient in practice, that's a signal to raise the bound, not a
    // hidden gap. Shared by latestRun and listRunsByRecency (round 14) so
    // both see the identical candidate set.
    function fetchCandidateRuns(
      workflowFile: string,
      options: { branch?: string; status?: string; headSha?: string },
    ): WorkflowRun[] {
      const PAGE_SIZE = 100;
      const MAX_PAGES = 5;
      const params = new URLSearchParams({ per_page: String(PAGE_SIZE) });
      if (options.branch) params.set('branch', options.branch);
      if (options.status) params.set('status', options.status);
      // Round 13: server-side head_sha filtering, when a specific commit is
      // being asked about -- an unrelated older run's rerun can never
      // shadow the run for THIS commit, since it's excluded at the API
      // level rather than merely losing an updated_at comparison.
      if (options.headSha) params.set('head_sha', options.headSha);
      const allRuns: WorkflowRun[] = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        params.set('page', String(page));
        const response = ghApi(
          `repos/${repo}/actions/workflows/${workflowFile}/runs?${params.toString()}`,
        ) as { workflow_runs?: WorkflowRun[] };
        const pageRuns = response.workflow_runs ?? [];
        allRuns.push(...pageRuns);
        if (pageRuns.length < PAGE_SIZE) break;
      }
      return allRuns;
    }

    return {
      github: {
        repo,
        async headSha(branch) {
          const commit = ghApi(`repos/${repo}/commits/${branch}`) as { sha?: string };
          if (!commit.sha) throw new Error(`commits/${branch} returned no sha`);
          return commit.sha;
        },
        async latestRun(workflowFile, options = {}) {
          return selectMostRecentlyUpdatedRun(fetchCandidateRuns(workflowFile, options));
        },
        async listRunsByRecency(workflowFile, options = {}) {
          return sortByMostRecentlyUpdated(fetchCandidateRuns(workflowFile, options));
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
        async latestArtifactJson(runId, namePrefix, expectedAttempt) {
          const response = ghApi(`repos/${repo}/actions/runs/${runId}/artifacts`) as {
            artifacts?: { name: string; created_at: string }[];
          };
          const nameFilter =
            expectedAttempt === undefined
              ? (artifact: { name: string }) => artifact.name.startsWith(namePrefix)
              : (artifact: { name: string }) => artifact.name === `${namePrefix}${runId}-${expectedAttempt}`;
          const candidate = (response.artifacts ?? [])
            .filter(nameFilter)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
          if (!candidate) return null;

          const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-artifact-'));
          try {
            execFileSync('gh', ['run', 'download', String(runId), '-n', candidate.name, '-D', dir], {
              encoding: 'utf8',
            });
            const jsonFile = fs.readdirSync(dir).find((file) => file.endsWith('.json'));
            if (!jsonFile) return null;
            return JSON.parse(fs.readFileSync(path.join(dir, jsonFile), 'utf8')) as Record<string, unknown>;
          } finally {
            fs.rmSync(dir, { recursive: true, force: true });
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
