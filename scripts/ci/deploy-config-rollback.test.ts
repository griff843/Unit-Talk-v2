// UTV2-1834 — a rollback that restores the image but not the configuration puts
// production into a pairing that was never deployed and never tested. These
// tests hold both halves of the fix: deploy.yml must snapshot the OUTGOING
// configuration before it overwrites anything, and rollback.sh must restore the
// snapshot that matches the tag it is rolling back to.
//
// The structural assertions alone would pass against a snapshot step that
// snapshots the wrong thing, so the last test executes the two shell bodies for
// real against a temp directory and asserts the round trip.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = process.cwd();
const DEPLOY_WORKFLOW_PATH = resolve(REPO_ROOT, '.github/workflows/deploy.yml');
const ROLLBACK_SCRIPT_PATH = resolve(REPO_ROOT, 'deploy/rollback.sh');

const deployWorkflowSource = readFileSync(DEPLOY_WORKFLOW_PATH, 'utf8');
const rollbackSource = readFileSync(ROLLBACK_SCRIPT_PATH, 'utf8');

const SNAPSHOT_STEP = 'Snapshot outgoing configuration for rollback';
const ENV_WRITE_STEP = 'Write .env.production to server';
const DEPLOY_JOBS = ['canary', 'promote'] as const;
const CONFIG_FILES = ['.env.production', '.env.web', '.env.smart-form'] as const;

type WorkflowRecord = Record<string, unknown>;
type WorkflowStep = Record<string, unknown>;

function jobSteps(jobId: string): WorkflowStep[] {
  const workflow = parseYaml(deployWorkflowSource) as WorkflowRecord;
  const jobs = workflow['jobs'] as WorkflowRecord;
  assert.ok(jobs && typeof jobs === 'object', 'deploy.yml must define jobs');
  const job = jobs[jobId] as WorkflowRecord;
  assert.ok(job && typeof job === 'object', `deploy.yml must define the "${jobId}" job`);
  const steps = job['steps'];
  assert.ok(Array.isArray(steps), `"${jobId}" steps must be an array`);
  return steps as WorkflowStep[];
}

function stepIndex(jobId: string, name: string): number {
  return jobSteps(jobId).findIndex((step) => step && step['name'] === name);
}

function snapshotRunScript(jobId: string): string {
  const step = jobSteps(jobId).find((candidate) => candidate && candidate['name'] === SNAPSHOT_STEP);
  assert.ok(step, `"${jobId}" must contain the "${SNAPSHOT_STEP}" step`);
  const run = (step as WorkflowStep)['run'];
  assert.equal(typeof run, 'string', `"${SNAPSHOT_STEP}" in "${jobId}" must be a run step`);
  return run as string;
}

// The step ships the remote work as a quoted heredoc so nothing expands on the
// runner. Pulling that body back out is what lets the functional test execute
// the exact bytes the deploy would send.
function snapshotRemoteBody(jobId: string): string {
  const script = snapshotRunScript(jobId);
  const match = script.match(/<<'SNAPSHOT_REMOTE'\n([\s\S]*?)\nSNAPSHOT_REMOTE/);
  assert.ok(match, `"${SNAPSHOT_STEP}" in "${jobId}" must send a quoted SNAPSHOT_REMOTE heredoc`);
  return match![1];
}

for (const jobId of DEPLOY_JOBS) {
  test(`${jobId}: snapshots the outgoing configuration before overwriting it`, () => {
    const snapshotAt = stepIndex(jobId, SNAPSHOT_STEP);
    const writeAt = stepIndex(jobId, ENV_WRITE_STEP);

    assert.notEqual(snapshotAt, -1, `"${jobId}" must contain the "${SNAPSHOT_STEP}" step`);
    assert.notEqual(writeAt, -1, `"${jobId}" must contain the "${ENV_WRITE_STEP}" step`);

    // Ordering is the whole control. A snapshot taken after the first env write
    // captures the INCOMING configuration and silently makes rollback useless.
    assert.ok(
      snapshotAt < writeAt,
      `"${SNAPSHOT_STEP}" (index ${snapshotAt}) must precede "${ENV_WRITE_STEP}" (index ${writeAt}) in "${jobId}"`,
    );
  });

  test(`${jobId}: keys the snapshot on the outgoing release, not the incoming tag`, () => {
    const body = snapshotRemoteBody(jobId);

    // .unit-talk-release still holds the OUTGOING tag at this point in the job;
    // it is only advanced after the env writes. Keying on the incoming image tag
    // would name the snapshot after a release that was never configured by it.
    assert.match(body, /cat \.unit-talk-release/, `"${jobId}" must read the outgoing tag from .unit-talk-release`);
    assert.doesNotMatch(
      body,
      /IMAGE_TAG|UNIT_TALK_IMAGE_TAG|github\.sha/,
      `"${jobId}" must not key the snapshot on the incoming image tag`,
    );

    // A host with no prior release has nothing to snapshot; refusing there would
    // make the first deploy of a new host fail for no safety benefit.
    assert.match(body, /if \[ ! -f \.unit-talk-release \]/, `"${jobId}" must tolerate a first-ever deploy`);
  });

  // Kept separate from the keying test so that dropping a file and mis-keying the
  // tag produce distinguishable failures rather than the same red test.
  test(`${jobId}: snapshots every configuration file the deploy overwrites`, () => {
    const body = snapshotRemoteBody(jobId);
    for (const file of CONFIG_FILES) {
      assert.ok(body.includes(file), `"${jobId}" snapshot must cover ${file}`);
    }
  });
}

test('rollback.sh restores the configuration snapshot for the tag it rolls back to', () => {
  for (const file of CONFIG_FILES) {
    assert.ok(rollbackSource.includes(file), `rollback.sh must restore ${file}`);
  }

  // A missing snapshot must not abort the rollback: rolling the code back alone
  // is still strictly better than leaving the failed release running. But it has
  // to say so, or an operator will believe the configuration came back too.
  assert.match(
    rollbackSource,
    /WARNING: no configuration snapshot/,
    'rollback.sh must warn explicitly when no snapshot exists for the tag',
  );

  const restoreBefore = rollbackSource.indexOf('.env.production');
  const composeUp = rollbackSource.indexOf('docker compose up');
  assert.ok(restoreBefore !== -1 && composeUp !== -1, 'rollback.sh must both restore config and start containers');
  assert.ok(
    restoreBefore < composeUp,
    'rollback.sh must restore configuration before starting the containers that read it',
  );
});

test('snapshot then rollback restores the exact bytes and mode that were overwritten', () => {
  const dir = mkdtempSync(join(tmpdir(), 'utv2-1834-'));
  const outgoingTag = 'e48106fc0000000000000000000000000000abcd';
  const original: Record<string, string> = {
    '.env.production': 'SUPABASE_URL=https://old.example\nRUNTIME_MODE=fail_closed\n',
    '.env.web': 'NEXT_PUBLIC_API_BASE_URL=https://old.example\n',
    '.env.smart-form': 'ALLOWED_CAPPER_EMAILS=someone@example.com=griff843\n',
  };

  try {
    writeFileSync(join(dir, '.unit-talk-release'), `${outgoingTag}\n`);
    for (const [name, body] of Object.entries(original)) {
      writeFileSync(join(dir, name), body);
      chmodSync(join(dir, name), 0o600);
    }

    // 1. Run the real snapshot body the deploy would ssh to the host.
    const snapshot = spawnSync('bash', ['-s', '--', dir], {
      input: snapshotRemoteBody('promote'),
      encoding: 'utf8',
      cwd: dir,
    });
    assert.equal(snapshot.status, 0, `snapshot body failed: ${snapshot.stderr}`);

    for (const name of CONFIG_FILES) {
      const snapPath = join(dir, `${name}.${outgoingTag}`);
      assert.equal(readFileSync(snapPath, 'utf8'), original[name], `${name} snapshot must be byte-identical`);
      assert.equal(statSync(snapPath).mode & 0o777, 0o600, `${name} snapshot must be mode 0600`);
    }

    // 2. Simulate the deploy overwriting every env file in place, exactly as the
    //    "Write .env.* to server" steps do.
    for (const name of CONFIG_FILES) {
      writeFileSync(join(dir, name), 'BROKEN=1\n');
    }
    writeFileSync(join(dir, '.unit-talk-release'), 'aaaaaaaabbbbbbbbccccccccddddddddeeeeeeee\n');

    // 3. Roll back to the outgoing tag using the script's own emitted remote
    //    command, with only the docker lines removed — there is no daemon here.
    const dryRun = spawnSync(
      'bash',
      [ROLLBACK_SCRIPT_PATH, '--dry-run', '--tag', outgoingTag, '--path', dir],
      { encoding: 'utf8', cwd: REPO_ROOT },
    );
    assert.equal(dryRun.status, 0, `rollback dry run failed: ${dryRun.stderr}`);

    const remoteCommand = dryRun.stdout
      .split('\n')
      .filter((line) => !line.includes('docker compose'))
      .filter((line) => !line.startsWith('Rollback dry run passed'))
      .join('\n');
    assert.ok(remoteCommand.includes('.env.smart-form'), 'emitted remote command must carry the restore loop');

    const restore = spawnSync('bash', ['-s'], { input: remoteCommand, encoding: 'utf8', cwd: dir });
    assert.equal(restore.status, 0, `restore failed: ${restore.stderr}`);

    for (const name of CONFIG_FILES) {
      assert.equal(
        readFileSync(join(dir, name), 'utf8'),
        original[name],
        `${name} must be restored to the configuration that ran with ${outgoingTag}`,
      );
      assert.equal(statSync(join(dir, name)).mode & 0o777, 0o600, `${name} must be restored as mode 0600`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rolling back to a tag with no snapshot warns and still rolls the code back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'utv2-1834-nosnap-'));
  const tag = '1111111122222222333333334444444455555555';
  try {
    writeFileSync(join(dir, '.env.production'), 'CURRENT=1\n');
    const dryRun = spawnSync(
      'bash',
      [ROLLBACK_SCRIPT_PATH, '--dry-run', '--tag', tag, '--path', dir],
      { encoding: 'utf8', cwd: REPO_ROOT },
    );
    assert.equal(dryRun.status, 0, `rollback dry run failed: ${dryRun.stderr}`);

    const remoteCommand = dryRun.stdout
      .split('\n')
      .filter((line) => !line.includes('docker compose'))
      .filter((line) => !line.startsWith('Rollback dry run passed'))
      .join('\n');

    const restore = spawnSync('bash', ['-s'], { input: remoteCommand, encoding: 'utf8', cwd: dir });
    assert.equal(restore.status, 0, 'a missing snapshot must not abort the rollback');
    assert.match(
      restore.stderr,
      /WARNING: no configuration snapshot for 1111111122222222333333334444444455555555/,
      'the operator must be told the configuration did not come back',
    );
    // The code half still happened.
    assert.equal(readFileSync(join(dir, '.unit-talk-release'), 'utf8').trim(), tag);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// UTV2-1835 — the snapshot is keyed on .unit-talk-release, which only advances
// after the env writes. That leaves a window: a deploy that fails between the
// two has already replaced the configuration on disk while the release record
// still names the previous, still-running release.
//
// Two behaviours have to hold at once, and they pull in opposite directions:
//
//   - A RETRY after a failed attempt must not overwrite the snapshot, because
//     what is on disk is the failed attempt's configuration.
//   - A REDEPLOY of the same tag (a secret rotation with no code change — the
//     documented recovery from a bad configuration) must refresh it, or the
//     stored copy silently diverges from what is running.
//
// The in-flight marker is the only thing that distinguishes them, so it is
// tested in both directions and its lifecycle is asserted structurally.
const RELEASE_ADVANCE_STEP: Record<(typeof DEPLOY_JOBS)[number], string> = {
  canary: 'Release API canary',
  promote: 'Promote all production containers',
};
const INFLIGHT = '.unit-talk-deploy-inflight';

function seedHost(dir: string, tag: string, config: Record<string, string>): void {
  writeFileSync(join(dir, '.unit-talk-release'), `${tag}\n`);
  for (const [name, body] of Object.entries(config)) {
    writeFileSync(join(dir, name), body);
    chmodSync(join(dir, name), 0o600);
  }
}

function runSnapshot(jobId: (typeof DEPLOY_JOBS)[number], dir: string) {
  return spawnSync('bash', ['-s', '--', dir, 'test-run-id'], {
    input: snapshotRemoteBody(jobId),
    encoding: 'utf8',
    cwd: dir,
  });
}

for (const jobId of DEPLOY_JOBS) {
  // Establishes that the window this defect lives in actually exists. If the
  // release record were advanced before the env writes there would be no
  // window, and the tests below would be guarding nothing.
  test(`${jobId}: the release record advances only after the configuration is written`, () => {
    const writeAt = stepIndex(jobId, ENV_WRITE_STEP);
    const advanceAt = stepIndex(jobId, RELEASE_ADVANCE_STEP[jobId]);
    assert.notEqual(advanceAt, -1, `"${jobId}" must contain "${RELEASE_ADVANCE_STEP[jobId]}"`);
    assert.ok(
      writeAt < advanceAt,
      `"${ENV_WRITE_STEP}" (${writeAt}) must precede "${RELEASE_ADVANCE_STEP[jobId]}" (${advanceAt})`,
    );
  });

  // The marker is only meaningful if it is raised before the writes and cleared
  // at the exact moment the configuration on disk becomes the release's own.
  // A marker that is never cleared would freeze every future snapshot; one that
  // is never raised restores the original defect.
  test(`${jobId}: the in-flight marker is raised by the snapshot and cleared at the release record`, () => {
    assert.match(
      snapshotRemoteBody(jobId),
      new RegExp(`> ${INFLIGHT.replace(/\./g, '\\.')}`),
      `"${SNAPSHOT_STEP}" in "${jobId}" must raise the in-flight marker before the env writes`,
    );
    const advance = jobSteps(jobId).find((s) => s && s['name'] === RELEASE_ADVANCE_STEP[jobId]);
    const run = (advance as WorkflowStep)['run'] as string;
    const releaseAt = run.indexOf('> .unit-talk-release');
    const clearAt = run.indexOf(`rm -f ${INFLIGHT}`);
    assert.ok(clearAt !== -1, `"${RELEASE_ADVANCE_STEP[jobId]}" must clear the in-flight marker`);
    assert.ok(
      releaseAt !== -1 && releaseAt < clearAt,
      'the marker must be cleared only after the release record has advanced',
    );
  });

  test(`${jobId}: a retry after a failed deploy does not overwrite the running release's snapshot`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'utv2-1835-retry-'));
    const runningTag = 'e48106fc9a5eb5904b322833d0968da5ae0b0665';
    const original: Record<string, string> = {
      '.env.production': 'RUNTIME_MODE=fail_closed\n',
      '.env.web': 'NEXT_PUBLIC_API_BASE_URL=https://old.example\n',
      '.env.smart-form': 'ALLOWED_CAPPER_EMAILS=old-shape-that-admits-the-operator\n',
    };
    try {
      seedHost(dir, runningTag, original);

      // Deploy #1: snapshot (which raises the marker), then write the new
      // configuration, then die — before the release record advances. The
      // marker is left behind, exactly as the real job would leave it.
      assert.equal(runSnapshot(jobId, dir).status, 0, 'first snapshot must succeed');
      assert.ok(statSync(join(dir, INFLIGHT)).isFile(), 'the snapshot step must raise the marker');
      for (const name of CONFIG_FILES) {
        writeFileSync(join(dir, name), 'REPLACED_BY_FAILED_DEPLOY=1\n');
      }

      // Deploy #2: the operator retries the same dispatch.
      assert.equal(runSnapshot(jobId, dir).status, 0, 'retry snapshot must succeed');

      for (const name of CONFIG_FILES) {
        assert.equal(
          readFileSync(join(dir, `${name}.${runningTag}`), 'utf8'),
          original[name],
          `${name}.${runningTag} must still hold the configuration that ran with ${runningTag}, ` +
            'not what a failed deploy left behind',
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The counterpart. Without this, "never overwrite" would be indistinguishable
  // from a correct fix while quietly breaking the documented recovery path:
  // edit the secret, re-dispatch the same release.
  test(`${jobId}: redeploying the same tag after a completed deploy refreshes the snapshot`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'utv2-1835-resnap-'));
    const tag = 'e48106fc9a5eb5904b322833d0968da5ae0b0665';
    try {
      seedHost(dir, tag, { '.env.smart-form': 'ALLOWED_CAPPER_EMAILS=admits-nobody\n' });

      // A completed deploy: snapshot ran, and the release step cleared the
      // marker. What is on disk genuinely is this release's configuration.
      assert.equal(runSnapshot(jobId, dir).status, 0, 'first snapshot must succeed');
      rmSync(join(dir, INFLIGHT));

      // The operator corrects the secret and re-dispatches the same release.
      writeFileSync(join(dir, '.env.smart-form'), 'ALLOWED_CAPPER_EMAILS=corrected\n');
      chmodSync(join(dir, '.env.smart-form'), 0o600);
      assert.equal(runSnapshot(jobId, dir).status, 0, 'redeploy snapshot must succeed');

      assert.equal(
        readFileSync(join(dir, `.env.smart-form.${tag}`), 'utf8'),
        'ALLOWED_CAPPER_EMAILS=corrected\n',
        'a completed deploy of the same tag must refresh the snapshot, or the stored ' +
          'copy diverges from the configuration actually running',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test(`${jobId}: pruning never evicts the snapshot for the release on the host`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'utv2-1835-prune-'));
    const runningTag = 'e48106fc9a5eb5904b322833d0968da5ae0b0665';
    const original = 'ALLOWED_CAPPER_EMAILS=old-shape-that-admits-the-operator\n';
    try {
      seedHost(dir, runningTag, { '.env.smart-form': original });

      // Snapshot first, so it is the OLDEST by mtime — the position a
      // mtime-ordered prune evicts from. The marker is left in place so the
      // second run cannot refresh it and mask the eviction.
      assert.equal(runSnapshot(jobId, dir).status, 0, 'snapshot must succeed');

      // Eight newer snapshots, as a run of failed retries at other tags leaves.
      for (let i = 0; i < 8; i += 1) {
        writeFileSync(join(dir, `.env.smart-form.${String(i).repeat(40)}`), `NEWER=${i}\n`);
      }

      assert.equal(runSnapshot(jobId, dir).status, 0, 'second snapshot must succeed');
      assert.equal(
        readFileSync(join(dir, `.env.smart-form.${runningTag}`), 'utf8'),
        original,
        'the snapshot for the release on the host must survive the prune',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
