#!/usr/bin/env tsx
/**
 * UTV2-1626 — the shape `readiness-refresh.yml` must keep.
 *
 * The failure this encodes is not hypothetical. The scheduled refresh reported
 * success 26 times in a row while its only durable output sat unchanged for 13
 * days, because the workflow named "refresh" never invoked a generator at all —
 * it only checked the artifact's age and opened an issue. Nothing in CI could
 * notice, because "does this workflow actually produce and persist the thing it
 * is named for" was a property no test asserted.
 *
 * So the properties are asserted here, against the real file, and the tests
 * mutate the parsed workflow to prove each rule actually fires — a validator that
 * cannot fail is the same defect one level up.
 *
 * These rules are about mechanism, not wording: a step may be renamed freely, but
 * the run must still generate, persist, and prove persistence, and it must never
 * become pull-request-reachable while holding a production credential.
 */
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

export const READINESS_REFRESH_WORKFLOW = '.github/workflows/readiness-refresh.yml';
export const LEDGER_PATH = 'docs/06_status/readiness/readiness-score.json';

/** Marker each required mechanism is recognised by, in any step's `run` text. */
const GENERATOR_MARKER = 'ops:readiness-refresh';
const PERSISTENCE_PROOF_MARKER = '--mode persistence';
const PUSH_MARKER = 'git push';

export interface WorkflowViolation {
  rule: string;
  detail: string;
}

interface Step {
  name?: unknown;
  run?: unknown;
  env?: unknown;
  'continue-on-error'?: unknown;
  if?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function triggers(doc: Record<string, unknown>): string[] {
  // YAML 1.1 folds a bare `on:` to boolean true; read both spellings so the rule
  // can never pass vacuously on an empty trigger list.
  const raw = doc['on'] ?? doc['true'];
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) return raw.filter((entry): entry is string => typeof entry === 'string');
  const record = asRecord(raw);
  return record ? Object.keys(record) : [];
}

function allSteps(doc: Record<string, unknown>): Step[] {
  const jobs = asRecord(doc['jobs']);
  if (!jobs) return [];
  const steps: Step[] = [];
  for (const job of Object.values(jobs)) {
    const body = asRecord(job);
    const jobSteps = body?.['steps'];
    if (Array.isArray(jobSteps)) {
      for (const step of jobSteps) {
        const record = asRecord(step);
        if (record) steps.push(record as Step);
      }
    }
  }
  return steps;
}

function runText(step: Step): string {
  return typeof step.run === 'string' ? step.run : '';
}

function stepsMatching(doc: Record<string, unknown>, marker: string): Step[] {
  return allSteps(doc).filter((step) => runText(step).includes(marker));
}

function serialized(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/**
 * Every way this workflow could go back to reporting success without refreshing
 * anything. An empty array is the only passing state.
 */
export function validateReadinessRefreshWorkflow(doc: unknown): WorkflowViolation[] {
  const workflow = asRecord(doc);
  if (!workflow) return [{ rule: 'parseable', detail: 'workflow does not parse as a YAML mapping' }];

  const violations: WorkflowViolation[] = [];
  const on = triggers(workflow);

  if (!on.includes('schedule')) {
    violations.push({
      rule: 'scheduled',
      detail: 'the refresher must run on a schedule; an artifact refreshed only by hand is the stale-ledger defect',
    });
  }
  if (!on.includes('workflow_dispatch')) {
    violations.push({ rule: 'dispatchable', detail: 'workflow_dispatch is required so a stale ledger can be refreshed on demand' });
  }
  for (const event of ['pull_request', 'pull_request_target']) {
    if (on.includes(event)) {
      violations.push({
        rule: 'not-pull-request-triggered',
        detail: `${event} must never trigger this workflow: it reads production with a production credential`,
      });
    }
  }

  const permissions = asRecord(workflow['permissions']);
  if (permissions?.['contents'] !== 'write') {
    violations.push({
      rule: 'can-persist',
      detail: 'permissions.contents must be "write"; without it the refreshed ledger cannot be committed and the run would compute a result it cannot publish',
    });
  }

  const generatorSteps = stepsMatching(workflow, GENERATOR_MARKER);
  if (generatorSteps.length === 0) {
    violations.push({
      rule: 'runs-generator',
      detail: `no step runs "${GENERATOR_MARKER}" — a refresh workflow that never invokes the generator is exactly the 26-green-runs failure`,
    });
  }

  for (const step of generatorSteps) {
    const env = serialized(step.env);
    for (const secret of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
      if (!env.includes(secret)) {
        violations.push({
          rule: 'generator-has-production-read-credential',
          detail: `the generator step must receive ${secret}; without it every database dimension records "unknown" and the ledger proves nothing`,
        });
      }
    }
  }

  // The path may be written literally in a step or bound once as an `env` value
  // and referenced as a variable; both are the canonical path, and a workflow
  // that names neither is writing somewhere the gate never looks.
  const envAliases = Object.entries(asRecord(workflow['env']) ?? {})
    .filter(([, value]) => value === LEDGER_PATH)
    .map(([name]) => name);
  const writesCanonicalPath = allSteps(workflow).some((step) => {
    const text = runText(step);
    return (
      text.includes(LEDGER_PATH) ||
      envAliases.some((alias) => text.includes(`$${alias}`) || text.includes(`\${${alias}}`))
    );
  });
  if (!writesCanonicalPath) {
    violations.push({
      rule: 'writes-canonical-path',
      detail: `no step references ${LEDGER_PATH}; a ledger written only to an ephemeral workspace path is never seen by the gate`,
    });
  }

  const pushSteps = stepsMatching(workflow, PUSH_MARKER);
  if (pushSteps.length === 0) {
    violations.push({
      rule: 'persists-to-repository',
      detail: 'no step pushes the refreshed ledger; computing a result and discarding it is a false-green refresh',
    });
  }

  const persistenceProofSteps = stepsMatching(workflow, PERSISTENCE_PROOF_MARKER);
  if (persistenceProofSteps.length === 0) {
    violations.push({
      rule: 'proves-persistence',
      detail: `no step runs the persistence assertion ("${PERSISTENCE_PROOF_MARKER}"); without it a no-op run still concludes success`,
    });
  }

  // A `continue-on-error` on any of these turns a hard failure back into a green
  // run — the precise shape of the original defect.
  for (const step of [...generatorSteps, ...pushSteps, ...persistenceProofSteps]) {
    if (step['continue-on-error'] === true) {
      violations.push({
        rule: 'no-soft-failure',
        detail: `step "${String(step.name ?? runText(step).slice(0, 40))}" sets continue-on-error: true, which lets a failed refresh report success`,
      });
    }
  }

  const hasFailureAlert = allSteps(workflow).some((step) => {
    const condition = typeof step.if === 'string' ? step.if : '';
    return condition.includes('failure()') || condition.includes('always()');
  });
  if (!hasFailureAlert) {
    violations.push({
      rule: 'alerts-on-failure',
      detail: 'no step runs on failure()/always(); a refresher that fails silently is indistinguishable from one that never ran',
    });
  }

  return violations;
}

export function validateWorkflowFile(filePath: string): WorkflowViolation[] {
  return validateReadinessRefreshWorkflow(parseYaml(readFileSync(filePath, 'utf8')) as unknown);
}
