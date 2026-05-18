import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

type Verdict = 'PROVEN' | 'PARTIAL' | 'UNPROVEN';
type HealthCheckResult = 'PASS' | 'SKIP' | 'FAIL';

interface RollbackProof {
  generated_at: string;
  preconditions: string[];
  rollback_steps: string[];
  health_check_result: `${HealthCheckResult}: ${string}`;
  verdict: Verdict;
}

interface PackageJson {
  scripts?: Record<string, string>;
}

const repoRoot = process.cwd();
const deployWorkflowPath = path.join(
  repoRoot,
  '.github',
  'workflows',
  'deploy.yml',
);
const packageJsonPath = path.join(repoRoot, 'package.json');
const artifactPath = path.join(repoRoot, 'artifacts', 'rollback-proof.json');

function readText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function readPackageJson(): PackageJson {
  return JSON.parse(readText(packageJsonPath)) as PackageJson;
}

function extractRollbackEvidence(workflow: string): string[] {
  const lines = workflow.split(/\r?\n/);
  const evidence: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line?.includes('ROLLBACK_TAG')) {
      continue;
    }

    const lineNumber = index + 1;
    evidence.push(`deploy.yml:${lineNumber}: ${line.trim()}`);
  }

  return evidence;
}

function runDeployCheckIfPresent(packageJson: PackageJson): string {
  const deployCheckScript = packageJson.scripts?.['deploy:check'];
  if (!deployCheckScript) {
    return [
      'deploy:check not present; manual equivalent is:',
      '1. Confirm production deploy secrets are configured.',
      '2. Confirm docker-compose services define restart and healthcheck controls.',
      '3. Confirm deploy.yml deep health checks /api/health?full=true.',
      '4. Confirm deploy/rollback.sh supports --dry-run and --tag.',
    ].join(' ');
  }

  try {
    execSync('pnpm deploy:check', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return `PASS: pnpm deploy:check exists (${deployCheckScript}) and completed successfully.`;
  } catch (error) {
    const detail =
      error instanceof Error && 'stdout' in error
        ? String(
            (error as { stdout?: unknown; stderr?: unknown }).stdout ?? '',
          ) + String((error as { stderr?: unknown }).stderr ?? '')
        : error instanceof Error
          ? error.message
          : String(error);
    return `FAIL: pnpm deploy:check exists (${deployCheckScript}) but did not complete in this environment. ${detail.trim()}`;
  }
}

function buildRollbackSteps(
  rollbackEvidence: string[],
  deployCheckResult: string,
): string[] {
  return [
    'Before: dispatch Deploy workflow with image_tag set to the candidate release and rollback_tag set to the previously known-good image tag.',
    'Before: verify required deploy inputs/secrets are present: UNIT_TALK_DEPLOY_HOST, UNIT_TALK_DEPLOY_USER, UNIT_TALK_DEPLOY_PATH, UNIT_TALK_DEPLOY_HEALTH_URL, UNIT_TALK_DEPLOY_SSH_KEY, and GHCR_PAT.',
    `Before: static deploy gate result: ${deployCheckResult}`,
    'Rollback trigger: canary and production jobs normalize DEPLOY_HEALTH_URL to /api/health?full=true and poll it 30 times at 10 second intervals.',
    'Rollback trigger: if deep health never responds successfully and ROLLBACK_TAG is non-empty, deploy.yml invokes deploy/rollback.sh with --tag "$ROLLBACK_TAG" plus host, user, and path.',
    ...rollbackEvidence.map((evidence) => `Rollback evidence: ${evidence}`),
    'Rollback: deploy/rollback.sh restores the requested image tag; this proof records the command path only and does not contact Hetzner or production.',
    'After: rerun the deep health endpoint check against /api/health?full=true and confirm the service returns success before declaring recovery.',
  ];
}

function main(): void {
  const workflow = readText(deployWorkflowPath);
  const packageJson = readPackageJson();
  const rollbackEvidence = extractRollbackEvidence(workflow);
  const deployCheckResult = runDeployCheckIfPresent(packageJson);
  const rollbackTagReferenced = rollbackEvidence.length > 0;
  const hasRollbackScriptCall = workflow.includes(
    'bash deploy/rollback.sh --tag "$ROLLBACK_TAG"',
  );
  const hasDeepHealthCheck = workflow.includes('/api/health?full=true');
  const healthCheckResult: RollbackProof['health_check_result'] =
    hasDeepHealthCheck
      ? 'SKIP: deep health verification is documented from deploy.yml but not called by this offline proof.'
      : 'FAIL: deploy.yml deep health endpoint normalization was not found.';
  const verdict: Verdict =
    rollbackTagReferenced && hasRollbackScriptCall && hasDeepHealthCheck
      ? 'PARTIAL'
      : 'UNPROVEN';

  const proof: RollbackProof = {
    generated_at: new Date().toISOString(),
    preconditions: [
      'ROLLBACK_TAG must be set from workflow_dispatch input rollback_tag.',
      'The deploy health endpoint must respond at DEPLOY_HEALTH_URL normalized to /api/health?full=true.',
      'Deploy secrets must be configured for host, user, path, health URL, SSH key, and GHCR auth.',
      'deploy/rollback.sh must be available and executable by the GitHub Actions runner.',
      'No live Hetzner or production network call is made by this proof script.',
    ],
    rollback_steps: buildRollbackSteps(rollbackEvidence, deployCheckResult),
    health_check_result: healthCheckResult,
    verdict,
  };

  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');

  console.log(
    `Rollback proof written to ${path.relative(repoRoot, artifactPath)}`,
  );
  console.log(`Verdict: ${proof.verdict}`);
}

main();
