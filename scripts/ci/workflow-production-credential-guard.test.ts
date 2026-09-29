import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readdirSync, readFileSync } from 'node:fs';
import {
  findProductionCredentialExposures,
  findUnboundStagingCredentialJobs,
  formatExposures,
  pullRequestReachableWorkflows,
  ORPHANED_REPOSITORY_SECRETS,
  SECRETS_INHERIT,
  WORKFLOW_LEVEL_ENV,
  READ_ONLY_EXEMPTIONS,
  PRODUCTION_DB_SECRET_NAMES,
  type CredentialExemption,
} from './workflow-production-credential-guard.js';
import { ROOT } from '../ops/shared.js';
import { createTempWorkspace } from '../ops/temp-workspace.js';
import {
  DB_FACTS_SQL,
  EXPECTED_MIGRATION_VERSION,
  READ_ONLY_PREAMBLE,
  READ_ONLY_STATE_SQL,
  RECEIPT_SCHEMA,
  assertLedgerCredentialMode,
  assertProductionIdentity,
  assertReadOnlyStatement,
  buildPsqlEnvironment,
  parseMigrationLedger,
  receiptPasses,
  type VerificationReceipt,
} from './production-post-migration-verify.js';

const WORKFLOW_DIR = join(ROOT, '.github', 'workflows');

function fixtureDir(files: Record<string, string>): string {
  const dir = createTempWorkspace('utv2-1630-wf-');
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

test('every exemption records whether it executes PR code, and names a real pin when it does', () => {
  // UTV2-1629 — "it only reads production" is a property of the code the job
  // runs, and on a pull_request event that code comes from the PR head. An
  // exemption that does not say which of those two situations it is in has not
  // actually been reasoned about.
  for (const entry of READ_ONLY_EXEMPTIONS) {
    assert.equal(
      typeof entry.executesPullRequestCode,
      'boolean',
      `${entry.workflow}::${entry.job} must state whether it executes PR-authored code`,
    );
    assert.ok(
      entry.privilegeReduction.trim().length >= 40,
      `${entry.workflow}::${entry.job} must name the provisioning that would retire it`,
    );

    if (!entry.executesPullRequestCode) {
      assert.deepEqual(
        entry.pinnedBy,
        [],
        `${entry.workflow}::${entry.job} claims it runs no PR code, so it must pin nothing`,
      );
      continue;
    }

    assert.ok(
      entry.pinnedBy.length > 0,
      `${entry.workflow}::${entry.job} executes PR-authored code and must name what pins it`,
    );

    // The pin has to be real, not aspirational: every declared path must appear
    // in the workflow's own assert-unmodified-vs-base invocation. A pin recorded
    // here but absent from the YAML is the failure mode this test exists for.
    const text = readFileSync(join(WORKFLOW_DIR, entry.workflow), 'utf8');
    assert.match(
      text,
      /assert-unmodified-vs-base\.ts/u,
      `${entry.workflow} declares a pin but never invokes assert-unmodified-vs-base.ts`,
    );
    for (const path of entry.pinnedBy) {
      assert.ok(
        text.includes(path),
        `${entry.workflow}::${entry.job} declares ${path} as pinned, but the workflow never passes it to assert-unmodified-vs-base.ts`,
      );
    }
  }
});

test('orphaned repository secrets are referenced by no workflow', () => {
  // These are queued for deletion by the orchestrator (an external action). The
  // repo's job is to make sure nothing starts depending on them again in the
  // meantime — a reference here would turn a pending cleanup into a breakage.
  const referenced: string[] = [];
  for (const file of readdirSync(WORKFLOW_DIR).filter((name) => /\.ya?ml$/.test(name))) {
    const text = readFileSync(join(WORKFLOW_DIR, file), 'utf8');
    for (const secret of ORPHANED_REPOSITORY_SECRETS) {
      if (new RegExp(`secrets\\s*\\.\\s*${secret}\\b`).test(text)) referenced.push(`${file} → ${secret}`);
    }
  }
  assert.deepEqual(
    referenced,
    [],
    'A workflow references a secret listed as orphaned and pending deletion:\n' +
      referenced.join('\n') +
      '\n\nEither remove the reference or take the name off ORPHANED_REPOSITORY_SECRETS.',
  );
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
    {
      workflow: 'partial.yml',
      job: 'reader',
      secrets: ['SUPABASE_URL'],
      executesPullRequestCode: false,
      pinnedBy: [],
      reason: 'read-only',
      privilegeReduction: 'fixture',
    },
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
    {
      workflow: 'twojobs.yml',
      job: 'reader',
      secrets: ['SUPABASE_URL'],
      executesPullRequestCode: false,
      pinnedBy: [],
      reason: 'read-only',
      privilegeReduction: 'fixture',
    },
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

// Production post-migration verifier regression coverage lives in this already-wired
// CI guard so the verifier does not need to expand the active package.json lock.
const PRODUCTION_REF = 'zfzdnfwdarxucxtaojxm';
const STAGING_REF = 'xskgrzbteyqdufktjrjx';

function passingReceipt(): VerificationReceipt {
  return {
    schema: RECEIPT_SCHEMA,
    environment: 'production',
    project_ref: PRODUCTION_REF,
    migration_version: EXPECTED_MIGRATION_VERSION,
    generated_at: '2026-09-29T00:00:00.000Z',
    github: {
      repository: 'griff843/Unit-Talk-v2',
      workflow_ref:
        'griff843/Unit-Talk-v2/.github/workflows/production-post-migration-verify.yml@refs/heads/main',
      event_name: 'workflow_dispatch',
      ref: 'refs/heads/main',
      run_id: '123',
      run_attempt: '1',
      job: 'verify',
      sha: 'a'.repeat(40),
    },
    read_only: true,
    mutated: false,
    ledger: {
      aligned: true,
      expectedVersion: EXPECTED_MIGRATION_VERSION,
      local: [EXPECTED_MIGRATION_VERSION],
      remote: [EXPECTED_MIGRATION_VERSION],
    },
    database: {
      current_user: 'warehouse_reader',
      transaction_read_only: 'on',
      objects_present: true,
      phase_roles_inert: true,
      phase_privileges_exact: true,
      phase_roles_have_no_direct_dml: true,
      data_api_execute_denied: true,
      public_execute_denied: true,
      reader_is_least_privilege: true,
      control_tables_rls: true,
      control_immutability_triggers: true,
      runtime_functions_security_definer: true,
    },
    live_schema_parity: {
      required: true,
      evidence: 'separate-authoritative-workflow-run-and-job',
    },
    verdict: 'PASS',
  };
}

test('writable DB suites remain mechanically staging-only', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.match(packageJson.scripts['test:db'] ?? '', /^pnpm ci:assert-staging &&/u);
  assert.match(packageJson.scripts['test:t1-proof:live'] ?? '', /^pnpm ci:assert-staging &&/u);

  const guard = readFileSync('scripts/ci/assert-staging-target.ts', 'utf8');
  assert.match(guard, /CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF/u);
  assert.match(guard, /REFUSED/u);
});

test('production verifier accepts only the canonical project and warehouse_reader identity', () => {
  assert.doesNotThrow(() =>
    assertProductionIdentity(
      `https://${PRODUCTION_REF}.supabase.co`,
      `postgresql://warehouse_reader.${PRODUCTION_REF}:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
    ),
  );
  assert.doesNotThrow(() =>
    assertProductionIdentity(
      `https://${PRODUCTION_REF}.supabase.co`,
      `postgresql://warehouse_reader:secret@db.${PRODUCTION_REF}.supabase.co:5432/postgres`,
    ),
  );
  assert.throws(
    () =>
      assertProductionIdentity(
        `https://${STAGING_REF}.supabase.co`,
        `postgresql://warehouse_reader.${PRODUCTION_REF}:secret@pooler.supabase.com:5432/postgres`,
      ),
    /refused API project ref/u,
  );
  assert.throws(
    () =>
      assertProductionIdentity(
        `https://${PRODUCTION_REF}.supabase.co`,
        `postgresql://warehouse_reader.${STAGING_REF}:secret@pooler.supabase.com:5432/postgres`,
      ),
    /requires warehouse_reader bound/u,
  );
  assert.throws(
    () =>
      assertProductionIdentity(
        `https://${PRODUCTION_REF}.supabase.co`,
        `postgresql://warehouse_reader.${PRODUCTION_REF}:secret@attacker.example:5432/postgres`,
      ),
    /refused a non-Supabase pooler host/u,
  );
  assert.throws(
    () =>
      assertProductionIdentity(
        `https://${PRODUCTION_REF}.supabase.co`,
        `postgresql://postgres.${PRODUCTION_REF}:secret@pooler.supabase.com:5432/postgres`,
      ),
    /requires warehouse_reader bound/u,
  );
});

test('every production SQL operation is select/show or the read-only transaction preamble', () => {
  for (const statement of [READ_ONLY_PREAMBLE, READ_ONLY_STATE_SQL, DB_FACTS_SQL]) {
    assert.doesNotThrow(() => assertReadOnlyStatement(statement));
  }
  for (const mutation of [
    'INSERT INTO public.picks DEFAULT VALUES',
    'UPDATE public.picks SET status = status',
    'DELETE FROM public.picks',
    'CALL public.warehouse_retention_execute_window()',
    'ALTER TABLE public.picks ADD COLUMN unsafe text',
    'SELECT setval(\'unsafe_sequence\', 1)',
    'SELECT public.warehouse_retention_execute_window()',
    'SELECT 1; DELETE FROM public.picks',
    'SELECT 1 INTO TEMP TABLE unsafe',
  ]) {
    assert.throws(() => assertReadOnlyStatement(mutation), /production verifier refused/u);
  }
});

test('immutability trigger proof binds every enabled trigger to its table and function', () => {
  for (const [triggerName, tableName] of [
    ['warehouse_retention_plans_immutable', 'warehouse_retention_plans'],
    ['warehouse_retention_executions_immutable', 'warehouse_retention_executions'],
    ['warehouse_retention_recoveries_immutable', 'warehouse_retention_recoveries'],
  ]) {
    assert.match(DB_FACTS_SQL, new RegExp(triggerName, 'u'));
    assert.match(DB_FACTS_SQL, new RegExp(tableName, 'u'));
  }
  assert.match(DB_FACTS_SQL, /trigger_function\.proname = 'warehouse_retention_control_immutable'/u);
  assert.match(DB_FACTS_SQL, /t\.tgenabled = 'O'/u);
  assert.doesNotMatch(DB_FACTS_SQL, /t\.tgenabled[^\n]*'R'/u);

  const disabledTriggerReceipt = passingReceipt();
  disabledTriggerReceipt.database.control_immutability_triggers = false;
  assert.equal(receiptPasses(disabledTriggerReceipt), false);
});

test('phase roles are refused any direct table or helper-function privilege', () => {
  for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
    assert.match(
      DB_FACTS_SQL,
      new RegExp(`has_table_privilege\\(r\\.role_name, 'public\\.' \\|\\| t\\.table_name, '${privilege}'\\)`, 'u'),
    );
  }
  for (const helper of [
    'warehouse_retention_control_immutable',
    'warehouse_retention_source_config',
    'warehouse_retention_assert_fk_contract',
    'warehouse_retention_window_counts',
  ]) {
    assert.match(DB_FACTS_SQL, new RegExp(helper, 'u'));
  }
  const leakedPrivilege = passingReceipt();
  leakedPrivilege.database.phase_privileges_exact = false;
  assert.equal(receiptPasses(leakedPrivilege), false);
});

test('ledger-file mode refuses the management token and strips it from psql', () => {
  assert.doesNotThrow(() => assertLedgerCredentialMode('artifacts/ledger.txt', ''));
  assert.doesNotThrow(() => assertLedgerCredentialMode(null, 'management-token'));
  assert.throws(
    () => assertLedgerCredentialMode('artifacts/ledger.txt', 'management-token'),
    /refused SUPABASE_ACCESS_TOKEN in ledger-file mode/u,
  );
  assert.throws(
    () => assertLedgerCredentialMode(null, ''),
    /required when the verifier captures the ledger/u,
  );

  const childEnvironment = buildPsqlEnvironment(
    { SUPABASE_ACCESS_TOKEN: 'must-not-cross-process-boundary', KEEP_ME: 'yes' },
    'postgresql://warehouse_reader:secret@example.invalid/postgres',
  );
  assert.equal(childEnvironment['SUPABASE_ACCESS_TOKEN'], undefined);
  assert.equal(childEnvironment['KEEP_ME'], 'yes');
  assert.match(childEnvironment['PGOPTIONS'] ?? '', /default_transaction_read_only=on/u);

  const workflow = readFileSync('.github/workflows/production-post-migration-verify.yml', 'utf8');
  const verifierStep = workflow.match(
    /- name: Verify production schema[\s\S]*?(?=\n\s+- name: Upload immutable verification receipt)/u,
  )?.[0];
  assert.ok(verifierStep, 'production verifier workflow step must exist');
  assert.doesNotMatch(verifierStep, /SUPABASE_ACCESS_TOKEN/u);
});

test('ledger evidence requires exact local/remote alignment and the applied migration', () => {
  const versions = ['202609280001', EXPECTED_MIGRATION_VERSION];
  const aligned = parseMigrationLedger(
    ` Local | Remote | Time\n ${versions[0]} | ${versions[0]} | now\n ${versions[1]} | ${versions[1]} | now\n`,
    EXPECTED_MIGRATION_VERSION,
    versions,
  );
  assert.equal(aligned.aligned, true);

  const missingRemote = parseMigrationLedger(
    ` Local | Remote | Time\n ${versions[0]} | ${versions[0]} | now\n ${versions[1]} | | now\n`,
    EXPECTED_MIGRATION_VERSION,
    versions,
  );
  assert.equal(missingRemote.aligned, false);
});

test('a staging or non-read-only receipt cannot substitute for production truth', () => {
  assert.equal(receiptPasses(passingReceipt()), true);
  assert.equal(receiptPasses({ ...passingReceipt(), environment: 'staging' as 'production' }), false);
  assert.equal(receiptPasses({ ...passingReceipt(), project_ref: STAGING_REF }), false);
  assert.equal(
    receiptPasses({
      ...passingReceipt(),
      github: {
        ...passingReceipt().github,
        workflow_ref:
          'griff843/Unit-Talk-v2/.github/workflows/staging-db-proof.yml@refs/heads/main',
      },
    }),
    false,
  );
  assert.equal(
    receiptPasses({
      ...passingReceipt(),
      github: { ...passingReceipt().github, ref: 'refs/heads/feature' },
    }),
    false,
  );
  assert.equal(
    receiptPasses({
      ...passingReceipt(),
      database: { ...passingReceipt().database, transaction_read_only: 'off' },
    }),
    false,
  );
  assert.equal(receiptPasses({ ...passingReceipt(), ledger: { ...passingReceipt().ledger, aligned: false } }), false);
  assert.equal(receiptPasses({ ...passingReceipt(), migration_version: '20260928000000' }), false);
  assert.equal(
    receiptPasses({
      ...passingReceipt(),
      ledger: { ...passingReceipt().ledger, expectedVersion: '20260928000000' },
    }),
    false,
  );
  assert.equal(
    receiptPasses({
      ...passingReceipt(),
      ledger: { ...passingReceipt().ledger, local: [], remote: [] },
    }),
    false,
  );
});

test('workflow is manual, production-bound, reader-only, and keeps parity mandatory', () => {
  const workflow = readFileSync('.github/workflows/production-post-migration-verify.yml', 'utf8');
  assert.match(workflow, /^\s*workflow_dispatch:/mu);
  assert.doesNotMatch(workflow, /^\s*pull_request:/mu);
  assert.match(workflow, /environment: production/u);
  assert.match(workflow, /UNIT_TALK_WAREHOUSE_SOURCE_DSN/u);
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY/u);
  assert.match(workflow, /Live Schema Parity/u);
  assert.match(workflow, /production-post-migration-verify\.ts/u);
});
