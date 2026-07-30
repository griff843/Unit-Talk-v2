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
      'Applies repo migrations to an EPHEMERAL LOCAL Supabase stack and compares its schema to live. Live is read via compare-databases.ts / schema-drift-gate.ts, which issue catalog reads only — the migrations are never applied to live.',
  },
  {
    workflow: 'shadow-parity-required.yml',
    job: 'shadow-parity',
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    reason:
      'Runs scripts/shadow-scoring-runner.ts with --dry-run, which counts production state without writing. Its purpose is parity against PRODUCTION data, so staging would make the check meaningless. The runner asserts picksCreated/shadowModeFalseSet/distributionEnqueued/promotionWidened are all 0 and exits non-zero otherwise, so an accidental write fails the job.',
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

function referencedProductionSecrets(job: unknown): string[] {
  // Serializing the parsed job captures every place an expression can hide —
  // step `env`, job `env`, `with`, inline `run` text, `if` conditions — without
  // this scanner needing to model the step schema. A structural walk that
  // missed one field would fail open, which is the exact defect class here.
  const serialized = JSON.stringify(job ?? null);
  const found = new Set<string>();
  for (const name of PRODUCTION_DB_SECRET_NAMES) {
    const pattern = new RegExp(`secrets\\s*\\.\\s*${name}\\b`);
    if (pattern.test(serialized)) found.add(name);
  }
  return [...found].sort();
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
export function findProductionCredentialExposures(
  workflowDir: string,
  exemptions: CredentialExemption[] = READ_ONLY_EXEMPTIONS,
): CredentialExposure[] {
  const exposures: CredentialExposure[] = [];

  for (const file of readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name)).sort()) {
    const parsed = parseYaml(readFileSync(join(workflowDir, file), 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const doc = parsed as Record<string, unknown>;

    if (!triggerNames(doc).some((name) => PULL_REQUEST_EVENTS.has(name))) continue;

    const jobs = doc['jobs'];
    if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs)) continue;

    for (const [jobId, body] of Object.entries(jobs as Record<string, unknown>)) {
      const offending = referencedProductionSecrets(body).filter(
        (secret) => !isExempt(file, jobId, secret, exemptions),
      );
      if (offending.length > 0) {
        exposures.push({ workflow: file, job: jobId, secrets: offending });
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
 * A job that interpolates `secrets.CI_SUPABASE_*` without `environment:
 * staging-ci` silently receives EMPTY STRINGS — so it neither writes to
 * production (safe) nor works (broken). `proof-gate.yml`'s `t1-proof` job hit
 * exactly this: its env block was migrated alongside `runtime-verifier`, but
 * only `runtime-verifier` got the binding, and C2 failed for every T1 lane with
 * no indication that a credential was missing rather than wrong.
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
