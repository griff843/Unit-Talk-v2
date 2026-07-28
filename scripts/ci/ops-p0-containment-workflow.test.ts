import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';

const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'ops-p0-containment.yml');

interface WorkflowJob {
  environment?: string;
  if?: string;
  steps?: Array<{ name?: string; run?: string; env?: Record<string, string> }>;
}

interface Workflow {
  on?: Record<string, unknown>;
  jobs?: Record<string, WorkflowJob>;
}

function load(): { text: string; workflow: Workflow; job: WorkflowJob } {
  const text = fs.readFileSync(workflowPath, 'utf8');
  const workflow = YAML.parse(text) as Workflow;
  assert.ok(workflow && typeof workflow === 'object', 'workflow must parse as a YAML object');
  const jobs = workflow.jobs ?? {};
  assert.deepStrictEqual(Object.keys(jobs), ['contain'], 'workflow must expose one surgical containment job');
  return { text, workflow, job: jobs.contain };
}

function runScript(job: WorkflowJob): string {
  return (job.steps ?? []).map((step) => step.run ?? '').join('\n');
}

/**
 * The remote half of the containment step, i.e. the body of the quoted
 * `<<'REMOTE_SCRIPT'` heredoc that is delivered to the host on ssh stdin.
 */
function remoteScript(job: WorkflowJob): string {
  const script = runScript(job);
  const start = script.indexOf("<<'REMOTE_SCRIPT'");
  assert.ok(start >= 0, 'containment step must deliver a quoted REMOTE_SCRIPT heredoc');
  const bodyStart = script.indexOf('\n', start) + 1;
  const end = script.indexOf('\nREMOTE_SCRIPT\n', bodyStart);
  assert.ok(end > bodyStart, 'REMOTE_SCRIPT heredoc must be terminated');
  return script.slice(bodyStart, end);
}

test('is manual-only and accepts only the exact confirmation input', () => {
  const { workflow } = load();
  assert.deepStrictEqual(Object.keys(workflow.on ?? {}), ['workflow_dispatch']);

  const dispatch = workflow.on?.workflow_dispatch as
    | { inputs?: Record<string, { required?: boolean; type?: string }> }
    | undefined;
  assert.ok(dispatch && typeof dispatch === 'object', 'workflow_dispatch must be configured');
  assert.deepStrictEqual(Object.keys(dispatch.inputs ?? {}), ['confirm'], 'confirm must be the only input');
  assert.strictEqual(dispatch.inputs?.confirm?.required, true);
  assert.strictEqual(dispatch.inputs?.confirm?.type, 'string');
});

test('uses the production approval gate and the exact confirmation guard', () => {
  const { job } = load();
  assert.strictEqual(job.environment, 'production');
  assert.strictEqual(job.if, "${{ github.event.inputs.confirm == 'contain-utv2-1610' }}");
});

test('never interpolates workflow context into a shell command', () => {
  const { job } = load();
  const script = runScript(job);

  // The confirm input is attacker-controlled text. It may be compared in an
  // `if:` expression but must never reach a run: block, where `${{ }}` is
  // substituted before the shell parses the line.
  assert.doesNotMatch(
    script,
    /\$\{\{\s*(?:github|inputs|env|vars)\./,
    'no github/inputs/env/vars context may be interpolated inside a run: block',
  );

  // Secrets must arrive through env:, not through inline interpolation.
  const secretInterpolations = script.match(/\$\{\{[^}]*\}\}/g) ?? [];
  assert.deepStrictEqual(secretInterpolations, [], 'run: blocks must contain no ${{ }} interpolation at all');
});

test('the confirm input is referenced exactly twice: its declaration and the job guard', () => {
  const { text } = load();
  const references = text.split('\n').filter((line) => /\bconfirm\b/.test(line));
  assert.strictEqual(references.length, 2, `confirm must appear only in its declaration and the if: guard, found:\n${references.join('\n')}`);
});

test('hardcodes both containment variables to false and never exposes them as inputs', () => {
  const { text, workflow } = load();
  const dispatch = workflow.on?.workflow_dispatch as { inputs?: Record<string, unknown> };
  const inputNames = Object.keys(dispatch.inputs ?? {});

  assert.ok(!inputNames.includes('SYNDICATE_MACHINE_ENABLED'));
  assert.ok(!inputNames.includes('BOARD_PICK_WRITER_ENABLED'));
  assert.match(text, /SYNDICATE_MACHINE_ENABLED=false/);
  assert.match(text, /BOARD_PICK_WRITER_ENABLED=false/);
  assert.doesNotMatch(text, /SYNDICATE_MACHINE_ENABLED=\$\{\{/);
  assert.doesNotMatch(text, /BOARD_PICK_WRITER_ENABLED=\$\{\{/);
});

test('validates all four existing deployment secrets without printing their values', () => {
  const { text, job } = load();
  const script = runScript(job);

  for (const secret of [
    'UNIT_TALK_DEPLOY_HOST',
    'UNIT_TALK_DEPLOY_USER',
    'UNIT_TALK_DEPLOY_PATH',
    'UNIT_TALK_DEPLOY_SSH_KEY',
  ]) {
    assert.match(text, new RegExp(`secrets\\.${secret}`));
    assert.match(script, new RegExp(`missing\\+=\\(${secret}\\)`));
  }

  // Any command that writes a secret to stdout (the run log), not just echo.
  // Lines that redirect into a file — e.g. the ssh key install — are exempt.
  const leaks = script
    .split('\n')
    .filter((line) => /^\s*(?:echo|printf|cat|tee)\b/.test(line))
    .filter((line) => /\$\{?(?:DEPLOY_HOST|DEPLOY_USER|DEPLOY_PATH|DEPLOY_SSH_KEY)\b/.test(line))
    .filter((line) => !/>\s*\S/.test(line))
    .filter((line) => !/\|\s*base64/.test(line));
  assert.deepStrictEqual(leaks, [], 'deployment secrets must never be written to the run log');
  assert.doesNotMatch(script, /GITHUB_STEP_SUMMARY/, 'no secret-bearing state may be written to the job summary');
});

test('every remote command that could consume the script on stdin is redirected from /dev/null', () => {
  const { job } = load();
  const remote = remoteScript(job);

  // The script itself is the ssh stdin stream. `docker compose exec` keeps
  // stdin attached by default (-T only disables the TTY), so an unredirected
  // call drains the rest of the script, bash reaches EOF and exits 0 having
  // performed no containment at all.
  const stdinConsumers = remote
    .split('\n')
    .filter((line) => /\b(?:docker|curl|ssh|xargs|read)\b/.test(line))
    .filter((line) => !line.trim().startsWith('#'))
    .filter((line) => !/^\s*(?:echo|printf)\b/.test(line.trim()));

  assert.ok(stdinConsumers.length > 0, 'expected remote docker/curl commands to exist');
  for (const line of stdinConsumers) {
    assert.match(
      line,
      /<\s*\/dev\/null/,
      `remote command may steal the script from stdin; redirect it from /dev/null: ${line.trim()}`,
    );
  }
});

test('a truncated remote script fails the job instead of reporting success', () => {
  const { job } = load();
  const script = runScript(job);
  const remote = remoteScript(job);

  assert.match(
    remote.trimEnd().split('\n').at(-1) ?? '',
    /^echo 'CONTAINMENT_COMPLETE=UTV2-1612'$/,
    'the remote script must end with a completion sentinel as its final statement',
  );
  assert.match(
    script,
    /if ! grep -qx 'CONTAINMENT_COMPLETE=UTV2-1612'/,
    'the runner must assert the completion sentinel',
  );
  const sentinelCheck = script.indexOf("if ! grep -qx 'CONTAINMENT_COMPLETE=UTV2-1612'");
  assert.ok(sentinelCheck >= 0);
  assert.match(script.slice(sentinelCheck), /exit 1/, 'a missing sentinel must fail the job');
});

test('backs up env.production before either containment variable is mutated', () => {
  const { text } = load();
  const backup = text.indexOf('cp -p -- "$ENV_FILE" "$BACKUP_FILE"');
  const syndicateMutation = text.indexOf(
    "sed -i 's/^SYNDICATE_MACHINE_ENABLED=.*/SYNDICATE_MACHINE_ENABLED=false/'",
  );
  const boardMutation = text.indexOf(
    "sed -i 's/^BOARD_PICK_WRITER_ENABLED=.*/BOARD_PICK_WRITER_ENABLED=false/'",
  );

  assert.ok(backup >= 0, 'timestamped .env.production backup must be created');
  assert.match(text, /BACKUP_FILE="\.env\.production\.utv2-1612\.\$\{TIMESTAMP\}\.bak"/);
  assert.ok(backup < syndicateMutation, 'backup must precede SYNDICATE_MACHINE_ENABLED mutation');
  assert.ok(backup < boardMutation, 'backup must precede BOARD_PICK_WRITER_ENABLED mutation');
});

test('restores env.production automatically if anything fails before the restart', () => {
  const { job } = load();
  const remote = remoteScript(job);

  const backup = remote.indexOf('cp -p -- "$ENV_FILE" "$BACKUP_FILE"');
  const trap = remote.indexOf('trap on_failure EXIT');
  const firstMutation = remote.indexOf("sed -i 's/^SYNDICATE_MACHINE_ENABLED=");
  assert.ok(backup >= 0 && trap > backup, 'the failure trap must be armed after the backup exists');
  assert.ok(trap < firstMutation, 'the failure trap must be armed before any mutation');

  assert.match(remote, /RESTART_DONE=false/, 'restart state must be tracked');
  assert.match(remote, /cp -p -- "\$BACKUP_FILE" "\$ENV_FILE"/, 'the trap must restore from the backup');

  const restartFlag = remote.indexOf('RESTART_DONE=true');
  const restart = remote.indexOf('UNIT_TALK_IMAGE_TAG="$CURRENT_IMAGE" docker compose up');
  assert.ok(restartFlag >= 0 && restartFlag < restart, 'RESTART_DONE must be set before the restart is attempted');
});

test('never appends onto a file that lacks a trailing newline', () => {
  const { job } = load();
  const remote = remoteScript(job);
  const guard = remote.indexOf('tail -c 1 "$ENV_FILE"');
  const firstAppend = remote.indexOf("printf '%s\\n' 'SYNDICATE_MACHINE_ENABLED=false' >> \"$ENV_FILE\"");
  assert.ok(guard >= 0, 'a trailing-newline guard must exist before any append');
  assert.ok(guard < firstAppend, 'the trailing-newline guard must precede the first append');
});

test('validates each key occurs exactly once and has the exact false value before restart', () => {
  const { text } = load();
  const validationEnd = text.indexOf(
    'UNIT_TALK_IMAGE_TAG="$CURRENT_IMAGE" docker compose up -d --no-deps --force-recreate api',
  );
  assert.ok(validationEnd >= 0, 'API restart must exist');
  const beforeRestart = text.slice(0, validationEnd);

  assert.match(beforeRestart, /grep -c '\^SYNDICATE_MACHINE_ENABLED='/);
  assert.match(beforeRestart, /"\$SYNDICATE_COUNT" -ne 1/);
  assert.match(beforeRestart, /grep -qx 'SYNDICATE_MACHINE_ENABLED=false'/);
  assert.match(beforeRestart, /grep -c '\^BOARD_PICK_WRITER_ENABLED='/);
  assert.match(beforeRestart, /"\$BOARD_COUNT" -ne 1/);
  assert.match(beforeRestart, /grep -qx 'BOARD_PICK_WRITER_ENABLED=false'/);
});

test('reuses the current release image and recreates only the API without dependencies', () => {
  const { text, job } = load();
  const script = runScript(job);
  assert.match(script, /CURRENT_IMAGE="\$\(tr -d '\\r\\n' < \.unit-talk-release\)"/);
  assert.match(script, /UNIT_TALK_IMAGE_TAG="\$CURRENT_IMAGE" docker compose up -d --no-deps --force-recreate api/);

  const composeUpLines = text.split('\n').filter((line) => line.includes('docker compose up'));
  assert.ok(composeUpLines.length >= 2, 'containment and rollback API restart commands must be present');
  for (const line of composeUpLines) {
    assert.match(line, /docker compose up -d --no-deps --force-recreate api\b/);
    assert.doesNotMatch(line, /\b(worker|ingestor|discord-bot|bot|grading-cron|outbox)\b/i);
  }
});

test('contains no forbidden deploy, database, cleanup, or service-control operation', () => {
  const { text } = load();

  // Image / deploy surface.
  assert.doesNotMatch(text, /docker (?:compose )?pull\b/i);
  assert.doesNotMatch(text, /docker (?:compose )?build\b/i);
  assert.doesNotMatch(text, /\bprune\b/i);
  assert.doesNotMatch(text, /\bmigrat(?:e|ion|ions)\b/i);

  // Whole-stack and non-API service control, including bare docker verbs.
  assert.doesNotMatch(text, /docker compose down\b/i);
  assert.doesNotMatch(text, /docker compose (?:stop|kill|rm)\b/i);
  assert.doesNotMatch(text, /\bdocker (?:stop|kill|rm|restart|start)\b/i);
  assert.doesNotMatch(
    text,
    /docker compose (?:restart|up|exec|stop)[^\n]*\b(?:worker|ingestor|discord-bot|bot|grading-cron|outbox)\b/i,
  );
  assert.doesNotMatch(text, /systemctl\b/i);

  // Database and credential surface.
  assert.doesNotMatch(text, /\b(?:psql|pg_dump|supabase)\b/i);
  assert.doesNotMatch(text, /\b(?:SUPABASE_[A-Z_]*KEY|SGO_API_KEY|SERVICE_ROLE)\b/);

  // Outbound distribution surface.
  assert.doesNotMatch(text, /\b(?:discord|webhook|notion|slack)\b/i);
  assert.doesNotMatch(text, /curl[^\n]*-X\s*(?:POST|PUT|PATCH|DELETE)/i);

  // Repository mutation on the host.
  assert.doesNotMatch(text, /\bgit (?:pull|fetch|checkout|reset|clone)\b/i);

  const composeUpLines = text.split('\n').filter((line) => line.includes('docker compose up'));
  assert.ok(composeUpLines.every((line) => line.includes('--no-deps')));
});

test('the only network egress is the loopback health probe', () => {
  const { job } = load();
  const remote = remoteScript(job);
  const curlLines = remote.split('\n').filter((line) => /\bcurl\b/.test(line) && !line.trim().startsWith('#'));
  assert.ok(curlLines.length > 0, 'the health probe must exist');
  for (const line of curlLines) {
    assert.match(line, /http:\/\/localhost:4000\/health/, `unexpected curl target: ${line.trim()}`);
  }
});

test('captures ordered pre-state, post-state, health evidence, and an explicit rollback receipt', () => {
  const { text } = load();
  const pre = text.indexOf('=== PRE-STATE (REDACTED) ===');
  const backup = text.indexOf('cp -p -- "$ENV_FILE" "$BACKUP_FILE"');
  const restart = text.indexOf(
    'UNIT_TALK_IMAGE_TAG="$CURRENT_IMAGE" docker compose up -d --no-deps --force-recreate api',
  );
  const post = text.indexOf('=== POST-STATE (REDACTED) ===');
  const evidence = text.indexOf('=== REDACTED CONTAINMENT EVIDENCE ===');
  const rollback = text.indexOf('=== ROLLBACK RECEIPT ===');

  assert.ok(pre >= 0 && pre < backup && backup < restart && restart < post && post < evidence && evidence < rollback);
  assert.match(text, /docker compose exec -T api printenv SYNDICATE_MACHINE_ENABLED/);
  assert.match(text, /docker compose exec -T api printenv BOARD_PICK_WRITER_ENABLED/);
  assert.match(text, /cat \.unit-talk-release/);
  assert.match(text, /docker ps --format/);
  assert.match(text, /curl -fsS --max-time 10 http:\/\/localhost:4000\/health/);
  assert.match(text, /backup_file=%s/);
  assert.match(
    text,
    /rollback_command=cp -- %q \.env\.production && UNIT_TALK_IMAGE_TAG=.*docker compose up -d --no-deps --force-recreate api/,
  );
});

test('warns that a subsequent deploy reverts the containment', () => {
  const { text } = load();
  assert.match(text, /CONTAINMENT IS NOT DURABLE/, 'the run log must state that containment is not durable');
  assert.match(text, /deploy\.yml rewrites \.env\.production/);

  // The warning must stay true against the real deploy workflow: it restores
  // SYNDICATE_MACHINE_ENABLED from a secret and does not carry the board flag.
  const deploy = fs.readFileSync(path.join(process.cwd(), '.github', 'workflows', 'deploy.yml'), 'utf8');
  assert.match(deploy, /"SYNDICATE_MACHINE_ENABLED=\$SYNDICATE_MACHINE_ENABLED"/);
  assert.doesNotMatch(deploy, /BOARD_PICK_WRITER_ENABLED/);
});

test('every run block is valid shell', () => {
  const { job } = load();
  const steps = job.steps ?? [];
  assert.ok(steps.length > 0, 'the containment job must define steps');

  for (const [index, step] of steps.entries()) {
    if (!step.run) continue;
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'p0-contain-')), `step-${index}.sh`);
    fs.writeFileSync(file, step.run);
    const result = spawnSync('bash', ['-n', file], { encoding: 'utf8' });
    assert.strictEqual(
      result.status,
      0,
      `step "${step.name ?? index}" is not valid shell:\n${result.stderr}`,
    );
  }
});
