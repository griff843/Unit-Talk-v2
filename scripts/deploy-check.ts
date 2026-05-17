import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvironment } from '@unit-talk/config';
import YAML from 'yaml';

export interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const REQUIRED_ENV_VARS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'UNIT_TALK_API_RUNTIME_MODE',
  'UNIT_TALK_WORKER_RUNTIME_MODE',
  'UNIT_TALK_INGESTOR_RUNTIME_MODE',
  'UNIT_TALK_DISCORD_BOT_RUNTIME_MODE',
  'UNIT_TALK_INGESTOR_AUTORUN',
  'UNIT_TALK_WORKER_AUTORUN',
  'UNIT_TALK_INGESTOR_API_KEY',
  'UNIT_TALK_BOT_API_KEY',
] as const;

const REQUIRED_PACKAGE_SCRIPTS = [
  'api:start',
  'api:status',
  'api:stop',
  'worker:start',
  'worker:status',
  'worker:stop',
  'ingestor:start',
  'ingestor:status',
  'ingestor:stop',
] as const;

const REQUIRED_COMPOSE_SERVICES = ['api', 'worker', 'ingestor'] as const;
const REQUIRED_DEPLOY_SERVICES = ['api', 'worker', 'ingestor', 'discord-bot'] as const;
const REQUIRED_DEPLOY_SECRETS = [
  'UNIT_TALK_DEPLOY_HOST',
  'UNIT_TALK_DEPLOY_USER',
  'UNIT_TALK_DEPLOY_PATH',
  'UNIT_TALK_DEPLOY_HEALTH_URL',
  'UNIT_TALK_DEPLOY_SSH_KEY',
] as const;

const REQUIRED_STAGING_DEPLOY_SECRETS = [
  'UNIT_TALK_STAGING_DEPLOY_HOST',
  'UNIT_TALK_STAGING_DEPLOY_USER',
  'UNIT_TALK_STAGING_DEPLOY_PATH',
  'UNIT_TALK_STAGING_DEPLOY_HEALTH_URL',
  'UNIT_TALK_STAGING_DEPLOY_SSH_KEY',
] as const;

export function collectDeployStaticChecks(
  repoRoot = process.cwd(),
  environment: Record<string, string | undefined> = loadEnvironment(),
): CheckResult[] {
  const results: CheckResult[] = [];

  for (const varName of REQUIRED_ENV_VARS) {
    const value = environment[varName]?.trim();
    results.push(
      value
        ? { name: `env ${varName}`, passed: true }
        : { name: `env ${varName}`, passed: false, detail: `${varName} is not set or empty` },
    );
  }

  for (const runtimeModeName of [
    'UNIT_TALK_API_RUNTIME_MODE',
    'UNIT_TALK_WORKER_RUNTIME_MODE',
    'UNIT_TALK_INGESTOR_RUNTIME_MODE',
    'UNIT_TALK_DISCORD_BOT_RUNTIME_MODE',
  ] as const) {
    const value = environment[runtimeModeName]?.trim();
    results.push(
      value === 'fail_closed'
        ? { name: `env ${runtimeModeName} fail-closed`, passed: true }
        : {
            name: `env ${runtimeModeName} fail-closed`,
            passed: false,
            detail: `${runtimeModeName} must be fail_closed in production`,
          },
    );
  }

  const workerDryRun = environment.UNIT_TALK_WORKER_DRY_RUN?.trim();
  results.push(
    workerDryRun === 'false'
      ? { name: 'env UNIT_TALK_WORKER_DRY_RUN disabled', passed: true }
      : {
          name: 'env UNIT_TALK_WORKER_DRY_RUN disabled',
          passed: false,
          detail: 'UNIT_TALK_WORKER_DRY_RUN must be false in production',
        },
  );

  for (const [service, key] of [
    ['worker', 'UNIT_TALK_WORKER_MAX_CYCLES'],
    ['ingestor', 'UNIT_TALK_INGESTOR_MAX_CYCLES'],
  ] as const) {
    const autorunKey = service === 'worker'
      ? 'UNIT_TALK_WORKER_AUTORUN'
      : 'UNIT_TALK_INGESTOR_AUTORUN';
    const autorun = environment[autorunKey]?.trim() === 'true';
    const maxCycles = environment[key]?.trim();
    const explicitContinuousOrBounded =
      service === 'worker'
        ? maxCycles === undefined ||
          maxCycles.length === 0 ||
          (maxCycles !== '1' && Number.isFinite(Number(maxCycles)))
        : maxCycles !== undefined &&
          maxCycles.length > 0 &&
          maxCycles !== '1' &&
          Number.isFinite(Number(maxCycles));

    results.push(
      !autorun || explicitContinuousOrBounded
        ? { name: `env ${key} avoids one-cycle ambiguity`, passed: true }
        : {
            name: `env ${key} avoids one-cycle ambiguity`,
            passed: false,
            detail: `${key}=1 is forbidden when ${autorunKey}=true`,
          },
    );
  }

  const packageJson = readJsonFile<{ scripts?: Record<string, string> }>(path.join(repoRoot, 'package.json'));
  for (const scriptName of REQUIRED_PACKAGE_SCRIPTS) {
    const script = packageJson.scripts?.[scriptName];
    results.push(
      script
        ? { name: `package script ${scriptName}`, passed: true }
        : { name: `package script ${scriptName}`, passed: false, detail: 'missing package script' },
    );
  }

  const dockerfile = readTextFile(path.join(repoRoot, 'Dockerfile'));
  for (const target of REQUIRED_COMPOSE_SERVICES) {
    const hasTarget = new RegExp(`FROM\\s+node:[^\\n]+\\s+AS\\s+${target}\\b`, 'i').test(dockerfile);
    results.push(
      hasTarget
        ? { name: `docker target ${target}`, passed: true }
        : { name: `docker target ${target}`, passed: false, detail: 'missing Dockerfile target' },
    );
  }

  const compose = YAML.parse(readTextFile(path.join(repoRoot, 'docker-compose.yml'))) as {
    services?: Record<string, { restart?: string; healthcheck?: unknown; depends_on?: unknown }>;
  };
  for (const serviceName of REQUIRED_COMPOSE_SERVICES) {
    const service = compose.services?.[serviceName];
    if (!service) {
      results.push({ name: `compose service ${serviceName}`, passed: false, detail: 'missing compose service' });
      continue;
    }

    results.push(
      service.restart
        ? { name: `compose restart ${serviceName}`, passed: true }
        : { name: `compose restart ${serviceName}`, passed: false, detail: 'missing restart policy' },
    );
  }

  results.push(
    compose.services?.api?.healthcheck
      ? { name: 'compose api healthcheck', passed: true }
      : { name: 'compose api healthcheck', passed: false, detail: 'api healthcheck is required' },
  );

  for (const dependent of ['worker', 'ingestor'] as const) {
    const dependsOn = compose.services?.[dependent]?.depends_on;
    const dependsOnApi = JSON.stringify(dependsOn ?? {}).includes('api');
    results.push(
      dependsOnApi
        ? { name: `compose ${dependent} waits for api`, passed: true }
        : {
            name: `compose ${dependent} waits for api`,
            passed: false,
            detail: 'service must depend on api health before starting',
          },
    );
  }

  const deployComposePath = path.join(repoRoot, 'deploy', 'production', 'docker-compose.yml');
  const deployWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'deploy.yml');
  const deployCompose = YAML.parse(readTextFile(deployComposePath)) as {
    services?: Record<string, {
      image?: string;
      restart?: string;
      depends_on?: unknown;
      healthcheck?: unknown;
      networks?: unknown;
      deploy?: { resources?: { limits?: { memory?: string; cpus?: string } } };
    }>;
    networks?: Record<string, unknown>;
  };
  const deployWorkflow = readTextFile(deployWorkflowPath);

  for (const serviceName of REQUIRED_DEPLOY_SERVICES) {
    const service = deployCompose.services?.[serviceName];
    if (!service) {
      results.push({
        name: `production compose service ${serviceName}`,
        passed: false,
        detail: 'missing production compose service',
      });
      continue;
    }

    const image = service.image ?? '';
    results.push(
      image.includes(`unit-talk-v2/${serviceName}:`) && image.includes('UNIT_TALK_IMAGE_TAG')
        ? { name: `production image ${serviceName}`, passed: true }
        : {
            name: `production image ${serviceName}`,
            passed: false,
            detail: 'image must use GHCR service image and UNIT_TALK_IMAGE_TAG',
          },
    );

    results.push(
      service.restart
        ? { name: `production restart ${serviceName}`, passed: true }
        : { name: `production restart ${serviceName}`, passed: false, detail: 'missing restart policy' },
    );
  }

  results.push(
    deployCompose.services?.api?.healthcheck
      ? { name: 'production api healthcheck', passed: true }
      : { name: 'production api healthcheck', passed: false, detail: 'api healthcheck is required' },
  );

  for (const serviceName of REQUIRED_DEPLOY_SERVICES) {
    const memLimit = deployCompose.services?.[serviceName]?.deploy?.resources?.limits?.memory;
    const cpuLimit = deployCompose.services?.[serviceName]?.deploy?.resources?.limits?.cpus;
    results.push(
      memLimit && cpuLimit
        ? { name: `production resource limits ${serviceName}`, passed: true }
        : {
            name: `production resource limits ${serviceName}`,
            passed: false,
            detail: 'production services must declare memory and cpu resource limits to prevent resource exhaustion',
          },
    );
  }

  results.push(
    deployCompose.networks && Object.keys(deployCompose.networks).length > 0
      ? { name: 'production network defined', passed: true }
      : { name: 'production network defined', passed: false, detail: 'production compose must declare an explicit named network' },
  );

  for (const dependent of ['worker', 'ingestor', 'discord-bot'] as const) {
    const dependsOn = deployCompose.services?.[dependent]?.depends_on;
    const dependsOnApi = JSON.stringify(dependsOn ?? {}).includes('api');
    results.push(
      dependsOnApi
        ? { name: `production ${dependent} waits for api`, passed: true }
        : {
            name: `production ${dependent} waits for api`,
            passed: false,
            detail: 'service must depend on api health before starting',
          },
    );
  }

  for (const secretName of REQUIRED_DEPLOY_SECRETS) {
    results.push(
      deployWorkflow.includes(secretName)
        ? { name: `deploy secret ${secretName}`, passed: true }
        : { name: `deploy secret ${secretName}`, passed: false, detail: 'deploy workflow must require secret' },
    );
  }

  const workflowChecks = [
    ['deploy workflow dispatch', /workflow_dispatch:/],
    ['deploy workflow builds api', /service:\s+\[api,\s*worker,\s*ingestor,\s*discord-bot\]/],
    ['deploy workflow pushes ghcr', /docker push "\$IMAGE_NAMESPACE\/\$\{\{ matrix\.service \}\}:\$IMAGE_TAG"/],
    ['deploy workflow runs health check', /curl -fsS "\$DEPLOY_HEALTH_URL"/],
    ['deploy workflow rollback path', /ROLLBACK_TAG/],
  ] as const;
  for (const [name, pattern] of workflowChecks) {
    results.push(
      pattern.test(deployWorkflow)
        ? { name, passed: true }
        : { name, passed: false, detail: 'deploy workflow release/rollback contract is missing' },
    );
  }

  return results;
}

export function collectStagingParityChecks(
  repoRoot = process.cwd(),
  environment: Record<string, string | undefined> = loadEnvironment(),
  stagingWorkflowText?: string,
): CheckResult[] {
  const results: CheckResult[] = [];

  // App env must be staging
  const appEnv = environment.UNIT_TALK_APP_ENV?.trim();
  results.push(
    appEnv === 'staging'
      ? { name: 'staging env UNIT_TALK_APP_ENV', passed: true }
      : { name: 'staging env UNIT_TALK_APP_ENV', passed: false, detail: 'UNIT_TALK_APP_ENV must be staging' },
  );

  // Same required env vars as production
  for (const varName of REQUIRED_ENV_VARS) {
    const value = environment[varName]?.trim();
    results.push(
      value
        ? { name: `staging env ${varName}`, passed: true }
        : { name: `staging env ${varName}`, passed: false, detail: `${varName} is not set or empty` },
    );
  }

  // Runtime modes must be fail_closed even on staging
  for (const runtimeModeName of [
    'UNIT_TALK_API_RUNTIME_MODE',
    'UNIT_TALK_WORKER_RUNTIME_MODE',
    'UNIT_TALK_INGESTOR_RUNTIME_MODE',
    'UNIT_TALK_DISCORD_BOT_RUNTIME_MODE',
  ] as const) {
    const value = environment[runtimeModeName]?.trim();
    results.push(
      value === 'fail_closed'
        ? { name: `staging env ${runtimeModeName} fail-closed`, passed: true }
        : {
            name: `staging env ${runtimeModeName} fail-closed`,
            passed: false,
            detail: `${runtimeModeName} must be fail_closed in staging`,
          },
    );
  }

  // Worker dry-run must be disabled
  const workerDryRun = environment.UNIT_TALK_WORKER_DRY_RUN?.trim();
  results.push(
    workerDryRun === 'false'
      ? { name: 'staging env UNIT_TALK_WORKER_DRY_RUN disabled', passed: true }
      : {
          name: 'staging env UNIT_TALK_WORKER_DRY_RUN disabled',
          passed: false,
          detail: 'UNIT_TALK_WORKER_DRY_RUN must be false in staging',
        },
  );

  // Staging compose must mirror production service set
  const stagingComposePath = path.join(repoRoot, 'deploy', 'staging', 'docker-compose.yml');
  const stagingCompose = YAML.parse(readTextFile(stagingComposePath)) as {
    services?: Record<string, { image?: string; restart?: string; depends_on?: unknown; healthcheck?: unknown; env_file?: string[] }>;
  };

  for (const serviceName of REQUIRED_DEPLOY_SERVICES) {
    const service = stagingCompose.services?.[serviceName];
    results.push(
      service
        ? { name: `staging compose service ${serviceName}`, passed: true }
        : {
            name: `staging compose service ${serviceName}`,
            passed: false,
            detail: 'missing staging compose service — staging must mirror production service set',
          },
    );
    if (!service) continue;

    const image = service.image ?? '';
    results.push(
      image.includes(`unit-talk-v2/${serviceName}:`) && image.includes('UNIT_TALK_IMAGE_TAG')
        ? { name: `staging image ${serviceName}`, passed: true }
        : {
            name: `staging image ${serviceName}`,
            passed: false,
            detail: 'staging image must use GHCR service image and UNIT_TALK_IMAGE_TAG',
          },
    );

    results.push(
      service.restart
        ? { name: `staging restart ${serviceName}`, passed: true }
        : { name: `staging restart ${serviceName}`, passed: false, detail: 'missing restart policy' },
    );

    const envFile = service.env_file ?? [];
    const usesEnvFile = Array.isArray(envFile)
      ? envFile.some((f: string) => f.includes('.env.staging'))
      : String(envFile).includes('.env.staging');
    results.push(
      usesEnvFile
        ? { name: `staging env_file ${serviceName}`, passed: true }
        : {
            name: `staging env_file ${serviceName}`,
            passed: false,
            detail: 'staging service must use .env.staging, not .env.production',
          },
    );
  }

  results.push(
    stagingCompose.services?.api?.healthcheck
      ? { name: 'staging api healthcheck', passed: true }
      : { name: 'staging api healthcheck', passed: false, detail: 'api healthcheck is required in staging' },
  );

  for (const dependent of ['worker', 'ingestor', 'discord-bot'] as const) {
    const dependsOn = stagingCompose.services?.[dependent]?.depends_on;
    const dependsOnApi = JSON.stringify(dependsOn ?? {}).includes('api');
    results.push(
      dependsOnApi
        ? { name: `staging ${dependent} waits for api`, passed: true }
        : {
            name: `staging ${dependent} waits for api`,
            passed: false,
            detail: 'staging service must depend on api health before starting',
          },
    );
  }

  // Staging workflow secrets
  const workflowText = stagingWorkflowText ?? (() => {
    const stagingWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'staging-deploy.yml');
    return fs.existsSync(stagingWorkflowPath) ? readTextFile(stagingWorkflowPath) : '';
  })();

  if (workflowText) {
    for (const secretName of REQUIRED_STAGING_DEPLOY_SECRETS) {
      results.push(
        workflowText.includes(secretName)
          ? { name: `staging secret ${secretName}`, passed: true }
          : { name: `staging secret ${secretName}`, passed: false, detail: 'staging deploy workflow must reference secret' },
      );
    }
  }

  return results;
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readTextFile(filePath)) as T;
}

function readTextFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function runVerify(): CheckResult {
  console.log('--- Running pnpm verify ---');
  try {
    execSync('pnpm verify', { stdio: 'inherit', timeout: 600_000 });
    return { name: 'pnpm verify', passed: true };
  } catch {
    return { name: 'pnpm verify', passed: false, detail: 'pnpm verify failed' };
  }
}

function printSummary(results: CheckResult[]): boolean {
  console.log('\n--- Deploy Check Summary ---');
  let allPassed = true;
  for (const result of results) {
    const status = result.passed ? 'PASS' : 'FAIL';
    const detail = result.detail ? ` (${result.detail})` : '';
    console.log(`  [${status}] ${result.name}${detail}`);
    if (!result.passed) allPassed = false;
  }
  return allPassed;
}

async function main() {
  const results = [runVerify(), ...collectDeployStaticChecks()];
  const allPassed = printSummary(results);

  if (allPassed) {
    console.log('\nAll checks passed. Ready to deploy.');
    process.exit(0);
  }

  console.log('\nSome checks failed. Not ready to deploy.');
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
