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

function stepIndex(job: WorkflowRecord, name: string): number {
  const steps = job['steps'];
  assert.ok(Array.isArray(steps), 'job steps must be an array');
  return steps.findIndex(
    (candidate) =>
      candidate && typeof candidate === 'object' && (candidate as WorkflowStep)['name'] === name,
  );
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
  const canaryAuth = runScript(workflowStep(canary, 'Authenticate GHCR on remote'));
  const promoteAuth = runScript(workflowStep(promote, 'Authenticate GHCR on remote'));
  const canaryPermissions = objectField(canary, 'permissions');
  const promotePermissions = objectField(promote, 'permissions');
  const canarySteps = canary['steps'];
  const promoteSteps = promote['steps'];
  assert.ok(Array.isArray(canarySteps), 'canary steps must be an array');
  assert.ok(Array.isArray(promoteSteps), 'promote steps must be an array');

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
      !/case "\$SYNDICATE_MACHINE_MODE" in[\s\S]*active\)[\s\S]*?SYNDICATE_MACHINE_ENABLED=true[\s\S]*parked\)[\s\S]*?SYNDICATE_MACHINE_ENABLED=false/.test(
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

    // UTV2-1646: parked mode must also stop provider-derived producers (ingestor,
    // worker) and force public delivery targets to none -- SYNDICATE_MACHINE_ENABLED
    // alone only gates the API process's own schedulers.
    if (
      !/active\)[\s\S]*?_ingestor_autorun=true[\s\S]*?_ingestor_scheduling_enabled=true[\s\S]*?_worker_autorun=true[\s\S]*parked\)[\s\S]*?_ingestor_autorun=false[\s\S]*?_ingestor_scheduling_enabled=false[\s\S]*?_worker_autorun=false/.test(
        writeScript,
      )
    ) {
      violations.push(
        `${stage} env writer must derive ingestor/worker autorun+scheduling flags from validated mode`,
      );
    }
    if (!writeScript.includes('"UNIT_TALK_INGESTOR_AUTORUN=$_ingestor_autorun"')) {
      violations.push(`${stage} env writer must not hardcode UNIT_TALK_INGESTOR_AUTORUN`);
    }
    if (
      !writeScript.includes(
        '"UNIT_TALK_INGESTOR_SCHEDULING_ENABLED=$_ingestor_scheduling_enabled"',
      )
    ) {
      violations.push(`${stage} env writer must not hardcode UNIT_TALK_INGESTOR_SCHEDULING_ENABLED`);
    }
    if (!writeScript.includes('"UNIT_TALK_WORKER_AUTORUN=$_worker_autorun"')) {
      violations.push(`${stage} env writer must not hardcode UNIT_TALK_WORKER_AUTORUN`);
    }
    if (writeScript.includes('_enabled_targets:-best-bets}"')) {
      violations.push(
        `${stage} env writer must not use a bare fallback for UNIT_TALK_ENABLED_TARGETS -- parked mode must never resolve to best-bets`,
      );
    }
    if (
      !/SYNDICATE_MACHINE_MODE"\s*=\s*"parked"\s*\][\s\S]*?_enabled_targets="none"/.test(writeScript)
    ) {
      violations.push(`${stage} env writer must force UNIT_TALK_ENABLED_TARGETS to none in parked mode`);
    }
    if (!writeScript.includes('"UNIT_TALK_ENABLED_TARGETS=$_enabled_targets"')) {
      violations.push(`${stage} env writer must write the fully-resolved UNIT_TALK_ENABLED_TARGETS value`);
    }
  }

  for (const [stage, confirmScript] of [
    ['canary', canaryConfirm],
    ['production', productionConfirm],
  ] as const) {
    if (
      !/case "\$SYNDICATE_MACHINE_MODE" in[\s\S]*active\)[\s\S]*?REQUESTED_VALUE=true[\s\S]*parked\)[\s\S]*?REQUESTED_VALUE=false/.test(
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

    // UTV2-1646: only production actually runs the ingestor/worker containers
    // (canary deploys the api service alone via --no-deps api), so the deployed-SHA-
    // bound container-truth proof for the parked contract's other three vars only
    // makes sense at the production stage.
    if (stage === 'production') {
      if (!confirmScript.includes('docker compose exec -T ingestor printenv UNIT_TALK_INGESTOR_AUTORUN')) {
        violations.push('production readiness must inspect the ingestor container for UNIT_TALK_INGESTOR_AUTORUN');
      }
      if (
        !confirmScript.includes(
          'docker compose exec -T ingestor printenv UNIT_TALK_INGESTOR_SCHEDULING_ENABLED',
        )
      ) {
        violations.push(
          'production readiness must inspect the ingestor container for UNIT_TALK_INGESTOR_SCHEDULING_ENABLED',
        );
      }
      if (!confirmScript.includes('docker compose exec -T worker printenv UNIT_TALK_WORKER_AUTORUN')) {
        violations.push('production readiness must inspect the worker container for UNIT_TALK_WORKER_AUTORUN');
      }
      if (!confirmScript.includes('docker compose exec -T worker printenv UNIT_TALK_ENABLED_TARGETS')) {
        violations.push('production readiness must inspect the worker container for UNIT_TALK_ENABLED_TARGETS');
      }
      if (
        !confirmScript.includes(
          '[ "$SYNDICATE_MACHINE_MODE" = "parked" ] && [ "$ENABLED_TARGETS_VALUE" != "none" ]',
        )
      ) {
        violations.push(
          'production readiness must fail closed if parked mode does not resolve UNIT_TALK_ENABLED_TARGETS to none',
        );
      }
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

  // UTV2-1648: the long-lived GHCR_PAT secret must never come back -- registry
  // auth on the remote host must use the ephemeral, repository-scoped
  // github.token the build job already uses to push these same images.
  if (/secrets\.GHCR_PAT\b/.test(source) || /GHCR_PAT\s*:/.test(source)) {
    violations.push('no job may reference the retired GHCR_PAT secret');
  }

  for (const [stage, job, authScript, permissions] of [
    ['canary', canary, canaryAuth, canaryPermissions],
    ['production', promote, promoteAuth, promotePermissions],
  ] as const) {
    if (!authScript.includes('${{ github.token }}') && !authScript.includes('$REGISTRY_TOKEN')) {
      violations.push(`${stage} GHCR auth must use github.token, not a standing secret`);
    }
    if (!/\$\{\{\s*github\.token\s*\}\}/.test(source)) {
      violations.push('github.token must appear literally in the workflow source');
    }
    if (!authScript.includes('${{ github.actor }}')) {
      violations.push(`${stage} GHCR auth must use github.actor as the registry username, not a hardcoded login`);
    }
    if (permissions['packages'] !== 'read') {
      violations.push(`${stage} job must be scoped to packages: read (pull-only), not the workflow-level write default`);
    }
    if (permissions['contents'] !== 'read') {
      violations.push(`${stage} job must declare contents: read explicitly`);
    }

    const preflightName = 'Preflight — verify registry auth and resolve all 4 image tags';
    const authIdx = stepIndex(job, 'Authenticate GHCR on remote');
    const preflightIdx = stepIndex(job, preflightName);
    const mutationIdx = stepIndex(
      job,
      stage === 'canary' ? 'Release API canary' : 'Promote all production containers',
    );
    if (preflightIdx === -1) {
      violations.push(`${stage} must have a registry preflight step before any container mutation`);
    } else {
      if (!(authIdx < preflightIdx && preflightIdx < mutationIdx)) {
        violations.push(
          `${stage} registry preflight must run after auth and before the container-mutation step, in that order`,
        );
      }
      const preflightScript = runScript(workflowStep(job, preflightName));
      if (!/for svc in .*api.*worker.*ingestor.*discord-bot/.test(preflightScript)) {
        violations.push(`${stage} registry preflight must check all four services (api, worker, ingestor, discord-bot)`);
      }
      if (!/exit 1/.test(preflightScript)) {
        violations.push(`${stage} registry preflight must fail closed (exit 1) if any image fails to resolve`);
      }
    }
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

// ── UTV2-1646: parked mode must also stop ingestor/worker and never fall back
// to a real delivery target ─────────────────────────────────────────────────

test('static deploy audit detects a hardcoded UNIT_TALK_INGESTOR_AUTORUN', () => {
  const mutatedSource = deployWorkflowSource.replaceAll(
    '"UNIT_TALK_INGESTOR_AUTORUN=$_ingestor_autorun"',
    '"UNIT_TALK_INGESTOR_AUTORUN=true"',
  );
  assert.ok(
    auditParkedModeDeployWorkflow(mutatedSource).some((violation) =>
      violation.includes('UNIT_TALK_INGESTOR_AUTORUN'),
    ),
  );
});

test('static deploy audit detects a hardcoded UNIT_TALK_WORKER_AUTORUN', () => {
  const mutatedSource = deployWorkflowSource.replaceAll(
    '"UNIT_TALK_WORKER_AUTORUN=$_worker_autorun"',
    '"UNIT_TALK_WORKER_AUTORUN=true"',
  );
  assert.ok(
    auditParkedModeDeployWorkflow(mutatedSource).some((violation) =>
      violation.includes('UNIT_TALK_WORKER_AUTORUN'),
    ),
  );
});

test('static deploy audit detects UNIT_TALK_ENABLED_TARGETS falling back to best-bets instead of forcing none in parked mode', () => {
  const mutatedSource = deployWorkflowSource.replaceAll(
    '"UNIT_TALK_ENABLED_TARGETS=$_enabled_targets"',
    '"UNIT_TALK_ENABLED_TARGETS=${_enabled_targets:-best-bets}"',
  );
  assert.ok(
    auditParkedModeDeployWorkflow(mutatedSource).some((violation) =>
      violation.includes('UNIT_TALK_ENABLED_TARGETS') || violation.includes('best-bets'),
    ),
  );
});

test('static deploy audit detects a missing production ingestor/worker container confirmation', () => {
  const mutatedSource = deployWorkflowSource.replace(
    'docker compose exec -T ingestor printenv UNIT_TALK_INGESTOR_AUTORUN',
    'docker compose exec -T api printenv UNIT_TALK_INGESTOR_AUTORUN',
  );
  assert.ok(
    auditParkedModeDeployWorkflow(mutatedSource).some((violation) =>
      violation.includes('UNIT_TALK_INGESTOR_AUTORUN'),
    ),
  );
});

test('static deploy audit detects a missing parked-mode UNIT_TALK_ENABLED_TARGETS container assertion', () => {
  const mutatedSource = deployWorkflowSource.replace(
    '[ "$SYNDICATE_MACHINE_MODE" = "parked" ] && [ "$ENABLED_TARGETS_VALUE" != "none" ]',
    '[ "$SYNDICATE_MACHINE_MODE" = "parked" ] && false',
  );
  assert.ok(
    auditParkedModeDeployWorkflow(mutatedSource).some((violation) =>
      violation.includes('UNIT_TALK_ENABLED_TARGETS'),
    ),
  );
});

// ── UTV2-1648: no standing GHCR_PAT credential; ephemeral github.token only ──

test('static deploy audit detects a reintroduced GHCR_PAT secret', () => {
  const mutatedSource = deployWorkflowSource
    .replaceAll('${{ github.token }}', '${{ secrets.GHCR_PAT }}')
    .replaceAll('REGISTRY_TOKEN', 'GHCR_PAT');
  assert.ok(
    auditParkedModeDeployWorkflow(mutatedSource).some((violation) => violation.includes('GHCR_PAT')),
  );
});

test('static deploy audit detects a hardcoded registry username instead of github.actor', () => {
  const mutatedSource = deployWorkflowSource.replaceAll('${{ github.actor }}', 'griff843');
  assert.ok(
    auditParkedModeDeployWorkflow(mutatedSource).some((violation) => violation.includes('github.actor')),
  );
});

test('static deploy audit detects canary/production still granted packages: write', () => {
  const mutatedSource = deployWorkflowSource.replace(
    /(canary:\n(?:.*\n)*?\s+permissions:\n\s+contents: read\n\s+packages: )read/,
    '$1write',
  );
  assert.ok(
    auditParkedModeDeployWorkflow(mutatedSource).some((violation) => violation.includes('packages: read')),
  );
});

test('static deploy audit detects a missing registry preflight step', () => {
  const mutatedSource = deployWorkflowSource.replace(
    /\n\s+- name: Preflight — verify registry auth and resolve all 4 image tags\n(?:.*\n)*?(?=\n\s+- name: Release API canary)/,
    '\n',
  );
  assert.ok(
    auditParkedModeDeployWorkflow(mutatedSource).some((violation) =>
      violation.includes('registry preflight'),
    ),
  );
});

test('static deploy audit detects a registry preflight that does not fail closed', () => {
  const mutatedSource = deployWorkflowSource.replaceAll(
    'echo "::error::Registry preflight failed for tag $IMAGE_TAG -- could not authenticate or resolve:$failed. Aborting before any container mutation."\n            exit 1',
    'echo "::warning::registry preflight found issues but continuing"',
  );
  assert.ok(
    auditParkedModeDeployWorkflow(mutatedSource).some((violation) =>
      violation.includes('fail closed'),
    ),
  );
});
