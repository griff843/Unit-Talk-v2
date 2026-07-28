import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

test('uses the production approval gate and exact UTV2-1610 guard', () => {
  const { job } = load();
  assert.strictEqual(job.environment, 'production');
  assert.strictEqual(job.if, "${{ github.event.inputs.confirm == 'contain-utv2-1610' }}");
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
  assert.doesNotMatch(script, /echo[^\n]*\$\{?(DEPLOY_HOST|DEPLOY_USER|DEPLOY_PATH|DEPLOY_SSH_KEY)\b/);
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
    assert.match(line, /docker compose up -d --no-deps --force-recreate api/);
    assert.doesNotMatch(line, /\b(worker|ingestor|discord-bot|bot)\b/i);
  }
});

test('contains no forbidden deploy, database, cleanup, or service-restart operation', () => {
  const { text } = load();
  assert.doesNotMatch(text, /docker compose pull/i);
  assert.doesNotMatch(text, /docker (?:compose )?build/i);
  assert.doesNotMatch(text, /\bprune\b/i);
  assert.doesNotMatch(text, /\bmigrat(?:e|ion|ions)\b/i);
  assert.doesNotMatch(text, /docker compose (?:restart|up)[^\n]*(?:worker|ingestor|discord-bot|bot)\b/i);

  const composeUpLines = text.split('\n').filter((line) => line.includes('docker compose up'));
  assert.ok(composeUpLines.every((line) => line.includes('--no-deps')));
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
