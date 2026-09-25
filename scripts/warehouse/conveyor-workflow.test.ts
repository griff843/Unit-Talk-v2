/**
 * WORK-2026092101 — the scheduled conveyor's runtime home.
 *
 * `conveyor.test.ts` proves the conveyor behaves. This file proves the thing
 * that actually runs it is wired the way the lane claims, because a guarantee
 * that lives only in a comment above a workflow is not a guarantee.
 *
 * Two assertions carry the most weight: that no path reachable from the
 * schedule can delete production data, and that no secret is written into the
 * repository.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { DEFAULT_RETENTION_POLICY, planConveyorRun } from './conveyor.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github/workflows/warehouse-archive-conveyor.yml');
const CLI_PATH = path.join(REPO_ROOT, 'scripts/warehouse/cli.ts');

const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');
const cli = fs.readFileSync(CLI_PATH, 'utf8');

test('the conveyor runs on a schedule and can be dispatched by hand', () => {
  assert.ok(workflow.includes('schedule:'));
  assert.match(workflow, /cron: '17 4 \* \* \*'/);
  assert.ok(workflow.includes('workflow_dispatch:'));
  assert.ok(
    workflow.includes('window_date'),
    'a backfill of one specific day must be possible without editing the schedule',
  );
});

test('the schedule is daily, and each day archives the window 45 days back', () => {
  // A daily schedule and a one-day window are one design: together they move at
  // the rate the hot database fills. Either one changing alone opens a gap.
  const cron = /cron: '([^']+)'/.exec(workflow)?.[1] ?? '';
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.split(' ');
  assert.match(minute ?? '', /^\d+$/);
  assert.match(hour ?? '', /^\d+$/);
  assert.deepEqual([dayOfMonth, month, dayOfWeek], ['*', '*', '*'], 'the conveyor must run every day');

  assert.equal(DEFAULT_RETENTION_POLICY.length, 1);
  assert.equal(DEFAULT_RETENTION_POLICY[0]?.hotRetentionDays, 45);
  const plan = planConveyorRun({ policy: DEFAULT_RETENTION_POLICY, today: '2026-09-24' });
  assert.deepEqual(plan.items.map((item) => item.date), ['2026-08-09'], 'today - 45 - 1');
});

test('two conveyor runs cannot overlap', () => {
  assert.ok(workflow.includes('concurrency:'));
  assert.ok(workflow.includes('group: warehouse-archive-conveyor'));
  assert.ok(
    workflow.includes('cancel-in-progress: false'),
    'cancelling a running conveyor mid-upload is how a half-written object happens',
  );
});

test('nothing reachable from the schedule can delete production data', () => {
  // The conveyor archives and verifies. A prune is a separate, PM-authorized
  // action, and the absence of the capability is the control — not a warning
  // in a runbook that a future step could ignore.
  //
  // The assertion is over what the workflow EXECUTES, so YAML comment lines are
  // stripped first. Matching comments too would have made the control unable to
  // coexist with the header that explains why no prune step exists — and the
  // usual resolution of that conflict is to delete the explanation, which
  // weakens the documentation without strengthening the control.
  const executable = workflow
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  for (const forbidden of ['prune', 'DELETE', 'DROP', 'TRUNCATE', 'detach-then-drop']) {
    assert.equal(
      executable.includes(forbidden),
      false,
      `the conveyor workflow must not execute ${forbidden}`,
    );
  }
  assert.equal(/case 'prune'/.test(cli), false, 'the CLI must have no prune subcommand');
  assert.equal(/\bDELETE\s+FROM\b/i.test(cli), false);
  assert.equal(/\bDROP\s+(TABLE|PARTITION)\b/i.test(cli), false);
});

test('the workflow holds no secret values, only references to the secret store', () => {
  // Every credential arrives as `${{ secrets.NAME }}`. A literal would be a
  // secret committed to the repository, which is the one mistake in this lane
  // that cannot be undone by a revert.
  const assignments = [...workflow.matchAll(/^\s+(UNIT_TALK_WAREHOUSE_[A-Z0-9_]+):\s*(.+)$/gm)];
  assert.ok(assignments.length > 0, 'the workflow must pass the warehouse configuration through');
  for (const [, name, value] of assignments) {
    assert.match(
      value.trim(),
      /^\$\{\{ secrets\.[A-Z0-9_]+ \}\}$/,
      `${name} must come from the secret store, not from a literal`,
    );
  }
  assert.equal(/AKIA[0-9A-Z]{12,}/.test(workflow), false, 'no access key id literal');
  assert.equal(/postgres(ql)?:\/\/[^\s$]*:[^\s$]*@/.test(workflow), false, 'no DSN with credentials');
});

test('the workflow asks only for read permission on the repository', () => {
  assert.ok(workflow.includes('permissions:'));
  assert.ok(workflow.includes('contents: read'));
  assert.equal(workflow.includes('contents: write'), false);
});

test('staleness is reported even when the run failed', () => {
  // "Failing" and "not running" are different states. A staleness step that is
  // skipped on failure reports the conveyor as healthy for as long as it is
  // broken, which is precisely backwards.
  const stalenessStep = workflow.slice(workflow.indexOf('Report conveyor staleness'));
  assert.ok(stalenessStep.includes('always()'), 'the staleness report must not be skipped on failure');
});

test('the run is bounded in time', () => {
  assert.match(workflow, /timeout-minutes: \d+/, 'an unbounded scheduled export can run for hours');
});

test('the workflow names no other lane’s job or gate', () => {
  // This lane runs alongside production-recovery work. The conveyor must not
  // be able to interfere with a deploy, a merge gate or a readiness refresh.
  for (const forbidden of ['deploy.yml', 'merge-gate', 'readiness-refresh', 'workflow_run']) {
    assert.equal(workflow.includes(forbidden), false, `the conveyor must not touch ${forbidden}`);
  }
});

test('the conveyor refuses a row-security-filtered source before exporting anything', () => {
  const conveyorCase = cli.slice(cli.indexOf("case 'conveyor':"), cli.indexOf("case 'staleness':"));
  const guard = conveyorCase.indexOf('assertSourceNotRowFiltered(connection');
  const exportRun = conveyorCase.indexOf('runConveyor(');
  assert.ok(guard > 0, 'the conveyor path must call assertSourceNotRowFiltered');
  assert.ok(guard < exportRun, 'the row-security guard must run before runConveyor');
  assert.match(conveyorCase, /new Set\(plan\.items\.map\(\(item\) => item\.relation\)\)/);
});

test('the header never claims an unconfigured run exits cleanly', () => {
  // The header once said an unconfigured run "exits cleanly". It never did, and
  // the contract says it must not: an archive that is not running is stale.
  const header = workflow.slice(0, workflow.indexOf('on:'));
  assert.equal(/exits? cleanly/i.test(header), false);
  assert.match(header, /FAILS at `warehouse\s+#?\s*doctor`/);
});

test('warehouse doctor exits 0 only when the archive configuration is ready', () => {
  const runDoctor = (extra: Record<string, string>) =>
    spawnSync(process.execPath, ['--import', 'tsx', CLI_PATH, 'doctor'], {
      cwd: REPO_ROOT,
      env: { PATH: process.env.PATH ?? '', ...extra },
      encoding: 'utf8',
    });
  const objectStore = {
    UNIT_TALK_WAREHOUSE_S3_ENDPOINT: 'https://fsn1.your-objectstorage.com',
    UNIT_TALK_WAREHOUSE_S3_REGION: 'fsn1',
    UNIT_TALK_WAREHOUSE_S3_BUCKET: 'unit-talk-archive',
    UNIT_TALK_WAREHOUSE_S3_ACCESS_KEY_ID: 'AKIAEXAMPLEKEYID0001',
    UNIT_TALK_WAREHOUSE_S3_SECRET_ACCESS_KEY: 's3cr3t-value-not-a-placeholder',
  };
  const dsn = { UNIT_TALK_WAREHOUSE_SOURCE_DSN: 'postgresql://r:pw-value-9f2@db.example.test:5432/postgres' };

  const cases: Array<[string, Record<string, string>, number, string]> = [
    ['nothing set', {}, 1, 'not_provisioned'],
    ['object store only', objectStore, 1, 'incomplete'],
    ['placeholder bucket', { ...objectStore, ...dsn, UNIT_TALK_WAREHOUSE_S3_BUCKET: 'your-bucket' }, 1, 'incomplete'],
    ['complete', { ...objectStore, ...dsn }, 0, 'ready'],
  ];
  for (const [label, env, expectedStatus, expectedState] of cases) {
    const result = runDoctor(env);
    assert.equal(result.status, expectedStatus, `${label}: exit ${result.status}, stderr ${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).archive_state, expectedState, label);
    assert.equal(result.stdout.includes('s3cr3t-value'), false, `${label}: doctor printed a secret`);
    assert.equal(result.stdout.includes('pw-value-9f2'), false, `${label}: doctor printed the DSN password`);
  }
});

function runCli(argv: string[], extra: Record<string, string>) {
  return spawnSync(process.execPath, ['--import', 'tsx', CLI_PATH, ...argv], {
    cwd: REPO_ROOT,
    env: { PATH: process.env.PATH ?? '', ...extra },
    encoding: 'utf8',
  });
}

const READER = {
  UNIT_TALK_WAREHOUSE_S3_ENDPOINT: 'https://fsn1.your-objectstorage.com',
  UNIT_TALK_WAREHOUSE_S3_REGION: 'fsn1',
  UNIT_TALK_WAREHOUSE_S3_BUCKET: 'unit-talk-archive',
  UNIT_TALK_WAREHOUSE_S3_READ_ACCESS_KEY_ID: 'READERKEYID00000001',
  UNIT_TALK_WAREHOUSE_S3_READ_SECRET_ACCESS_KEY: 'reader-s3cr3t-value-0001',
};
const WRITER_SECRET = 'wr1ter-s3cr3t-value-must-not-print';

test('warehouse query refuses to start beside the writer key, and never prints it', () => {
  for (const key of ['UNIT_TALK_WAREHOUSE_S3_ACCESS_KEY_ID', 'UNIT_TALK_WAREHOUSE_S3_SECRET_ACCESS_KEY']) {
    const result = runCli(['query', '--prefix', 'canonical/markets'], { ...READER, [key]: WRITER_SECRET });
    assert.equal(result.status, 1, `${key}: exit ${result.status}`);
    assert.ok(result.stderr.includes(key), `${key}: the refusal must name the variable`);
    assert.equal(`${result.stdout}${result.stderr}`.includes(WRITER_SECRET), false, `${key}: printed its value`);
  }
});

test('doctor --research is ready with the reader alone and refuses beside the writer', () => {
  const reader = runCli(['doctor', '--research'], READER);
  assert.equal(reader.status, 0, reader.stderr);
  assert.equal(JSON.parse(reader.stdout).research_ready, true);

  const writer = runCli(['doctor', '--research'], {
    ...READER,
    UNIT_TALK_WAREHOUSE_S3_SECRET_ACCESS_KEY: WRITER_SECRET,
  });
  assert.equal(writer.status, 1);
  assert.deepEqual(JSON.parse(writer.stdout).research_forbidden_present, ['UNIT_TALK_WAREHOUSE_S3_SECRET_ACCESS_KEY']);
  assert.equal(`${writer.stdout}${writer.stderr}`.includes(WRITER_SECRET), false);
  assert.equal(`${reader.stdout}${reader.stderr}`.includes('reader-s3cr3t-value-0001'), false);
});

test('a backfill dry run prints its windows and keys and writes nothing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-warehouse-dry-run-'));
  try {
    const result = runCli(
      ['backfill', '--source', 'provider_offers_legacy_quarantine', '--from', '2026-04-23', '--to', '2026-04-29',
        '--today', '2026-09-25', '--dry-run'],
      { UNIT_TALK_WAREHOUSE_LOCAL_ROOT: root },
    );
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.equal(out.dry_run, true);
    assert.equal(out.prune_hold, true);
    assert.equal(out.windows.length, 7);
    assert.equal(out.windows[0].data_key, 'raw/provider_offers_legacy/all/2026/2026-04-23/part-0000.parquet');
    assert.equal(out.ledger_key, 'manifests/_backfill/provider_offers_legacy_quarantine/2026-04-23_2026-04-29.json');
    assert.deepEqual(fs.readdirSync(root), [], 'a dry run wrote into the store');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a backfill names every missing argument at once, and refuses a bad range', () => {
  const missing = runCli(['backfill', '--source', 'provider_offer_history', '--dry-run'], {});
  assert.equal(missing.status, 1);
  assert.ok(missing.stderr.includes('--from, --to are required'), missing.stderr);
  assert.ok(missing.stderr.includes('Full invocation: warehouse backfill --source'), missing.stderr);

  const backwards = runCli(
    ['backfill', '--source', 'provider_offer_history', '--from', '2026-06-30', '--to', '2026-05-11', '--dry-run'],
    {},
  );
  assert.equal(backwards.status, 1);
  assert.match(backwards.stderr, /is after to/);

  const tooMany = runCli(
    ['backfill', '--source', 'provider_offer_history', '--from', '2026-05-11', '--to', '2026-06-30',
      '--max-windows', '1', '--today', '2026-09-25', '--dry-run'],
    {},
  );
  assert.equal(tooMany.status, 1);
  assert.match(tooMany.stderr, /51 windows, above the limit of 1/);
});

/** The body of one job, from its key to the next top-level job key. */
function jobBody(name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `the workflow must define a ${name} job`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9_-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

test('a backfill is a manual dispatch mode with explicit inputs, never the schedule', () => {
  for (const input of ['mode', 'source', 'from', 'to', 'max_windows', 'dry_run']) {
    assert.match(workflow, new RegExp(`\\n {6}${input}:\\n`), `workflow_dispatch must declare ${input}`);
  }
  assert.match(workflow, /- provider_offer_history\n\s+- provider_offers_legacy_quarantine\n/);

  const backfill = jobBody('backfill');
  assert.match(backfill, /if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.mode == 'backfill' \}\}/);
  assert.ok(backfill.includes('pnpm -s warehouse backfill'));
  assert.ok(backfill.includes('--dry-run'), 'the backfill job plans before it runs');
  for (const flag of ['--source "$BACKFILL_SOURCE"', '--from "$BACKFILL_FROM"', '--to "$BACKFILL_TO"']) {
    assert.ok(backfill.includes(flag), `the backfill passes ${flag}`);
  }
  assert.ok(backfill.includes('--max-windows "$BACKFILL_MAX_WINDOWS"'));
  for (const [variable, input] of [
    ['BACKFILL_SOURCE', 'source'],
    ['BACKFILL_FROM', 'from'],
    ['BACKFILL_TO', 'to'],
    ['BACKFILL_MAX_WINDOWS', 'max_windows'],
  ]) {
    const wired = backfill.split(`${variable}: \${{ inputs.${input} }}`).length - 1;
    assert.equal(wired, 2, `${variable} must carry inputs.${input} into both the plan and the run`);
  }
  assert.match(backfill, /if: \$\{\{ inputs\.dry_run != true \}\}/, 'dry_run must stop before the real run');

  const conveyor = jobBody('conveyor');
  assert.equal(conveyor.includes('warehouse backfill'), false, 'the schedule must never start a backfill');
  assert.match(conveyor, /if: \$\{\{ github\.event_name == 'schedule' \|\| inputs\.mode != 'backfill' \}\}/);
});

test('dispatch inputs reach the shell only through environment variables', () => {
  // `${{ inputs.x }}` inside a run line is spliced into the script before the
  // shell parses it: a crafted input becomes a command. Through `env:` it is
  // only ever data.
  const lines = workflow.split('\n').filter((line) => !/^\s*#/.test(line));
  for (const line of lines.filter((l) => l.includes('${{ inputs.'))) {
    const asEnv = /^\s+[A-Z][A-Z0-9_]*: \$\{\{ inputs\.[a-z_]+ \}\}$/.test(line);
    const asCondition = /^\s+if: /.test(line);
    assert.ok(asEnv || asCondition, `input interpolated outside env or if: ${line.trim()}`);
  }
  assert.equal(/format\(/.test(workflow), false, 'no expression builds a command line');
});

test('every job runs in the warehouse-archive environment and refuses off main', () => {
  for (const name of ['conveyor', 'backfill']) {
    const body = jobBody(name);
    assert.match(body, /\n {4}environment: warehouse-archive\n/, `${name} must use the warehouse-archive environment`);
    const guard = body.indexOf('Refuse unless running from main');
    assert.ok(guard > 0, `${name} must refuse unless on main`);
    assert.ok(guard < body.indexOf('Checkout'), `${name}: the ref guard must run before anything else`);
    const step = body.slice(guard, body.indexOf('- name: Checkout'));
    assert.ok(step.includes('RUN_REF: ${{ github.ref }}'));
    assert.ok(step.includes('if [ "$RUN_REF" != "refs/heads/main" ]; then'));
    assert.ok(step.includes('exit 1'), `${name}: the ref guard must fail the run, not skip it`);
    assert.match(body, /timeout-minutes: \d+/, `${name} must be bounded in time`);
  }
});

test('no prune or delete command exists in either job', () => {
  const executable = workflow
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
    .toLowerCase();
  for (const forbidden of ['prune', 'delete', 'drop ', 'truncate', 'detach', ' rm ', 'cron.alter_job']) {
    assert.equal(executable.includes(forbidden), false, `the workflow must not execute ${forbidden.trim()}`);
  }
  const runs = [...workflow.matchAll(/pnpm -s warehouse ([a-z]+)/g)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(runs)].sort(),
    ['backfill', 'conveyor', 'doctor', 'plan', 'staleness'],
    'the workflow runs only the archiving and reporting subcommands',
  );
});
