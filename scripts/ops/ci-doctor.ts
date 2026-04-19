import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import {
  type CheckResult,
  type CiDoctorResult,
  CI_DOCTOR_DIR,
  ROOT,
  emitJson,
  ensureDir,
  getFlag,
  parseArgs,
  relativeToRoot,
  validateCiDoctorSchemaDependencies,
  writeJsonFile,
} from './shared.js';

type Scope = CiDoctorResult['scope'];
type SecretInventoryEntry = {
  name: string;
  environment?: string;
};
type RequiredCheckInventoryEntry = {
  name: string;
  workflow?: string;
  job?: string;
};
type WorkflowDoc = {
  path: string;
  name: string;
  data: Record<string, unknown>;
  text: string;
  jobs: string[];
  secretRefs: string[];
};

const SUPPORTED_WORKFLOW_TRIGGERS = new Set([
  'push',
  'pull_request',
  'pull_request_review',
  'issue_comment',
  'schedule',
  'workflow_dispatch',
  'workflow_call',
]);

const SUPPORTED_SCOPES: Scope[] = [
  'workflows',
  'secrets',
  'protection',
  'preview',
  'required-checks',
  'artifacts',
  'all',
];

async function main(): Promise<number> {
  const { flags, bools } = parseArgs(process.argv.slice(2));
  const json = bools.has('json');
  const explain = bools.has('explain');
  const writeResult = bools.has('write-result');
  const since = getFlag(flags, 'since');
  const scope = (getFlag(flags, 'scope') ?? 'all') as Scope;
  if (!SUPPORTED_SCOPES.includes(scope)) {
    return outputAndExit(
      buildResult('local', scope, [
        { id: 'ARGS', status: 'infra_error', detail: `Unsupported scope: ${scope}` },
      ]),
      json,
    );
  }

  const checks: CheckResult[] = [];
  const addCheck = (id: string, status: CheckResult['status'], detail: string): void => {
    checks.push({ id, status, detail });
    if (explain) {
      process.stderr.write(`[${status.toUpperCase()}] ${id} ${detail}\n`);
    }
  };

  try {
    validateCiDoctorSchemaDependencies();
  } catch (error) {
    return outputAndExit(
      buildResult(detectMode(), scope, [
        {
          id: 'CD0',
          status: 'infra_error',
          detail: error instanceof Error ? error.message : String(error),
        },
      ]),
      json,
      writeResult,
    );
  }

  const githubToken = process.env.GITHUB_TOKEN?.trim() ?? '';
  const repoSlug = process.env.GITHUB_REPOSITORY?.trim() || deriveRepoSlug();
  const mode = detectMode();
  const workflowDocs = loadWorkflowDocs(addCheck);
  const artifactState = loadArtifactContracts(addCheck);

  if (scope === 'all' || scope === 'artifacts') {
    runArtifactChecks(addCheck, artifactState);
  }
  if (scope === 'all' || scope === 'workflows') {
    runWorkflowChecks(addCheck, workflowDocs, artifactState.secrets, artifactState.requiredChecks);
  }
  if (scope === 'all' || scope === 'secrets') {
    await runSecretChecks(addCheck, githubToken, repoSlug, workflowDocs, artifactState.secrets);
  }
  if (scope === 'all' || scope === 'protection') {
    await runProtectionChecks(addCheck, githubToken, repoSlug);
  }
  if (scope === 'all' || scope === 'required-checks') {
    await runRequiredCheckChecks(addCheck, githubToken, repoSlug, workflowDocs, artifactState.requiredChecks, since);
  }
  if (scope === 'all' || scope === 'preview') {
    await runPreviewChecks(addCheck, githubToken, repoSlug, workflowDocs, artifactState.secrets, since);
  }
  if (scope === 'all') {
    await runHistoryChecks(addCheck, githubToken, repoSlug, artifactState.requiredChecks, since);
  }

  const result = buildResult(mode, scope, checks, repoSlug);
  return outputAndExit(result, json, writeResult);
}

function detectMode(): 'local' | 'scheduled' {
  return process.env.GITHUB_ACTIONS === 'true' ? 'scheduled' : 'local';
}

function deriveRepoSlug(): string {
  const origin = emitGit(['remote', 'get-url', 'origin']);
  const match = origin.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  return match?.[1] ?? 'unknown/unknown';
}

function loadWorkflowDocs(
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
): WorkflowDoc[] {
  const workflowDir = path.join(ROOT, '.github', 'workflows');
  const files = fs.existsSync(workflowDir)
    ? fs.readdirSync(workflowDir).filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'))
    : [];
  const docs: WorkflowDoc[] = [];
  for (const file of files) {
    const fullPath = path.join(workflowDir, file);
    try {
      const text = fs.readFileSync(fullPath, 'utf8');
      const data = YAML.parse(text) as Record<string, unknown>;
      const jobs = Object.keys((data.jobs as Record<string, unknown>) ?? {});
      const secretRefs = [...text.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g)].map((match) => match[1]);
      docs.push({
        path: relativeToRoot(fullPath),
        name: typeof data.name === 'string' ? data.name : file,
        data,
        text,
        jobs,
        secretRefs,
      });
    } catch (error) {
      addCheck('CW2', 'fail', `${relativeToRoot(fullPath)} failed YAML parse: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return docs;
}

function loadArtifactContracts(
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
): {
  secrets: SecretInventoryEntry[] | null;
  requiredChecks: RequiredCheckInventoryEntry[] | null;
} {
  const secretsPath = path.join(ROOT, 'docs', '05_operations', 'REQUIRED_SECRETS.md');
  const checksPath = path.join(ROOT, 'docs', '05_operations', 'REQUIRED_CI_CHECKS.md');
  return {
    secrets: parseSecretsInventory(secretsPath, addCheck),
    requiredChecks: parseRequiredChecksInventory(checksPath, addCheck),
  };
}

function parseJsonFence(
  filePath: string,
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
  artifactId: 'CA1' | 'CA2',
): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const text = fs.readFileSync(filePath, 'utf8');
  const match = text.match(/```json\r?\n([\s\S]*?)```/);
  if (!match) {
    addCheck(artifactId, 'infra_error', `${relativeToRoot(filePath)} missing fenced json block`);
    return null;
  }
  try {
    return JSON.parse(match[1]) as Record<string, unknown>;
  } catch (error) {
    addCheck(artifactId, 'infra_error', `${relativeToRoot(filePath)} JSON parse failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function parseSecretsInventory(
  filePath: string,
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
): SecretInventoryEntry[] | null {
  const parsed = parseJsonFence(filePath, addCheck, 'CA1');
  if (!parsed) {
    return null;
  }
  const entries = (parsed.secrets as Array<Record<string, unknown>> | undefined) ?? [];
  return entries
    .map((entry) => ({
      name: String(entry.name ?? ''),
      environment: typeof entry.environment === 'string' ? entry.environment : undefined,
    }))
    .filter((entry) => entry.name.length > 0);
}

function parseRequiredChecksInventory(
  filePath: string,
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
): RequiredCheckInventoryEntry[] | null {
  const parsed = parseJsonFence(filePath, addCheck, 'CA2');
  if (!parsed) {
    return null;
  }
  const entries = (parsed.checks as Array<Record<string, unknown>> | undefined) ?? [];
  return entries
    .map((entry) => ({
      name: String(entry.name ?? ''),
      workflow: typeof entry.workflow === 'string' ? entry.workflow : undefined,
      job: typeof entry.job === 'string' ? entry.job : undefined,
    }))
    .filter((entry) => entry.name.length > 0);
}

function runArtifactChecks(
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
  artifactState: {
    secrets: SecretInventoryEntry[] | null;
    requiredChecks: RequiredCheckInventoryEntry[] | null;
  },
): void {
  const secretsPath = path.join(ROOT, 'docs', '05_operations', 'REQUIRED_SECRETS.md');
  const checksPath = path.join(ROOT, 'docs', '05_operations', 'REQUIRED_CI_CHECKS.md');
  if (!fs.existsSync(secretsPath)) {
    addCheck('CA1', 'infra_error', 'docs/05_operations/REQUIRED_SECRETS.md is missing');
  } else if (artifactState.secrets) {
    addCheck('CA1', 'pass', 'required secrets inventory exists and is parseable');
  }

  if (!fs.existsSync(checksPath)) {
    addCheck('CA2', 'infra_error', 'docs/05_operations/REQUIRED_CI_CHECKS.md is missing');
  } else if (artifactState.requiredChecks) {
    addCheck('CA2', 'pass', 'required CI checks inventory exists and is parseable');
  }

  const truthModelPath = path.join(ROOT, 'docs', '05_operations', 'EXECUTION_TRUTH_MODEL.md');
  if (!fs.existsSync(truthModelPath)) {
    addCheck('CA3', 'infra_error', 'EXECUTION_TRUTH_MODEL.md is missing');
  } else {
    const text = fs.readFileSync(truthModelPath, 'utf8');
    if (/T1/.test(text) && /T2/.test(text) && /T3/.test(text)) {
      addCheck('CA3', 'pass', 'truth model tier names parse as expected');
    } else {
      addCheck('CA3', 'infra_error', 'truth model tier matrix is missing expected tier names');
    }
  }
}

function runWorkflowChecks(
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
  workflowDocs: WorkflowDoc[],
  secretInventory: SecretInventoryEntry[] | null,
  requiredChecks: RequiredCheckInventoryEntry[] | null,
): void {
  const workflowDir = path.join(ROOT, '.github', 'workflows');
  if (!fs.existsSync(workflowDir) || workflowDocs.length === 0) {
    addCheck('CW1', 'fail', '.github/workflows is missing or empty');
    return;
  }
  addCheck('CW1', 'pass', `${workflowDocs.length} workflow files present`);
  if (!requiredChecks) {
    addCheck('CW3', 'infra_error', 'required CI workflow/check inventory unavailable');
  } else {
    const requiredWorkflowFiles = [...new Set(
      requiredChecks
        .map((entry) => entry.workflow?.trim() ?? '')
        .filter((entry) => entry.length > 0),
    )];
    if (requiredWorkflowFiles.length === 0) {
      addCheck('CW3', 'infra_error', 'required CI checks inventory does not declare workflow file mappings');
    } else {
      const missingNamedWorkflows = requiredWorkflowFiles.filter(
        (workflowFile) => !workflowDocs.some((doc) => doc.path === workflowFile),
      );
      addCheck(
        'CW3',
        missingNamedWorkflows.length === 0 ? 'pass' : 'fail',
        missingNamedWorkflows.length === 0
          ? 'all required workflow files exist under .github/workflows'
          : `required workflow files missing: ${missingNamedWorkflows.join(', ')}`,
      );
    }
  }

  if (!workflowDocs.some((doc) => doc.path.endsWith('ci-doctor.yml'))) {
    addCheck('CW7', 'fail', 'ci-doctor.yml is missing');
  } else {
    const doc = workflowDocs.find((entry) => entry.path.endsWith('ci-doctor.yml'))!;
    if (/contents:\s*write|pull_requests:\s*write|actions:\s*write/i.test(doc.text)) {
      addCheck('CW7', 'fail', 'ci-doctor.yml requests write-scoped permissions');
    } else {
      addCheck('CW7', 'pass', 'ci-doctor.yml exists and uses read-scoped permissions');
    }
  }

  for (const doc of workflowDocs) {
    if (Object.keys(doc.data).length > 0) {
      addCheck('CW2', 'pass', `${doc.path} parses as YAML`);
    }

    const onBlock = doc.data.on;
    if (!onBlock) {
      addCheck('CW4', 'fail', `${doc.path} is missing an on: block`);
    } else {
      const triggers = typeof onBlock === 'string'
        ? [onBlock]
        : Array.isArray(onBlock)
          ? onBlock.map(String)
          : Object.keys(onBlock as Record<string, unknown>);
      const unsupported = triggers.filter((trigger) => !SUPPORTED_WORKFLOW_TRIGGERS.has(trigger));
      addCheck('CW4', unsupported.length === 0 ? 'pass' : 'fail', unsupported.length === 0 ? `${doc.path} uses supported triggers` : `${doc.path} uses unsupported triggers: ${unsupported.join(', ')}`);
    }

    const usesLines = [...doc.text.matchAll(/uses:\s*([^\s]+)/g)].map((match) => match[1]);
    const invalidUses = usesLines.filter((entry) => !/^[^@\s]+@[^@\s]+$/.test(entry));
    addCheck('CW5', invalidUses.length === 0 ? 'pass' : 'fail', invalidUses.length === 0 ? `${doc.path} uses references are syntactically valid` : `${doc.path} has invalid uses refs: ${invalidUses.join(', ')}`);

    const jobs = (doc.data.jobs as Record<string, Record<string, unknown>> | undefined) ?? {};
    const badJobs = Object.entries(jobs).filter(([, job]) => !job['runs-on']);
    if (badJobs.length > 0) {
      addCheck('CW4', 'fail', `${doc.path} jobs missing runs-on: ${badJobs.map(([name]) => name).join(', ')}`);
    }

    const badSteps = Object.entries(jobs).flatMap(([jobName, job]) => {
      const steps = (job.steps as Array<Record<string, unknown>> | undefined) ?? [];
      return steps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => !step.run && !step.uses)
        .map(({ index }) => `${jobName}[${index}]`);
    });
    if (badSteps.length > 0) {
      addCheck('CW4', 'fail', `${doc.path} steps missing run/uses: ${badSteps.join(', ')}`);
    }

    if (secretInventory) {
      const secretNames = secretInventory.map((entry) => entry.name);
      const missingSecrets = [...new Set(doc.secretRefs.filter((secretName) => !secretNames.includes(secretName)))];
      addCheck('CW6', missingSecrets.length === 0 ? 'pass' : 'fail', missingSecrets.length === 0 ? `${doc.path} secret refs are all in inventory` : `${doc.path} references undeclared secrets: ${missingSecrets.join(', ')}`);
    } else {
      addCheck('CW6', 'infra_error', 'secret inventory unavailable; cannot validate workflow secret references');
    }
  }
}

async function runSecretChecks(
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
  githubToken: string,
  repoSlug: string,
  workflowDocs: WorkflowDoc[],
  secretInventory: SecretInventoryEntry[] | null,
): Promise<void> {
  if (!githubToken) {
    addCheck('CS1', 'infra_error', 'GITHUB_TOKEN is missing');
    addCheck('CS2', 'infra_error', 'GitHub token unavailable');
    addCheck('CS3', 'infra_error', 'GitHub token unavailable');
    addCheck('CS4', 'skip', 'no environment-scoped secret inventory declared');
    addCheck('CS5', checkWorkflowSecretLeak(workflowDocs) ? 'fail' : 'pass', checkWorkflowSecretLeak(workflowDocs) ? 'possible plaintext secret references in workflows' : 'no suspicious plaintext secret references in workflows');
    return;
  }

  const secretsResponse = await githubRequest<{ secrets?: Array<{ name: string }> }>(repoSlug, '/actions/secrets', githubToken);
  if (!secretsResponse.ok || !secretsResponse.data?.secrets) {
    addCheck('CS1', 'infra_error', `unable to list repo secrets: ${secretsResponse.detail}`);
    addCheck('CS2', 'infra_error', 'repo secret list unavailable');
    addCheck('CS3', 'infra_error', 'repo secret list unavailable');
  } else {
    addCheck('CS1', 'pass', 'GitHub token can list repo secrets');
    const remoteNames = secretsResponse.data.secrets.map((secret) => secret.name);
    const workflowSecrets = [...new Set(workflowDocs.flatMap((doc) => doc.secretRefs))];
    const missingWorkflowSecrets = workflowSecrets.filter((name) => !remoteNames.includes(name));
    addCheck('CS2', missingWorkflowSecrets.length === 0 ? 'pass' : 'fail', missingWorkflowSecrets.length === 0 ? 'all workflow-referenced secrets exist in the repo' : `missing workflow secrets: ${missingWorkflowSecrets.join(', ')}`);

    if (!secretInventory) {
      addCheck('CS3', 'infra_error', 'required secret inventory missing');
    } else {
      const missingExpectedSecrets = secretInventory
        .map((entry) => entry.name)
        .filter((name) => !remoteNames.includes(name));
      addCheck('CS3', missingExpectedSecrets.length === 0 ? 'pass' : 'fail', missingExpectedSecrets.length === 0 ? 'all expected secrets exist in the repo' : `missing expected secrets: ${missingExpectedSecrets.join(', ')}`);
    }
  }

  const envScopedSecrets = (secretInventory ?? []).filter((entry) => entry.environment);
  addCheck('CS4', envScopedSecrets.length > 0 ? 'infra_error' : 'skip', envScopedSecrets.length > 0 ? 'environment-scoped secret validation is not implemented in Phase 1' : 'no environment-scoped secret inventory declared');
  const badSecretStrings = checkWorkflowSecretLeak(workflowDocs);
  addCheck('CS5', badSecretStrings ? 'fail' : 'pass', badSecretStrings ? 'possible plaintext secret references in workflows' : 'no suspicious plaintext secret references in workflows');
}

async function runProtectionChecks(
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
  githubToken: string,
  repoSlug: string,
): Promise<void> {
  if (!githubToken) {
    addCheck('CP1', 'infra_error', 'GITHUB_TOKEN is missing');
    addCheck('CP2', 'infra_error', 'GITHUB_TOKEN is missing');
    addCheck('CP3', 'infra_error', 'GITHUB_TOKEN is missing');
    addCheck('CP4', 'infra_error', 'GITHUB_TOKEN is missing');
    addCheck('CP5', 'infra_error', 'GITHUB_TOKEN is missing');
    addCheck('CP6', 'infra_error', 'GITHUB_TOKEN is missing');
    addCheck('CP7', 'infra_error', 'GITHUB_TOKEN is missing');
    return;
  }
  const protection = await githubRequest<Record<string, unknown>>(repoSlug, '/branches/main/protection', githubToken);
  if (!protection.ok || !protection.data) {
    for (const id of ['CP1', 'CP2', 'CP3', 'CP4', 'CP5', 'CP6', 'CP7']) {
      addCheck(id as CheckResult['id'], 'infra_error', `branch protection unavailable: ${protection.detail}`);
    }
    return;
  }
  const data = protection.data;
  addCheck('CP1', 'pass', 'main branch protection is enabled');
  const requiredStatusChecks = data.required_status_checks as Record<string, unknown> | null;
  addCheck('CP2', requiredStatusChecks ? 'pass' : 'fail', requiredStatusChecks ? 'main requires status checks' : 'main does not require status checks');
  addCheck('CP3', requiredStatusChecks?.strict ? 'pass' : 'fail', requiredStatusChecks?.strict ? 'main requires branches be up to date' : 'main does not require branches be up to date');
  const contexts = [
    ...(((requiredStatusChecks?.contexts as string[] | undefined) ?? [])),
    ...((((requiredStatusChecks?.checks as Array<{ context?: string }> | undefined) ?? []).map((entry) => entry.context ?? '').filter(Boolean))),
  ];
  addCheck('CP4', contexts.length > 0 ? 'pass' : 'fail', contexts.length > 0 ? `main requires ${contexts.length} status checks` : 'main has no required check names configured');
  addCheck('CP5', data.allow_force_pushes === null || (data.allow_force_pushes as { enabled?: boolean }).enabled === false ? 'pass' : 'fail', data.allow_force_pushes === null || (data.allow_force_pushes as { enabled?: boolean }).enabled === false ? 'force-push is blocked on main' : 'force-push is allowed on main');
  addCheck('CP6', data.allow_deletions === null || (data.allow_deletions as { enabled?: boolean }).enabled === false ? 'pass' : 'fail', data.allow_deletions === null || (data.allow_deletions as { enabled?: boolean }).enabled === false ? 'branch deletion is blocked on main' : 'branch deletion is allowed on main');
  addCheck('CP7', 'skip', 'T1 label gating presence is not mechanically resolvable beyond branch protection in Phase 1');
}

async function runRequiredCheckChecks(
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
  githubToken: string,
  repoSlug: string,
  workflowDocs: WorkflowDoc[],
  requiredChecks: RequiredCheckInventoryEntry[] | null,
  since: string | undefined,
): Promise<void> {
  if (!githubToken) {
    for (const id of ['CR1', 'CR2', 'CR3', 'CR4']) {
      addCheck(id as CheckResult['id'], 'infra_error', 'GITHUB_TOKEN is missing');
    }
    return;
  }
  const protection = await githubRequest<Record<string, unknown>>(repoSlug, '/branches/main/protection', githubToken);
  const requiredStatusChecks = (protection.data?.required_status_checks as Record<string, unknown> | undefined) ?? {};
  const configured = [
    ...(((requiredStatusChecks.contexts as string[] | undefined) ?? [])),
    ...((((requiredStatusChecks.checks as Array<{ context?: string }> | undefined) ?? []).map((entry) => entry.context ?? '').filter(Boolean))),
  ];
  const workflowNames = workflowDocs.flatMap((doc) => [doc.name, ...doc.jobs]);
  const staleConfigured = configured.filter((name) => !workflowNames.includes(name));
  addCheck('CR1', staleConfigured.length === 0 ? 'pass' : 'fail', staleConfigured.length === 0 ? 'configured required checks map to known workflow/job names' : `required checks not produced by known workflows: ${staleConfigured.join(', ')}`);

  if (!requiredChecks) {
    addCheck('CR2', 'infra_error', 'required CI checks inventory missing');
  } else {
    const missingConfigured = requiredChecks
      .map((entry) => entry.name)
      .filter((name) => !configured.includes(name));
    addCheck('CR2', missingConfigured.length === 0 ? 'pass' : 'fail', missingConfigured.length === 0 ? 'declared required CI checks are configured on main' : `declared required checks missing on main: ${missingConfigured.join(', ')}`);
  }
  addCheck('CR3', staleConfigured.length === 0 ? 'pass' : 'fail', staleConfigured.length === 0 ? 'no stale required check names on main' : `stale required check names: ${staleConfigured.join(', ')}`);

  const runs = await listWorkflowRuns(repoSlug, githubToken, since);
  const recentNames = new Set(runs.flatMap((run) => run.check_suite_name ? [run.check_suite_name] : [run.name]).filter(Boolean));
  const missingRecent = configured.filter((name) => !recentNames.has(name));
  addCheck('CR4', missingRecent.length === 0 ? 'pass' : 'fail', missingRecent.length === 0 ? 'required check names appeared in recent workflow history' : `required checks missing from recent run history: ${missingRecent.join(', ')}`);
}

async function runPreviewChecks(
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
  githubToken: string,
  repoSlug: string,
  workflowDocs: WorkflowDoc[],
  secretInventory: SecretInventoryEntry[] | null,
  since: string | undefined,
): Promise<void> {
  const previewDoc = workflowDocs.find((doc) => /supabase.*(preview|pr-db-branch)/i.test(doc.path) || /Supabase PR DB Branch/i.test(doc.name));
  if (!previewDoc) {
    for (const id of ['CV1', 'CV2', 'CV3', 'CV4', 'CV5', 'CV6']) {
      addCheck(id as CheckResult['id'], 'skip', 'preview workflow is not present');
    }
    return;
  }
  addCheck('CV1', 'pass', `${previewDoc.path} exists`);

  if (!secretInventory) {
    addCheck('CV2', 'infra_error', 'required secret inventory missing');
  } else {
    const declaredSecretNames = secretInventory.map((entry) => entry.name);
    const previewSecrets = [...new Set(previewDoc.secretRefs)];
    const undeclared = previewSecrets.filter((name) => !declaredSecretNames.includes(name));
    addCheck('CV2', undeclared.length === 0 ? 'pass' : 'fail', undeclared.length === 0 ? 'preview workflow secrets match inventory' : `preview workflow uses undeclared secrets: ${undeclared.join(', ')}`);
  }

  addCheck('CV3', /echo\s+"[A-Z_][A-Z0-9_]*=\\"/.test(previewDoc.text) ? 'fail' : 'pass', /echo\s+"[A-Z_][A-Z0-9_]*=\\"/.test(previewDoc.text) ? 'preview workflow contains quoted GITHUB_ENV writes' : 'preview workflow avoids quoted GITHUB_ENV writes');
  addCheck('CV4', /(pooler\.supabase\.com|POSTGRES_URL\b)/.test(previewDoc.text) ? 'pass' : 'fail', /(pooler\.supabase\.com|POSTGRES_URL\b)/.test(previewDoc.text) ? 'preview workflow uses pooled URL pattern' : 'preview workflow does not show pooled Supabase URL usage');

  if (!githubToken) {
    addCheck('CV5', 'infra_error', 'GITHUB_TOKEN is missing');
  } else {
    const runs = await listWorkflowRuns(repoSlug, githubToken, since, previewDoc.name);
    const recurringFailures = runs
      .filter((run) => run.conclusion === 'failure')
      .filter((run) => /(parse|connection refused|missing secret)/i.test(run.display_title || run.name || ''));
    addCheck('CV5', recurringFailures.length === 0 ? 'pass' : 'fail', recurringFailures.length === 0 ? 'no recent preview workflow failures matched known recurring reasons' : `recent preview workflow failures matched known reasons: ${recurringFailures.length}`);
  }

  const previewDocPath = path.join(ROOT, 'docs', 'ops', 'SUPABASE_PREVIEW_BRANCH_VALIDATION.md');
  if (!fs.existsSync(previewDocPath)) {
    addCheck('CV6', 'fail', 'preview-branch validation doc is missing');
  } else {
    const text = fs.readFileSync(previewDocPath, 'utf8');
    addCheck('CV6', /selective-use|selective use/i.test(text) ? 'pass' : 'fail', /selective-use|selective use/i.test(text) ? 'preview-branch validation doc is marked selective-use' : 'preview-branch validation doc is missing selective-use language');
  }
}

async function runHistoryChecks(
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
  githubToken: string,
  repoSlug: string,
  requiredChecks: RequiredCheckInventoryEntry[] | null,
  since: string | undefined,
): Promise<void> {
  if (!githubToken) {
    for (const id of ['CH1', 'CH2', 'CH3', 'CH4']) {
      addCheck(id as CheckResult['id'], 'infra_error', 'GITHUB_TOKEN is missing');
    }
    return;
  }
  const runs = await listWorkflowRuns(repoSlug, githubToken, since);
  if (runs.length === 0) {
    for (const id of ['CH1', 'CH2', 'CH3', 'CH4']) {
      addCheck(id as CheckResult['id'], 'fail', 'no workflow runs available in history window');
    }
    return;
  }
  const now = Date.now();
  const names = [...new Set(
    (requiredChecks ?? []).length > 0
      ? requiredChecks!.map((entry) => entry.name)
      : runs.map((run) => run.name).filter(Boolean),
  )];
  const grouped = new Map<string, typeof runs>();
  for (const name of names) {
    grouped.set(name, runs.filter((run) => run.name === name || run.check_suite_name === name));
  }

  const stale = names.filter((name) => {
    const lastSuccess = grouped.get(name)?.find((run) => run.conclusion === 'success');
    if (!lastSuccess?.created_at) return true;
    return now - Date.parse(lastSuccess.created_at) > 7 * 24 * 60 * 60 * 1000;
  });
  addCheck('CH1', stale.length === 0 ? 'pass' : 'fail', stale.length === 0 ? 'recent successful runs exist for gating workflows' : `stale successful workflow history for: ${stale.join(', ')}`);

  const consecutiveFailures = names.filter((name) => (grouped.get(name) ?? []).slice(0, 3).length === 3 && (grouped.get(name) ?? []).slice(0, 3).every((run) => run.conclusion === 'failure'));
  addCheck('CH2', consecutiveFailures.length === 0 ? 'pass' : 'fail', consecutiveFailures.length === 0 ? 'no gating workflow has failed 3 consecutive runs' : `consecutive failing workflows: ${consecutiveFailures.join(', ')}`);

  const absent = names.filter((name) => (grouped.get(name) ?? []).length === 0);
  addCheck('CH3', absent.length === 0 ? 'pass' : 'fail', absent.length === 0 ? 'all gating workflows have runs in the last 30 days' : `gating workflows with zero recent runs: ${absent.join(', ')}`);

  const ciDoctorRuns = runs.filter((run) => run.name === 'CI Doctor');
  const lastCiDoctorSuccess = ciDoctorRuns.find((run) => run.conclusion === 'success');
  if (!lastCiDoctorSuccess?.created_at) {
    addCheck('CH4', 'fail', 'ci-doctor workflow has no recent successful run');
  } else {
    const ageMs = now - Date.parse(lastCiDoctorSuccess.created_at);
    addCheck('CH4', ageMs <= 26 * 60 * 60 * 1000 ? 'pass' : 'fail', ageMs <= 26 * 60 * 60 * 1000 ? 'ci-doctor workflow succeeded within the last 26 hours' : 'ci-doctor workflow has not succeeded within the last 26 hours');
  }
}

async function listWorkflowRuns(
  repoSlug: string,
  token: string,
  since: string | undefined,
  workflowName?: string,
): Promise<Array<{ name: string; check_suite_name?: string; conclusion?: string; created_at?: string; display_title?: string }>> {
  const query = since ? `?created=>=${encodeURIComponent(since)}&per_page=50` : '?per_page=50';
  const response = await githubRequest<{ workflow_runs?: Array<{ name: string; check_suite_name?: string; conclusion?: string; created_at?: string; display_title?: string }> }>(repoSlug, `/actions/runs${query}`, token);
  const runs = response.data?.workflow_runs ?? [];
  return workflowName ? runs.filter((run) => run.name === workflowName) : runs;
}

async function githubRequest<T>(
  repoSlug: string,
  endpoint: string,
  token: string,
): Promise<{ ok: boolean; data?: T; detail: string }> {
  const url = `https://api.github.com/repos/${repoSlug}${endpoint}`;
  let lastError = 'unknown error';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'unit-talk-ops-ci-doctor',
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        lastError = `${response.status} ${response.statusText}`;
        if (attempt === 1) {
          return { ok: false, detail: lastError };
        }
      } else {
        return { ok: true, data: (await response.json()) as T, detail: 'ok' };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === 1) {
        return { ok: false, detail: lastError };
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  return { ok: false, detail: lastError };
}

function emitGit(args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  }) as { status: number | null; stdout?: string; stderr?: string };
  if (result.status !== 0) {
    return '';
  }
  return (result.stdout ?? '').trim();
}

function checkWorkflowSecretLeak(workflowDocs: WorkflowDoc[]): boolean {
  const knownSecretNames = [...new Set(workflowDocs.flatMap((doc) => doc.secretRefs))];
  if (knownSecretNames.length === 0) {
    return false;
  }

  return workflowDocs.some((doc) =>
    doc.text.split(/\r?\n/).some((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) {
        return false;
      }
      if (/^\s*echo\b/.test(line)) {
        return false;
      }
      if (/\$\{\{\s*secrets\./.test(line)) {
        return false;
      }
      return knownSecretNames.some((secretName) => {
        const bareNamePattern = new RegExp(`\\b${escapeRegExp(secretName)}\\b`);
        if (!bareNamePattern.test(line)) {
          return false;
        }
        if (new RegExp(`\\$\\{?${escapeRegExp(secretName)}\\}?`).test(line)) {
          return false;
        }
        if (new RegExp(`^\\s*${escapeRegExp(secretName)}\\s*=`).test(line)) {
          return false;
        }
        return true;
      });
    }),
  );
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildResult(
  mode: 'local' | 'scheduled',
  scope: Scope,
  checks: CheckResult[],
  repo = deriveRepoSlug(),
): CiDoctorResult {
  const failures = checks.filter((check) => check.status === 'fail').map((check) => check.id);
  const infraErrors = checks.filter((check) => check.status === 'infra_error').map((check) => check.id);
  const skips = checks.filter((check) => check.status === 'skip').map((check) => check.id);
  const verdict: CiDoctorResult['verdict'] = failures.length > 0 ? 'FAIL' : infraErrors.length > 0 ? 'INFRA' : 'PASS';
  const exitCode: CiDoctorResult['exit_code'] = verdict === 'PASS' ? 0 : verdict === 'FAIL' ? 1 : 3;
  return {
    schema_version: 1,
    run_at: new Date().toISOString(),
    mode,
    repo,
    scope,
    verdict,
    exit_code: exitCode,
    checks,
    failures,
    infra_errors: infraErrors,
    skips,
    summary: {
      total: checks.length,
      pass: checks.filter((check) => check.status === 'pass').length,
      fail: failures.length,
      skip: skips.length,
      infra_error: infraErrors.length,
    },
  };
}

function outputAndExit(
  result: CiDoctorResult,
  json: boolean,
  writeResult = false,
): number {
  if (writeResult && result.mode === 'local') {
    ensureDir(CI_DOCTOR_DIR);
    const target = path.join(CI_DOCTOR_DIR, `${result.run_at.replace(/[:]/g, '-')}.json`);
    writeJsonFile(target, result);
  }
  if (json) {
    emitJson(result);
  } else {
    const groups = new Map<string, CheckResult[]>();
    for (const check of result.checks) {
      const prefix = check.id.slice(0, 2);
      const group = groups.get(prefix) ?? [];
      group.push(check);
      groups.set(prefix, group);
    }
    for (const [prefix, entries] of groups) {
      console.log(`-- ${prefix} --`);
      for (const check of entries) {
        console.log(`[${check.status.toUpperCase()}] ${check.id} - ${check.detail}`);
      }
    }
    console.log(`VERDICT: ${result.verdict}  (pass: ${result.summary.pass}, fail: ${result.summary.fail}, skip: ${result.summary.skip}, infra: ${result.summary.infra_error})`);
  }
  return result.exit_code;
}

void main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    const result = buildResult(detectMode(), 'all', [
      {
        id: 'CDX',
        status: 'infra_error',
        detail: error instanceof Error ? error.message : String(error),
      },
    ]);
    emitJson(result);
    process.exitCode = 3;
  });
