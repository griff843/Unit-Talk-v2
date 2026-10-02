import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DB_FACTS_SQL,
  EXPECTED_MIGRATION_VERSION,
  READ_ONLY_PREAMBLE,
  READ_ONLY_STATE_SQL,
  RECEIPT_SCHEMA,
  assertLedgerCredentialMode,
  assertProductionIdentity,
  assertReadOnlyStatement,
  buildPsqlArguments,
  buildPsqlEnvironment,
  isAcceptedImmutabilityTriggerState,
  parseMigrationLedger,
  receiptPasses,
  type VerificationReceipt,
} from './production-post-migration-verify.js';

const PRODUCTION_REF = 'zfzdnfwdarxucxtaojxm';
const STAGING_REF = 'xskgrzbteyqdufktjrjx';
const PRODUCTION_WORKFLOW = '.github/workflows/production-post-migration-verify.yml';
const VERIFIER_ENTRYPOINT = 'scripts/ci/production-post-migration-verify.ts';

function readRegisteredProductionWorkflow(): string | null {
  const inventory = JSON.parse(
    readFileSync('docs/05_operations/db-writer-classification.json', 'utf8'),
  ) as {
    production_read_only_entrypoints: Array<{ path: string }>;
  };
  const registered = inventory.production_read_only_entrypoints.some(
    (entry) => entry.path === VERIFIER_ENTRYPOINT,
  );

  if (!registered) {
    assert.equal(
      existsSync(PRODUCTION_WORKFLOW),
      false,
      'the production workflow must remain absent until its governance companion registers the verifier',
    );
    return null;
  }

  assert.equal(
    existsSync(PRODUCTION_WORKFLOW),
    true,
    'a registered production verifier must have its governed workflow',
  );
  return readFileSync(PRODUCTION_WORKFLOW, 'utf8');
}

function passingReceipt(): VerificationReceipt {
  return {
    schema: RECEIPT_SCHEMA,
    environment: 'production',
    project_ref: PRODUCTION_REF,
    migration_version: EXPECTED_MIGRATION_VERSION,
    generated_at: '2026-09-30T00:00:00.000Z',
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
      phase_roles_have_no_memberships: true,
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

test('the dedicated verifier commands are discoverable and wired into static verification', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.equal(
    packageJson.scripts['test:production-post-migration'],
    'tsx --test scripts/ci/production-post-migration-verify.test.ts',
  );
  assert.equal(
    packageJson.scripts['verify:production-post-migration'],
    'tsx scripts/ci/production-post-migration-verify.ts',
  );
  assert.match(
    packageJson.scripts['verify:static'] ?? '',
    /pnpm test:production-post-migration/u,
  );

  const workflow = readRegisteredProductionWorkflow();
  if (workflow) {
    assert.match(workflow, /pnpm verify:production-post-migration --/u);
  }
});

test('writable DB suites remain mechanically staging-only', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.match(
    packageJson.scripts['test:db'] ?? '',
    /^pnpm ci:assert-staging &&/u,
  );
  assert.match(
    packageJson.scripts['test:t1-proof:live'] ?? '',
    /^pnpm ci:assert-staging &&/u,
  );

  const guard = readFileSync('scripts/ci/assert-staging-target.ts', 'utf8');
  assert.match(guard, /CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF/u);
  assert.match(guard, /REFUSED/u);
});

test('production verifier accepts only canonical production and warehouse_reader identity', () => {
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
        `postgresql://postgres.${PRODUCTION_REF}:secret@pooler.supabase.com:5432/postgres`,
      ),
    /requires warehouse_reader bound/u,
  );
});

test('every production SQL operation remains read-only', () => {
  for (const statement of [
    READ_ONLY_PREAMBLE,
    READ_ONLY_STATE_SQL,
    DB_FACTS_SQL,
  ]) {
    assert.doesNotThrow(() => assertReadOnlyStatement(statement));
  }
  for (const mutation of [
    'INSERT INTO public.picks DEFAULT VALUES',
    'UPDATE public.picks SET status = status',
    'DELETE FROM public.picks',
    'CALL public.warehouse_retention_execute_window()',
    'ALTER TABLE public.picks ADD COLUMN unsafe text',
    "SELECT setval('unsafe_sequence', 1)",
    'SELECT public.warehouse_retention_execute_window()',
    'SELECT 1; DELETE FROM public.picks',
    'SELECT 1 INTO TEMP TABLE unsafe',
  ]) {
    assert.throws(
      () => assertReadOnlyStatement(mutation),
      /production verifier refused/u,
    );
  }
});

test('NOINHERIT phase roles fail closed on direct and transitive role memberships', () => {
  assert.match(DB_FACTS_SQL, /phase_roles_have_no_memberships/u);
  assert.match(DB_FACTS_SQL, /WITH RECURSIVE phase_role_membership_paths/u);
  assert.match(DB_FACTS_SQL, /pg_catalog\.pg_auth_members membership/u);
  assert.match(DB_FACTS_SQL, /phase_role\.oid = membership\.member/u);
  assert.match(
    DB_FACTS_SQL,
    /membership\.member = membership_path\.reachable_role_oid/u,
  );
  assert.match(
    DB_FACTS_SQL,
    /membership_path\.membership_path \|\| membership\.roleid/u,
  );

  // Mutation: a NOINHERIT phase role receives a SET ROLE-capable membership.
  // The recursive catalog probe reports the path, making this required fact false.
  const noInheritWithSettableMembership = passingReceipt();
  noInheritWithSettableMembership.database.phase_roles_inert = true;
  noInheritWithSettableMembership.database.phase_roles_have_no_memberships = false;
  assert.equal(receiptPasses(noInheritWithSettableMembership), false);
});

test('immutability triggers accept ordinary and always states but reject disabled and replica-only', () => {
  assert.equal(isAcceptedImmutabilityTriggerState('O'), true);
  assert.equal(isAcceptedImmutabilityTriggerState('A'), true);
  assert.equal(isAcceptedImmutabilityTriggerState('D'), false);
  assert.equal(isAcceptedImmutabilityTriggerState('R'), false);

  assert.match(DB_FACTS_SQL, /t\.tgenabled IN \('O', 'A'\)/u);
  assert.doesNotMatch(DB_FACTS_SQL, /t\.tgenabled IN \([^)]*'D'/u);
  assert.doesNotMatch(DB_FACTS_SQL, /t\.tgenabled IN \([^)]*'R'/u);

  const rejectedTriggerState = passingReceipt();
  rejectedTriggerState.database.control_immutability_triggers = false;
  assert.equal(receiptPasses(rejectedTriggerState), false);
});

test('phase roles are refused direct table and helper-function privilege', () => {
  for (const privilege of [
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'REFERENCES',
    'TRIGGER',
  ]) {
    assert.match(
      DB_FACTS_SQL,
      new RegExp(
        `has_table_privilege\\(r\\.role_name, 'public\\.' \\|\\| t\\.table_name, '${privilege}'\\)`,
        'u',
      ),
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
});

test('ledger-file mode refuses the management token and strips it from psql', () => {
  assert.doesNotThrow(() =>
    assertLedgerCredentialMode('artifacts/ledger.txt', ''),
  );
  assert.doesNotThrow(() =>
    assertLedgerCredentialMode(null, 'management-token'),
  );
  assert.throws(
    () =>
      assertLedgerCredentialMode('artifacts/ledger.txt', 'management-token'),
    /refused SUPABASE_ACCESS_TOKEN in ledger-file mode/u,
  );
  assert.throws(
    () => assertLedgerCredentialMode(null, ''),
    /required when the verifier captures the ledger/u,
  );

  const childEnvironment = buildPsqlEnvironment(
    {
      SUPABASE_ACCESS_TOKEN: 'must-not-cross-process-boundary',
      KEEP_ME: 'yes',
    },
    `postgresql://warehouse_reader.${PRODUCTION_REF}:test-only@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  );
  assert.equal(childEnvironment['SUPABASE_ACCESS_TOKEN'], undefined);
  assert.equal(childEnvironment['KEEP_ME'], 'yes');
  assert.match(
    childEnvironment['PGOPTIONS'] ?? '',
    /default_transaction_read_only=on/u,
  );
});

test('canonical pooler URI becomes explicit libpq fields, never a URI database or argv credential', () => {
  // Synthetic credential only; never load production secrets into tests.
  const dsn = `postgresql://warehouse_reader.${PRODUCTION_REF}:test%40only%3Avalue@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require`;
  const child = buildPsqlEnvironment({
    ...process.env,
    SUPABASE_ACCESS_TOKEN: 'test-management-token',
    UNIT_TALK_WAREHOUSE_SOURCE_DSN: dsn,
    PGHOST: '/var/run/postgresql',
    PGHOSTADDR: '127.0.0.1',
    PGSERVICE: 'untrusted-connection',
    PGSERVICEFILE: '/untrusted/service.conf',
    PGOPTIONS: '-c default_transaction_read_only=off',
    PGSSLMODE: 'disable',
  }, dsn);
  assert.equal(child['PGHOST'], 'aws-0-us-east-1.pooler.supabase.com');
  assert.equal(child['PGPORT'], '5432');
  assert.equal(child['PGUSER'], `warehouse_reader.${PRODUCTION_REF}`);
  assert.equal(child['PGDATABASE'], 'postgres');
  assert.equal(child['PGPASSWORD'], 'test@only:value');
  assert.equal(child['PGSSLMODE'], 'require');
  assert.equal(child['PGOPTIONS'], '-c default_transaction_read_only=on -c statement_timeout=15000');
  for (const key of ['SUPABASE_ACCESS_TOKEN', 'UNIT_TALK_WAREHOUSE_SOURCE_DSN', 'PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE']) {
    assert.equal(child[key], undefined);
  }
  const args = buildPsqlArguments();
  assert.equal(args.some((arg) => arg.includes(dsn) || arg.includes(child['PGPASSWORD'] as string)), false);
  assert.ok(args.includes('--single-transaction'));
  assert.ok(args.at(-1)?.startsWith(`${READ_ONLY_PREAMBLE}; ${READ_ONLY_STATE_SQL};`));

  // A real child boundary, without a DB connection: emit booleans only, never
  // passwords or a full env dump. This reproduces the production env handoff.
  const observed = JSON.parse(execFileSync(process.execPath, ['-e', `
    console.log(JSON.stringify({
      host: process.env.PGHOST === 'aws-0-us-east-1.pooler.supabase.com',
      database: process.env.PGDATABASE === 'postgres',
      reader: process.env.PGUSER === 'warehouse_reader.${PRODUCTION_REF}',
      password: process.env.PGPASSWORD === 'test@only:value',
      tokenStripped: !process.env.SUPABASE_ACCESS_TOKEN,
      dsnStripped: !process.env.UNIT_TALK_WAREHOUSE_SOURCE_DSN,
      readOnly: process.env.PGOPTIONS === '-c default_transaction_read_only=on -c statement_timeout=15000'
    }));
  `], { env: child, encoding: 'utf8' })) as Record<string, boolean>;
  assert.ok(Object.values(observed).every((value) => value));
});

test('reader decomposition refuses malformed, noncanonical or connection-override DSNs before psql', () => {
  const prefix = `postgresql://warehouse_reader.${PRODUCTION_REF}:test-only@aws-0-us-east-1.pooler.supabase.com:5432`;
  for (const dsn of [
    'not-a-url',
    `postgresql://postgres.${PRODUCTION_REF}:test-only@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
    `postgresql://warehouse_reader.${STAGING_REF}:test-only@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
    `postgresql://warehouse_reader.${PRODUCTION_REF}:test-only@untrusted.invalid:5432/postgres`,
    `${prefix}/`,
    `${prefix}/postgres?sslmode=disable`,
    `${prefix}/postgres?sslmode=require&sslmode=disable`,
    `${prefix}/postgres?host=untrusted.invalid`,
    `${prefix}/postgres?options=-c%20default_transaction_read_only=off`,
    `${prefix}/postgres#ignored`,
    `${prefix}/post%ZZgres`,
    `${prefix}/post%00gres`,
  ]) {
    assert.throws(() => buildPsqlEnvironment({}, dsn));
  }
  const direct = `postgresql://warehouse_reader:test-only@db.${PRODUCTION_REF}.supabase.co:5432/warehouse%5Ftest?sslmode=verify-full`;
  const child = buildPsqlEnvironment({}, direct);
  assert.equal(child['PGDATABASE'], 'warehouse_test');
  assert.equal(child['PGSSLMODE'], 'verify-full');
  assert.equal(buildPsqlEnvironment({}, `${prefix}/postgres`)['PGSSLMODE'], 'require');
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

test('production Markdown ledger shape passes only with exact numeric version sets', () => {
  const versions = ['00000000000000', '202603200001', EXPECTED_MIGRATION_VERSION];
  const header = ' Local | Remote | Time (UTC)\n ----------|----------|----------\n';
  const rows = versions.map((version) => `  \`${version}\`  | \`${version}\` | \`2026-09-28 13:17:14\``).join('\n');
  const ledger = parseMigrationLedger(header + rows, EXPECTED_MIGRATION_VERSION, versions);
  assert.equal(ledger.aligned, true);
  assert.ok(ledger.remote.includes('20260928131714'));
  for (const badCell of ['`arbitrary text`', '``20260928131714``', '`20260928131714', '20260928131714`', '` 20260928131714 `', '`123`', '`202609281317140`']) {
    assert.equal(parseMigrationLedger(`${header}${rows}\n${badCell} | ${badCell} | now`, EXPECTED_MIGRATION_VERSION, versions).aligned, false);
  }
  for (const remote of ['', '`20260928131713`', '`nonnumeric`']) {
    const changedRows = rows.replace(/`20260928131714`\s+\|\s+`20260928131714`/u, `\`20260928131714\` | ${remote}`);
    assert.equal(parseMigrationLedger(header + changedRows, EXPECTED_MIGRATION_VERSION, versions).aligned, false);
  }
  assert.equal(parseMigrationLedger(header + rows, EXPECTED_MIGRATION_VERSION, versions.slice(0, 2)).aligned, false);
});

test('staging, mutable, or non-authoritative receipts cannot substitute for production truth', () => {
  assert.equal(receiptPasses(passingReceipt()), true);
  assert.equal(
    receiptPasses({
      ...passingReceipt(),
      environment: 'staging' as 'production',
    }),
    false,
  );
  assert.equal(
    receiptPasses({ ...passingReceipt(), project_ref: STAGING_REF }),
    false,
  );
  assert.equal(
    receiptPasses({ ...passingReceipt(), read_only: false as true }),
    false,
  );
  assert.equal(
    receiptPasses({ ...passingReceipt(), mutated: true as false }),
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
});

test('workflow is manual, production-bound, reader-only, and keeps parity mandatory', () => {
  const workflow = readRegisteredProductionWorkflow();
  if (!workflow) return;
  assert.match(workflow, /^\s*workflow_dispatch:/mu);
  assert.doesNotMatch(workflow, /^\s*pull_request:/mu);
  assert.match(workflow, /environment: production/u);
  assert.match(workflow, /UNIT_TALK_WAREHOUSE_SOURCE_DSN/u);
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY/u);
  assert.match(workflow, /Live Schema Parity/u);
});
