import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readFileSync } from 'node:fs';
import {
  findProductionCredentialExposures,
  findUnboundStagingCredentialJobs,
  formatExposures,
  pullRequestReachableWorkflows,
  SECRETS_INHERIT,
  WORKFLOW_LEVEL_ENV,
  READ_ONLY_EXEMPTIONS,
  PRODUCTION_DB_SECRET_NAMES,
  type CredentialExemption,
} from './workflow-production-credential-guard.js';
import { ROOT } from '../ops/shared.js';

const WORKFLOW_DIR = join(ROOT, '.github', 'workflows');

function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'utv2-1630-wf-'));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body);
  }
  return dir;
}

// ── The live assertion ──────────────────────────────────────────────────────

test('no pull-request-triggered job holds an unexempted production DB credential', () => {
  const exposures = findProductionCredentialExposures(WORKFLOW_DIR);
  assert.deepEqual(
    exposures,
    [],
    'A pull-request-reachable job references a PRODUCTION Supabase secret.\n' +
      formatExposures(exposures) +
      '\n\nCI must never hold a production database credential on a pull request. ' +
      'Bind `environment: staging-ci` and use CI_SUPABASE_URL / CI_SUPABASE_PUBLISHABLE_KEY / ' +
      'CI_SUPABASE_SECRET_KEY. If the job genuinely only READS production, add an entry to ' +
      'READ_ONLY_EXEMPTIONS with a reason — an exemption never licenses a write.',
  );
});

test('the workflows this lane migrated are clean without needing an exemption', () => {
  // Guards the migration itself: if a later change restores production secrets
  // to any of these, this fails even if someone also adds an exemption for a
  // different job in the same file.
  const exposures = findProductionCredentialExposures(WORKFLOW_DIR, []);
  const migrated = ['ci.yml', 'proof-gate.yml', 'proof-regression.yml'];
  for (const workflow of migrated) {
    const hit = exposures.filter((item) => item.workflow === workflow);
    assert.deepEqual(hit, [], `${workflow} must hold no production DB credential at all`);
  }
});

test('every exemption names a workflow, job and secret that actually exist', () => {
  // A stale exemption is worse than none: it reads as "reviewed and safe" while
  // guarding nothing, and it silently pre-authorizes the name if it returns.
  for (const entry of READ_ONLY_EXEMPTIONS) {
    const doc = parseYaml(readFileSync(join(WORKFLOW_DIR, entry.workflow), 'utf8')) as Record<
      string,
      unknown
    >;
    const jobs = doc['jobs'] as Record<string, unknown> | undefined;
    assert.ok(jobs && entry.job in jobs, `exemption references missing job ${entry.workflow}::${entry.job}`);

    const serialized = JSON.stringify(jobs[entry.job]);
    for (const secret of entry.secrets) {
      assert.ok(
        PRODUCTION_DB_SECRET_NAMES.includes(secret as (typeof PRODUCTION_DB_SECRET_NAMES)[number]),
        `${secret} is not a tracked production secret`,
      );
      assert.match(
        serialized,
        new RegExp(`secrets\\s*\\.\\s*${secret}\\b`),
        `${entry.workflow}::${entry.job} no longer uses ${secret} — remove the exemption`,
      );
    }
    assert.ok(entry.reason.trim().length >= 40, `exemption ${entry.workflow}::${entry.job} needs a real reason`);
  }
});

// ── Detection behaviour ─────────────────────────────────────────────────────

test('detects a production secret in a step env block', () => {
  const dir = fixtureDir({
    'bad.yml': `
name: Bad
on:
  pull_request:
jobs:
  leak:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test:db
        env:
          SUPABASE_SERVICE_ROLE_KEY: \${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
`,
  });
  assert.deepEqual(findProductionCredentialExposures(dir, []), [
    { workflow: 'bad.yml', job: 'leak', secrets: ['SUPABASE_SERVICE_ROLE_KEY'] },
  ]);
});

test('detects a production secret interpolated inside inline run text', () => {
  // This is the shape that actually shipped: a heredoc writing local.env.
  const dir = fixtureDir({
    'heredoc.yml': `
name: Heredoc
on:
  pull_request:
jobs:
  leak:
    runs-on: ubuntu-latest
    steps:
      - run: |
          cat <<'EOF' > local.env
          SUPABASE_URL=\${{ secrets.SUPABASE_URL }}
          EOF
`,
  });
  assert.deepEqual(findProductionCredentialExposures(dir, []), [
    { workflow: 'heredoc.yml', job: 'leak', secrets: ['SUPABASE_URL'] },
  ]);
});

test('detects a production secret in a job-level env block', () => {
  const dir = fixtureDir({
    'joblevel.yml': `
name: Job level
on: [pull_request]
jobs:
  leak:
    runs-on: ubuntu-latest
    env:
      SUPABASE_URL: \${{ secrets.SUPABASE_URL }}
    steps:
      - run: echo hi
`,
  });
  assert.deepEqual(findProductionCredentialExposures(dir, []), [
    { workflow: 'joblevel.yml', job: 'leak', secrets: ['SUPABASE_URL'] },
  ]);
});

test('tolerates whitespace inside the expression', () => {
  const dir = fixtureDir({
    'spaced.yml': `
name: Spaced
on:
  pull_request:
jobs:
  leak:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ secrets . SUPABASE_URL }}"
`,
  });
  assert.equal(findProductionCredentialExposures(dir, []).length, 1);
});

test('ignores workflows with no pull-request trigger', () => {
  const dir = fixtureDir({
    'deploy.yml': `
name: Deploy
on:
  push:
    branches: [main]
jobs:
  ship:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}"
`,
  });
  assert.deepEqual(findProductionCredentialExposures(dir, []), []);
});

test('accepts staging credentials', () => {
  const dir = fixtureDir({
    'good.yml': `
name: Good
on:
  pull_request:
jobs:
  proof:
    runs-on: ubuntu-latest
    environment: staging-ci
    steps:
      - run: pnpm ci:assert-staging && pnpm ci:db-smoke
        env:
          SUPABASE_URL: \${{ secrets.CI_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: \${{ secrets.CI_SUPABASE_SECRET_KEY }}
`,
  });
  assert.deepEqual(findProductionCredentialExposures(dir, []), []);
});

test('CI_SUPABASE_URL is not mistaken for SUPABASE_URL', () => {
  // `secrets.CI_SUPABASE_URL` contains the substring `SUPABASE_URL`; a
  // substring match would flag every correctly-migrated job and the guard would
  // be turned off within a day.
  const dir = fixtureDir({
    'prefixed.yml': `
name: Prefixed
on:
  pull_request:
jobs:
  proof:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ secrets.CI_SUPABASE_URL }} \${{ secrets.CI_SUPABASE_SECRET_KEY }}"
`,
  });
  assert.deepEqual(findProductionCredentialExposures(dir, []), []);
});

test('an exemption covers only the secret it names', () => {
  const dir = fixtureDir({
    'partial.yml': `
name: Partial
on:
  pull_request:
jobs:
  reader:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ secrets.SUPABASE_URL }} \${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}"
`,
  });
  const exemptions: CredentialExemption[] = [
    { workflow: 'partial.yml', job: 'reader', secrets: ['SUPABASE_URL'], reason: 'read-only' },
  ];
  assert.deepEqual(findProductionCredentialExposures(dir, exemptions), [
    { workflow: 'partial.yml', job: 'reader', secrets: ['SUPABASE_SERVICE_ROLE_KEY'] },
  ]);
});

test('an exemption does not carry across jobs in the same workflow', () => {
  const dir = fixtureDir({
    'twojobs.yml': `
name: Two jobs
on:
  pull_request:
jobs:
  reader:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ secrets.SUPABASE_URL }}"
  writer:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ secrets.SUPABASE_URL }}"
`,
  });
  const exemptions: CredentialExemption[] = [
    { workflow: 'twojobs.yml', job: 'reader', secrets: ['SUPABASE_URL'], reason: 'read-only' },
  ];
  assert.deepEqual(findProductionCredentialExposures(dir, exemptions), [
    { workflow: 'twojobs.yml', job: 'writer', secrets: ['SUPABASE_URL'] },
  ]);
});

test('pull_request_target is treated as a pull-request trigger', () => {
  const dir = fixtureDir({
    'target.yml': `
name: Target
on:
  pull_request_target:
    types: [opened]
jobs:
  leak:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ secrets.SUPABASE_DB_URL }}"
`,
  });
  assert.equal(findProductionCredentialExposures(dir, []).length, 1);
});

test('a workflow mixing push and pull_request is still scanned', () => {
  const dir = fixtureDir({
    'mixed.yml': `
name: Mixed
on:
  push:
    branches: [main]
  pull_request:
jobs:
  leak:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ secrets.SUPABASE_ANON_KEY }}"
`,
  });
  assert.deepEqual(findProductionCredentialExposures(dir, []), [
    { workflow: 'mixed.yml', job: 'leak', secrets: ['SUPABASE_ANON_KEY'] },
  ]);
});

// ── Evasion classes demonstrated against the first version of this scanner ──

test('detects a production secret in WORKFLOW-level env inherited by every job', () => {
  // Sits outside the `jobs` subtree, so a jobs-only walk reports nothing while
  // every job in the file holds the credential. Most likely accidental form.
  const dir = fixtureDir({
    'wfenv.yml': `
name: Workflow env
on:
  pull_request:
env:
  SUPABASE_SERVICE_ROLE_KEY: \${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
jobs:
  anything:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test
`,
  });
  assert.deepEqual(findProductionCredentialExposures(dir, []), [
    { workflow: 'wfenv.yml', job: WORKFLOW_LEVEL_ENV, secrets: ['SUPABASE_SERVICE_ROLE_KEY'] },
  ]);
});

test('detects bracket-indexed secret access', () => {
  const dir = fixtureDir({
    'bracket.yml': `
name: Bracket
on:
  pull_request:
jobs:
  leak:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ secrets['SUPABASE_URL'] }}"
`,
  });
  assert.deepEqual(findProductionCredentialExposures(dir, []), [
    { workflow: 'bracket.yml', job: 'leak', secrets: ['SUPABASE_URL'] },
  ]);
});

test('detects a name assembled inside a bracket expression', () => {
  const dir = fixtureDir({
    'format.yml': `
name: Format
on:
  pull_request:
jobs:
  leak:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ secrets[format('{0}', 'SUPABASE_SERVICE_ROLE_KEY')] }}"
`,
  });
  assert.equal(findProductionCredentialExposures(dir, []).length, 1);
});

test('detects secrets: inherit, which names no secret at all', () => {
  const dir = fixtureDir({
    'inherit.yml': `
name: Inherit
on:
  pull_request:
jobs:
  call:
    uses: ./.github/workflows/callee.yml
    secrets: inherit
`,
    'callee.yml': `
name: Callee
on:
  workflow_call:
jobs:
  work:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`,
  });
  assert.deepEqual(findProductionCredentialExposures(dir, []), [
    { workflow: 'inherit.yml', job: 'call', secrets: [SECRETS_INHERIT] },
  ]);
});

test('a workflow_call callee is pull-request-reachable through its caller', () => {
  // The callee's own `on:` has no pull_request, so a trigger-only test skips it
  // entirely — while it runs on every PR with the caller's secrets.
  const dir = fixtureDir({
    'caller.yml': `
name: Caller
on:
  pull_request:
jobs:
  call:
    uses: ./.github/workflows/reusable.yml
`,
    'reusable.yml': `
name: Reusable
on:
  workflow_call:
jobs:
  leak:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}"
`,
  });
  assert.ok(pullRequestReachableWorkflows(dir).has('reusable.yml'));
  assert.deepEqual(findProductionCredentialExposures(dir, []), [
    { workflow: 'reusable.yml', job: 'leak', secrets: ['SUPABASE_SERVICE_ROLE_KEY'] },
  ]);
});

test('an unreferenced workflow_call workflow stays out of scope', () => {
  const dir = fixtureDir({
    'orphan.yml': `
name: Orphan
on:
  workflow_call:
jobs:
  work:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ secrets.SUPABASE_URL }}"
`,
  });
  assert.deepEqual(findProductionCredentialExposures(dir, []), []);
});

// ── Staging credentials must be bound to the environment that releases them ──

test('every job using a CI_SUPABASE_* secret binds the staging-ci environment', () => {
  const unbound = findUnboundStagingCredentialJobs(WORKFLOW_DIR);
  assert.deepEqual(
    unbound,
    [],
    'A job interpolates a staging secret without `environment: staging-ci`, so it ' +
      'receives EMPTY STRINGS rather than credentials:\n' +
      formatExposures(unbound) +
      '\n\nEnvironment secrets are released per job and are never inherited from a sibling job.',
  );
});

test('detects a job using staging secrets with no environment', () => {
  const dir = fixtureDir({
    'unbound.yml': `
name: Unbound
on:
  pull_request:
jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm ci:db-smoke
        env:
          SUPABASE_SERVICE_ROLE_KEY: \${{ secrets.CI_SUPABASE_SECRET_KEY }}
`,
  });
  assert.deepEqual(findUnboundStagingCredentialJobs(dir), [
    { workflow: 'unbound.yml', job: 'smoke', secrets: ['CI_SUPABASE_SECRET_KEY'] },
  ]);
});

test('a sibling job binding staging-ci does not satisfy an unbound job', () => {
  // The exact shape of the proof-gate.yml defect.
  const dir = fixtureDir({
    'sibling.yml': `
name: Sibling
on:
  pull_request:
jobs:
  bound:
    runs-on: ubuntu-latest
    environment: staging-ci
    steps:
      - run: echo "\${{ secrets.CI_SUPABASE_URL }}"
  unbound:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ secrets.CI_SUPABASE_URL }}"
`,
  });
  assert.deepEqual(findUnboundStagingCredentialJobs(dir), [
    { workflow: 'sibling.yml', job: 'unbound', secrets: ['CI_SUPABASE_URL'] },
  ]);
});

test('accepts the object form of environment', () => {
  const dir = fixtureDir({
    'objform.yml': `
name: Object form
on:
  pull_request:
jobs:
  proof:
    runs-on: ubuntu-latest
    environment:
      name: staging-ci
      url: https://example.invalid
    steps:
      - run: echo "\${{ secrets.CI_SUPABASE_SECRET_KEY }}"
`,
  });
  assert.deepEqual(findUnboundStagingCredentialJobs(dir), []);
});

test('the scanner reads real workflows and does not pass vacuously', () => {
  // If `on:` parsing ever broke, every workflow would be skipped and the live
  // assertion above would pass while checking nothing.
  const scanned = findProductionCredentialExposures(WORKFLOW_DIR, []);
  assert.ok(
    scanned.length >= READ_ONLY_EXEMPTIONS.length,
    'scanner found fewer production-credential jobs than there are exemptions — trigger parsing is likely broken',
  );
});
