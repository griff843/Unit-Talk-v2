import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { normalizeUntrackedScriptFiles } from './clean-scripts.js';
import { evaluateBranchDiscipline, evaluateIssueReferences, extractIssueIds } from './branch-discipline-guard.js';
import { ROOT } from './shared.js';

type WorkflowDocument = Record<string, unknown>;

function readWorkflow(name: string): string {
  return fs.readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8');
}

function readWorkflowYaml(name: string): WorkflowDocument {
  const parsed = parseYaml(readWorkflow(name)) as unknown;
  assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed), `${name} must parse as a YAML object`);
  return parsed as WorkflowDocument;
}

function objectField(input: WorkflowDocument, key: string): WorkflowDocument {
  const value = input[key];
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${key} must be an object`);
  return value as WorkflowDocument;
}

function stringArrayField(input: WorkflowDocument, key: string): string[] {
  const value = input[key];
  assert.ok(Array.isArray(value), `${key} must be an array`);
  assert.ok(value.every((item) => typeof item === 'string'), `${key} must contain only strings`);
  return value as string[];
}

function stringField(input: WorkflowDocument, key: string): string {
  const value = input[key];
  assert.strictEqual(typeof value, 'string', `${key} must be a string`);
  return value;
}

function workflowEvent(name: string, eventName: string): WorkflowDocument {
  return objectField(objectField(readWorkflowYaml(name), 'on'), eventName);
}

test('migration linter flags destructive audit_log statements with file and statement context', async () => {
  const { lintMigrationContent } = await import('../lint-migrations.mjs');

  const findings = lintMigrationContent(
    [
      '-- DELETE FROM public.audit_log is mentioned in a comment only',
      'DELETE FROM public.audit_log',
      "  WHERE created_at < NOW() - INTERVAL '90 days';",
      'UPDATE audit_log SET action = action;',
      'TRUNCATE TABLE public.audit_log;',
    ].join('\n'),
    'future_bad_migration.sql',
  );

  assert.deepStrictEqual(
    findings.map((finding: { rule: string }) => finding.rule),
    ['A1', 'A1', 'A1'],
  );
  assert.deepStrictEqual(
    findings.map((finding: { file: string }) => finding.file),
    ['future_bad_migration.sql', 'future_bad_migration.sql', 'future_bad_migration.sql'],
  );
  assert.match(findings[0].statement, /DELETE FROM public\.audit_log/i);
  assert.match(findings[1].statement, /UPDATE audit_log/i);
  assert.match(findings[2].statement, /TRUNCATE TABLE public\.audit_log/i);
});

test('migration linter allows audit_log inserts and immutability triggers', async () => {
  const { lintMigrationContent } = await import('../lint-migrations.mjs');

  const findings = lintMigrationContent(
    [
      'insert into public.audit_log (id, entity_type) values (gen_random_uuid(), \'pick\');',
      'create trigger audit_log_immutable',
      '  before update or delete on public.audit_log',
      '  for each row execute function public.prevent_audit_log_mutation();',
    ].join('\n'),
    'audit_safe_migration.sql',
  );

  assert.deepStrictEqual(findings, []);
});

test('clean-scripts only keeps untracked files under scripts', () => {
  assert.deepStrictEqual(
    normalizeUntrackedScriptFiles(
      ['scripts/proof-a.ts', 'apps/api/src/scripts/proof-b.ts', 'scripts/nested/tool.ts', '../scripts/nope.ts'].join('\n'),
    ),
    ['scripts/nested/tool.ts', 'scripts/proof-a.ts'],
  );
});

test('branch discipline extracts unique issue IDs case-insensitively', () => {
  assert.deepStrictEqual(extractIssueIds('fix UTV2-123 and utv2-123, refs UTV2-124'), [
    'UTV2-123',
    'UTV2-124',
  ]);
});

test('branch discipline fails on multiple issue IDs', () => {
  const result = evaluateIssueReferences('PR title UTV2-123\nBody mentions UTV2-124');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'multiple_issue_references');
  assert.match(result.errors.join('\n'), /UTV2-123, UTV2-124/);
  assert.match(result.warning ?? '', /UTV2-123, UTV2-124/);
});

test('branch discipline requires an issue ID in the PR branch', () => {
  const result = evaluateBranchDiscipline({
    title: 'fix runtime truth check',
    branch: 'codex/g4-admin-merge-truth',
    commits: 'fix runtime truth check',
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'missing_branch_issue_reference');
  assert.match(result.errors.join('\n'), /must include exactly one/);
});

test('branch discipline requires all PR issue references to match the branch issue', () => {
  const result = evaluateBranchDiscipline({
    title: 'fix ops UTV2-124',
    branch: 'codex/utv2-123-branch-discipline',
    commits: 'fix(ops): UTV2-123 branch discipline',
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'multiple_issue_references');
  assert.deepStrictEqual(result.branch_issue_ids, ['UTV2-123']);
  assert.deepStrictEqual(result.issue_ids, ['UTV2-123', 'UTV2-124']);
});

test('branch discipline accepts a single matching branch issue reference', () => {
  const result = evaluateBranchDiscipline({
    title: 'fix ops guard',
    branch: 'codex/utv2-123-branch-discipline',
    commits: 'fix(ops): UTV2-123 branch discipline',
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.code, 'single_issue_reference');
  assert.deepStrictEqual(result.branch_issue_ids, ['UTV2-123']);
  assert.deepStrictEqual(result.issue_ids, ['UTV2-123']);
});

test('session start state cache writes only to ignored local output', () => {
  const hook = fs.readFileSync(path.join(ROOT, '.claude', 'hooks', 'session-start.sh'), 'utf8');

  assert.match(hook, /SESSION_STATE_DIR="\$ROOT\/\.out\/ops\/session-state"/);
  assert.match(hook, /STAMP_FILE="\$SESSION_STATE_DIR\/\.state-stamp"/);
  assert.match(hook, /STATE_FILE="\$SESSION_STATE_DIR\/SYSTEM_STATE\.md"/);
  assert.doesNotMatch(hook, /STAMP_FILE="\$ROOT\/\.claude\/\.state-stamp"/);
  assert.doesNotMatch(hook, /STATE_FILE="\$ROOT\/docs\/06_status\/SYSTEM_STATE\.md"/);
  assert.match(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), /^\.out\/$/m);
});

test('required PR check workflows do not create stale merge-gate contexts on opened events', () => {
  const mergeGate = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'merge-gate.yml'), 'utf8');
  const mergeGatePullRequestBlock = mergeGate.match(/pull_request:\s*\r?\n\s+types:\s*\[([^\]]+)\]/);

  assert.ok(mergeGatePullRequestBlock, 'merge-gate.yml must declare explicit pull_request types');
  assert.doesNotMatch(
    mergeGatePullRequestBlock[1] ?? '',
    /(^|,\s*)opened(\s*,|$)/,
    'merge-gate.yml must not run required checks on pull_request.opened before labels settle',
  );
});

test('tier label sync runs on opened so PM does not manually apply GitHub tier labels', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'tier-label-check.yml'), 'utf8');
  const pullRequestBlock = workflow.match(/pull_request:\s*\r?\n\s+types:\s*\[([^\]]+)\]/);

  assert.ok(pullRequestBlock, 'tier-label-check.yml must declare explicit pull_request types');
  assert.match(
    pullRequestBlock[1] ?? '',
    /(^|,\s*)opened(\s*,|$)/,
    'tier-label-check.yml must run on pull_request.opened to apply missing tier evidence automatically',
  );
});

test('merge gate is structurally wired for PM verdict comments without opened PR races', () => {
  const pullRequest = workflowEvent('merge-gate.yml', 'pull_request');
  const issueComment = workflowEvent('merge-gate.yml', 'issue_comment');
  const jobs = objectField(readWorkflowYaml('merge-gate.yml'), 'jobs');
  const gateIf = stringField(objectField(jobs, 'gate'), 'if');

  assert.deepStrictEqual(stringArrayField(pullRequest, 'types'), [
    'synchronize',
    'reopened',
    'labeled',
    'unlabeled',
    'ready_for_review',
  ]);
  assert.deepStrictEqual(stringArrayField(issueComment, 'types'), ['created', 'edited']);
  assert.match(gateIf, /PM_VERDICT:/, 'merge gate must respond to PM verdict comments');
});

test('required pull-request gates are wired to executable blocking jobs', () => {
  const requiredGateJobs = [
    ['executor-result-validator.yml', 'validate', 'Executor Result Validation'],
    ['file-scope-lock-check.yml', 'check', 'File scope lock'],
    ['r-level-compliance-check.yml', 'r-level-compliance-check', 'R-Level Compliance Check'],
    ['return-review-packet.yml', 'return-review-packet', 'Return review packet'],
    ['proof-auditor-gate.yml', 'proof-auditor-gate', 'Proof Auditor Gate'],
    ['runtime-verifier-gate.yml', 'runtime-verifier-gate', 'Runtime Verifier Gate'],
  ] as const;

  for (const [workflowName, jobId, jobName] of requiredGateJobs) {
    const workflow = readWorkflowYaml(workflowName);
    const pullRequest = objectField(objectField(workflow, 'on'), 'pull_request');
    const jobs = objectField(workflow, 'jobs');
    const job = objectField(jobs, jobId);

    assert.ok(
      stringArrayField(pullRequest, 'types').includes('synchronize'),
      `${workflowName} must rerun on synchronize`,
    );
    assert.strictEqual(job.name, jobName, `${workflowName} must expose the required check name`);
    assert.ok(Array.isArray(job.steps), `${workflowName} job ${jobId} must have executable steps`);
  }
});

test('proof and runtime gates watch proof, lane, and ops control-plane paths', () => {
  const proofPaths = stringArrayField(workflowEvent('proof-auditor-gate.yml', 'pull_request'), 'paths');
  const runtimePaths = stringArrayField(workflowEvent('runtime-verifier-gate.yml', 'pull_request'), 'paths');

  assert.ok(proofPaths.includes('docs/06_status/proof/**'), 'proof auditor must watch proof directories');
  assert.ok(runtimePaths.includes('docs/06_status/proof/**'), 'runtime verifier must watch proof directories');
  assert.ok(runtimePaths.includes('docs/06_status/lanes/**'), 'runtime verifier must watch lane manifests');
  assert.ok(runtimePaths.includes('scripts/ops/**'), 'runtime verifier must watch ops control-plane changes');
});

test('CI avoids duplicate verify jobs for codex PR branches', () => {
  const workflow = readWorkflowYaml('ci.yml');
  const on = objectField(workflow, 'on');
  const push = objectField(on, 'push');
  const branches = stringArrayField(push, 'branches');
  const concurrency = objectField(workflow, 'concurrency');

  assert.deepStrictEqual(branches, ['main']);
  assert.ok(on.pull_request !== undefined, 'CI must still run for pull requests');
  assert.match(stringField(concurrency, 'group'), /pull_request\.number/);
  assert.strictEqual(concurrency['cancel-in-progress'], true);
});
