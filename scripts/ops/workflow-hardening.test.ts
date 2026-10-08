import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { parse as parseYaml } from 'yaml';
import { normalizeUntrackedScriptFiles } from './clean-scripts.js';
import {
  evaluateBranchDiscipline,
  evaluateIssueReferences,
  extractIssueIds,
  normalizeProofOutputForIssueBinding,
} from './branch-discipline-guard.js';
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

function readClaudeCommand(name: string): string {
  return fs.readFileSync(path.join(ROOT, '.claude', 'commands', name), 'utf8');
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

function githubScriptStep(workflowName: string, jobName: string, stepName: string): string {
  const jobs = objectField(readWorkflowYaml(workflowName), 'jobs');
  const job = objectField(jobs, jobName);
  assert.ok(Array.isArray(job.steps), `${jobName} must have steps`);
  const step = (job.steps as Array<Record<string, unknown>>).find((candidate) => candidate.name === stepName);
  assert.ok(step, `${jobName} must contain ${stepName}`);
  return stringField((step.with ?? {}) as WorkflowDocument, 'script');
}

async function executeGithubScript(
  script: string,
  bindings: Record<string, unknown>,
): Promise<unknown> {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<unknown>;
  const names = Object.keys(bindings);
  return new AsyncFunction(...names, script)(...names.map((name) => bindings[name]));
}

function workflowEvent(name: string, eventName: string): WorkflowDocument {
  return objectField(objectField(readWorkflowYaml(name), 'on'), eventName);
}

function evaluateWorkflowExpression(expression: string, eventName: string): unknown {
  const source = expression.startsWith('${{') && expression.endsWith('}}')
    ? expression.slice(3, -2).trim()
    : expression;
  return runInNewContext(source, { github: { event_name: eventName } });
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

test('branch discipline ignores historical issue ids in fenced proof output', () => {
  const result = evaluateBranchDiscipline({
    title: 'fix(ops): UTV2-1172 branch discipline proof handling',
    branch: 'codex/utv2-1172-proof-aware-branch-discipline',
    body: [
      '## Summary',
      'Fixes proof parsing for UTV2-1172.',
      '',
      '## Verification',
      '```text',
      'TAP version 13',
      'ok 1 UTV2-866 live DB proof output',
      '# tests 1',
      '```',
    ].join('\n'),
    commits: 'fix(ops): UTV2-1172 proof-aware branch discipline',
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.code, 'single_issue_reference');
  assert.deepStrictEqual(result.issue_ids, ['UTV2-1172']);
});

test('branch discipline ignores marked proof sections and TAP lines', () => {
  const body = [
    '## Summary',
    'Only UTV2-1172 is prose.',
    '',
    '## Live-DB proof',
    '[proof] UTV2-866 legacy closeout fixture',
    'not ok 2 UTV2-901 historical fixture',
    '# fail 1',
    '',
    '## Merge order',
    'No overlapping files.',
  ].join('\n');

  assert.doesNotMatch(normalizeProofOutputForIssueBinding(body), /UTV2-866|UTV2-901/);

  const result = evaluateBranchDiscipline({
    title: 'fix(ops): UTV2-1172 branch discipline proof handling',
    branch: 'codex/utv2-1172-proof-aware-branch-discipline',
    body,
    commits: 'fix(ops): UTV2-1172 proof-aware branch discipline',
  });

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.issue_ids, ['UTV2-1172']);
});

test('branch discipline still fails mismatched prose issue references', () => {
  const result = evaluateBranchDiscipline({
    title: 'fix(ops): UTV2-1172 branch discipline proof handling',
    branch: 'codex/utv2-1172-proof-aware-branch-discipline',
    body: 'This also changes UTV2-999 in normal prose.',
    commits: 'fix(ops): UTV2-1172 proof-aware branch discipline',
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'multiple_issue_references');
  assert.deepStrictEqual(result.issue_ids, ['UTV2-1172', 'UTV2-999']);
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

test('governance lane authority covers Claude hook orchestration files', () => {
  const manifest = parseYaml(fs.readFileSync(path.join(ROOT, '.lane', 'lanes', 'governance.yml'), 'utf8')) as {
    allowed_path_globs?: unknown;
  };

  assert.ok(Array.isArray(manifest.allowed_path_globs), 'governance allowed_path_globs must be an array');
  assert.ok(
    manifest.allowed_path_globs.includes('.claude/hooks/**'),
    'governance lane must allow Claude hook orchestration changes',
  );
});

test('UTV2-1551: merge-gate.yml intentionally runs required checks on pull_request.opened (reversing UTV2-1157)', () => {
  // UTV2-1157 originally kept Merge Gate off `opened`, on the theory that
  // running before GitHub tier labels "settle" would be premature. That
  // theory doesn't hold: Merge Gate resolves its authoritative tier by
  // reading the lane manifest directly via the Contents API (see the
  // `readManifest`/`authoritativeTier` logic in merge-gate.yml) -- it never
  // depends on tier-label-check.yml's label sync having run first, and it
  // already self-applies the matching `tier:T*` label as evidence when none
  // exists yet. The real-world effect of omitting `opened` was worse than
  // "premature": a brand-new PR got zero Merge Gate evaluation from PR
  // creation itself, so the required "Merge Gate" check could sit
  // never-having-run (not failed) until some later push/label/review/comment
  // event happened to fire it (UTV2-1551). Running on `opened` now just
  // means the fail-closed BLOCKED status appears immediately instead of
  // silently later -- see the "evaluates fresh (opened) PRs" test above for
  // the structural assertion that `opened` is present.
  const mergeGate = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'merge-gate.yml'), 'utf8');
  const mergeGatePullRequestBlock = mergeGate.match(/pull_request:[\s\S]*?\n\s+types:\s*\[([^\]]+)\]/);

  assert.ok(mergeGatePullRequestBlock, 'merge-gate.yml must declare explicit pull_request types');
  assert.match(
    mergeGatePullRequestBlock[1] ?? '',
    /(^|,\s*)opened(\s*,|$)/,
    'merge-gate.yml must run on pull_request.opened so a fresh PR gets an immediate Merge Gate evaluation',
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


test('WORK-2026100801: Merge Gate publishes natively and its PR-controlled definition is read-only', () => {
  const workflow = readWorkflowYaml('merge-gate.yml');
  const jobs = objectField(workflow, 'jobs');
  const gate = objectField(jobs, 'gate');

  assert.strictEqual(
    gate.name,
    "${{ github.event_name == 'pull_request' && 'Merge Gate' || 'Merge Gate (ineligible event)' }}",
  );
  assert.strictEqual(stringField(gate, 'if'), "github.event_name == 'pull_request'");
  assert.strictEqual(jobs.refresh, undefined, 'write-capable refresh must not live in merge-gate.yml');
  assert.strictEqual(objectField(workflow, 'on').issue_comment, undefined);
  assert.strictEqual(objectField(workflow, 'on').workflow_dispatch, undefined);
  assert.deepStrictEqual(stringArrayField(workflowEvent('merge-gate.yml', 'pull_request'), 'types'), [
    'opened',
    'synchronize',
    'reopened',
    'labeled',
    'unlabeled',
    'ready_for_review',
  ]);

  const raw = readWorkflow('merge-gate.yml');
  assert.doesNotMatch(raw, /github\.rest\.checks\.(create|update)/, 'Merge Gate must not fabricate required check runs');
  for (const [jobId, value] of Object.entries(jobs)) {
    const permissions = objectField(value as WorkflowDocument, 'permissions');
    assert.notStrictEqual(permissions.actions, 'write', `${jobId} must not receive actions:write`);
  }
  assert.match(raw, /core\.setFailed\(`Merge Gate blocked:/, 'policy denial must fail the native required job');
  assert.match(raw, /Merge Gate \(ineligible event\)/, 'skipped non-PR jobs must not carry the protected name');
});

test('WORK-2026100801: trusted refresh broker cannot impersonate required contexts', () => {
  const executorJobs = objectField(readWorkflowYaml('executor-result-validator.yml'), 'jobs');
  const mergeJobs = objectField(readWorkflowYaml('merge-gate.yml'), 'jobs');
  const refreshJobs = objectField(readWorkflowYaml('required-check-refresh.yml'), 'jobs');
  assert.match(String(objectField(executorJobs, 'validate').name), /Executor Result Validation \(ineligible event\)/);
  assert.match(String(objectField(mergeJobs, 'gate').name), /Merge Gate \(ineligible event\)/);
  assert.strictEqual(objectField(refreshJobs, 'refresh').name, 'Retry eligible native required checks');
  assert.notStrictEqual(objectField(refreshJobs, 'refresh').name, 'Executor Result Validation');
  assert.notStrictEqual(objectField(refreshJobs, 'refresh').name, 'Merge Gate');
});

test('WORK-2026100501: parsed native job expressions reserve required identities for evaluated PR jobs', () => {
  for (const [workflowName, jobId, requiredName] of [
    ['executor-result-validator.yml', 'validate', 'Executor Result Validation'],
    ['merge-gate.yml', 'gate', 'Merge Gate'],
  ] as const) {
    const job = objectField(objectField(readWorkflowYaml(workflowName), 'jobs'), jobId);
    const nameExpression = stringField(job, 'name');
    const ifExpression = stringField(job, 'if');

    for (const eventName of ['pull_request', 'pull_request_review', 'issue_comment', 'workflow_dispatch']) {
      const evaluatedName = evaluateWorkflowExpression(nameExpression, eventName);
      const evaluatedIf = evaluateWorkflowExpression(ifExpression, eventName);
      const eligible = eventName === 'pull_request';

      assert.strictEqual(evaluatedIf, eligible, `${workflowName} ${eventName} eligibility must fail closed`);
      assert.strictEqual(
        evaluatedName,
        eligible ? requiredName : `${requiredName} (ineligible event)`,
        `${workflowName} ${eventName} must expose the correct native identity`,
      );
      assert.strictEqual(
        evaluatedName === requiredName,
        evaluatedIf,
        `${workflowName} must expose its required identity exactly when the native job is evaluated`,
      );
    }
  }
});

test('WORK-2026100801: actions-write exists only in the default-controlled retry broker', () => {
  for (const [workflowName, nativeId] of [
    ['executor-result-validator.yml', 'validate'],
    ['merge-gate.yml', 'gate'],
  ] as const) {
    const jobs = objectField(readWorkflowYaml(workflowName), 'jobs');
    const nativePermissions = objectField(objectField(jobs, nativeId), 'permissions');
    assert.notStrictEqual(nativePermissions.actions, 'write', `${workflowName} native job must not write Actions`);
    assert.notStrictEqual(nativePermissions.checks, 'write', `${workflowName} native job must not write checks`);
    for (const [jobId, value] of Object.entries(jobs)) {
      const permissions = objectField(value as WorkflowDocument, 'permissions');
      assert.notStrictEqual(permissions.actions, 'write', `${workflowName}/${jobId} must not receive actions:write`);
    }
  }
  const refresh = objectField(objectField(readWorkflowYaml('required-check-refresh.yml'), 'jobs'), 'refresh');
  const permissions = objectField(refresh, 'permissions');
  assert.strictEqual(permissions.actions, 'write');
  assert.notStrictEqual(permissions.checks, 'write');
});

test('WORK-2026100801: refresh broker is default-controlled and rechecks live HEAD adjacent to retry', () => {
  const workflow = readWorkflowYaml('required-check-refresh.yml');
  const events = objectField(workflow, 'on');
  assert.strictEqual(events.pull_request, undefined);
  assert.strictEqual(events.pull_request_review, undefined);
  assert.strictEqual(events.workflow_dispatch, undefined, 'no branch-selectable privileged dispatch');
  assert.deepStrictEqual(stringArrayField(objectField(events, 'repository_dispatch'), 'types'), ['required-check-refresh']);
  assert.deepStrictEqual(stringArrayField(objectField(events, 'workflow_run'), 'workflows'), [
    'CI',
    'Executor Result Validator',
    'Merge Gate',
  ]);
  const raw = readWorkflow('required-check-refresh.yml');
  assert.match(raw, /current\.head\?\.sha !== headSha/);
  assert.match(raw, /refusing stale refresh/);
  assert.match(raw, /github\.rest\.actions\.reRunWorkflow/);
  assert.doesNotMatch(raw, /github\.rest\.checks\.(create|update)/);
  assert.doesNotMatch(raw, /download-artifact|artifacts\.|pnpm install|pull_request\.head\.sha/);
});

test('P1 fix (UTV2-1551 follow-up): tier-label-check.yml never references SYNC_BOT_TOKEN anywhere', () => {
  // tier-label-check.yml runs on `pull_request`, which means GitHub Actions
  // executes it using the PR's OWN copy of this workflow file -- not
  // main's. A malicious same-repo PR could rewrite any step's `script:` or
  // `run:` to exfiltrate or misuse a privileged secret before any review
  // happens, so this workflow must never reference SYNC_BOT_TOKEN (or any
  // other privileged secret) in any step, anywhere.
  const workflow = readWorkflow('tier-label-check.yml');
  assert.doesNotMatch(
    workflow,
    /secrets\.SYNC_BOT_TOKEN/,
    'tier-label-check.yml (pull_request-triggered) must never actually reference secrets.SYNC_BOT_TOKEN -- label mutation belongs in tier-label-apply.yml (workflow_run-triggered)',
  );

  const parsed = readWorkflowYaml('tier-label-check.yml');
  const jobs = objectField(parsed, 'jobs');
  const job = objectField(jobs, 'check-tier-label');
  const steps = job.steps as Array<Record<string, unknown>>;

  for (const step of steps) {
    const withBlock = (step.with ?? {}) as Record<string, unknown>;
    assert.strictEqual(
      withBlock['github-token'],
      undefined,
      `${String(step.name)}: no step in tier-label-check.yml may set an explicit github-token -- this job must run with only the default GITHUB_TOKEN`,
    );
  }
});

test('P1 fix (UTV2-1551 follow-up): tier-label-apply.yml applies the label mutation from a privileged, PR-code-free context', () => {
  // Companion to the test above: the actual label mutation (which needs
  // SYNC_BOT_TOKEN so its labeled/unlabeled event cascades to trigger
  // Merge Gate) must live in a workflow that (a) triggers on `workflow_run`
  // -- always evaluated using the base branch's own copy of the file, never
  // a PR's -- and (b) never checks out any ref, so no PR content is ever
  // executed by this privileged job.
  const raw = readWorkflow('tier-label-apply.yml');
  const workflow = readWorkflowYaml('tier-label-apply.yml');

  const workflowRun = objectField(objectField(workflow, 'on'), 'workflow_run');
  assert.deepStrictEqual(
    stringArrayField(workflowRun, 'workflows'),
    ['Tier Label Check'],
    'tier-label-apply.yml must trigger off Tier Label Check completing',
  );
  assert.deepStrictEqual(stringArrayField(workflowRun, 'types'), ['completed']);
  assert.strictEqual(
    (workflow.on as Record<string, unknown>).pull_request,
    undefined,
    'tier-label-apply.yml must not also trigger on pull_request -- that would reintroduce the P1 finding',
  );

  const jobs = objectField(workflow, 'jobs');
  const job = objectField(jobs, 'apply-tier-label');
  const steps = job.steps as Array<Record<string, unknown>>;

  assert.ok(
    !steps.some((s) => typeof s.uses === 'string' && (s.uses as string).startsWith('actions/checkout@')),
    'tier-label-apply.yml must not check out any ref -- it holds SYNC_BOT_TOKEN and must never execute PR-controlled code',
  );
  assert.doesNotMatch(
    raw,
    /pull_request\.head\.sha/,
    'tier-label-apply.yml must never reference pull_request.head.sha as a trust decision -- the only trusted PR identity here is github.event.workflow_run.pull_requests[0], which GitHub populates server-side',
  );

  const guardStep = steps.find(
    (s) => typeof s.name === 'string' && (s.name as string).includes('Require SYNC_BOT_TOKEN'),
  );
  assert.ok(guardStep, 'tier-label-apply.yml must fail closed if SYNC_BOT_TOKEN is not configured');
  assert.match(
    (guardStep as Record<string, unknown>).run as string,
    /secrets\.SYNC_BOT_TOKEN.*exit 1/s,
    'the SYNC_BOT_TOKEN guard must actually exit non-zero when the secret is unset',
  );

  const applyStep = steps.find(
    (s) => typeof s.name === 'string' && (s.name as string).includes('Validate plan and apply labels'),
  );
  assert.ok(applyStep, 'tier-label-apply.yml must have the label-apply step');
  const withBlock = objectField(applyStep as Record<string, unknown>, 'with');
  assert.strictEqual(
    withBlock['github-token'],
    '${{ secrets.SYNC_BOT_TOKEN }}',
    'label apply must use SYNC_BOT_TOKEN with no GITHUB_TOKEN fallback -- a fallback would silently reintroduce the non-cascading-event bug',
  );

  const script = withBlock.script as string;
  assert.match(script, /plan\.schema !== 'tier-label-plan\/v1'/, 'apply step must validate the artifact schema before trusting it');
  assert.match(
    script,
    /plan\.pr_number !== associatedPr\.number/,
    'apply step must cross-check the artifact PR number against workflow_run.pull_requests (server-populated, not PR-forgeable)',
  );
  assert.match(
    script,
    /plan\.head_sha !== associatedPr\.head\.sha/,
    'apply step must reject a label plan that is stale against the current PR head',
  );
  assert.match(
    script,
    /\/\^tier:T\[123\]\$\//,
    'apply step must re-validate every label against the strict tier-label allowlist independently of what the artifact claims',
  );
});

test('required pull-request gates are wired to executable blocking jobs', () => {
  const requiredGateJobs = [
    ['executor-result-validator.yml', 'validate', "${{ github.event_name == 'pull_request' && 'Executor Result Validation' || 'Executor Result Validation (ineligible event)' }}"],
    ['file-scope-lock-check.yml', 'check', 'File scope lock'],
    ['r-level-compliance-check.yml', 'r-level-compliance-check', 'R-Level Compliance Check'],
    ['return-review-packet.yml', 'return-review-packet', 'Return review packet'],
    // proof-auditor and runtime-verifier consolidated into proof-gate.yml (UTV2-1378)
    ['proof-gate.yml', 'proof-auditor', 'Proof Auditor Gate'],
    ['proof-gate.yml', 'runtime-verifier', 'Runtime Verifier Gate'],
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

test('WORK-2026100801: executor result publishes only from its native read-only PR definition', () => {
  const workflow = readWorkflowYaml('executor-result-validator.yml');
  const pullRequest = objectField(objectField(workflow, 'on'), 'pull_request');
  const jobs = objectField(workflow, 'jobs');
  const validate = objectField(jobs, 'validate');

  assert.ok(
    stringArrayField(pullRequest, 'types').includes('synchronize'),
    'executor-result-validator.yml must rerun on synchronize',
  );
  assert.strictEqual(
    validate.name,
    "${{ github.event_name == 'pull_request' && 'Executor Result Validation' || 'Executor Result Validation (ineligible event)' }}",
  );
  assert.strictEqual(stringField(validate, 'if'), "github.event_name == 'pull_request'");
  assert.strictEqual(jobs.refresh, undefined);
  assert.deepStrictEqual(Object.keys(objectField(workflow, 'on')), ['pull_request']);
  const raw = readWorkflow('executor-result-validator.yml');
  assert.doesNotMatch(raw, /github\.rest\.checks\.(create|update)/, 'validator must not fabricate required check runs');
  assert.doesNotMatch(raw, /actions:\s*write/);
  assert.match(raw, /core\.setFailed\(`Executor result validation failed:/, 'policy denial must fail the native job');
  assert.match(raw, /Executor Result Validation \(ineligible event\)/, 'skipped non-PR jobs must not carry the protected name');
});

test('WORK-2026100801: required evaluators and retry broker execute only trusted code', () => {
  const workflow = readWorkflowYaml('executor-result-validator.yml');
  const jobs = objectField(workflow, 'jobs');
  const job = objectField(jobs, 'validate');
  const steps = job.steps as Array<Record<string, unknown>>;

  const checkoutStep = steps.find(
    (s) => typeof s.uses === 'string' && (s.uses as string).startsWith('actions/checkout@'),
  );
  assert.ok(checkoutStep, 'executor-result-validator.yml must have a Checkout step');

  const withBlock = objectField(checkoutStep as Record<string, unknown>, 'with');
  const ref = withBlock.ref;
  assert.strictEqual(
    ref,
    '${{ github.event.pull_request.base.sha }}',
    'validation must execute the trusted PR base copy',
  );

  const mergeJobs = objectField(readWorkflowYaml('merge-gate.yml'), 'jobs');
  const gate = objectField(mergeJobs, 'gate');
  const gateCheckout = (gate.steps as Array<Record<string, unknown>>)
    .find((step) => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'));
  assert.ok(gateCheckout);
  assert.strictEqual(objectField(gateCheckout, 'with').ref, '${{ github.event.pull_request.base.sha }}');

  const refresh = objectField(objectField(readWorkflowYaml('required-check-refresh.yml'), 'jobs'), 'refresh');
  const refreshCheckout = (refresh.steps as Array<Record<string, unknown>>)
    .find((step) => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'));
  assert.ok(refreshCheckout);
  assert.strictEqual(
    objectField(refreshCheckout, 'with').ref,
    '${{ github.event.repository.default_branch }}',
    'privileged broker may execute only default-branch code',
  );

  const wfr = objectField(mergeJobs, 'wfr-validators');
  const wfrPermissions = objectField(wfr, 'permissions');
  assert.notStrictEqual(wfrPermissions.actions, 'write', 'supporting WFR validator must remain read-only');
  assert.notStrictEqual(wfrPermissions.checks, 'write', 'supporting WFR validator must not fabricate checks');
  const wfrSteps = wfr.steps as Array<Record<string, unknown>>;
  const wfrCheckout = wfrSteps.find((step) => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'));
  assert.ok(wfrCheckout, 'wfr-validators must checkout candidate metadata');
  assert.strictEqual(
    wfrCheckout.with,
    undefined,
    'WFR must preserve the read-only PR checkout so tier-sync can inspect the candidate lane manifest',
  );
});

test('UTV2-1573: executor-result-validator.yml paginates check-runs instead of a single unpaginated call', () => {
  const workflow = readWorkflow('executor-result-validator.yml');

  assert.match(
    workflow,
    /await github\.paginate\(github\.rest\.checks\.listForRef,\s*\{\s*\n\s*owner, repo, ref: headSha, per_page: 100/,
    'executor-result-validator.yml must fetch check-runs via github.paginate with per_page: 100, not a single-page checks.listForRef call',
  );
  assert.doesNotMatch(
    workflow,
    /const \{ data: checkRuns \} = await github\.rest\.checks\.listForRef/,
    'executor-result-validator.yml must not still contain the old unpaginated checks.listForRef call',
  );
  assert.match(
    workflow,
    /require\('\.\/scripts\/ops\/executor-result-check-selection\.cjs'\)/,
    'executor-result-validator.yml must select the verify check-run via the tested module, not inline .find() logic',
  );
  assert.doesNotMatch(
    workflow,
    /checkRuns\.check_runs\.find/,
    'executor-result-validator.yml must not still contain the old inline check-run selection',
  );
});

test('UTV2-1573: selectLatestVerifyCheckRun finds a valid run past the first page boundaries', async () => {
  const { selectLatestVerifyCheckRun } = await import('./executor-result-check-selection.cjs');

  const noise = (count: number, offset = 0) =>
    Array.from({ length: count }, (_, i) => ({
      id: offset + i,
      name: 'some-other-check',
      app: { slug: 'github-actions' },
      status: 'completed',
      conclusion: 'success',
    }));

  const verifyRun = { id: 9999, name: 'verify', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success' };

  // Past the API's 30-per-page default.
  assert.deepStrictEqual(selectLatestVerifyCheckRun([...noise(30), verifyRun]), verifyRun);
  // Past a naive 100-item cap -- the fix must not silently stop paginating at 100.
  assert.deepStrictEqual(selectLatestVerifyCheckRun([...noise(150), verifyRun]), verifyRun);
});

test('UTV2-1573: selectLatestVerifyCheckRun ignores a same-named check from a different app', async () => {
  const { selectLatestVerifyCheckRun } = await import('./executor-result-check-selection.cjs');

  const foreignVerify = { id: 5, name: 'verify', app: { slug: 'some-third-party-app' }, status: 'completed', conclusion: 'success' };
  const realVerify = { id: 3, name: 'verify', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success' };

  assert.deepStrictEqual(selectLatestVerifyCheckRun([foreignVerify, realVerify]), realVerify);
  assert.strictEqual(selectLatestVerifyCheckRun([foreignVerify]), null);
});

test('UTV2-1573: selectLatestVerifyCheckRun picks the newest of duplicate github-actions verify runs', async () => {
  const { selectLatestVerifyCheckRun } = await import('./executor-result-check-selection.cjs');

  const stale = { id: 100, name: 'verify', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'failure' };
  const rerun = { id: 200, name: 'verify', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success' };

  // Newest (highest id) governs regardless of insertion order.
  assert.deepStrictEqual(selectLatestVerifyCheckRun([rerun, stale]), rerun);
  assert.deepStrictEqual(selectLatestVerifyCheckRun([stale, rerun]), rerun);
});

test('UTV2-1573: selectLatestVerifyCheckRun fails closed -- missing, incomplete, or failed latest run is never silently bypassed', async () => {
  const { selectLatestVerifyCheckRun } = await import('./executor-result-check-selection.cjs');

  // Missing entirely.
  assert.strictEqual(selectLatestVerifyCheckRun([]), null);
  assert.strictEqual(selectLatestVerifyCheckRun([{ id: 1, name: 'lint', app: { slug: 'github-actions' } }]), null);

  // The newest matching run is incomplete -- callers must see THIS run (and
  // report "not completed"), not an older completed one.
  const olderSuccess = { id: 1, name: 'verify', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success' };
  const newerInProgress = { id: 2, name: 'verify', app: { slug: 'github-actions' }, status: 'in_progress', conclusion: null };
  assert.deepStrictEqual(selectLatestVerifyCheckRun([olderSuccess, newerInProgress]), newerInProgress);

  // The newest matching run failed -- callers must see THIS run (and report
  // the failure), not fall back to an older success.
  const newerFailed = { id: 3, name: 'verify', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'failure' };
  assert.deepStrictEqual(selectLatestVerifyCheckRun([olderSuccess, newerFailed]), newerFailed);
});

test('WORK-2026100501: refresh selection binds event, workflow, PR, and exact HEAD', async () => {
  const { selectEligibleRefreshRun } = await import('./executor-result-check-selection.cjs');
  const headSha = 'a'.repeat(40);
  const options = {
    workflowPath: '.github/workflows/merge-gate.yml',
    prNumber: 1715,
    headSha,
  };
  const eligible = {
    id: 20,
    event: 'pull_request',
    path: options.workflowPath,
    head_sha: headSha,
    status: 'completed',
    run_attempt: 1,
    pull_requests: [{ number: 1715, head: { sha: headSha } }],
  };
  const noise = [
    { ...eligible, id: 99, event: 'workflow_dispatch' },
    { ...eligible, id: 98, path: '.github/workflows/other.yml' },
    { ...eligible, id: 97, head_sha: 'b'.repeat(40) },
    { ...eligible, id: 96, pull_requests: [{ number: 1714, head: { sha: headSha } }] },
  ];
  assert.deepStrictEqual(selectEligibleRefreshRun([...noise, eligible], options), eligible);
});

test('WORK-2026100501: newest exact-head retry target wins and unavailable newest is not bypassed', async () => {
  const { selectEligibleRefreshRun } = await import('./executor-result-check-selection.cjs');
  const headSha = 'c'.repeat(40);
  const options = {
    workflowPath: '.github/workflows/executor-result-validator.yml',
    prNumber: 1720,
    headSha,
  };
  const run = (id: number, status: string, runAttempt: number) => ({
    id,
    event: 'pull_request',
    path: options.workflowPath,
    head_sha: headSha,
    status,
    run_attempt: runAttempt,
    pull_requests: [{ number: 1720, head: { sha: headSha } }],
  });
  const older = run(10, 'completed', 1);
  const newest = run(11, 'in_progress', 2);
  assert.deepStrictEqual(selectEligibleRefreshRun([older, newest], options), newest);
  assert.strictEqual(selectEligibleRefreshRun([{ ...older, head_sha: 'd'.repeat(40) }], options), null);
});

test('WORK-2026100801: literal refresh broker reruns only the exact eligible native run after a live-head recheck', async () => {
  const selection = await import('./executor-result-check-selection.cjs');
  const script = githubScriptStep(
    'required-check-refresh.yml',
    'refresh',
    'Resolve trusted signal and retry exact-head native run',
  );
  const headSha = 'a'.repeat(40);
  const listWorkflowRuns = async () => undefined;
  const reruns: number[] = [];
  let pullReads = 0;
  const github = {
    rest: {
      pulls: {
        get: async () => {
          pullReads += 1;
          return { data: {
            number: 1725,
            state: 'open',
            head: { sha: headSha, repo: { full_name: 'griff843/Unit-Talk-v2' } },
            base: { ref: 'main', repo: { full_name: 'griff843/Unit-Talk-v2' } },
          } };
        },
      },
      actions: {
        listWorkflowRuns,
        reRunWorkflow: async ({ run_id }: { run_id: number }) => { reruns.push(run_id); },
      },
    },
    paginate: async (endpoint: unknown, input: Record<string, unknown>) => {
      assert.strictEqual(endpoint, listWorkflowRuns);
      assert.strictEqual(input.event, 'pull_request');
      assert.strictEqual(input.head_sha, headSha);
      return [{
        id: 77,
        event: 'pull_request',
        path: '.github/workflows/executor-result-validator.yml',
        head_sha: headSha,
        status: 'completed',
        pull_requests: [{ number: 1725, head: { sha: headSha } }],
      }];
    },
  };
  await executeGithubScript(script, {
    github,
    context: {
      repo: { owner: 'griff843', repo: 'Unit-Talk-v2' },
      eventName: 'issue_comment',
      payload: {
        repository: { default_branch: 'main' },
        issue: { number: 1725, pull_request: { url: 'https://api.example.test/pulls/1725' } },
        comment: { body: 'EXECUTOR_RESULT: READY_FOR_REVIEW' },
      },
    },
    core: { info: () => undefined },
    require: (specifier: string) => {
      assert.strictEqual(specifier, './scripts/ops/executor-result-check-selection.cjs');
      return selection;
    },
  });
  assert.strictEqual(pullReads, 2);
  assert.deepStrictEqual(reruns, [77]);
});

test('WORK-2026100801: review workflow_run resolves an empty PR list through exact commit association', async () => {
  const selection = await import('./executor-result-check-selection.cjs');
  const script = githubScriptStep(
    'required-check-refresh.yml',
    'refresh',
    'Resolve trusted signal and retry exact-head native run',
  );
  const headSha = 'd'.repeat(40);
  const runId = 9001;
  const listAssociated = async () => undefined;
  const listRuns = async () => undefined;
  const reruns: number[] = [];
  const repository = 'griff843/Unit-Talk-v2';
  const pull = {
    number: 1726,
    state: 'open',
    head: { sha: headSha, repo: { full_name: repository } },
    base: { ref: 'main', repo: { full_name: repository } },
  };
  await executeGithubScript(script, {
    github: {
      rest: {
        pulls: { get: async () => ({ data: pull }) },
        repos: { listPullRequestsAssociatedWithCommit: listAssociated },
        actions: {
          getWorkflowRun: async () => ({ data: {
            id: runId,
            name: 'Merge Gate',
            path: '.github/workflows/merge-gate.yml',
            event: 'pull_request_review',
            status: 'completed',
            conclusion: 'failure',
            head_sha: headSha,
            repository: { full_name: repository },
            head_repository: { full_name: repository },
            pull_requests: [],
          } }),
          listWorkflowRuns: listRuns,
          reRunWorkflow: async ({ run_id }: { run_id: number }) => { reruns.push(run_id); },
        },
      },
      paginate: async (endpoint: unknown) => {
        if (endpoint === listAssociated) return [pull];
        assert.strictEqual(endpoint, listRuns);
        return [{
          id: 88,
          event: 'pull_request',
          path: '.github/workflows/merge-gate.yml',
          head_sha: headSha,
          status: 'completed',
          pull_requests: [{ number: 1726, head: { sha: headSha } }],
        }];
      },
    },
    context: {
      repo: { owner: 'griff843', repo: 'Unit-Talk-v2' },
      eventName: 'workflow_run',
      payload: {
        repository: { default_branch: 'main' },
        workflow_run: { id: runId, head_sha: headSha, path: '.github/workflows/merge-gate.yml' },
      },
    },
    core: { info: () => undefined },
    require: () => selection,
  });
  assert.deepStrictEqual(reruns, [88]);
});

test('WORK-2026100801: literal refresh broker refuses head movement before mutation', async () => {
  const selection = await import('./executor-result-check-selection.cjs');
  const script = githubScriptStep(
    'required-check-refresh.yml',
    'refresh',
    'Resolve trusted signal and retry exact-head native run',
  );
  const original = 'b'.repeat(40);
  let reads = 0;
  let mutated = false;
  await assert.rejects(
    executeGithubScript(script, {
      github: {
        rest: {
          pulls: { get: async () => ({ data: {
            state: 'open',
            head: { sha: reads++ === 0 ? original : 'c'.repeat(40), repo: { full_name: 'griff843/Unit-Talk-v2' } },
            base: { ref: 'main', repo: { full_name: 'griff843/Unit-Talk-v2' } },
          } }) },
          actions: {
            listWorkflowRuns: async () => undefined,
            reRunWorkflow: async () => { mutated = true; },
          },
        },
        paginate: async () => [{
          id: 78,
          event: 'pull_request',
          path: '.github/workflows/merge-gate.yml',
          head_sha: original,
          status: 'completed',
          pull_requests: [{ number: 1725, head: { sha: original } }],
        }],
      },
      context: {
        repo: { owner: 'griff843', repo: 'Unit-Talk-v2' },
        eventName: 'issue_comment',
        payload: {
          repository: { default_branch: 'main' },
          issue: { number: 1725, pull_request: {} },
          comment: { body: 'PM_VERDICT: APPROVED' },
        },
      },
      core: { info: () => undefined },
      require: () => selection,
    }),
    /PR identity changed.*refusing stale refresh/,
  );
  assert.strictEqual(mutated, false);
});

test('WORK-2026100801 rework: literal broker refuses every target and final-identity mismatch without rerun', async () => {
  const selection = await import('./executor-result-check-selection.cjs');
  const script = githubScriptStep(
    'required-check-refresh.yml',
    'refresh',
    'Resolve trusted signal and retry exact-head native run',
  );
  const repository = 'griff843/Unit-Talk-v2';
  const headSha = '9'.repeat(40);
  const basePull = {
    number: 1725,
    state: 'open',
    head: { sha: headSha, repo: { full_name: repository } },
    base: { ref: 'main', repo: { full_name: repository } },
  };
  const baseRun = {
    id: 9001,
    name: 'CI',
    path: '.github/workflows/ci.yml',
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    head_sha: headSha,
    repository: { full_name: repository },
    head_repository: { full_name: repository },
    pull_requests: [{ ...basePull }],
  };
  const eligibleTarget = {
    id: 77,
    event: 'pull_request',
    path: '.github/workflows/executor-result-validator.yml',
    head_sha: headSha,
    status: 'completed',
    run_attempt: 1,
    pull_requests: [{ number: 1725, head: { sha: headSha } }],
  };

  const cases: Array<{
    name: string;
    eventName?: string;
    payload?: Record<string, unknown>;
    run?: Record<string, unknown>;
    initialPull?: typeof basePull;
    finalPull?: typeof basePull;
    target?: Record<string, unknown>;
  }> = [
    { name: 'wrong source repository', run: { ...baseRun, repository: { full_name: 'evil/fork' } } },
    { name: 'wrong source workflow', run: { ...baseRun, name: 'Untrusted Workflow' } },
    { name: 'wrong source event', run: { ...baseRun, event: 'workflow_dispatch' } },
    { name: 'source head differs from live head', run: { ...baseRun, head_sha: '8'.repeat(40) } },
    { name: 'incomplete source workflow', run: { ...baseRun, status: 'in_progress' } },
    { name: 'wrong head repository', initialPull: { ...basePull, head: { ...basePull.head, repo: { full_name: 'evil/fork' } } } },
    { name: 'wrong base repository', initialPull: { ...basePull, base: { ...basePull.base, repo: { full_name: 'evil/fork' } } } },
    { name: 'wrong base branch', initialPull: { ...basePull, base: { ...basePull.base, ref: 'feature-untrusted-base' } } },
    { name: 'newest target incomplete', target: { ...eligibleTarget, status: 'in_progress', run_attempt: 2 } },
    {
      name: 'malformed manual target',
      eventName: 'repository_dispatch',
      payload: { action: 'required-check-refresh', client_payload: { pr_number: 1725, target: 'unknown' } },
    },
    { name: 'final PR closed', finalPull: { ...basePull, state: 'closed' } },
    { name: 'final base drift', finalPull: { ...basePull, base: { ...basePull.base, ref: 'feature-untrusted-base' } } },
    { name: 'final repository drift', finalPull: { ...basePull, head: { ...basePull.head, repo: { full_name: 'evil/fork' } } } },
    { name: 'final head drift', finalPull: { ...basePull, head: { ...basePull.head, sha: '7'.repeat(40) } } },
  ];

  for (const fixture of cases) {
    const reruns: number[] = [];
    let pullReads = 0;
    const eventName = fixture.eventName ?? 'workflow_run';
    const payload = {
      repository: { default_branch: 'main' },
      ...(fixture.payload ?? {
        workflow_run: { id: 9001, head_sha: headSha, path: '.github/workflows/ci.yml' },
      }),
    };
    await assert.rejects(
      executeGithubScript(script, {
        github: {
          rest: {
            pulls: {
              get: async () => ({
                data: pullReads++ === 0
                  ? (fixture.initialPull ?? basePull)
                  : (fixture.finalPull ?? fixture.initialPull ?? basePull),
              }),
            },
            repos: { listPullRequestsAssociatedWithCommit: async () => undefined },
            actions: {
              getWorkflowRun: async () => ({ data: fixture.run ?? baseRun }),
              listWorkflowRuns: async () => undefined,
              reRunWorkflow: async ({ run_id }: { run_id: number }) => { reruns.push(run_id); },
            },
          },
          paginate: async () => [fixture.target ?? eligibleTarget],
        },
        context: { repo: { owner: 'griff843', repo: 'Unit-Talk-v2' }, eventName, payload },
        core: { info: () => undefined },
        require: () => selection,
      }),
      undefined,
      fixture.name,
    );
    assert.deepStrictEqual(reruns, [], fixture.name);
  }
});

test('codex return review extracts issue IDs without sed delimiter traps', () => {
  const workflow = readWorkflow('codex-return-review.yml');

  assert.match(
    workflow,
    /grep -oiE 'utv2-\[0-9\]\+'/,
    'codex-return-review.yml must extract issue IDs with grep instead of a sed expression that conflicts with pipe delimiters',
  );
  assert.doesNotMatch(
    workflow,
    /sed -nE 's\|codex\/\(utv2\|UTV2\)-/,
    'codex-return-review.yml must not use the broken pipe-delimited sed alternation',
  );
});

test('review and tier workflows accept repository-owned WORK identities', () => {
  for (const workflowName of ['return-review-packet.yml', 'tier-classifier-advisory.yml']) {
    const workflow = readWorkflow(workflowName);
    assert.match(
      workflow,
      /work\|WORK/u,
      `${workflowName} must recognize WORK-### identities alongside tracker IDs`,
    );
    assert.match(
      workflow,
      /tr '\[:lower:\]' '\[:upper:\]'/u,
      `${workflowName} must normalize the captured identity before manifest lookup`,
    );
  }
});

test('proof and runtime gates watch proof, lane, and ops control-plane paths', () => {
  // proof-gate.yml (UTV2-1378) triggers on all PRs (no path filter); the detect job
  // checks path changes at runtime and gates downstream jobs. Verify the detect job
  // step content references the required paths.
  const workflow = readWorkflowYaml('proof-gate.yml');
  const pullRequest = objectField(objectField(workflow, 'on'), 'pull_request');
  assert.ok(pullRequest !== undefined, 'proof-gate.yml must have pull_request trigger');

  const jobs = objectField(workflow, 'jobs');
  const detectJob = objectField(jobs, 'detect');
  assert.ok(Array.isArray(detectJob.steps), 'detect job must have steps');

  const detectScript = JSON.stringify(detectJob.steps);
  assert.ok(detectScript.includes('docs/06_status/proof'), 'detect job must check proof paths');
  assert.ok(detectScript.includes('docs/06_status/lanes'), 'detect job must check lane manifest paths');
  assert.ok(detectScript.includes('scripts/ops'), 'detect job must check ops control-plane paths');
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
  assert.match(stringField(concurrency, 'group'), /github\.sha/, 'distinct main merge SHAs must not cancel each other');
  assert.doesNotMatch(stringField(concurrency, 'group'), /github\.ref/, 'all main pushes must not share one cancellation key');
  assert.strictEqual(concurrency['cancel-in-progress'], true);
});

test('WORK-2026100701: protected-main CI does not suppress metadata-only merge proof producers', () => {
  const push = objectField(objectField(readWorkflowYaml('ci.yml'), 'on'), 'push');
  assert.deepStrictEqual(stringArrayField(push, 'branches'), ['main']);
  assert.strictEqual(push['paths-ignore'], undefined, 'main pushes must always produce exact-SHA T1 receipts');
  assert.strictEqual(push.paths, undefined, 'main proof production must not be narrowed by an allowlist');
});

test('WORK-2026100701: recovery is default-branch-controlled and isolates write authority', () => {
  const workflow = readWorkflowYaml('merge-proof-recovery.yml');
  const events = objectField(workflow, 'on');
  assert.strictEqual(events.workflow_dispatch, undefined, 'branch-selectable workflow_dispatch is not trusted');
  assert.deepStrictEqual(stringArrayField(objectField(events, 'repository_dispatch'), 'types'), [
    'merge-proof-recovery',
  ]);

  const jobs = objectField(workflow, 'jobs');
  const resolve = objectField(jobs, 'resolve');
  const staging = objectField(jobs, 'staging-db-proof');
  const verify = objectField(jobs, 'verify');
  const publish = objectField(jobs, 'publish');
  assert.strictEqual(staging.environment, 'staging-ci');
  assert.strictEqual(objectField(staging, 'permissions').contents, 'read');
  assert.strictEqual(objectField(publish, 'permissions').checks, 'write');
  assert.notStrictEqual(objectField(resolve, 'permissions').checks, 'write');
  assert.notStrictEqual(objectField(verify, 'permissions').checks, 'write');
  assert.strictEqual(publish.environment, undefined, 'check publisher must not enter a secret-bearing environment');
  const publishSteps = JSON.stringify(publish.steps);
  assert.doesNotMatch(publishSteps, /secrets\.|CI_SUPABASE|SUPABASE_SERVICE_ROLE_KEY/);
  const publisherCheckout = (publish.steps as Array<Record<string, unknown>>)
    .find((step) => step.uses === 'actions/checkout@v4');
  assert.ok(publisherCheckout);
  assert.strictEqual(
    (publisherCheckout.with as Record<string, unknown>).ref,
    '${{ needs.resolve.outputs.execution_sha }}',
    'publisher may check out only the trusted workflow source, never target code',
  );

  const raw = readWorkflow('merge-proof-recovery.yml');
  assert.match(raw, /repository_dispatch always loads the workflow definition/);
  assert.doesNotMatch(raw, /PRODUCTION|zfzdnfwdarxucxtaojxm/, 'recovery must not reference production credentials or project');
  assert.match(raw, /CI_SUPABASE_PROJECT_REF.*xskgrzbteyqdufktjrjx/s);
});

test('WORK-2026100701: recovery validates the real merged target through GitHub APIs', () => {
  const workflow = readWorkflow('merge-proof-recovery.yml');
  assert.match(workflow, /github\.rest\.git\.getRef/);
  assert.match(workflow, /github\.rest\.pulls\.get/);
  assert.match(workflow, /github\.paginate\(github\.rest\.pulls\.listFiles/);
  assert.match(workflow, /github\.rest\.repos\.compareCommitsWithBasehead/);
  assert.match(workflow, /context\.payload\.client_payload\?\.pr_number/);
  assert.match(workflow, /validateDispatchContext/);
  assert.match(workflow, /validatePullTarget/);
  assert.match(workflow, /validateReachability/);
});

test('WORK-2026100701: both native proof jobs check out and attest the exact merge SHA', () => {
  const workflow = readWorkflow('merge-proof-recovery.yml');
  const exactRefs = workflow.match(/ref: \$\{\{ needs\.resolve\.outputs\.merge_sha \}\}/g) ?? [];
  const checkoutAssertions = workflow.match(/tested_sha=\$\(git rev-parse HEAD\)/g) ?? [];
  const provenanceAssertions = workflow.match(/test "\$GITHUB_SHA" = "\$EXECUTION_SHA"/g) ?? [];
  assert.strictEqual(exactRefs.length, 2);
  assert.strictEqual(checkoutAssertions.length, 2);
  assert.strictEqual(provenanceAssertions.length, 2);
  assert.doesNotMatch(workflow, /GITHUB_SHA=/, 'execution provenance must never be spoofed');
  assert.match(workflow, /pnpm verify:static/);
  assert.match(workflow, /pnpm test:t1-proof:live/);
  assert.match(workflow, /verify-db-proof-receipt\.ts/);
});

test('WORK-2026100701: publisher reads native jobs and reports exact G6 identities', () => {
  const workflow = readWorkflow('merge-proof-recovery.yml');
  assert.match(workflow, /github\.paginate\(github\.rest\.actions\.listJobsForWorkflowRun/);
  assert.match(workflow, /github\.rest\.actions\.getWorkflowRun/);
  assert.match(workflow, /buildPublishedProofResults/);
  assert.match(workflow, /github\.rest\.checks\.create/);
  assert.match(workflow, /github\.rest\.checks\.update/);
  assert.match(workflow, /head_sha: result\.targetSha/);
  assert.match(workflow, /Trusted workflow source SHA:/);
  assert.match(workflow, /Tested merge SHA:/);
  assert.match(workflow, /runAttempt/);
  assert.match(workflow, /currentTarget\.mergeSha !== process\.env\.TARGET_MERGE_SHA/);
  assert.match(workflow, /core\.setFailed\(`Recovery proof refused:/);
});

test('WORK-2026100701: target validation accepts only a merged default-branch PR reachable from main', async () => {
  const recovery = await import('./merge-proof-recovery.cjs');
  const mergeSha = 'a'.repeat(40);
  const mainSha = 'b'.repeat(40);
  const execution = recovery.validateDispatchContext({
    eventName: 'repository_dispatch',
    action: 'merge-proof-recovery',
    repository: 'griff843/Unit-Talk-v2',
    defaultBranch: 'main',
    ref: 'refs/heads/main',
    executionSha: mainSha,
    defaultHeadSha: mainSha,
  });
  const target = recovery.validatePullTarget({
    requestedPrNumber: 1720,
    repository: 'griff843/Unit-Talk-v2',
    defaultBranch: 'main',
    pull: {
      number: 1720,
      state: 'closed',
      merged: true,
      merged_at: '2026-10-07T00:00:00Z',
      merge_commit_sha: mergeSha,
      base: { ref: 'main', repo: { full_name: 'griff843/Unit-Talk-v2' } },
      head: { repo: { full_name: 'griff843/Unit-Talk-v2' } },
      changed_files: 11,
    },
    files: [
      { filename: '.ops/sync/WORK-2026100602.yml', status: 'added' },
      { filename: 'docs/06_status/lanes/WORK-2026100602.json', status: 'added' },
      { filename: 'docs/06_status/proof/WORK-2026100501/evidence.json', status: 'removed' },
      { filename: 'docs/06_status/proof/WORK-2026100602/diff-summary.md', status: 'added' },
      { filename: 'docs/06_status/proof/WORK-2026100602/evidence.json', status: 'added' },
      { filename: 'docs/06_status/proof/WORK-2026100602/executor-attempt-2-result.json', status: 'added' },
      { filename: 'docs/06_status/proof/WORK-2026100602/executor-attempt-3-result.json', status: 'added' },
      { filename: 'docs/06_status/proof/WORK-2026100602/executor-attempt-4-result.json', status: 'added' },
      { filename: 'docs/06_status/proof/WORK-2026100602/executor-epoch-f5a158c6-completed.json', status: 'added' },
      { filename: 'docs/06_status/proof/WORK-2026100602/model-routing.json', status: 'added' },
      { filename: 'docs/06_status/proof/WORK-2026100602/verification.md', status: 'added' },
    ],
  });
  recovery.validateReachability({
    mergeSha: target.mergeSha,
    defaultHeadSha: execution.defaultHeadSha,
    comparison: {
      status: 'ahead',
      base_commit: { sha: mergeSha },
      merge_base_commit: { sha: mergeSha },
      commits: [{ sha: mainSha }],
    },
  });
  assert.strictEqual(target.mergeSha, mergeSha);
});

test('WORK-2026100701: target validation refuses stale definitions, altered targets, open PRs, and wrong bases', async () => {
  const recovery = await import('./merge-proof-recovery.cjs');
  const sha = 'c'.repeat(40);
  const base = {
    eventName: 'repository_dispatch',
    action: 'merge-proof-recovery',
    repository: 'griff843/Unit-Talk-v2',
    defaultBranch: 'main',
    ref: 'refs/heads/main',
    executionSha: sha,
    defaultHeadSha: sha,
  };
  assert.throws(() => recovery.validateDispatchContext({ ...base, ref: 'refs/heads/feature' }), /untrusted_workflow_ref/);
  assert.throws(() => recovery.validateDispatchContext({ ...base, defaultHeadSha: 'd'.repeat(40) }), /stale_workflow_definition/);

  const pull = {
    number: 1720,
    state: 'closed',
    merged: true,
    merged_at: '2026-10-07T00:00:00Z',
    merge_commit_sha: sha,
    base: { ref: 'main', repo: { full_name: 'griff843/Unit-Talk-v2' } },
    head: { repo: { full_name: 'griff843/Unit-Talk-v2' } },
    changed_files: 1,
  };
  const pullInput = {
    requestedPrNumber: 1720,
    repository: 'griff843/Unit-Talk-v2',
    defaultBranch: 'main',
    pull,
    files: [{ filename: 'docs/06_status/proof/WORK-2026100602/verification.md', status: 'added' }],
  };
  assert.throws(() => recovery.validatePullTarget({ ...pullInput, pull: { ...pull, state: 'open', merged: false } }), /unmerged_pull/);
  assert.throws(
    () => recovery.validatePullTarget({ ...pullInput, pull: { ...pull, base: { ...pull.base, ref: 'release' } } }),
    /wrong_pull_base/,
  );
  assert.throws(
    () => recovery.validatePullTarget({ ...pullInput, pull: { ...pull, head: { repo: { full_name: 'fork/Unit-Talk-v2' } } } }),
    /wrong_pull_head/,
  );
  assert.throws(
    () => recovery.validateReachability({
      mergeSha: sha,
      defaultHeadSha: 'e'.repeat(40),
      comparison: { status: 'diverged', merge_base_commit: { sha: 'f'.repeat(40) } },
    }),
    /merge_not_reachable/,
  );
  assert.throws(
    () => recovery.validateReachability({
      mergeSha: sha,
      defaultHeadSha: 'e'.repeat(40),
      comparison: { status: 'ahead', base_commit: { sha }, merge_base_commit: { sha: 'f'.repeat(40) } },
    }),
    /merge_base_mismatch/,
  );
});

test('WORK-2026100701: metadata-only admission rejects code, unsafe renames, and incomplete file APIs', async () => {
  const recovery = await import('./merge-proof-recovery.cjs');
  assert.deepStrictEqual(
    recovery.validateMetadataOnlyFiles({
      changedFileCount: 3,
      files: [
        { filename: '.ops/sync/WORK-2026100602.yml', status: 'modified' },
        { filename: 'docs/06_status/lanes/WORK-2026100602.json', status: 'modified' },
        { filename: 'docs/06_status/proof/WORK-2026100602/verification.md', status: 'modified' },
      ],
    }).changedFileCount,
    3,
  );
  assert.throws(
    () => recovery.validateMetadataOnlyFiles({ changedFileCount: 1, files: [{ filename: 'apps/api/src/index.ts' }] }),
    /non_metadata_change/,
  );
  assert.throws(
    () => recovery.validateMetadataOnlyFiles({
      changedFileCount: 1,
      files: [{
        filename: 'docs/06_status/proof/WORK-2026100602/runtime.ts',
        previous_filename: 'packages/domain/src/scoring.ts',
        status: 'renamed',
      }],
    }),
    /non_metadata_rename_source/,
  );
  assert.throws(
    () => recovery.validateMetadataOnlyFiles({ changedFileCount: 2, files: [{ filename: '.ops/sync/one.yml' }] }),
    /incomplete_pull_files/,
  );
  assert.throws(() => recovery.validateMetadataOnlyFiles({ changedFileCount: 1, files: [] }), /unreadable_pull_files/);
  assert.throws(() => recovery.validateMetadataOnlyFiles({ changedFileCount: 1, files: [{}] }), /non_metadata_change/);
});

test('WORK-2026100701: literal resolver script paginates and validates the GitHub API target', async () => {
  const recovery = await import('./merge-proof-recovery.cjs');
  const script = githubScriptStep(
    'merge-proof-recovery.yml',
    'resolve',
    'Resolve and validate merged PR target',
  );
  const executionSha = '6'.repeat(40);
  const mergeSha = '7'.repeat(40);
  const files = [{ filename: 'docs/06_status/proof/WORK-2026100602/verification.md', status: 'modified' }];
  const pull = {
    number: 1720,
    state: 'closed',
    merged: true,
    merged_at: '2026-10-07T18:30:05Z',
    merge_commit_sha: mergeSha,
    changed_files: files.length,
    base: { ref: 'main', repo: { full_name: 'griff843/Unit-Talk-v2' } },
    head: { repo: { full_name: 'griff843/Unit-Talk-v2' } },
  };
  const listFiles = async () => undefined;
  const calls: string[] = [];
  const outputs = new Map<string, string>();
  const github = {
    rest: {
      git: { getRef: async (input: Record<string, unknown>) => {
        assert.strictEqual(input.ref, 'heads/main');
        calls.push('getRef');
        return { data: { object: { sha: executionSha } } };
      } },
      pulls: {
        get: async (input: Record<string, unknown>) => {
          assert.strictEqual(input.pull_number, 1720);
          calls.push('pulls.get');
          return { data: pull };
        },
        listFiles,
      },
      repos: {
        compareCommitsWithBasehead: async (input: Record<string, unknown>) => {
          assert.strictEqual(input.basehead, `${mergeSha}...${executionSha}`);
          calls.push('compare');
          return { data: { status: 'ahead', base_commit: { sha: mergeSha }, merge_base_commit: { sha: mergeSha }, commits: [{ sha: executionSha }] } };
        },
      },
    },
    paginate: async (endpoint: unknown, input: Record<string, unknown>) => {
      assert.strictEqual(endpoint, listFiles);
      assert.strictEqual(input.pull_number, 1720);
      assert.strictEqual(input.per_page, 100);
      calls.push('pulls.listFiles');
      return files;
    },
  };
  await executeGithubScript(script, {
    github,
    context: {
      repo: { owner: 'griff843', repo: 'Unit-Talk-v2' },
      payload: { action: 'merge-proof-recovery', client_payload: { pr_number: 1720 }, repository: { default_branch: 'main' } },
      eventName: 'repository_dispatch',
      ref: 'refs/heads/main',
      sha: executionSha,
    },
    core: { setOutput: (key: string, value: string) => outputs.set(key, value), notice: () => undefined },
    require: (specifier: string) => {
      assert.strictEqual(specifier, './scripts/ops/merge-proof-recovery.cjs');
      return recovery;
    },
  });
  assert.deepStrictEqual(calls, ['getRef', 'pulls.get', 'pulls.listFiles', 'compare']);
  assert.strictEqual(outputs.get('merge_sha'), mergeSha);
  assert.strictEqual(outputs.get('changed_file_count'), '1');
});

test('WORK-2026100701: only complete successful native jobs bound to the target publish success', async () => {
  const recovery = await import('./merge-proof-recovery.cjs');
  const executionSha = '1'.repeat(40);
  const targetSha = '2'.repeat(40);
  const runId = 1234;
  const jobs = [
    {
      id: 10,
      run_id: runId,
      run_attempt: 2,
      head_sha: executionSha,
      name: recovery.NATIVE_JOB_NAMES.staging,
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://example.test/staging',
    },
    {
      id: 11,
      run_id: runId,
      run_attempt: 2,
      head_sha: executionSha,
      name: recovery.NATIVE_JOB_NAMES.verify,
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://example.test/verify',
    },
  ];
  const results = recovery.buildPublishedProofResults({
    jobs,
    runId,
    runAttempt: 2,
    runUrl: 'https://example.test/run',
    executionSha,
    targetSha,
    declaredResults: { staging: 'success', verify: 'success' },
    testedShas: { staging: targetSha, verify: targetSha },
  });
  assert.deepStrictEqual(results.map((result: { context: string }) => result.context), [
    'Writable DB proof (staging only)',
    'verify',
  ]);
  assert.ok(results.every((result: { succeeded: boolean; conclusion: string }) => result.succeeded && result.conclusion === 'success'));
  assert.ok(results.every((result: { executionSha: string; targetSha: string }) => result.executionSha !== result.targetSha));
});

test('WORK-2026100701: skipped, failing, incomplete, missing, or mismatched native proof never publishes success', async () => {
  const recovery = await import('./merge-proof-recovery.cjs');
  const executionSha = '3'.repeat(40);
  const targetSha = '4'.repeat(40);
  const runId = 2222;
  const native = (key: 'staging' | 'verify', id: number, status: string, conclusion: string | null) => ({
    id,
    run_id: runId,
    run_attempt: 3,
    head_sha: executionSha,
    name: recovery.NATIVE_JOB_NAMES[key],
    status,
    conclusion,
  });
  const cases = [
    { jobs: [native('staging', 1, 'completed', 'failure'), native('verify', 2, 'completed', 'success')] },
    { jobs: [native('staging', 1, 'completed', 'success'), native('verify', 2, 'in_progress', null)] },
    { jobs: [native('staging', 1, 'completed', 'success')] },
    { jobs: [native('staging', 1, 'completed', 'skipped'), native('verify', 2, 'completed', 'success')] },
  ];
  for (const fixture of cases) {
    const results = recovery.buildPublishedProofResults({
      ...fixture,
      runId,
      runAttempt: 3,
      runUrl: 'https://example.test/run',
      executionSha,
      targetSha,
      declaredResults: { staging: 'success', verify: 'success' },
      testedShas: { staging: targetSha, verify: targetSha },
    });
    assert.ok(results.some((result: { succeeded: boolean }) => !result.succeeded));
    assert.ok(results.filter((result: { succeeded: boolean }) => !result.succeeded)
      .every((result: { conclusion: string }) => result.conclusion === 'failure'));
  }

  const staleAttempt = recovery.buildPublishedProofResults({
    jobs: [
      { ...native('staging', 1, 'completed', 'success'), run_attempt: 2 },
      native('verify', 2, 'completed', 'success'),
    ],
    runId,
    runAttempt: 3,
    runUrl: 'https://example.test/run',
    executionSha,
    targetSha,
    declaredResults: { staging: 'success', verify: 'success' },
    testedShas: { staging: targetSha, verify: targetSha },
  });
  assert.strictEqual(staleAttempt.find((result: { key: string }) => result.key === 'staging')?.conclusion, 'failure');

  const mismatch = recovery.buildPublishedProofResults({
    jobs: [native('staging', 1, 'completed', 'success'), native('verify', 2, 'completed', 'success')],
    runId,
    runAttempt: 3,
    runUrl: 'https://example.test/run',
    executionSha,
    targetSha,
    declaredResults: { staging: 'success', verify: 'success' },
    testedShas: { staging: targetSha, verify: '5'.repeat(40) },
  });
  assert.strictEqual(mismatch.find((result: { key: string }) => result.key === 'verify')?.succeeded, false);
  assert.match(mismatch.find((result: { key: string }) => result.key === 'verify')?.reason ?? '', /tested/);
});

test('WORK-2026100701: literal publisher script revalidates APIs and writes success only to the tested merge SHA', async () => {
  const recovery = await import('./merge-proof-recovery.cjs');
  const script = githubScriptStep(
    'merge-proof-recovery.yml',
    'publish',
    'Report native proof outcomes on the tested merge SHA',
  );
  const executionSha = '8'.repeat(40);
  const targetSha = '9'.repeat(40);
  const runId = 3210;
  const runAttempt = 4;
  const listFiles = async () => undefined;
  const listJobs = async () => undefined;
  const files = [{ filename: 'docs/06_status/proof/WORK-2026100602/verification.md', status: 'modified' }];
  const pull = {
    number: 1720,
    state: 'closed',
    merged: true,
    merged_at: '2026-10-07T18:30:05Z',
    merge_commit_sha: targetSha,
    changed_files: 1,
    base: { ref: 'main', repo: { full_name: 'griff843/Unit-Talk-v2' } },
    head: { repo: { full_name: 'griff843/Unit-Talk-v2' } },
  };
  const native = (key: 'staging' | 'verify', id: number) => ({
    id,
    run_id: runId,
    run_attempt: runAttempt,
    head_sha: executionSha,
    name: recovery.NATIVE_JOB_NAMES[key],
    status: 'completed',
    conclusion: 'success',
    html_url: `https://example.test/jobs/${id}`,
  });
  let observedMutations = 0;

  async function runPublisher(options: {
    jobs?: Array<Record<string, unknown>>;
    pullOverride?: Record<string, unknown>;
    runOverride?: Record<string, unknown>;
    envOverride?: Record<string, string>;
  } = {}) {
    const createCalls: Array<Record<string, unknown>> = [];
    const updateCalls: Array<Record<string, unknown>> = [];
    const failures: string[] = [];
    const apiCalls: string[] = [];
    let nextCheckId = 100;
    const jobs = options.jobs ?? [native('staging', 10), native('verify', 11)];
    let mutationCount = 0;
    const github = {
      rest: {
        actions: {
          getWorkflowRun: async (input: Record<string, unknown>) => {
            assert.strictEqual(input.run_id, runId);
            apiCalls.push('actions.getWorkflowRun');
            return { data: {
              id: runId,
              run_attempt: runAttempt,
              event: 'repository_dispatch',
              path: '.github/workflows/merge-proof-recovery.yml',
              repository: { full_name: 'griff843/Unit-Talk-v2' },
              head_repository: { full_name: 'griff843/Unit-Talk-v2' },
              head_branch: 'main',
              head_sha: executionSha,
              status: 'in_progress',
              ...options.runOverride,
            } };
          },
          listJobsForWorkflowRun: listJobs,
        },
        pulls: {
          get: async (input: Record<string, unknown>) => {
            assert.strictEqual(input.pull_number, 1720);
            apiCalls.push('pulls.get');
            return { data: { ...pull, ...options.pullOverride } };
          },
          listFiles,
        },
        checks: {
          create: async (input: Record<string, unknown>) => {
            mutationCount += 1;
            observedMutations += 1;
            apiCalls.push('checks.create');
            createCalls.push(input);
            return { data: { id: nextCheckId++ } };
          },
          update: async (input: Record<string, unknown>) => {
            mutationCount += 1;
            observedMutations += 1;
            apiCalls.push('checks.update');
            updateCalls.push(input);
            return { data: input };
          },
        },
      },
      paginate: async (endpoint: unknown, input: Record<string, unknown>) => {
        if (endpoint === listFiles) {
          assert.strictEqual(input.pull_number, 1720);
          assert.strictEqual(input.per_page, 100);
          apiCalls.push('pulls.listFiles');
          return files;
        }
        assert.strictEqual(endpoint, listJobs);
        assert.strictEqual(input.run_id, runId);
        assert.strictEqual(input.filter, 'latest');
        apiCalls.push('actions.listJobsForWorkflowRun');
        return jobs;
      },
    };
    await executeGithubScript(script, {
      github,
      context: {
        repo: { owner: 'griff843', repo: 'Unit-Talk-v2' },
        payload: { repository: { default_branch: 'main' } },
        runId,
        serverUrl: 'https://github.com',
      },
      core: { setFailed: (message: string) => failures.push(message) },
      process: { env: {
        TARGET_MERGE_SHA: targetSha,
        EXECUTION_SHA: executionSha,
        RECOVERY_PR_NUMBER: '1720',
        RESOLVED_CHANGED_FILE_COUNT: '1',
        RUN_ATTEMPT: String(runAttempt),
        STAGING_RESULT: 'success',
        STAGING_TESTED_SHA: targetSha,
        VERIFY_RESULT: 'success',
        VERIFY_TESTED_SHA: targetSha,
        ...options.envOverride,
      } },
      require: (specifier: string) => {
        assert.strictEqual(specifier, './scripts/ops/merge-proof-recovery.cjs');
        return recovery;
      },
    });
    return { apiCalls, createCalls, updateCalls, failures, mutationCount };
  }

  const success = await runPublisher();
  assert.deepStrictEqual(success.apiCalls.slice(0, 4), [
    'actions.getWorkflowRun',
    'pulls.get',
    'pulls.listFiles',
    'actions.listJobsForWorkflowRun',
  ]);
  assert.strictEqual(success.createCalls.length, 2);
  assert.ok(success.createCalls.every((call) => call.head_sha === targetSha));
  assert.ok(success.updateCalls.every((call) => call.conclusion === 'success'));
  assert.ok(success.createCalls.every((call) => String(call.external_id).includes(`:${runAttempt}:`)));
  assert.deepStrictEqual(success.failures, []);

  const refusedCases = [
    { name: 'wrong run', jobs: [{ ...native('staging', 10), run_id: runId + 1 }, native('verify', 11)] },
    { name: 'wrong head', jobs: [{ ...native('staging', 10), head_sha: 'a'.repeat(40) }, native('verify', 11)] },
    { name: 'stale attempt', jobs: [{ ...native('staging', 10), run_attempt: runAttempt - 1 }, native('verify', 11)] },
    { name: 'missing', jobs: [native('verify', 11)] },
    { name: 'all missing', jobs: [] },
    { name: 'failed', jobs: [{ ...native('staging', 10), conclusion: 'failure' }, native('verify', 11)] },
    { name: 'skipped', jobs: [{ ...native('staging', 10), conclusion: 'skipped' }, native('verify', 11)] },
    { name: 'incomplete', jobs: [{ ...native('staging', 10), status: 'in_progress', conclusion: null }, native('verify', 11)] },
    {
      name: 'job count over limit',
      jobs: Array.from({ length: recovery.MAX_NATIVE_JOB_COUNT + 1 }, (_, index) => ({
        id: 1000 + index,
        run_id: runId,
        run_attempt: runAttempt,
        head_sha: executionSha,
        name: `unexpected-${index}`,
        status: 'completed',
        conclusion: 'success',
      })),
    },
  ];
  for (const fixture of refusedCases) {
    const refused = await runPublisher({ jobs: fixture.jobs });
    assert.ok(refused.failures.length > 0, `${fixture.name} must fail the publisher`);
    assert.ok(refused.updateCalls.some((call) => call.conclusion === 'failure'), `${fixture.name} must emit failure`);
    assert.ok(refused.updateCalls.every((call) => !['neutral', 'skipped'].includes(String(call.conclusion))));
  }

  const wrongCheckout = await runPublisher({ envOverride: { STAGING_TESTED_SHA: 'b'.repeat(40) } });
  assert.ok(wrongCheckout.failures.length > 0);
  assert.ok(wrongCheckout.updateCalls.some((call) => call.conclusion === 'failure'));

  const writesBeforeRefusal = observedMutations;
  await assert.rejects(
    () => runPublisher({ pullOverride: { merge_commit_sha: 'c'.repeat(40) } }),
    /altered_target/,
  );
  assert.strictEqual(observedMutations, writesBeforeRefusal, 'altered target must be refused before any check write');
  const writesBeforeUntrustedRun = observedMutations;
  await assert.rejects(
    () => runPublisher({ runOverride: { path: '.github/workflows/untrusted.yml' } }),
    /untrusted_workflow_run/,
  );
  assert.strictEqual(observedMutations, writesBeforeUntrustedRun, 'untrusted workflow identity must be refused before any check write');
});

test('loop-dispatch requires live governor commands before every cycle', () => {
  const command = readClaudeCommand('loop-dispatch.md');

  const phase0 = command.slice(command.indexOf('## Phase 0:'), command.indexOf('## Phase 1:'));
  const cycleStart = command.slice(command.indexOf('### Cycle start'), command.indexOf('### After each cycle'));

  for (const required of [
    'pnpm ops:merge-risk',
    'pnpm ops:execution-state',
    'pnpm ops:lane-maximizer',
    'pnpm ops:orchestration-reconcile --current --json',
  ]) {
    assert.match(phase0, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(cycleStart, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(command, /hard fail or block/i);
  assert.doesNotMatch(command, /codex-health-check\.ts/);
  assert.doesNotMatch(command, /Run `pnpm ops:reconcile`/);
});

test('loop-dispatch bookends cycles with reconciliation and repair command reporting', () => {
  const command = readClaudeCommand('loop-dispatch.md');
  const cycleEnd = command.slice(command.indexOf('### Cycle-end reconciliation'), command.indexOf('### Cycle limit'));

  assert.match(cycleEnd, /pnpm ops:orchestration-reconcile --current --json/);
  assert.match(cycleEnd, /Repair command: \{first repair_plan action command \| none available\}/);
  assert.match(command, /Start and end every cycle with `ops:orchestration-reconcile --current --json`/);
});

test('loop-dispatch summary exposes live executor state and recommendations', () => {
  const command = readClaudeCommand('loop-dispatch.md');
  const summary = command.slice(command.indexOf('LOOP-DISPATCH — SESSION COMPLETE'), command.indexOf('## --dry-run behavior'));

  assert.match(summary, /Active lanes:\s+Claude \{N\}, Codex \{N\}, Unknown \{N\}/);
  assert.match(summary, /Available slots:\s+Claude \{N\}, Codex \{N\}/);
  assert.match(summary, /Blocked lanes:\s+\{issue IDs or none\}/);
  assert.match(summary, /CI\/PM waiting:\s+\{PR numbers and reason or none\}/);
  assert.match(summary, /Recommendations:\s+\{execution-state and lane-maximizer next recommendations\}/);
});

test('loop-dispatch delegates executor limits to concurrency config', () => {
  const command = readClaudeCommand('loop-dispatch.md');

  assert.match(command, /docs\/governance\/CONCURRENCY_CONFIG\.json/);
  assert.match(command, /CONCURRENCY_CONFIG\.json owns lane limits/);
  assert.doesNotMatch(command, /Claude slots at cap \(2\/2\)/);
  assert.doesNotMatch(command, /max 2 Claude/);
  assert.doesNotMatch(command, /max 4 Codex/);
});

test('dispatch surfaces share live governor and reconciliation gates', () => {
  for (const name of ['dispatch.md', 'dispatch-board.md', 'loop-dispatch.md']) {
    const command = readClaudeCommand(name);

    for (const required of [
      'pnpm ops:merge-risk',
      'pnpm ops:execution-state',
      'pnpm ops:lane-maximizer',
      'pnpm ops:orchestration-reconcile --current --json',
    ]) {
      assert.match(command, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${name} missing ${required}`);
    }

    assert.match(command, /Repair command: \{first repair_plan action command \| none available\}/, `${name} must surface one repair command`);
  }
});

test('dispatch surfaces delegate lane counts and forbidden combinations to config', () => {
  for (const name of ['dispatch.md', 'dispatch-board.md']) {
    const command = readClaudeCommand(name);

    assert.match(command, /docs\/governance\/CONCURRENCY_CONFIG\.json/, `${name} must cite concurrency config`);
    assert.match(command, /forbidden-combination|forbidden combination/i, `${name} must preserve forbidden-combination handling`);
    assert.doesNotMatch(command, /max 2 Claude/i);
    assert.doesNotMatch(command, /max 4 Codex/i);
    assert.doesNotMatch(command, /up to 2 Claude/i);
    assert.doesNotMatch(command, /up to 4 Codex/i);
  }
});

test('active dispatch docs do not reference stale lane files or reconcile commands', () => {
  for (const name of ['dispatch.md', 'dispatch-board.md', 'loop-dispatch.md']) {
    const command = readClaudeCommand(name);

    assert.doesNotMatch(command, /\.claude\/lanes\.json/);
    assert.doesNotMatch(command, /pnpm ops:reconcile\b/);
    assert.doesNotMatch(command, /codex-health-check\.ts/);
  }
});

test('UTV2-1543: merge-gate.yml validates T1 pm-verdict/v1 PR + Head SHA via the tested module, not inline logic', async () => {
  const { validateT1Verdicts } = await import('./merge-gate-verdict.cjs');

  const workflow = readWorkflowYaml('merge-gate.yml');
  const jobs = objectField(workflow, 'jobs');
  const gate = objectField(jobs, 'gate');
  const steps = gate.steps as Array<Record<string, unknown>>;
  const evalStep = steps.find(
    (s) => typeof s.with === 'object' && s.with && typeof (s.with as Record<string, unknown>).script === 'string',
  );
  assert.ok(evalStep, 'merge-gate.yml gate job must have the Evaluate merge gate script step');
  const script = ((evalStep as Record<string, unknown>).with as Record<string, unknown>).script as string;

  assert.match(
    script,
    /require\(['"]\.\/scripts\/ops\/merge-gate-verdict\.cjs['"]\)/,
    'merge-gate.yml must resolve T1 verdict validation via the tested merge-gate-verdict.cjs module, not a duplicated inline implementation',
  );
  assert.doesNotMatch(
    script,
    /function parseVerdict/,
    'merge-gate.yml must not hand-duplicate parseVerdict inline once the tested module exists',
  );

  // The module itself must actually enforce PR/Head SHA freshness for T1 —
  // covered exhaustively in merge-gate-verdict.test.ts; this asserts the
  // exact shape the workflow depends on hasn't drifted.
  assert.equal(typeof validateT1Verdicts, 'function');
  const staleErrors = validateT1Verdicts(
    [{ user: 'griff843', userType: 'User', parsed: { verdict: 'APPROVED', issueId: 'UTV2-1', prNumber: 1, headSha: 'a'.repeat(40) }, createdAt: '2026-01-01' }],
    { prNumber: 1, headSha: 'b'.repeat(40), authorizedReviewers: new Set(['griff843']) },
  );
  assert.ok(staleErrors.some((e) => /stale/i.test(e)), 'a verdict bound to a different head SHA must fail closed');
});

test('WORK-2026100801: Merge Gate invokes the collector only behind complete nonempty stale-head codes', () => {
  const script = githubScriptStep('merge-gate.yml', 'gate', 'Evaluate merge gate');
  assert.match(script, /t1Errors\.length > 0/);
  assert.match(script, /t1Codes !== null/);
  assert.match(script, /t1Codes\.length === t1Errors\.length/);
  assert.match(script, /t1Codes\.every\(code => code === 'stale_head'\)/);
  assert.doesNotMatch(script, /codes\s*\|\|\s*\[\]/, 'missing codes must never become vacuous success');
  assert.doesNotMatch(script, /t1Errors.*stale/i, 'classification must not prose-match error messages');
  assert.match(script, /scripts\/ops\/carry-forward-collect\.ts/);
  assert.match(script, /parsed\.original_verdict_sha === latestAuthorized\?\.parsed\.headSha/);
  assert.match(script, /parsed\.original_verdict_url === latestAuthorized\?\.htmlUrl/);
  assert.match(script, /parsed\.current_head_sha === headSha/);
  assert.match(script, /APPROVAL_CARRY_FORWARD_COMPUTED=/);
  assert.doesNotMatch(script, /APPROVAL_CARRY_FORWARD:.*parse|renderReceipt|receipt.*input/is);
});

test('WORK-2026100801 rework: literal Merge Gate executes stale-only carry-forward and refuses every incomplete authority shape', async () => {
  const actualVerdict = await import('./merge-gate-verdict.cjs');
  const script = githubScriptStep('merge-gate.yml', 'gate', 'Evaluate merge gate');
  const prNumber = 1725;
  const issueId = 'WORK-2026100801';
  const oldHead = '1'.repeat(40);
  const headSha = '2'.repeat(40);
  const originalUrl = `https://github.com/griff843/Unit-Talk-v2/pull/${prNumber}#issuecomment-1`;
  const approvedBody = (overrides: { pr?: number; head?: string } = {}) => [
    'PM_VERDICT: APPROVED',
    'schema: pm-verdict/v1',
    `Issue: ${issueId}`,
    `PR: ${overrides.pr ?? prNumber}`,
    `Head SHA: ${overrides.head ?? oldHead}`,
  ].join('\n');
  const comment = (body: string, overrides: { login?: string; type?: string; url?: string; created?: string } = {}) => ({
    body,
    user: { login: overrides.login ?? 'griff843', type: overrides.type ?? 'User' },
    html_url: overrides.url ?? originalUrl,
    created_at: overrides.created ?? '2026-10-08T12:00:00Z',
  });
  const validCollector = {
    schema: 'approval-carry-forward/v1',
    verdict: 'VERIFIED',
    issue_id: issueId,
    original_verdict_sha: oldHead,
    original_verdict_url: originalUrl,
    current_head_sha: headSha,
    main_anchor_sha: '3'.repeat(40),
    pr_diff_patch_id: { atApproved: 'patch-id', atHead: 'patch-id' },
    conditions: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'].map((id) => ({
      id,
      title: `${id} verified`,
      status: 'pass',
      detail: `${id} evidence passed`,
    })),
    admitted_paths: [{ path: 'docs/06_status/proof/WORK-2026100801/verification.md', rule: 'named lane proof' }],
    refusals: [],
  };

  async function runGate(options: {
    comments?: Array<Record<string, unknown>>;
    collector?: Record<string, unknown> | string;
    spawnResult?: Record<string, unknown>;
    verdictModule?: Record<string, unknown>;
  } = {}) {
    const failures: string[] = [];
    const notices: string[] = [];
    const infos: string[] = [];
    const summaries: string[] = [];
    let collectorCalls = 0;
    const summary = {
      addHeading(value: string) { summaries.push(value); return this; },
      addCodeBlock(value: string) { summaries.push(value); return this; },
      async write() { return this; },
    };
    const manifest = Buffer.from(JSON.stringify({ issue_id: issueId, tier: 'T1' })).toString('base64');
    const collectorStdout = typeof options.collector === 'string'
      ? options.collector
      : JSON.stringify(options.collector ?? validCollector);
    await executeGithubScript(script, {
      github: {
        rest: {
          issues: {
            get: async () => ({ data: { labels: [{ name: 'tier:T1' }, { name: 't1-approved' }] } }),
            listComments: async () => ({ data: options.comments ?? [comment(approvedBody())] }),
          },
          repos: {
            getContent: async ({ path: requestedPath }: { path: string }) => {
              if (requestedPath === `docs/06_status/lanes/${issueId}.json`) {
                return { data: { content: manifest, encoding: 'base64' } };
              }
              const absent = new Error('not found') as Error & { status?: number };
              absent.status = 404;
              throw absent;
            },
          },
          pulls: {
            listReviews: async () => ({ data: [] }),
            listFiles: async () => undefined,
          },
        },
        paginate: async () => [],
      },
      context: {
        repo: { owner: 'griff843', repo: 'Unit-Talk-v2' },
        serverUrl: 'https://github.com',
        runId: 456,
        payload: {
          pull_request: {
            number: prNumber,
            title: `feat(ops): ${issueId} harden workflow safety`,
            head: { sha: headSha, ref: 'codex/work-2026100801-workflow-safety' },
            base: { sha: '4'.repeat(40) },
          },
        },
      },
      core: {
        info: (message: string) => infos.push(message),
        notice: (message: string) => notices.push(message),
        setFailed: (message: string) => failures.push(message),
        summary,
      },
      process: { env: { GITHUB_TOKEN: 'test-token', GITHUB_RUN_ATTEMPT: '3' } },
      Buffer,
      require: (specifier: string) => {
        if (specifier === './scripts/ops/merge-gate-verdict.cjs') {
          return options.verdictModule ?? actualVerdict;
        }
        assert.strictEqual(specifier, 'child_process');
        return {
          spawnSync: () => {
            collectorCalls += 1;
            return options.spawnResult ?? { stdout: collectorStdout, status: 0, signal: null, error: undefined };
          },
        };
      },
    });
    return { failures, notices, infos, summaries, collectorCalls };
  }

  const success = await runGate();
  assert.deepStrictEqual(success.failures, []);
  assert.strictEqual(success.collectorCalls, 1);
  assert.match(success.notices.join('\n'), /"original_verdict_sha":"1{40}"/);
  assert.match(success.notices.join('\n'), /"current_head_sha":"2{40}"/);
  assert.match(success.notices.join('\n'), /"generated_by":"https:\/\/github\.com\/griff843\/Unit-Talk-v2\/actions\/runs\/456\/attempts\/3"/);
  assert.match(success.infos.join('\n'), /Conditions:[\s\S]*C1[\s\S]*C7/);
  assert.match(success.summaries.join('\n'), /not an independent review/);

  const codedError = (codes: Array<string | null> | undefined) => {
    const errors = ['synthetic stale classification'] as string[] & { codes?: Array<string | null> };
    if (codes !== undefined) Object.defineProperty(errors, 'codes', { value: codes });
    return errors;
  };
  for (const fixture of [
    { name: 'missing codes', verdictModule: { ...actualVerdict, validateT1Verdicts: () => codedError(undefined) } },
    { name: 'empty codes', verdictModule: { ...actualVerdict, validateT1Verdicts: () => codedError([]) } },
    { name: 'misaligned codes', verdictModule: { ...actualVerdict, validateT1Verdicts: () => codedError(['stale_head', null]) } },
    { name: 'no approval', comments: [] },
    { name: 'unauthorized approval', comments: [comment(approvedBody(), { login: 'outsider' })] },
    { name: 'bot approval', comments: [comment(approvedBody(), { login: 'bot', type: 'Bot' })] },
    { name: 'wrong PR', comments: [comment(approvedBody({ pr: prNumber + 1 }))] },
    {
      name: 'withdrawn approval',
      comments: [
        comment(approvedBody()),
        comment([
          'PM_VERDICT: CHANGES_REQUIRED',
          'schema: pm-verdict/v1',
          `Issue: ${issueId}`,
          'Bounce: 1',
        ].join('\n'), { created: '2026-10-08T12:01:00Z' }),
      ],
    },
  ]) {
    const result = await runGate(fixture);
    assert.strictEqual(result.collectorCalls, 0, `${fixture.name}: collector must not run`);
    assert.ok(result.failures.length > 0, `${fixture.name}: gate must fail`);
  }

  for (const fixture of [
    { name: 'malformed approval identity', collector: { ...validCollector, original_verdict_url: 'https://example.test/forged' } },
    { name: 'incorrect successor head', collector: { ...validCollector, current_head_sha: '5'.repeat(40) } },
    { name: 'incomplete conditions', collector: { ...validCollector, conditions: validCollector.conditions.slice(0, 6) } },
    { name: 'failed collector', spawnResult: { stdout: JSON.stringify(validCollector), status: 1, signal: null } },
    { name: 'timed-out collector', spawnResult: { stdout: '', status: null, signal: 'SIGTERM', error: new Error('timed out') } },
    { name: 'unparseable collector', collector: '{not-json' },
  ]) {
    const result = await runGate(fixture);
    assert.strictEqual(result.collectorCalls, 1, `${fixture.name}: stale-only evidence should invoke collector once`);
    assert.ok(result.failures.length > 0, `${fixture.name}: gate must fail`);
  }
});

test('UTV2-1543 (Codex P1): merge-gate.yml checks out the repo, pinned to a trusted ref, before requiring the verdict helper', () => {
  const workflow = readWorkflowYaml('merge-gate.yml');
  const jobs = objectField(workflow, 'jobs');
  const gate = objectField(jobs, 'gate');
  const steps = gate.steps as Array<Record<string, unknown>>;

  const checkoutIndex = steps.findIndex(
    (s) => typeof s.uses === 'string' && (s.uses as string).startsWith('actions/checkout@'),
  );
  const evalIndex = steps.findIndex(
    (s) => typeof s.with === 'object' && s.with && typeof (s.with as Record<string, unknown>).script === 'string',
  );
  assert.notStrictEqual(checkoutIndex, -1, 'merge-gate.yml gate job must have a Checkout step');
  assert.ok(
    checkoutIndex < evalIndex,
    'Checkout must run before the Evaluate merge gate step, or require(\'./scripts/ops/merge-gate-verdict.cjs\') throws before the check run is even created',
  );

  // The native required job is pull_request-only and read-only. Its executable
  // policy code must still come from the immutable base SHA.
  const checkoutStep = steps[checkoutIndex] as Record<string, unknown>;
  const withBlock = objectField(checkoutStep, 'with');
  assert.strictEqual(
    withBlock.ref,
    '${{ github.event.pull_request.base.sha }}',
    'Checkout must pin ref to the PR base SHA so a PR cannot execute its own verdict-validation module',
  );
});

test('WORK-2026100801: merge-gate reads head objects only through one inert fetch and never materializes head code', () => {
  const workflow = readWorkflowYaml('merge-gate.yml');
  const jobs = objectField(workflow, 'jobs');
  const gate = objectField(jobs, 'gate');
  const steps = gate.steps as Array<Record<string, unknown>>;

  for (const step of steps) {
    const stepName = typeof step.name === 'string' ? step.name : '(unnamed step)';

    // 1. No checkout (or any other) step may pin `ref` to the PR head SHA.
    //    Only base.sha / github.sha (main HEAD) are trusted refs for this
    //    privileged job (checks/pull-requests/issues: write).
    if (typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@')) {
      const withBlock = (step.with ?? {}) as Record<string, unknown>;
      if (typeof withBlock.ref === 'string') {
        assert.doesNotMatch(
          withBlock.ref,
          /pull_request\.head\.sha/,
          `${stepName}: checkout ref must never resolve to pull_request.head.sha (PR-controlled)`,
        );
      }
    }

    // 2. A bare fetch may place inert objects in the object database for the
    //    collector. No read/materialization verb may write PR bytes into the
    //    trusted working tree, and the fetch step may contain no second command.
    if (typeof step.run === 'string') {
      const referencesHeadSha = /pull_request\.head\.sha/.test(step.run);
      const materializesContent = /git\s+(show|checkout)|curl\s|wget\s|>\s*scripts\//.test(step.run);
      assert.ok(
        !(referencesHeadSha && materializesContent),
        `${stepName}: run step must not materialize content keyed on pull_request.head.sha:\n${step.run}`,
      );
      if (referencesHeadSha && /git\s+fetch/.test(step.run)) {
        assert.match(
          step.run.trim(),
          /^git fetch --no-tags origin "\$\{\{ github\.event\.pull_request\.head\.sha \}\}"$/,
          `${stepName}: head fetch must be the single inert fetch command`,
        );
      }
    }

    // 3. The github-script step's require() must resolve the committed,
    //    base-checked-out copy of merge-gate-verdict.cjs -- never a path
    //    the workflow wrote from head-sha content in a prior step.
    const withBlock = (step.with ?? {}) as Record<string, unknown>;
    if (typeof withBlock.script === 'string') {
      assert.doesNotMatch(
        withBlock.script,
        /pull_request\.head\.sha/,
        `${stepName}: evaluate-merge-gate script must not reference pull_request.head.sha directly for content trust decisions`,
      );
    }
  }

  // 4. No step in this job may be a "bootstrap"/"recover from PR head" step
  //    at all -- main unconditionally carries the trusted
  //    scripts/ops/merge-gate-verdict.cjs as of UTV2-1554, so no
  //    absence-triggered fallback should exist to bootstrap it from
  //    untrusted PR content.
  const bootstrapLike = steps.find(
    (s) => typeof s.name === 'string' && /bootstrap/i.test(s.name) && /merge-gate-verdict\.cjs/.test(s.name),
  );
  assert.strictEqual(
    bootstrapLike,
    undefined,
    'merge-gate.yml must not carry a PR-head bootstrap-recovery step for merge-gate-verdict.cjs; main always has the trusted file post-UTV2-1554',
  );

  const raw = readWorkflow('merge-gate.yml');
  for (const hostile of [
    /git show .*pull_request\.head\.sha.*>\s*scripts\//,
    /git checkout .*pull_request\.head\.sha.*scripts\//,
    /curl .*pull_request\.head\.sha.*(?:-o|>)\s*scripts\//,
  ]) {
    assert.doesNotMatch(raw, hostile);
  }
});

// ---------------------------------------------------------------------------
// UTV2-1632 — the DB Health Tripwire had never executed a single check.
//
// The defect had two independent halves, and a fix that closed only one would
// have looked identical from the outside:
//
//   1. `run: tsx scripts/ops/db-health-tripwire.ts` invoked a workspace binary
//      by bare name, so the step exited 127 before Node started.
//   2. `import postgres from 'postgres'` named a package with no manifest entry
//      and no lockfile entry, so fixing (1) alone would have exited 1 on
//      MODULE_NOT_FOUND — still zero checks executed.
//
// Both halves shared one root property: nothing distinguished "the monitor is
// broken" from "the monitor found something". The tests below hold the three
// guarantees that replace that ambiguity — the invocation is linted repo-wide,
// execution is proved from a receipt rather than from an exit code, and the
// check logic is shown to compare a measured value against a threshold.
// ---------------------------------------------------------------------------

import {
  collectWorkspaceBinaries,
  leadingCommandWords,
  runGuard as runBareBinaryGuard,
  scanDocument as scanWorkflowDocument,
} from '../ci/workflow-bare-binary-guard.js';
import {
  HOT_TABLES,
  RECEIPT_SCHEMA,
  TABLE_SIZE_SQL,
  countChecks,
  deriveOutcome,
  evaluateAutovacuumRow,
  evaluateSizeRow,
  evaluateStatementTimeoutRate,
  evaluateToastRow,
  gateReceipt,
  notRunCheck,
  resolveThresholds,
  type CheckOutcome,
  type SizeRow,
  type TripwireReceipt,
  type VacuumRow,
} from './db-health-checks.js';

const MB = 1024 * 1024;

function sizeRow(relname: string, megabytes: number): SizeRow {
  const bytes = Math.round(megabytes * MB);
  return {
    relname,
    table_size: `${megabytes} MB`,
    total_size: `${megabytes} MB`,
    total_bytes: String(bytes),
  };
}

// --- The invocation lint -----------------------------------------------------

test('UTV2-1632: no workflow invokes a workspace binary by bare name', () => {
  const violations = runBareBinaryGuard();
  assert.deepStrictEqual(
    violations,
    [],
    `bare workspace-binary invocation(s) found — these exit 127 on the runner:\n${violations
      .map((v) => `  ${v.file} → ${v.job} → ${v.step}: ${v.command}`)
      .join('\n')}`,
  );
});

test('UTV2-1632: the bare-binary guard catches the exact shape that shipped', () => {
  const binaries = collectWorkspaceBinaries();
  assert.ok(binaries.has('tsx'), 'tsx is a workspace devDependency and must be in the candidate set');
  assert.ok(binaries.has('tsc'), 'typescript provides tsc under a different name');
  assert.ok(
    !binaries.has('supabase') && !binaries.has('psql') && !binaries.has('gh'),
    'binaries installed by a setup action or by apt must never be flagged',
  );

  const offending = `
name: regression
jobs:
  j:
    steps:
      - name: Run DB health checks
        run: tsx scripts/ops/db-health-tripwire.ts
`;
  const found = scanWorkflowDocument('regression.yml', offending, binaries);
  assert.strictEqual(found.length, 1, 'the pre-UTV2-1632 invocation must be reported');
  assert.strictEqual(found[0]?.binary, 'tsx');

  const fixed = offending.replace('run: tsx', 'run: pnpm exec tsx');
  assert.deepStrictEqual(
    scanWorkflowDocument('regression.yml', fixed, binaries),
    [],
    'the pnpm exec form must be accepted',
  );
});

test('UTV2-1632: the guard reads through shell noise without inventing findings', () => {
  // A command substitution introduces a new command; the assignment in front of
  // it is not the command. Getting this wrong reports every `X=$(pnpm exec …)`
  // in the repository as a violation, which would make the guard useless.
  assert.deepStrictEqual(leadingCommandWords('NAME=$(pnpm exec tsx a.ts)'), ['pnpm']);
  assert.deepStrictEqual(leadingCommandWords('OUT=$(tsx a.ts)'), ['tsx']);
  assert.deepStrictEqual(leadingCommandWords('CI=true pnpm install'), ['pnpm']);
  assert.deepStrictEqual(leadingCommandWords('pnpm exec tsx \\\n  a.ts'), ['pnpm']);
  assert.deepStrictEqual(leadingCommandWords('# comment only'), []);
  assert.deepStrictEqual(leadingCommandWords('sudo apt-get install -y postgresql-client'), [
    'apt-get',
  ]);
});

// --- The workflow contract ---------------------------------------------------

test('UTV2-1632: the tripwire workflow runs through pnpm exec and proves execution', () => {
  const wf = readWorkflowYaml('db-health-tripwire.yml');
  const job = objectField(objectField(wf, 'jobs'), 'db-health-check');
  const steps = job['steps'] as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(steps), 'db-health-check must declare steps');

  const byName = (fragment: string): Record<string, unknown> => {
    const step = steps.find((s) => String(s['name'] ?? '').includes(fragment));
    assert.ok(step, `expected a step named like "${fragment}"`);
    return step as Record<string, unknown>;
  };

  const run = byName('Run DB health checks');
  assert.match(String(run['run']), /pnpm exec tsx scripts\/ops\/db-health-tripwire\.ts/);
  assert.match(String(run['run']), /--receipt/, 'the run must name where the receipt is written');

  // Fail-closed: the execution gate must run even when the producer failed, so
  // a receipt that was never written turns the job red instead of being skipped.
  const gate = byName('Prove the checks executed');
  assert.match(String(gate['run']), /--assert-executed/);
  assert.strictEqual(gate['if'], 'always()', 'the execution gate must not be skippable');

  // The three outcomes must be reported by three different steps, so the name
  // of the failing step says which one happened.
  const verdict = byName('Report DB health verdict');
  assert.match(String(verdict['run']), /--assert-healthy/);
  assert.ok(
    steps.indexOf(run) < steps.indexOf(gate) && steps.indexOf(gate) < steps.indexOf(verdict),
    'harness → execution proof → health verdict must run in that order',
  );

  assert.strictEqual(
    objectField(wf, 'permissions')['contents'],
    'read',
    'a read-only monitor must hold read-only workflow permissions',
  );

  const text = readWorkflow('db-health-tripwire.yml');
  assert.doesNotMatch(text, /echo[^\n]*secrets\./i, 'no step may echo a secret');
  assert.doesNotMatch(
    text,
    /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b/i,
    'the tripwire workflow must contain no mutating SQL verb',
  );
});

// --- Threshold resolution ----------------------------------------------------

test('UTV2-1632: thresholds record where their value came from', () => {
  const defaults = resolveThresholds({});
  assert.strictEqual(defaults['SYSTEM_RUNS_SIZE_THRESHOLD_MB']?.value, 500);
  assert.strictEqual(defaults['SYSTEM_RUNS_SIZE_THRESHOLD_MB']?.source, 'default');

  const fromEnv = resolveThresholds({ SYSTEM_RUNS_SIZE_THRESHOLD_MB: '750' });
  assert.strictEqual(fromEnv['SYSTEM_RUNS_SIZE_THRESHOLD_MB']?.value, 750);
  assert.strictEqual(fromEnv['SYSTEM_RUNS_SIZE_THRESHOLD_MB']?.source, 'env');

  const overridden = resolveThresholds({
    SYSTEM_RUNS_SIZE_THRESHOLD_MB: '750',
    TRIPWIRE_THRESHOLD_OVERRIDES: '{"SYSTEM_RUNS_SIZE_THRESHOLD_MB":"1"}',
  });
  assert.strictEqual(overridden['SYSTEM_RUNS_SIZE_THRESHOLD_MB']?.value, 1);
  assert.strictEqual(overridden['SYSTEM_RUNS_SIZE_THRESHOLD_MB']?.source, 'dispatch_override');
});

test('UTV2-1632: a threshold override may not reach anything but a threshold', () => {
  // A dispatch input that could name an arbitrary key would be a way to steer
  // the job's environment from the outside. Unknown keys fail closed, and so
  // does a value that silently would have fallen back to the default.
  assert.throws(
    () => resolveThresholds({ TRIPWIRE_THRESHOLD_OVERRIDES: '{"SUPABASE_DB_URL":"postgres://x"}' }),
    /unknown threshold key/i,
  );
  assert.throws(
    () => resolveThresholds({ TRIPWIRE_THRESHOLD_OVERRIDES: 'not json' }),
    /not valid JSON/i,
  );
  assert.throws(
    () => resolveThresholds({ TRIPWIRE_THRESHOLD_OVERRIDES: '{"AUTOVACUUM_STALENESS_HOURS":"nope"}' }),
    /not a finite number/i,
  );
});

// --- The check logic actually compares a value to a threshold ---------------

test('UTV2-1632: table_size evaluates the measured value against the threshold', () => {
  const thresholds = resolveThresholds({ SYSTEM_RUNS_SIZE_THRESHOLD_MB: '500' });

  const healthy = evaluateSizeRow(sizeRow('system_runs', 120), thresholds);
  assert.strictEqual(healthy.status, 'pass');
  assert.strictEqual(healthy.measured.value, 120);
  assert.strictEqual(healthy.threshold.value, 500);

  const over = evaluateSizeRow(sizeRow('system_runs', 600), thresholds);
  assert.strictEqual(over.status, 'tripped');
  assert.strictEqual(over.severity, 'warn');

  const wayOver = evaluateSizeRow(sizeRow('system_runs', 1200), thresholds);
  assert.strictEqual(wayOver.severity, 'critical', 'more than 2x the threshold is critical');

  // The boundary is strictly greater-than, so a table exactly at the threshold
  // does not alert.
  assert.strictEqual(evaluateSizeRow(sizeRow('system_runs', 500), thresholds).status, 'pass');
});

// --- table_size measures a partitioned table by its partitions --------------

test('WORK-2026092313: the size query sums each table with its partition tree', () => {
  const sql = TABLE_SIZE_SQL.replace(/\s+/g, ' ');
  // A partitioned parent is 0 bytes itself; the data is in pg_partition_tree.
  assert.match(sql, /pg_partition_tree\(c\.oid\)/, 'the query must walk the partition tree');
  // A plain table has an empty tree, so the relation itself must be in the set
  // or every plain table would disappear from the check.
  assert.match(sql, /SELECT c\.oid::regclass AS relid UNION SELECT pt\.relid/, 'the relation itself must be summed');
  assert.match(sql, /sum\(pg_total_relation_size\(t\.relid\)\)::text AS total_bytes/);
  assert.match(sql, /c\.relkind IN \('r', 'p'\)/, 'partitioned parents (relkind p) must be eligible');
  assert.match(sql, /GROUP BY c\.relname/);
});

test('WORK-2026092313: the size query names exactly the hot tables', () => {
  const listed = [...TABLE_SIZE_SQL.matchAll(/ARRAY\[([^\]]*)\]/g)].map((m) => m[1]);
  assert.strictEqual(listed.length, 1);
  const names = listed[0]!.split(',').map((part) => part.trim().replace(/^'|'$/g, ''));
  assert.deepStrictEqual(names, [...HOT_TABLES]);
});

test('WORK-2026092313: the tripwire executes the tested size query, not its own', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/ops/db-health-tripwire.ts'), 'utf8');
  assert.match(source, /const sizeRows = await tx\.unsafe<SizeRow\[\]>\(TABLE_SIZE_SQL\);/);
  // The pre-fix query sized each relation from pg_stat_user_tables alone,
  // which reads a partitioned parent as 0 MB.
  assert.doesNotMatch(source, /pg_total_relation_size\(relid\)/);
});

test('WORK-2026092313: a partitioned table measured by its partitions trips the size check', () => {
  // Production 2026-09-23: provider_offer_history summed over 61 relations
  // was 8,499,781,632 bytes, where the parent alone read 0 MB and passed.
  const thresholds = resolveThresholds({ PROVIDER_OFFER_HISTORY_SIZE_THRESHOLD_MB: '300' });
  const partitioned = evaluateSizeRow(
    { relname: 'provider_offer_history', table_size: '4165 MB', total_size: '8106 MB', total_bytes: '8499781632' },
    thresholds,
  );
  assert.strictEqual(partitioned.status, 'tripped');
  assert.strictEqual(partitioned.severity, 'critical');
  const parentOnly = evaluateSizeRow(sizeRow('provider_offer_history', 0), thresholds);
  assert.strictEqual(parentOnly.status, 'pass', 'the pre-fix parent-only reading passed');
});

test('UTV2-1632: lowering the threshold trips a table that otherwise passes', () => {
  // This is the unit-level twin of the live negative demonstration: the same
  // measured value produces a different verdict when only the threshold moves,
  // which is only possible if the comparison is actually performed.
  const row = sizeRow('system_runs', 120);
  assert.strictEqual(evaluateSizeRow(row, resolveThresholds({})).status, 'pass');

  const demo = resolveThresholds({
    TRIPWIRE_THRESHOLD_OVERRIDES: '{"SYSTEM_RUNS_SIZE_THRESHOLD_MB":"1"}',
  });
  const tripped = evaluateSizeRow(row, demo);
  assert.strictEqual(tripped.status, 'tripped');
  assert.strictEqual(tripped.threshold.source, 'dispatch_override');
  assert.strictEqual(tripped.measured.value, 120);
});

test('UTV2-1632: autovacuum, TOAST and timeout-rate checks each evaluate', () => {
  const thresholds = resolveThresholds({});
  const now = new Date('2026-07-31T00:00:00.000Z');
  const fresh = new Date('2026-07-30T23:00:00.000Z');
  const stale = new Date('2026-07-01T00:00:00.000Z');

  const base: VacuumRow = {
    relname: 'system_runs',
    last_vacuum: fresh,
    last_autovacuum: fresh,
    last_analyze: fresh,
    last_autoanalyze: fresh,
    n_dead_tup: '10',
    n_live_tup: '1000',
    dead_tup_pct: '0.99',
  };
  assert.strictEqual(evaluateAutovacuumRow(base, thresholds, now).status, 'pass');
  assert.strictEqual(
    evaluateAutovacuumRow({ ...base, last_analyze: stale }, thresholds, now).status,
    'tripped',
  );
  assert.strictEqual(
    evaluateAutovacuumRow({ ...base, last_vacuum: null }, thresholds, now).severity,
    'critical',
    'a table that has never been vacuumed is the 2026-06-22 write-path signature',
  );
  assert.strictEqual(
    evaluateAutovacuumRow({ ...base, n_dead_tup: '900', dead_tup_pct: '47.37' }, thresholds, now)
      .status,
    'tripped',
  );

  const toastBase = {
    relname: 'raw_payloads',
    heap_size: '10 MB',
    toast_plus_index_size: '20 MB',
    total_size: '30 MB',
  };
  assert.strictEqual(evaluateToastRow({ ...toastBase, toast_pct: '66.7' }, thresholds).status, 'pass');
  assert.strictEqual(
    evaluateToastRow({ ...toastBase, toast_pct: '95.0' }, thresholds).status,
    'tripped',
  );
  assert.strictEqual(
    evaluateToastRow({ ...toastBase, toast_pct: null }, thresholds).status,
    'not_run',
    'an uncomputable ratio is not a pass',
  );

  const t = (minutes: number): Date => new Date(now.getTime() + minutes * 60_000);
  assert.strictEqual(
    evaluateStatementTimeoutRate([t(0), t(10), t(20)], 3, thresholds).status,
    'pass',
    '3 in one hour is at the threshold, not over it',
  );
  assert.strictEqual(
    evaluateStatementTimeoutRate([t(0), t(10), t(20), t(30)], 4, thresholds).status,
    'tripped',
  );
  assert.strictEqual(
    evaluateStatementTimeoutRate([t(0), t(90), t(180), t(270)], 4, thresholds).status,
    'pass',
    'four events spread over four hours never exceed the hourly rate',
  );
});

// --- Execution proof ---------------------------------------------------------

test('UTV2-1632: a verdict may rest on an observation that has no number', () => {
  // Caught by the first live production run: `provider_offer_history` has never
  // been analysed, so `hours since last_analyze` has no value — yet the check
  // correctly tripped. Requiring a numeric measurement rejected a genuine
  // finding, so the gate asks whether the check OBSERVED anything, which is the
  // property that actually distinguishes evaluation from non-evaluation.
  const thresholds = resolveThresholds({});
  const now = new Date('2026-07-31T00:00:00.000Z');
  const neverAnalyzed: VacuumRow = {
    relname: 'provider_offer_history',
    last_vacuum: null,
    last_autovacuum: null,
    last_analyze: null,
    last_autoanalyze: null,
    n_dead_tup: '0',
    n_live_tup: '0',
    dead_tup_pct: null,
  };
  const outcome = evaluateAutovacuumRow(neverAnalyzed, thresholds, now);
  assert.strictEqual(outcome.status, 'tripped');
  assert.strictEqual(outcome.measured.value, null, 'a never-analysed table has no elapsed hours');
  assert.strictEqual(outcome.measured.observed, true, 'the row was read, so it was observed');
  assert.match(outcome.detail, /last_analyze=never run/);

  // Not-run rows are the opposite: nothing was read at all.
  assert.strictEqual(notRunCheck('table_size', 'x', 'unreachable').measured.observed, false);
});

test('UTV2-1632: a run that evaluated nothing is a harness error, never a pass', () => {
  assert.strictEqual(deriveOutcome([]), 'harness_error');
  assert.strictEqual(
    deriveOutcome([notRunCheck('table_size', 'system_runs', 'unreachable')]),
    'harness_error',
    'checks that could not run must not add up to a healthy verdict',
  );

  const thresholds = resolveThresholds({});
  const passed = evaluateSizeRow(sizeRow('system_runs', 10), thresholds);
  const tripped = evaluateSizeRow(sizeRow('raw_payloads', 9000), thresholds);
  assert.strictEqual(deriveOutcome([passed]), 'checks_passed');
  assert.strictEqual(deriveOutcome([passed, tripped]), 'checks_tripped');
});

test('UTV2-1632: the receipt gate is hostile to the receipt it is handed', () => {
  const thresholds = resolveThresholds({});
  const checks: CheckOutcome[] = [
    evaluateSizeRow(sizeRow('system_runs', 10), thresholds),
    notRunCheck('statement_timeout_rate', null, 'log endpoint unreachable'),
  ];
  const receipt: TripwireReceipt = {
    schema: RECEIPT_SCHEMA,
    issue: 'UTV2-1632',
    generated_at: new Date().toISOString(),
    outcome: 'checks_passed',
    harness_error: null,
    run: {
      workflow: 'DB Health Tripwire',
      run_id: '123',
      run_attempt: '1',
      job: 'db-health-check',
      sha: 'abc',
      ref: 'refs/heads/main',
      event: 'schedule',
    },
    target: { kind: 'canonical-production', project_ref: 'zfzdnfwdarxucxtaojxm', host: 'db' },
    read_only: { mechanism: 'SET TRANSACTION READ ONLY', observed_transaction_read_only: 'on' },
    thresholds,
    threshold_override_active: false,
    counts: countChecks(checks),
    checks,
    linear_alert: 'not_applicable',
  };

  assert.strictEqual(gateReceipt(receipt, {}).verdict, 'PASS');

  // The defect this whole lane exists to prevent.
  const evaluatedNothing = {
    ...receipt,
    outcome: 'checks_passed' as const,
    checks: [notRunCheck('table_size', 'system_runs', 'unreachable')],
    counts: countChecks([notRunCheck('table_size', 'system_runs', 'unreachable')]),
  };
  const nothing = gateReceipt(evaluatedNothing, {});
  assert.strictEqual(nothing.verdict, 'FAIL');
  assert.ok(nothing.reasons.some((r) => /zero executed checks/.test(r)));

  // A verdict must rest on data the check actually read.
  const unobserved = gateReceipt(
    {
      ...receipt,
      checks: [
        {
          ...checks[0],
          measured: { ...checks[0].measured, observed: false },
        },
      ],
      counts: countChecks([checks[0]]),
    },
    {},
  );
  assert.strictEqual(unobserved.verdict, 'FAIL');
  assert.ok(unobserved.reasons.some((r) => /without observing anything/.test(r)));

  // Counts are recomputed, never trusted.
  const liedCounts = gateReceipt({ ...receipt, counts: { ...receipt.counts, executed: 99 } }, {});
  assert.strictEqual(liedCounts.verdict, 'FAIL');
  assert.ok(liedCounts.reasons.some((r) => /do not match counts recomputed/.test(r)));

  // Read-only must be observed, not asserted.
  const unprovenReadOnly = gateReceipt(
    { ...receipt, read_only: { mechanism: 'trust me', observed_transaction_read_only: null } },
    {},
  );
  assert.strictEqual(unprovenReadOnly.verdict, 'FAIL');
  assert.ok(unprovenReadOnly.reasons.some((r) => /transaction_read_only=on/.test(r)));

  // A receipt from another run proves nothing about this one, so a receipt
  // committed to the repository cannot satisfy the gate.
  const wrongRun = gateReceipt(receipt, { GITHUB_RUN_ID: '999', GITHUB_RUN_ATTEMPT: '1' });
  assert.strictEqual(wrongRun.verdict, 'FAIL');
  assert.ok(wrongRun.reasons.some((r) => /proves nothing about this one/.test(r)));

  // A harness error never passes the execution gate.
  const broken = gateReceipt(
    { ...receipt, outcome: 'harness_error', harness_error: 'MODULE_NOT_FOUND: postgres' },
    {},
  );
  assert.strictEqual(broken.verdict, 'FAIL');

  assert.strictEqual(gateReceipt(null, {}).verdict, 'FAIL');
  assert.strictEqual(gateReceipt({ schema: 'nope' }, {}).verdict, 'FAIL');
});

test('UTV2-1632: the postgres driver the tripwire imports is a declared dependency', () => {
  // The original script imported `postgres`, which appeared in no package.json
  // and no lockfile. A workflow-only fix would have left the import unresolvable
  // and the checker still dark.
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const declared = { ...manifest.dependencies, ...manifest.devDependencies };
  assert.ok(
    typeof declared['postgres'] === 'string',
    'scripts/ops/db-health-tripwire.ts imports `postgres`; it must be a declared dependency',
  );
});

test('UTV2-1684: post-merge proof binding uses resolved merge authority on every trigger', () => {
  const workflow = fs.readFileSync(
    path.join(ROOT, '.github/workflows/post-merge-lane-close.yml'),
    'utf8',
  );
  const bindStart = workflow.indexOf('- name: Bind proof artifacts to merge SHA');
  const closeStart = workflow.indexOf('- name: Run lane closeout (hard-gate)');
  const persistStart = workflow.indexOf('- name: Commit and push gate-evaluated closeout state');
  assert.ok(bindStart >= 0 && closeStart > bindStart && persistStart > closeStart);
  const bindBlock = workflow.slice(bindStart, closeStart);
  const bindCondition = bindBlock.split('\n').find((line) => line.trimStart().startsWith('if:')) ?? '';
  assert.doesNotMatch(bindCondition, /github\.event_name/);
  assert.match(bindBlock, /steps\.resolve_sha\.outputs\.merge_sha != ''/);
  assert.match(workflow, /gh pr view "\$pr_number" --json mergeCommit/);
  assert.doesNotMatch(workflow, /falling back to github\.sha/);
});

test('UTV2-1722: proof binding is persisted only after the closeout gate passes', () => {
  const workflow = fs.readFileSync(
    path.join(ROOT, '.github/workflows/post-merge-lane-close.yml'),
    'utf8',
  );
  const persistStart = workflow.indexOf('- name: Commit and push gate-evaluated closeout state');
  const closeStart = workflow.indexOf('- name: Run lane closeout (hard-gate)');
  const failStart = workflow.indexOf('- name: Fail on lane closeout failure');
  assert.ok(closeStart >= 0 && closeStart < failStart && failStart < persistStart);
  assert.match(workflow, /Refusing mismatched proof binding/);
  assert.match(workflow, /persistence is deferred until the closeout gate passes/);
  assert.match(workflow, /steps\.lane_close\.outputs\.exit_code == '0'/);
  assert.match(workflow, /Commit proof,\n\s+# manifest, and sync cleanup atomically/);
  assert.doesNotMatch(workflow, /chore\(proof\): bind \$ISSUE_ID/);
  assert.match(workflow, /--post-merge-trusted --retain-merge-lock/);
  assert.match(workflow, /Release closeout merge mutex after persistence attempt/);
  assert.match(workflow, /always\(\)/);
  assert.doesNotMatch(workflow, /git pull --rebase origin main/);
  assert.strictEqual(workflow.match(/pnpm ops:lane-close "\$\{close_args\[@\]\}"/gu)?.length, 1);
  assert.doesNotMatch(workflow, /pnpm ops:truth-check "\$ISSUE_ID" --explain/gu);
  assert.doesNotMatch(workflow, /git commit --amend --no-edit/);
  assert.match(workflow, /Refusing to rebase or retry; main remains unmutated/);
  assert.match(workflow, /ops:merge-lock release --issue "\$ISSUE_ID" --branch "\$manifest_branch"/);
});

function utv21684PostMergeStep(name: string): Record<string, unknown> {
  const workflowPath = process.env.UTV2_1684_WORKFLOW_FIXTURE ??
    path.join(ROOT, '.github', 'workflows', 'post-merge-lane-close.yml');
  const workflow = parseYaml(fs.readFileSync(workflowPath, 'utf8')) as {
    jobs?: { 'lane-close'?: { steps?: Array<Record<string, unknown>> } };
  };
  const step = workflow.jobs?.['lane-close']?.steps?.find((candidate) => candidate.name === name);
  assert.ok(step, `missing workflow step: ${name}`);
  return step;
}

function utv21684ExecutableMock(binDir: string, name: string, body: string): void {
  const target = path.join(binDir, name);
  fs.writeFileSync(target, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  fs.chmodSync(target, 0o755);
}

function runUtv21684PostMergeStep(
  name: string,
  options: { env?: NodeJS.ProcessEnv; mocks?: Record<string, string>; cwd?: string } = {},
) {
  const root = options.cwd ?? fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1684-step-'));
  const binDir = path.join(root, '.mock-bin');
  fs.mkdirSync(binDir, { recursive: true });
  for (const [command, body] of Object.entries(options.mocks ?? {})) {
    utv21684ExecutableMock(binDir, command, body);
  }
  const outputPath = path.join(root, 'github-output');
  const run = utv21684PostMergeStep(name).run;
  assert.strictEqual(typeof run, 'string');
  const result = spawnSync('bash', ['-c', run], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      GITHUB_OUTPUT: outputPath,
      ...options.env,
    },
  });
  return {
    ...result,
    root,
    output: fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '',
  };
}

const utv21684MergeSha = '1684168416841684168416841684168416841684';

test('UTV2-1684 behavior: missing mergeCommit fails closed and cannot fall back to github.sha', () => {
  const result = runUtv21684PostMergeStep('Resolve merge SHA', {
    env: { MANIFEST_PATH: 'manifest.json', EVENT_NAME: 'push', PUSH_SHA: utv21684MergeSha },
    mocks: {
      jq: "printf '%s\\n' 'https://github.com/griff843/Unit-Talk-v2/pull/1397'",
      gh: "printf '\\n'",
    },
  });
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /has no validated merge SHA/);
  assert.doesNotMatch(result.output, /merge_sha=/);
});

test('UTV2-1684 behavior: push identity divergence fails closed', () => {
  const result = runUtv21684PostMergeStep('Resolve merge SHA', {
    env: {
      MANIFEST_PATH: 'manifest.json',
      EVENT_NAME: 'push',
      PUSH_SHA: '9999999999999999999999999999999999999999',
    },
    mocks: {
      jq: "printf '%s\\n' 'https://github.com/griff843/Unit-Talk-v2/pull/1397'",
      gh: `printf '%s\\n' '${utv21684MergeSha}'`,
    },
  });
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /diverges from push SHA/);
  assert.doesNotMatch(result.output, /merge_sha=/);
});

test('UTV2-1722 behavior: failed closeout leaves durable proof unchanged', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1722-nondestructive-'));
  fs.writeFileSync(path.join(root, 'manifest.json'), '{}\n');
  const durableProof = path.join(root, 'durable-main-proof.md');
  fs.writeFileSync(durableProof, 'unbound-main-state\n');
  const proofDir = path.join(root, 'docs/06_status/proof/UTV2-1684');
  const bind = runUtv21684PostMergeStep('Bind proof artifacts to merge SHA', {
    cwd: root,
    env: { ISSUE_ID: 'UTV2-1684', MERGE_SHA: utv21684MergeSha, MANIFEST_PATH: 'manifest.json' },
    mocks: {
      jq: "printf '\\n'",
      pnpm: `mkdir -p '${proofDir}'\nprintf '%s\\n' '${utv21684MergeSha}' > '${path.join(proofDir, 'verification.md')}'`,
    },
  });
  assert.strictEqual(bind.status, 0, bind.stderr);

  const failedGate = runUtv21684PostMergeStep('Run lane closeout (hard-gate)', {
    cwd: root,
    env: { ISSUE_ID: 'UTV2-1684', EXPLICIT_PR: '' },
    mocks: {
      pnpm: "printf '%s\\n' '{\"verdict\":\"fail\"}'\nexit 17",
    },
  });
  assert.strictEqual(failedGate.status, 17, failedGate.stderr);
  assert.strictEqual(fs.readFileSync(durableProof, 'utf8'), 'unbound-main-state\n');
  assert.strictEqual(fs.existsSync(path.join(root, 'git-calls')), false);
});

test('UTV2-1722 behavior: guarded persistence pushes once then releases the retained mutex', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1684-retry-'));
  fs.mkdirSync(path.join(root, 'docs/06_status/proof/UTV2-1684'), { recursive: true });
  const eventLog = path.join(root, 'events');
  const result = runUtv21684PostMergeStep('Commit and push gate-evaluated closeout state', {
    cwd: root,
    env: {
      ISSUE_ID: 'UTV2-1684',
      MANIFEST_PATH: 'manifest.json',
      EVENT_LOG: eventLog,
    },
    mocks: {
      git: `printf 'git %s\\n' "$*" >> "$EVENT_LOG"
if [ "$1" = diff ]; then exit 1; fi
exit 0`,
    },
  });
  assert.strictEqual(result.status, 0, result.stderr);

  const release = runUtv21684PostMergeStep('Release closeout merge mutex after persistence attempt', {
    cwd: root,
    env: { ISSUE_ID: 'UTV2-1684', MANIFEST_PATH: 'manifest.json', EVENT_LOG: eventLog },
    mocks: {
      jq: "printf '%s\\n' 'codex/utv2-1684-closeout'",
      pnpm: `printf 'pnpm %s\\n' "$*" >> "$EVENT_LOG"`,
    },
  });
  assert.strictEqual(release.status, 0, release.stderr);
  const events = fs.readFileSync(eventLog, 'utf8').trim().split('\n');
  assert.strictEqual(events.filter((event) => event === 'git push').length, 1);
  assert.ok(events.indexOf('pnpm ops:merge-lock release --issue UTV2-1684 --branch codex/utv2-1684-closeout') > events.indexOf('git push'));
  assert.ok(events.every((event) => !event.includes('pull --rebase')));
});

test('UTV2-1722 behavior: a rejected guarded push never rebases or retries and still releases the mutex', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1722-retry-gate-fail-'));
  fs.mkdirSync(path.join(root, 'docs/06_status/proof/UTV2-1722'), { recursive: true });
  const gitLog = path.join(root, 'git-calls');
  const pnpmLog = path.join(root, 'pnpm-calls');
  const durableMain = path.join(root, 'durable-main-mutated');
  const result = runUtv21684PostMergeStep('Commit and push gate-evaluated closeout state', {
    cwd: root,
    env: {
      ISSUE_ID: 'UTV2-1722',
      MANIFEST_PATH: 'manifest.json',
      EXPLICIT_PR: '',
      GIT_LOG: gitLog,
      PNPM_LOG: pnpmLog,
      DURABLE_MAIN: durableMain,
    },
    mocks: {
      git: `printf '%s\n' "$*" >> "$GIT_LOG"
if [ "$1" = diff ]; then exit 1; fi
if [ "$1" = push ]; then
  exit 1
fi
exit 0`,
    },
  });

  assert.strictEqual(result.status, 1, result.stderr);
  assert.match(result.stdout + result.stderr, /guarded push rejected/);
  assert.match(result.stdout + result.stderr, /Refusing to rebase or retry; main remains unmutated/);
  const gitCalls = fs.readFileSync(gitLog, 'utf8').trim().split('\n');
  assert.strictEqual(gitCalls.filter((call) => call === 'push').length, 1);
  assert.ok(gitCalls.every((call) => call !== 'pull --rebase origin main'));
  assert.strictEqual(fs.existsSync(durableMain), false);

  const release = runUtv21684PostMergeStep('Release closeout merge mutex after persistence attempt', {
    cwd: root,
    env: { ISSUE_ID: 'UTV2-1722', MANIFEST_PATH: 'manifest.json', PNPM_LOG: pnpmLog },
    mocks: {
      jq: "printf '%s\\n' 'codex/utv2-1722-closeout-recovery'",
      pnpm: `printf '%s\\n' "$*" >> "$PNPM_LOG"`,
    },
  });
  assert.strictEqual(release.status, 0, release.stderr);
  assert.match(fs.readFileSync(pnpmLog, 'utf8'), /ops:merge-lock release --issue UTV2-1722 --branch codex\/utv2-1722-closeout-recovery/u);
});

test('UTV2-1722 supplemental shape: proof side effects are closeable-only and persistence is post-gate', () => {
  const workflow = readWorkflow('post-merge-lane-close.yml');
  assert.ok(
    workflow.indexOf('- name: Bind proof artifacts to merge SHA') <
      workflow.indexOf('- name: Run lane closeout (hard-gate)'),
  );
  assert.ok(
    workflow.indexOf('- name: Run lane closeout (hard-gate)') <
      workflow.indexOf('- name: Commit and push gate-evaluated closeout state'),
  );
  for (const name of ['Bind proof artifacts to merge SHA', 'Commit and push gate-evaluated closeout state']) {
    assert.match(String(utv21684PostMergeStep(name).if), /steps\.status\.outputs\.closeable == 'true'/u);
  }
  assert.match(
    String(utv21684PostMergeStep('Commit and push gate-evaluated closeout state').if),
    /steps\.lane_close\.outputs\.exit_code == '0'/u,
  );
});

test('UTV2-1713: linear-auto-close is not queued behind the closeout mutex', () => {
  // `cancel-in-progress: false` protects a RUNNING job, but GitHub keeps at
  // most one PENDING run per concurrency group, so a run queued behind the
  // mutex is cancelled when a newer run enters that group -- with no retry and
  // no replacement run. Observed on UTV2-1690's closeout: run 31900689921 on
  // 52b4878b was cancelled while queued, the manifest reached `done`, and the
  // Linear issue stayed open until a human moved it.
  const closeout = objectField(readWorkflowYaml('post-merge-lane-close.yml'), 'concurrency');
  const linear = objectField(readWorkflowYaml('linear-auto-close.yml'), 'concurrency');

  assert.strictEqual(
    String(closeout.group),
    'merge-closeout-mutex',
    'the closeout writer keeps the shared mutex: it commits to main and must stay serialized',
  );

  assert.notStrictEqual(
    String(linear.group),
    String(closeout.group),
    'linear-auto-close must not share the closeout mutex; a queued run there is cancelled outright',
  );
  assert.match(
    String(linear.group),
    /\$\{\{\s*github\.sha\s*\}\}/u,
    'linear-auto-close must scope its concurrency group per commit so distinct merges never queue behind one another',
  );
});

// WORK-2026092501: Claude Code hands PreToolUse hooks absolute paths. The Tier C guard
// must classify those, and its manifest bypass must read the worktree the target lives in.
const TIER_C_GUARD = path.join(ROOT, '.claude', 'hooks', 'tier-c-path-guard.sh');

function runTierCGuard(filePath: string, cwd: string): number | null {
  const result = spawnSync('bash', [TIER_C_GUARD], {
    cwd,
    input: JSON.stringify({ tool_input: { file_path: filePath } }),
    encoding: 'utf8',
  });
  return result.status;
}

function makeLaneRepo(manifest: Record<string, unknown> | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-c-guard-'));
  const git = (...args: string[]) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  };
  git('init', '-q', '-b', 'claude/work-2099010101-guard');
  fs.mkdirSync(path.join(dir, 'supabase', 'migrations'), { recursive: true });
  if (manifest) {
    fs.mkdirSync(path.join(dir, 'docs', '06_status', 'lanes'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'docs', '06_status', 'lanes', `${String(manifest.issue_id)}.json`),
      JSON.stringify(manifest),
    );
  }
  // A lane worktree always has a commit; without one HEAD has no branch name to read.
  git('-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}

test('tier-c-path-guard classifies an absolute Tier C path, not only a relative one', () => {
  const dir = makeLaneRepo(null);
  try {
    assert.strictEqual(runTierCGuard(path.join(dir, 'supabase', 'migrations', 'x.sql'), os.tmpdir()), 2);
    assert.strictEqual(runTierCGuard('supabase/migrations/x.sql', dir), 2);
    assert.strictEqual(runTierCGuard(path.join(dir, 'apps', 'api', 'src', 'server.ts'), os.tmpdir()), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tier-c-path-guard allows a path outside any git repository', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-c-guard-norepo-'));
  try {
    assert.strictEqual(runTierCGuard(path.join(dir, 'supabase', 'migrations', 'x.sql'), os.tmpdir()), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tier-c-path-guard honours a WORK lane manifest from the target worktree, and only an open one on its branch', () => {
  const lane = {
    issue_id: 'WORK-2099010101',
    status: 'in_progress',
    branch: 'claude/work-2099010101-guard',
    file_scope_lock: ['supabase/migrations/x.sql'],
  };
  const cases: Array<[Record<string, unknown>, number]> = [
    [lane, 0],
    [{ ...lane, status: 'done' }, 2],
    [{ ...lane, branch: 'claude/work-2099010101-other' }, 2],
  ];
  for (const [manifest, expected] of cases) {
    const dir = makeLaneRepo(manifest);
    try {
      assert.strictEqual(
        runTierCGuard(path.join(dir, 'supabase', 'migrations', 'x.sql'), os.tmpdir()),
        expected,
        `manifest ${JSON.stringify(manifest)} must yield exit ${expected}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

// WORK-2026092706: scripts/ci/seed-staging-fixtures.ts deletes every row of
// system_runs, distribution_outbox and distribution_receipts in the shared staging
// database. A job that runs it while another such job is mid-proof deletes that
// run's in-flight rows, so every job that runs the reset joins one cross-workflow
// concurrency group and never cancels a running proof.
//
// Only the resetting jobs may join. GitHub keeps one pending job per group and
// cancels the older pending one when another arrives, so a sibling job fired by the
// same pull_request event (proof-gate.yml's T1 Proof Gate) would cancel `verify`'s
// staging job on every T1 push. Measured on the first revision of this change.
test('every job that runs the staging seed reset, and only those, is serialized in staging-ci-db', () => {
  const workflowDir = path.join(ROOT, '.github', 'workflows');
  const resetters: string[] = [];
  const grouped: string[] = [];
  for (const file of fs.readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const doc = readWorkflowYaml(file);
    const jobs = doc['jobs'];
    if (!jobs || typeof jobs !== 'object') continue;
    for (const [jobId, rawJob] of Object.entries(jobs as Record<string, unknown>)) {
      if (!rawJob || typeof rawJob !== 'object') continue;
      const job = rawJob as WorkflowDocument;
      const steps = Array.isArray(job['steps']) ? (job['steps'] as WorkflowDocument[]) : [];
      const resets = steps.some((step) => typeof step?.['run'] === 'string' && (step['run'] as string).includes('seed-staging-fixtures.ts'));
      const concurrency = job['concurrency'];
      const group = concurrency && typeof concurrency === 'object' ? (concurrency as WorkflowDocument)['group'] : concurrency;
      if (group === 'staging-ci-db') grouped.push(`${file}:${jobId}`);
      if (!resets) continue;
      resetters.push(`${file}:${jobId}`);
      assert.ok(
        concurrency && typeof concurrency === 'object',
        `${file}:${jobId} runs the staging seed reset but declares no job-level concurrency`,
      );
      const c = concurrency as WorkflowDocument;
      assert.equal(c['group'], 'staging-ci-db', `${file}:${jobId} must join concurrency group staging-ci-db`);
      assert.equal(c['cancel-in-progress'], false, `${file}:${jobId} must never cancel a running staging proof`);
    }
  }
  assert.ok(resetters.length >= 2, `expected at least 2 jobs running the staging seed reset, found ${resetters.length}: ${resetters.join(', ')}`);
  assert.deepEqual(grouped, resetters, 'only jobs that run the staging seed reset may join staging-ci-db');
});
