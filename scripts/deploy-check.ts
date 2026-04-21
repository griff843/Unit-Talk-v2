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
  'SUPABASE_SERVICE_ROLE_KEY',
  'UNIT_TALK_API_RUNTIME_MODE',
  'UNIT_TALK_INGESTOR_AUTORUN',
  'UNIT_TALK_WORKER_AUTORUN',
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
