import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { parse as parseYaml } from 'yaml';

const DEPLOY_WORKFLOW_PATH = resolve(process.cwd(), '.github/workflows/deploy.yml');
const deployWorkflowSource = readFileSync(DEPLOY_WORKFLOW_PATH, 'utf8');

type WorkflowRecord = Record<string, unknown>;
type WorkflowStep = Record<string, unknown>;

function objectField(input: WorkflowRecord, key: string): WorkflowRecord {
  const value = input[key];
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${key} must be an object`);
  return value as WorkflowRecord;
}

function workflowJob(workflow: WorkflowRecord, jobId: string): WorkflowRecord {
  return objectField(objectField(workflow, 'jobs'), jobId);
}

function workflowStep(job: WorkflowRecord, name: string): WorkflowStep {
  const steps = job['steps'];
  assert.ok(Array.isArray(steps), 'job steps must be an array');
  const step = steps.find(
    (candidate) =>
      candidate &&
      typeof candidate === 'object' &&
      (candidate as WorkflowStep)['name'] === name,
  );
  assert.ok(step, `workflow step "${name}" must exist`);
  return step as WorkflowStep;
}

function runScript(step: WorkflowStep): string {
  const source = step['run'];
  assert.equal(typeof source, 'string', 'workflow step must have a run script');
  return source;
}

function auditParkedModeDeployWorkflow(source: string): string[] {
  const parsed = parseYaml(source) as WorkflowRecord;
  const violations: string[] = [];
  const verify = workflowJob(parsed, 'verify');
  const canary = workflowJob(parsed, 'canary');
  const promote = workflowJob(parsed, 'promote');
  const verifyOutputs = objectField(verify, 'outputs');
  const canaryEnv = objectField(canary, 'env');
  const promoteEnv = objectField(promote, 'env');
  const canaryOutputs = objectField(canary, 'outputs');
  const secretValidation = runScript(workflowStep(verify, 'Validate production secret inventory'));
  const deployGateEnv = runScript(workflowStep(verify, 'Write deploy gate env'));
  const canaryWrite = runScript(workflowStep(canary, 'Write .env.production to server'));
  const productionWrite = runScript(workflowStep(promote, 'Write .env.production to server'));
  const canaryConfirm = runScript(
    workflowStep(canary, 'Confirm syndicate machine gate in canary container'),
  );
  const productionConfirm = runScript(
    workflowStep(promote, 'Confirm syndicate machine gate in production container'),
  );

  if (
    verifyOutputs['syndicate_machine_mode'] !==
    '${{ steps.syndicate-mode.outputs.mode }}'
  ) {
    violations.push('verify must export the canonical validated syndicate-machine mode');
  }

  const canaryNeeds = canary['needs'];
  if (!Array.isArray(canaryNeeds) || !canaryNeeds.includes('verify')) {
    violations.push('canary must depend directly on verify');
  }
  if (
    canaryEnv['SYNDICATE_MACHINE_MODE'] !==
      '${{ needs.verify.outputs.syndicate_machine_mode }}' ||
    canaryOutputs['syndicate_machine_mode'] !==
      '${{ needs.verify.outputs.syndicate_machine_mode }}'
  ) {
    violations.push('canary must consume and export the canonical validated mode');
  }
  if (
    promote['needs'] !== 'canary' ||
    promoteEnv['SYNDICATE_MACHINE_MODE'] !==
      '${{ needs.canary.outputs.syndicate_machine_mode }}'
  ) {
    violations.push('production must consume the canonical mode exported by canary');
  }

  if (
    !/case "\$SECRET_SYNDICATE_MACHINE_ENABLED" in[\s\S]*true\) syndicate_machine_mode=active[\s\S]*false\) syndicate_machine_mode=parked/.test(
      secretValidation,
    )
  ) {
    violations.push('secret inventory must accept only exact true/false declarations');
  }
  if (!secretValidation.includes('mode=$syndicate_machine_mode')) {
    violations.push('secret inventory must emit the validated mode');
  }
  if (
    !deployGateEnv.includes(
      "SYNDICATE_MACHINE_ENABLED=${{ steps.syndicate-mode.outputs.mode == 'active' && 'true' || 'false' }}",
    )
  ) {
    violations.push('deploy-check env must derive its value from the validated mode');
  }

  for (const [stage, writeScript] of [
    ['canary', canaryWrite],
    ['production', productionWrite],
  ] as const) {
    if (
      !/case "\$SYNDICATE_MACHINE_MODE" in[\s\S]*active\) SYNDICATE_MACHINE_ENABLED=true[\s\S]*parked\) SYNDICATE_MACHINE_ENABLED=false/.test(
        writeScript,
      )
    ) {
      violations.push(`${stage} env writer must map the validated mode without drift`);
    }
    if (
      !writeScript.includes(
        '"SYNDICATE_MACHINE_ENABLED=$SYNDICATE_MACHINE_ENABLED"',
      )
    ) {
      violations.push(`${stage} env writer must preserve the validated requested value`);
    }
  }

  for (const [stage, confirmScript] of [
    ['canary', canaryConfirm],
    ['production', productionConfirm],
  ] as const) {
    if (
      !/case "\$SYNDICATE_MACHINE_MODE" in[\s\S]*active\) REQUESTED_VALUE=true[\s\S]*parked\) REQUESTED_VALUE=false/.test(
        confirmScript,
      )
    ) {
      violations.push(`${stage} readiness must derive the requested value from validated mode`);
    }
    if (!confirmScript.includes('if [ "$VALUE" != "$REQUESTED_VALUE" ]; then')) {
      violations.push(`${stage} readiness must compare runtime and requested values`);
    }
    if (
      !confirmScript.includes(
        '"mode":"%s","requestedValue":"%s","runtimeValue":"%s"',
      )
    ) {
      violations.push(`${stage} receipt must report the truthful mode and values`);
    }
  }

  const directSecretConsumers =
    source.match(/SYNDICATE_MACHINE_ENABLED:\s*\$\{\{\s*secrets\.SYNDICATE_MACHINE_ENABLED\s*\}\}/g) ??
    [];
  if (directSecretConsumers.length !== 1) {
    violations.push('only the canonical validation step may consume the raw GitHub secret');
  }
  if (
    source.includes('"value":"true"') ||
    source.includes('SYNDICATE_MACHINE_ENABLED readiness RED in canary container: \'${VALUE') ||
    source.includes('SYNDICATE_MACHINE_ENABLED readiness RED in production container: \'${VALUE')
  ) {
    violations.push('deploy receipts and container checks must not hardcode active mode');
  }

  return violations;
}

function executeSecretValidation(rawValue: string) {
  const workflow = parseYaml(deployWorkflowSource) as WorkflowRecord;
  const script = runScript(
    workflowStep(workflowJob(workflow, 'verify'), 'Validate production secret inventory'),
  );
  const tempDir = mkdtempSync(join(tmpdir(), 'utv2-1604-deploy-mode-'));
  const outputPath = join(tempDir, 'github-output.txt');
  const requiredSecretEnv = {
    SECRET_SUPABASE_URL: 'https://example.supabase.co',
    SECRET_SUPABASE_ANON_KEY: 'anon',
    SECRET_SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    SECRET_DISCORD_BOT_TOKEN: 'discord-token',
    SECRET_DISCORD_CLIENT_ID: 'discord-client',
    SECRET_UNIT_TALK_BOT_API_KEY: 'bot-key',
    SECRET_UNIT_TALK_INGESTOR_API_KEY: 'ingestor-key',
    SECRET_SGO_API_KEY: 'sgo-key',
    SECRET_UNIT_TALK_DEPLOY_HOST: 'deploy.example.com',
    SECRET_UNIT_TALK_DEPLOY_SSH_KEY: 'ssh-key',
    SECRET_SYNDICATE_MACHINE_ENABLED: rawValue,
    GITHUB_OUTPUT: outputPath,
  };

  try {
    const result = spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
      cwd: process.cwd(),
      env: { ...process.env, ...requiredSecretEnv },
      encoding: 'utf8',
    });
    const output = result.status === 0 ? readFileSync(outputPath, 'utf8') : '';
    return { ...result, output };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

test('deploy workflow has one fail-closed parked-mode contract across every gate', () => {
  assert.deepEqual(auditParkedModeDeployWorkflow(deployWorkflowSource), []);
});

test('canonical deploy validator accepts parked and active modes with truthful output', () => {
  const parked = executeSecretValidation('false');
  assert.equal(parked.status, 0, parked.stderr);
  assert.match(parked.output, /^mode=parked$/m);
  assert.match(parked.stdout, /"mode":"parked"/);

  const active = executeSecretValidation('true');
  assert.equal(active.status, 0, active.stderr);
  assert.match(active.output, /^mode=active$/m);
  assert.match(active.stdout, /"mode":"active"/);
});

test('canonical deploy validator rejects missing, case-variant, padded, and unknown values', () => {
  for (const invalidValue of ['', 'TRUE', 'False', ' true ', '0', 'enabled']) {
    const result = executeSecretValidation(invalidValue);
    assert.notEqual(result.status, 0, `expected ${JSON.stringify(invalidValue)} to fail`);
  }
});

test('static deploy audit detects canary or production mode drift', () => {
  const canaryDrift = deployWorkflowSource.replace(
    '"SYNDICATE_MACHINE_ENABLED=$SYNDICATE_MACHINE_ENABLED"',
    '"SYNDICATE_MACHINE_ENABLED=true"',
  );
  assert.ok(
    auditParkedModeDeployWorkflow(canaryDrift).some((violation) =>
      violation.includes('canary env writer'),
    ),
  );

  const productionMarker = deployWorkflowSource.indexOf(
    'Confirm syndicate machine gate in production container',
  );
  assert.notEqual(productionMarker, -1);
  const productionDrift =
    deployWorkflowSource.slice(0, productionMarker) +
    deployWorkflowSource
      .slice(productionMarker)
      .replace(
        'if [ "$VALUE" != "$REQUESTED_VALUE" ]; then',
        'if [ "$VALUE" != "true" ]; then',
      );
  assert.ok(
    auditParkedModeDeployWorkflow(productionDrift).some((violation) =>
      violation.includes('production readiness'),
    ),
  );
});

test('static deploy audit detects a hardcoded active-mode receipt', () => {
  const mutatedSource = deployWorkflowSource.replace(
    '"mode":"%s","requestedValue":"%s","runtimeValue":"%s"',
    '"mode":"active","value":"true"',
  );

  assert.ok(
    auditParkedModeDeployWorkflow(mutatedSource).some((violation) =>
      violation.includes('receipt'),
    ),
  );
});
