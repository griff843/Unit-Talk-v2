/**
 * UTV2-1630 — no pull-request-triggered job may hold a production database
 * credential.
 *
 * ## Why a scanner rather than a review rule
 *
 * The production write incidents of 2026-07-29/30 were not caused by anyone
 * deciding CI should write to production. They were caused by a credential
 * sitting in a job whose call graph nobody re-derived: `ci.yml` handed
 * `secrets.SUPABASE_*` to `verify`, and `verify:live-db-verdict` reached
 * `pnpm test:db` three hops later. The guard that was supposed to stop it lived
 * in a branch of that graph nothing took.
 *
 * Fixing the three known workflows does not stop the fourth from being written.
 * The only durable form of "CI can never write to production" is a check that
 * enumerates every workflow, every time, and fails on a credential it was not
 * told to expect. Prose in a doc cannot do that (CLAUDE.md invariant 11).
 *
 * ## The rule
 *
 * A job reachable from `pull_request` or `pull_request_target` may not
 * reference any production Supabase secret. Pull-request triggers are the
 * untrusted-input surface: they run on every proposed change, including one
 * whose whole purpose is to alter what CI executes.
 *
 * `push`/`schedule`/`workflow_dispatch` jobs are deliberately out of scope —
 * deploying to production and monitoring production are what those exist for.
 *
 * Exemptions are per (workflow, job) and must carry a reason. An exemption
 * asserts the job only READS production; it never licenses a write.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * Secrets that resolve to the canonical production project
 * (`zfzdnfwdarxucxtaojxm`) or to a superuser-capable connection to it.
 */
export const PRODUCTION_DB_SECRET_NAMES = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'SUPABASE_DB_POOLER_URL',
  'SUPABASE_ACCESS_TOKEN',
] as const;

const PULL_REQUEST_EVENTS = new Set(['pull_request', 'pull_request_target']);

/** Pseudo-job name for `env:` declared above `jobs:` and inherited by all of them. */
export const WORKFLOW_LEVEL_ENV = '<workflow-level env>';

/** Pseudo-secret name for `secrets: inherit`, which names no secret at all. */
export const SECRETS_INHERIT = '<secrets: inherit>';

export interface CredentialExemption {
  workflow: string;
  job: string;
  secrets: string[];
  reason: string;
}

/**
 * Read-only production consumers. Each is exempt for the named secrets only:
 * adding a secret to a job does not inherit its neighbour's exemption.
 */
export const READ_ONLY_EXEMPTIONS: CredentialExemption[] = [
  {
    workflow: 'live-schema-parity.yml',
    job: 'check-config',
    secrets: ['SUPABASE_DB_URL', 'SUPABASE_DB_POOLER_URL'],
    reason:
      'Tests connection-string presence only; never opens a connection. The parity check it gates is a schema read.',
  },
  {
    workflow: 'live-schema-parity.yml',
    job: 'schema-parity',
    secrets: ['SUPABASE_DB_URL', 'SUPABASE_DB_POOLER_URL'],
    reason:
      'Applies repo migrations to an EPHEMERAL LOCAL Supabase stack and compares its schema to live; the migrations are never applied to live. This job holds a production SUPERUSER Postgres URL and runs comparison scripts from the PR checkout, and those scripts are inside its own trigger path filter — so "catalog reads only" is a property of code the PR can replace. It is therefore gated on assert-unmodified-vs-base.ts for compare-databases.ts and schema-drift-gate.ts: a PR that modifies either cannot execute its own version here.',
  },
  {
    workflow: 'shadow-parity-required.yml',
    job: 'shadow-parity',
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    reason:
      'Runs scripts/shadow-scoring-runner.ts with --dry-run, which counts production state without writing. Its purpose is parity against PRODUCTION data, so staging would make the check meaningless. The runner asserts picksCreated/shadowModeFalseSet/distributionEnqueued/promotionWidened are all 0 and exits non-zero otherwise. That is a property of a file the PR supplies, so the job is additionally gated on assert-unmodified-vs-base.ts: a PR that modifies the runner cannot execute its own version against production.',
  },
  {
    workflow: 'supabase-pr-db-branch.yml',
    job: 'validate',
    secrets: ['SUPABASE_ACCESS_TOKEN'],
    reason:
      'Management-API token used to create an ISOLATED per-PR preview branch. Migrations and test:db run against that branch, never against the production database.',
  },
  {
    workflow: 'supabase-pr-db-branch.yml',
    job: 'teardown',
    secrets: ['SUPABASE_ACCESS_TOKEN'],
    reason: 'Deletes the isolated preview branch created by the validate job.',
  },
];

export interface CredentialExposure {
  workflow: string;
  job: string;
  secrets: string[];
}

function triggerNames(doc: Record<string, unknown>): string[] {
  // YAML 1.1 folds a bare `on:` key to boolean true. The `yaml` package parses
  // as 1.2 (key stays "on"), but reading both costs nothing and a silently
  // empty trigger list would make this whole guard pass vacuously.
  const raw = doc['on'] ?? (doc as Record<string, unknown>)['true'];
  if (raw == null) return [];
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) return raw.filter((entry): entry is string => typeof entry === 'string');
  if (typeof raw === 'object') return Object.keys(raw as Record<string, unknown>);
  return [];
}

/**
 * Every production secret a node references, by ANY expression form.
 *
 * Serializing captures every place an expression can hide — step `env`, job
 * `env`, workflow-level `env`, `with`, inline `run` text, `if` conditions —
 * without this scanner needing to model the workflow schema. A structural walk
 * that missed one field would fail open, which is the exact defect class here.
 *
 * Both accessor forms are matched. `secrets.NAME` is the common one;
 * `secrets['NAME']` and `secrets[format('SUPABASE_{0}','URL')]` are equivalent
 * to GitHub and were invisible to the dotted-only pattern.
 */
function referencedProductionSecrets(node: unknown): string[] {
  const serialized = JSON.stringify(node ?? null);
  const found = new Set<string>();
  for (const name of PRODUCTION_DB_SECRET_NAMES) {
    const dotted = new RegExp(`secrets\\s*\\.\\s*${name}\\b`);
    // secrets['NAME'] / secrets["NAME"] / secrets[format('…','NAME')] — any
    // bracket expression mentioning the name between the brackets.
    const bracketed = new RegExp(`secrets\\s*\\[[^\\]]*\\b${name}\\b[^\\]]*\\]`);
    if (dotted.test(serialized) || bracketed.test(serialized)) found.add(name);
  }
  return [...found].sort();
}

/**
 * `secrets: inherit` on a reusable-workflow call passes EVERY secret the caller
 * can see, including production ones, without naming any of them. No
 * name-based scan can see that, so it is reported as its own finding.
 */
function inheritsAllSecrets(node: unknown): boolean {
  return /"secrets"\s*:\s*"inherit"/u.test(JSON.stringify(node ?? null));
}

/**
 * Local reusable workflows invoked by this document, e.g.
 * `uses: ./.github/workflows/thing.yml`. A callee inherits its caller's trigger
 * surface: if a pull_request workflow calls it, it is pull-request-reachable,
 * even though its own `on:` is only `workflow_call`.
 */
function localCallees(doc: Record<string, unknown>): string[] {
  const serialized = JSON.stringify(doc);
  return [...serialized.matchAll(/\.github\/workflows\/([A-Za-z0-9._-]+\.ya?ml)/gu)].map((m) => m[1] as string);
}

function isExempt(
  workflow: string,
  job: string,
  secret: string,
  exemptions: CredentialExemption[],
): boolean {
  return exemptions.some(
    (entry) =>
      entry.workflow === workflow && entry.job === job && entry.secrets.includes(secret),
  );
}

/**
 * Every pull-request-reachable job holding a production credential it has no
 * exemption for. An empty array is the only passing state.
 */
function parseWorkflow(workflowDir: string, file: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = readFileSync(join(workflowDir, file), 'utf8');
  } catch {
    return null;
  }
  const parsed = parseYaml(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/**
 * Workflow files reachable from a pull request, including reusable workflows
 * called by one.
 *
 * A `workflow_call` callee has no `pull_request` in its own `on:`, so a
 * trigger-only test skips it entirely — while it still runs, with the caller's
 * secrets, on every pull request. Resolving the call graph is what makes the
 * scan match what GitHub actually executes.
 */
export function pullRequestReachableWorkflows(workflowDir: string): Set<string> {
  const files = readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name));
  const reachable = new Set<string>();
  const queue: string[] = [];

  for (const file of files) {
    const doc = parseWorkflow(workflowDir, file);
    if (!doc) continue;
    if (triggerNames(doc).some((name) => PULL_REQUEST_EVENTS.has(name))) {
      reachable.add(file);
      queue.push(file);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift() as string;
    const doc = parseWorkflow(workflowDir, current);
    if (!doc) continue;
    for (const callee of localCallees(doc)) {
      if (!reachable.has(callee) && files.includes(callee)) {
        reachable.add(callee);
        queue.push(callee);
      }
    }
  }

  return reachable;
}

/**
 * Every pull-request-reachable job holding a production credential it has no
 * exemption for. An empty array is the only passing state.
 *
 * Workflow-level `env:` is scanned as its own pseudo-job. It sits OUTSIDE the
 * `jobs` subtree but is inherited by every job in the file, so a `jobs`-only
 * walk reports nothing while every job holds the credential — the most likely
 * accidental form of this defect.
 */
export function findProductionCredentialExposures(
  workflowDir: string,
  exemptions: CredentialExemption[] = READ_ONLY_EXEMPTIONS,
): CredentialExposure[] {
  const exposures: CredentialExposure[] = [];
  const reachable = pullRequestReachableWorkflows(workflowDir);

  for (const file of [...reachable].sort()) {
    const doc = parseWorkflow(workflowDir, file);
    if (!doc) continue;

    const workflowEnv = referencedProductionSecrets(doc['env']).filter(
      (secret) => !isExempt(file, WORKFLOW_LEVEL_ENV, secret, exemptions),
    );
    if (workflowEnv.length > 0) {
      exposures.push({ workflow: file, job: WORKFLOW_LEVEL_ENV, secrets: workflowEnv });
    }

    const jobs = doc['jobs'];
    if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs)) continue;

    for (const [jobId, body] of Object.entries(jobs as Record<string, unknown>)) {
      const offending = referencedProductionSecrets(body).filter(
        (secret) => !isExempt(file, jobId, secret, exemptions),
      );
      if (offending.length > 0) {
        exposures.push({ workflow: file, job: jobId, secrets: offending });
      }
      // `secrets: inherit` names nothing, so no name-based scan can see it. It
      // hands the callee every secret the caller holds, production included.
      if (inheritsAllSecrets(body) && !isExempt(file, jobId, SECRETS_INHERIT, exemptions)) {
        exposures.push({ workflow: file, job: jobId, secrets: [SECRETS_INHERIT] });
      }
    }
  }

  return exposures;
}

/**
 * Jobs that reference a staging secret without binding the environment that
 * releases it.
 *
 * Environment secrets are scoped per job and are never inherited from a sibling.
 * A job that interpolates an environment-scoped `secrets.CI_SUPABASE_*` without
 * `environment: staging-ci` receives an EMPTY STRING — so it neither writes to
 * production (safe) nor works (broken). `proof-gate.yml`'s `t1-proof` job hit
 * exactly this: its env block was migrated alongside `runtime-verifier`, but
 * only `runtime-verifier` got the binding, and C2 failed for every T1 lane with
 * no indication that a credential was missing rather than wrong.
 *
 * NOTE: not every `CI_SUPABASE_*` name is environment-scoped today. Four of
 * them (`CI_SUPABASE_URL`, `CI_SUPABASE_PROJECT_REF`, `CI_SUPABASE_ANON_KEY`,
 * `CI_SUPABASE_SERVICE_ROLE_KEY`) also exist as repository-level secrets left
 * over from UTV2-1627, and repository secrets ARE released to every job. That
 * makes the failure mode partial rather than total, which is worse to diagnose:
 * a job can resolve the URL and ref while the keys come back empty. All four
 * point at staging, so this is a correctness problem, not an exposure. They
 * should be deleted once nothing references them.
 *
 * Unlike the production check, this scans EVERY trigger — a scheduled or
 * dispatched job is just as broken by the omission.
 */
export function findUnboundStagingCredentialJobs(workflowDir: string): CredentialExposure[] {
  const STAGING_ENVIRONMENT = 'staging-ci';
  const findings: CredentialExposure[] = [];

  for (const file of readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name)).sort()) {
    const parsed = parseYaml(readFileSync(join(workflowDir, file), 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;

    const jobs = (parsed as Record<string, unknown>)['jobs'];
    if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs)) continue;

    for (const [jobId, body] of Object.entries(jobs as Record<string, unknown>)) {
      const used = [...JSON.stringify(body ?? null).matchAll(/secrets\s*\.\s*(CI_SUPABASE_[A-Z_]+)\b/gu)].map(
        (m) => m[1],
      );
      if (used.length === 0) continue;

      const environment = (body as Record<string, unknown> | null)?.['environment'];
      const bound =
        environment === STAGING_ENVIRONMENT ||
        (typeof environment === 'object' &&
          environment !== null &&
          (environment as Record<string, unknown>)['name'] === STAGING_ENVIRONMENT);

      if (!bound) {
        findings.push({ workflow: file, job: jobId, secrets: [...new Set(used)].sort() });
      }
    }
  }

  return findings;
}

export function formatExposures(exposures: CredentialExposure[]): string {
  return exposures
    .map((item) => `  ${item.workflow} :: job "${item.job}" → ${item.secrets.join(', ')}`)
    .join('\n');
}
