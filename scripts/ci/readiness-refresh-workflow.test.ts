import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  LEDGER_PATH,
  READINESS_REFRESH_WORKFLOW,
  validateReadinessRefreshWorkflow,
} from './readiness-refresh-workflow.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

type Doc = Record<string, unknown>;
type Step = Record<string, unknown>;

function realWorkflow(): Doc {
  return parseYaml(readFileSync(path.join(ROOT, READINESS_REFRESH_WORKFLOW), 'utf8')) as Doc;
}

function steps(doc: Doc): Step[] {
  const jobs = doc['jobs'] as Record<string, { steps?: Step[] }>;
  return Object.values(jobs).flatMap((job) => job.steps ?? []);
}

/** Drop every step whose `run` mentions `marker` — the "someone deleted it" mutation. */
function withoutStepsMatching(doc: Doc, marker: string): Doc {
  const mutated = structuredClone(doc);
  const jobs = mutated['jobs'] as Record<string, { steps?: Step[] }>;
  for (const job of Object.values(jobs)) {
    job.steps = (job.steps ?? []).filter((step) => !String(step['run'] ?? '').includes(marker));
  }
  return mutated;
}

function ruleNames(doc: Doc): string[] {
  return validateReadinessRefreshWorkflow(doc).map((violation) => violation.rule);
}

test('the real readiness-refresh workflow satisfies every rule', () => {
  assert.deepEqual(validateReadinessRefreshWorkflow(realWorkflow()), []);
});

test('the real workflow reads production and therefore must not be pull-request triggered', () => {
  const on = realWorkflow()['on'] as Record<string, unknown>;
  assert.ok('schedule' in on);
  assert.equal('pull_request' in on, false);
  assert.equal('pull_request_target' in on, false);
});

// ── Mutations: each removes one mechanism and must be caught ─────────────────

test('removing the generator step is caught', () => {
  assert.ok(ruleNames(withoutStepsMatching(realWorkflow(), 'ops:readiness-refresh')).includes('runs-generator'));
});

test('removing the push step is caught', () => {
  assert.ok(ruleNames(withoutStepsMatching(realWorkflow(), 'git push')).includes('persists-to-repository'));
});

test('removing the persistence assertion is caught', () => {
  assert.ok(ruleNames(withoutStepsMatching(realWorkflow(), '--mode persistence')).includes('proves-persistence'));
});

test('writing the ledger only to an ephemeral path is caught', () => {
  const mutated = structuredClone(realWorkflow());
  for (const step of steps(mutated)) {
    if (typeof step['run'] === 'string') {
      step['run'] = (step['run'] as string).split(LEDGER_PATH).join('/tmp/scratch.json');
    }
    if (mutated['env'] && typeof mutated['env'] === 'object') {
      const env = mutated['env'] as Record<string, unknown>;
      if (env['LEDGER_PATH'] === LEDGER_PATH) env['LEDGER_PATH'] = '/tmp/scratch.json';
    }
  }
  assert.ok(ruleNames(mutated).includes('writes-canonical-path'));
});

test('softening the generator with continue-on-error is caught', () => {
  const mutated = structuredClone(realWorkflow());
  for (const step of steps(mutated)) {
    if (String(step['run'] ?? '').includes('ops:readiness-refresh')) step['continue-on-error'] = true;
  }
  assert.ok(ruleNames(mutated).includes('no-soft-failure'));
});

test('dropping the production read credential from the generator is caught', () => {
  const mutated = structuredClone(realWorkflow());
  for (const step of steps(mutated)) {
    if (String(step['run'] ?? '').includes('ops:readiness-refresh')) delete step['env'];
  }
  assert.ok(ruleNames(mutated).includes('generator-has-production-read-credential'));
});

test('losing write permission — the run could compute but not publish — is caught', () => {
  const mutated = structuredClone(realWorkflow());
  mutated['permissions'] = { contents: 'read' };
  assert.ok(ruleNames(mutated).includes('can-persist'));
});

test('turning the refresher into a pull-request-triggered job is caught', () => {
  const mutated = structuredClone(realWorkflow());
  mutated['on'] = { pull_request: { branches: ['main'] } };
  const rules = ruleNames(mutated);
  assert.ok(rules.includes('not-pull-request-triggered'));
  assert.ok(rules.includes('scheduled'));
});

test('removing the failure alert is caught', () => {
  const mutated = structuredClone(realWorkflow());
  for (const step of steps(mutated)) delete step['if'];
  assert.ok(ruleNames(mutated).includes('alerts-on-failure'));
});

test('a workflow that is not a mapping is refused rather than passing vacuously', () => {
  assert.deepEqual(validateReadinessRefreshWorkflow(null).map((v) => v.rule), ['parseable']);
  assert.deepEqual(validateReadinessRefreshWorkflow([]).map((v) => v.rule), ['parseable']);
});

test('an empty workflow fails every mechanism rule — the validator cannot pass vacuously', () => {
  const rules = ruleNames({ jobs: {} });
  for (const required of [
    'scheduled',
    'dispatchable',
    'can-persist',
    'runs-generator',
    'writes-canonical-path',
    'persists-to-repository',
    'proves-persistence',
    'alerts-on-failure',
  ]) {
    assert.ok(rules.includes(required), `expected rule "${required}" to fire on an empty workflow`);
  }
});

// ── The pull-request gate must stay credential-free ──────────────────────────

test('the readiness regression gate holds no production credential and runs the shared evaluator', () => {
  const raw = readFileSync(path.join(ROOT, '.github/workflows/readiness-regression-gate.yml'), 'utf8');
  assert.match(raw, /pnpm ci:readiness-gate/);
  assert.match(raw, /--mode regression/);
  assert.match(raw, /name: Readiness Regression Evaluation/);
  assert.match(raw, /name: 'Readiness Regression Gate'/);
  assert.match(raw, /conclusion,/);
  assert.match(raw, /core\.setFailed\(result\.summary\)/);
  for (const secret of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL']) {
    assert.equal(raw.includes(secret), false, `the pull-request gate must not reference ${secret}`);
  }
});
