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
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
