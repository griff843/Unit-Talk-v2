import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
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

    // UTV2-1618: live incident (2026-08-01) -- the production compose file
    // requires UNIT_TALK_IMAGE_TAG for every service on every compose
    // evaluation, not just `up`. These checks lock in the fix so the exact
    // same bug class cannot silently return.
    if (!confirmScript.includes("UNIT_TALK_IMAGE_TAG='$IMAGE_TAG' docker compose exec")) {
      violations.push(`${stage} readiness must supply UNIT_TALK_IMAGE_TAG to every docker compose exec`);
    }
    if (/docker compose exec[^\n]*2>\/dev\/null\s*\|\|\s*true/.test(confirmScript)) {
      violations.push(
        `${stage} readiness must not suppress stderr or swallow exit status (2>/dev/null || true) on a compose exec -- that hides a real Compose evaluation failure as "variable missing"`,
      );
    }
    if (!confirmScript.includes(".unit-talk-release")) {
      violations.push(`${stage} readiness must cross-check the resolved tag against the host's own release record`);
    }
    if (!confirmScript.includes('docker ps -q --filter') || !confirmScript.includes('docker inspect')) {
      violations.push(`${stage} readiness must independently cross-check via docker inspect + compose labels, not compose-exec alone`);
    }
  }

  // UTV2-1618: production must also prove the public kill switches remain
  // engaged -- defense-in-depth containment that this deploy did not set but
  // must never silently observe as disengaged.
  if (
    !productionConfirm.includes('delivery_kill_switch') ||
    !productionConfirm.includes('best-bets') ||
    !productionConfirm.includes('trader-insights')
  ) {
    violations.push('production readiness must verify the best-bets/trader-insights kill switches remain engaged');
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

// ── UTV2-1618: live production incident, 2026-08-01 -- the canary confirm
// step's `docker compose exec` never received UNIT_TALK_IMAGE_TAG, which the
// production compose file requires for EVERY service on EVERY compose
// evaluation. Compose failed closed before printenv ever ran, and
// `2>/dev/null || true` silently discarded that failure, misreporting a
// genuine Compose evaluation error as "SYNDICATE_MACHINE_ENABLED missing at
// runtime". The API container itself was correctly recreated and healthy
// throughout -- only this verification step's own evaluation was broken.
// Full promotion and the other production services were never touched.

test('static deploy audit detects a confirm step missing UNIT_TALK_IMAGE_TAG on compose exec', () => {
  const mutatedSource = deployWorkflowSource.replaceAll(
    "UNIT_TALK_IMAGE_TAG='$IMAGE_TAG' docker compose exec",
    'docker compose exec',
  );
  const violations = auditParkedModeDeployWorkflow(mutatedSource);
  assert.ok(violations.some((violation) => violation.includes('UNIT_TALK_IMAGE_TAG')));
});

test('static deploy audit detects reintroduced stderr suppression on a confirm-step compose exec', () => {
  const mutatedSource = deployWorkflowSource.replace(
    '"cd \'$DEPLOY_PATH\' && UNIT_TALK_IMAGE_TAG=\'$IMAGE_TAG\' docker compose exec -T api printenv SYNDICATE_MACHINE_ENABLED" 2>&1); then',
    '"cd \'$DEPLOY_PATH\' && UNIT_TALK_IMAGE_TAG=\'$IMAGE_TAG\' docker compose exec -T api printenv SYNDICATE_MACHINE_ENABLED" 2>/dev/null || true); then',
  );
  const violations = auditParkedModeDeployWorkflow(mutatedSource);
  assert.ok(
    violations.some((violation) => violation.includes('2>/dev/null || true')),
    `expected a stderr-suppression violation, got: ${JSON.stringify(violations)}`,
  );
});

test('static deploy audit detects a missing .unit-talk-release cross-check', () => {
  const mutatedSource = deployWorkflowSource.replaceAll('.unit-talk-release', '.unused-marker');
  const violations = auditParkedModeDeployWorkflow(mutatedSource);
  assert.ok(violations.some((violation) => violation.includes("release record")));
});

test('static deploy audit detects a missing docker-inspect independent cross-check', () => {
  const mutatedSource = deployWorkflowSource.replaceAll('docker inspect', 'docker unused-inspect');
  const violations = auditParkedModeDeployWorkflow(mutatedSource);
  assert.ok(violations.some((violation) => violation.includes('docker inspect')));
});

test('static deploy audit detects a missing public kill-switch verification in production readiness', () => {
  const productionMarker = deployWorkflowSource.indexOf(
    'Confirm syndicate machine gate in production container',
  );
  assert.notEqual(productionMarker, -1);
  const mutatedSource =
    deployWorkflowSource.slice(0, productionMarker) +
    deployWorkflowSource.slice(productionMarker).replaceAll('delivery_kill_switch', 'unused_table');
  const violations = auditParkedModeDeployWorkflow(mutatedSource);
  assert.ok(violations.some((violation) => violation.includes('kill switch')));
});

// ── UTV2-1618 PM review, Bounce 3: executable shell regressions ─────────────
//
// The static string-presence checks above cannot prove the classification
// logic is actually *reachable* under `bash -e` (GitHub Actions' real shell
// for these steps -- confirmed by the workflow logs, `shell: /usr/bin/bash -e
// {0}`), that UNIT_TALK_ENABLED_TARGETS is independently verified via
// docker-inspect rather than compose-exec alone, or that container lookups
// reject ambiguous matches. These tests execute the real production confirm
// script under `bash -e` against a fake `ssh`/`curl` on PATH, so they run the
// actual failure-handling code paths rather than grepping for text.

const productionConfirmScript = runScript(
  workflowStep(
    workflowJob(parseYaml(deployWorkflowSource) as WorkflowRecord, 'promote'),
    'Confirm syndicate machine gate in production container',
  ),
);

const BASE_ENV = {
  DEPLOY_USER: 'deployer',
  DEPLOY_HOST: 'host.example.com',
  DEPLOY_PATH: '/opt/unit-talk',
  IMAGE_NAMESPACE: 'ghcr.io/example/unit-talk-v2',
  IMAGE_TAG: 'sha-abc123',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
};

// Each rule is [substring-to-match-against-the-remote-command, stdout, exitCode, stderr?].
// Rules are tried in order; the first substring match wins. An unmatched
// remote command is a hard test failure (exit 99 with the command echoed),
// not a silent success -- an untested code path must never look "fine" by
// accident.
// Single-quotes a string for safe use as a literal bash word, escaping any
// embedded single quotes via the standard '\'' trick. Match/stdout/stderr
// text here contains literal double quotes (docker --format strings), so
// double-quoting is not an option; this is what actually survives them.
function shQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function writeFakeSsh(dir: string, rules: Array<[string, string, number, string?]>) {
  const arms = rules
    .map(
      ([match, stdout, exitCode, stderr]) => `
  *${shQuote(match)}*)
    ${stderr ? `printf '%s\\n' ${shQuote(stderr)} >&2` : ':'}
    printf '%b\\n' ${shQuote(stdout)}
    exit ${exitCode}
    ;;`,
    )
    .join('');
  const script = `#!/usr/bin/env bash
cmd="$2"
case "$cmd" in${arms}
  *)
    echo "UNMOCKED SSH CALL: $cmd" >&2
    exit 99
    ;;
esac
`;
  const path = join(dir, 'ssh');
  writeFileSync(path, script);
  chmodSync(path, 0o755);
}

function writeFakeCurl(dir: string, body: string) {
  const path = join(dir, 'curl');
  writeFileSync(path, `#!/usr/bin/env bash\nprintf '%s' '${body}'\nexit 0\n`);
  chmodSync(path, 0o755);
}

const KILL_SWITCH_BOTH_ENGAGED =
  '[{"target":"best-bets","killed":true},{"target":"trader-insights","killed":true}]';

function runScriptWithMocks(
  script: string,
  sshRules: Array<[string, string, number, string?]>,
  extraEnv: Record<string, string> = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'utv2-1618-fake-bin-'));
  try {
    writeFakeSsh(dir, sshRules);
    writeFakeCurl(dir, KILL_SWITCH_BOTH_ENGAGED);
    const result = spawnSync('bash', ['-e', '-c', script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        SYNDICATE_MACHINE_MODE: 'parked',
        ...BASE_ENV,
        ...extraEnv,
      },
      encoding: 'utf8',
    });
    return result;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Standard "everything matches the parked contract" mock table, reused as a
// base by tests that need to inject exactly one discrepancy.
const HAPPY_PATH_SSH_RULES: Array<[string, string, number, string?]> = [
  [".unit-talk-release", BASE_ENV.IMAGE_TAG, 0],
  ["docker compose exec -T api printenv SYNDICATE_MACHINE_ENABLED", "false", 0],
  ["docker compose exec -T ingestor printenv UNIT_TALK_INGESTOR_AUTORUN", "false", 0],
  ["docker compose exec -T ingestor printenv UNIT_TALK_INGESTOR_SCHEDULING_ENABLED", "false", 0],
  ["docker compose exec -T worker printenv UNIT_TALK_WORKER_AUTORUN", "false", 0],
  ["docker compose exec -T worker printenv UNIT_TALK_ENABLED_TARGETS", "none", 0],
  ["docker ps -q --filter 'label=com.docker.compose.service=api' --filter 'status=running'", "cid-api", 0],
  ['docker inspect --format \'{{index .Config.Labels "com.docker.compose.project"}}\' \'cid-api\'', "unit-talk", 0],
  [
    "docker ps -q --filter 'label=com.docker.compose.service=api' --filter 'label=com.docker.compose.project=unit-talk' --filter 'status=running'",
    "cid-api",
    0,
  ],
  [
    "docker ps -q --filter 'label=com.docker.compose.service=ingestor' --filter 'label=com.docker.compose.project=unit-talk' --filter 'status=running'",
    "cid-ingestor",
    0,
  ],
  [
    "docker ps -q --filter 'label=com.docker.compose.service=worker' --filter 'label=com.docker.compose.project=unit-talk' --filter 'status=running'",
    "cid-worker",
    0,
  ],
  ["docker inspect --format '{{.Config.Image}}' 'cid-api'", `${BASE_ENV.IMAGE_NAMESPACE}/api:${BASE_ENV.IMAGE_TAG}`, 0],
  [
    "docker inspect --format '{{.Config.Image}}' 'cid-ingestor'",
    `${BASE_ENV.IMAGE_NAMESPACE}/ingestor:${BASE_ENV.IMAGE_TAG}`,
    0,
  ],
  [
    "docker inspect --format '{{.Config.Image}}' 'cid-worker'",
    `${BASE_ENV.IMAGE_NAMESPACE}/worker:${BASE_ENV.IMAGE_TAG}`,
    0,
  ],
  [
    "docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' 'cid-api'",
    "SYNDICATE_MACHINE_ENABLED=false",
    0,
  ],
  [
    "docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' 'cid-ingestor'",
    "UNIT_TALK_INGESTOR_AUTORUN=false\\nUNIT_TALK_INGESTOR_SCHEDULING_ENABLED=false",
    0,
  ],
  [
    "docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' 'cid-worker'",
    "UNIT_TALK_WORKER_AUTORUN=false\\nUNIT_TALK_ENABLED_TARGETS=none",
    0,
  ],
];

test('EXECUTABLE: production confirm step reaches its failure classifier under bash -e when compose-exec fails', () => {
  const rules: Array<[string, string, number, string?]> = [
    [".unit-talk-release", BASE_ENV.IMAGE_TAG, 0],
    [
      "docker compose exec -T api printenv SYNDICATE_MACHINE_ENABLED",
      "",
      1,
      'service "api" is not running',
    ],
  ];
  const result = runScriptWithMocks(productionConfirmScript, rules);
  assert.notEqual(result.status, 0, 'script must fail closed when compose-exec fails');
  assert.match(
    result.stdout,
    /Production api service\/container could not be resolved/,
    `expected the classifier to run and identify the failure; got stdout: ${JSON.stringify(result.stdout)}`,
  );
});

test('EXECUTABLE: reverting to the pre-fix VAR=$(...); STATUS=$? pattern makes the classifier unreachable (proves the original bug)', () => {
  const buggyOldPattern = productionConfirmScript.replace(
    `if API_EXEC_OUTPUT=$(ssh "$DEPLOY_USER@$DEPLOY_HOST" \\
  "cd '$DEPLOY_PATH' && UNIT_TALK_IMAGE_TAG='$IMAGE_TAG' docker compose exec -T api printenv SYNDICATE_MACHINE_ENABLED" 2>&1); then
  API_EXEC_STATUS=0
else
  API_EXEC_STATUS=$?
fi`,
    `API_EXEC_OUTPUT=$(ssh "$DEPLOY_USER@$DEPLOY_HOST" \\
  "cd '$DEPLOY_PATH' && UNIT_TALK_IMAGE_TAG='$IMAGE_TAG' docker compose exec -T api printenv SYNDICATE_MACHINE_ENABLED" 2>&1)
API_EXEC_STATUS=$?`,
  );
  assert.notEqual(buggyOldPattern, productionConfirmScript, 'the reversion must actually change the script');

  const rules: Array<[string, string, number, string?]> = [
    [".unit-talk-release", BASE_ENV.IMAGE_TAG, 0],
    [
      "docker compose exec -T api printenv SYNDICATE_MACHINE_ENABLED",
      "",
      1,
      'service "api" is not running',
    ],
  ];
  const result = runScriptWithMocks(buggyOldPattern, rules);
  assert.notEqual(result.status, 0, 'the old pattern still fails closed (bash -e aborts) -- that was never the bug');
  assert.doesNotMatch(
    result.stdout,
    /Production api service\/container could not be resolved/,
    'the pre-fix pattern must NOT reach the classifier -- bash -e should abort at the plain assignment first',
  );
});

test('EXECUTABLE: production confirm step independently rejects a docker-inspect UNIT_TALK_ENABLED_TARGETS value that disagrees with compose-exec', () => {
  const rules = HAPPY_PATH_SSH_RULES.map((rule) => [...rule]) as Array<[string, string, number, string?]>;
  const workerEnvIdx = rules.findIndex((r) => r[0].includes(".Config.Env") && r[0].includes("'cid-worker'"));
  // compose-exec reports "none" (satisfies the parked-mode compose-level
  // assertion), but the container's real environment says "best-bets" --
  // exactly the scenario an independent cross-check exists to catch.
  rules[workerEnvIdx] = [
    "docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' 'cid-worker'",
    "UNIT_TALK_WORKER_AUTORUN=false\\nUNIT_TALK_ENABLED_TARGETS=best-bets",
    0,
  ];
  const result = runScriptWithMocks(productionConfirmScript, rules);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stdout,
    /docker-inspect value mismatch for worker\/UNIT_TALK_ENABLED_TARGETS/,
    `expected the inspect-layer mismatch to be caught; got stdout: ${JSON.stringify(result.stdout)}`,
  );
});

test('EXECUTABLE: removing UNIT_TALK_ENABLED_TARGETS from the docker-inspect loop lets the same real discrepancy through undetected (proves the original gap)', () => {
  const mutatedScript = productionConfirmScript.replace(
    ` \\
            "worker:UNIT_TALK_ENABLED_TARGETS:$REQUESTED_ENABLED_TARGETS"`,
    '',
  );
  assert.notEqual(mutatedScript, productionConfirmScript, 'the reversion must actually remove the loop entry');

  const rules = HAPPY_PATH_SSH_RULES.map((rule) => [...rule]) as Array<[string, string, number, string?]>;
  const workerEnvIdx = rules.findIndex((r) => r[0].includes(".Config.Env") && r[0].includes("'cid-worker'"));
  rules[workerEnvIdx] = [
    "docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' 'cid-worker'",
    "UNIT_TALK_WORKER_AUTORUN=false\\nUNIT_TALK_ENABLED_TARGETS=best-bets",
    0,
  ];
  const result = runScriptWithMocks(mutatedScript, rules);
  assert.equal(
    result.status,
    0,
    `without the loop entry, the real best-bets/none discrepancy should go undetected and the script should exit 0; got: ${JSON.stringify(result)}`,
  );
});

test('EXECUTABLE: production confirm step rejects ambiguous container evidence when a service+project filter matches more than one container', () => {
  const rules = HAPPY_PATH_SSH_RULES.map((rule) => [...rule]) as Array<[string, string, number, string?]>;
  const workerPsIdx = rules.findIndex(
    (r) => r[0] === "docker ps -q --filter 'label=com.docker.compose.service=worker' --filter 'label=com.docker.compose.project=unit-talk' --filter 'status=running'",
  );
  rules[workerPsIdx] = [rules[workerPsIdx][0], "cid-worker-1\\ncid-worker-2", 0];
  const result = runScriptWithMocks(productionConfirmScript, rules);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stdout,
    /expected exactly one, evidence is ambiguous/,
    `expected an ambiguous-match rejection; got stdout: ${JSON.stringify(result.stdout)}`,
  );
});
