import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DB_FACTS_SQL,
  EXPECTED_MIGRATION_VERSION,
  READ_ONLY_PREAMBLE,
  READ_ONLY_STATE_SQL,
  RECEIPT_SCHEMA,
  assertProductionIdentity,
  assertReadOnlyStatement,
  parseMigrationLedger,
  receiptPasses,
  type VerificationReceipt,
} from './production-post-migration-verify.js';

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
