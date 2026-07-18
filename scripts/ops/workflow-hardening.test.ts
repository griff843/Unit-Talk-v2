import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
    // executor-result-validator.yml is intentionally excluded here and checked
    // separately below: UTV2-1550 makes its check name dynamic (resolved from
    // the triggering event, not a static job.name), specifically so that
    // pull_request-triggered runs never expose the required "Executor Result
    // Validation" name in the first place. See the dedicated test after this
    // one for what it asserts instead.
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

test('UTV2-1550: executor-result-validator.yml never exposes the required check name on pull_request', async () => {
  const { resolveCheckName, isRequiredCheckName, REQUIRED_CHECK_NAME, PREFLIGHT_CHECK_NAME } = await import(
    './executor-result-validate.ts'
  );

  const workflow = readWorkflowYaml('executor-result-validator.yml');
  const pullRequest = objectField(objectField(workflow, 'on'), 'pull_request');
  const jobs = objectField(workflow, 'jobs');
  const job = objectField(jobs, 'validate');

  assert.ok(
    stringArrayField(pullRequest, 'types').includes('synchronize'),
    'executor-result-validator.yml must rerun on synchronize',
  );
  assert.ok(Array.isArray(job.steps), 'executor-result-validator.yml job validate must have executable steps');

  // The job's own static name must NOT be the required context — otherwise
  // GitHub's own native per-job check run would recreate the exact bug this
  // lane fixes, regardless of the dynamic custom check name logic below.
  assert.notStrictEqual(
    job.name,
    REQUIRED_CHECK_NAME,
    'the job-level name must not equal the required check name, or every pull_request-triggered run would still create a native check under that identity',
  );

  // The dynamic check-name resolution itself, which the workflow looks up
  // via `tsx scripts/ops/executor-result-validate.ts resolve-check-name`
  // rather than hand-duplicating.
  assert.strictEqual(resolveCheckName('pull_request'), PREFLIGHT_CHECK_NAME);
  assert.strictEqual(resolveCheckName('issue_comment'), REQUIRED_CHECK_NAME);
  assert.strictEqual(resolveCheckName('workflow_dispatch'), REQUIRED_CHECK_NAME);
  assert.strictEqual(isRequiredCheckName('pull_request'), false);
  assert.strictEqual(isRequiredCheckName('issue_comment'), true);

  // The workflow step that performs this resolution must exist and must
  // call the same script the assertions above imported from, so the
  // workflow can never hand-duplicate a diverging literal.
  const steps = job.steps as Array<Record<string, unknown>>;
  const resolveStep = steps.find(
    (s) => typeof s.run === 'string' && (s.run as string).includes('executor-result-validate.ts resolve-check-name'),
  );
  assert.ok(resolveStep, 'executor-result-validator.yml must resolve its check name via the tested script, not a duplicated literal');
});

test('UTV2-1550 follow-up: executor-result-validator.yml never executes PR-controlled code to resolve the check name', () => {
  // Codex P1: the "Resolve check name" step runs the checked-out copy of
  // scripts/ops/executor-result-validate.ts in a job holding checks: write.
  // actions/checkout defaults to the PR's own head/merge ref on pull_request
  // events -- a PR could alter that script to defeat the identity fix above.
  // The checkout must instead pin to the PR's base SHA (immutable, reachable
  // from main, never PR-supplied) on pull_request; other event types keep
  // the default github.sha, which already resolves to the base repo's
  // default-branch HEAD for those triggers.
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
    "${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.sha }}",
    'Checkout must pin ref to the PR base SHA on pull_request so a PR can never make the privileged job execute its own modified check-name-resolution script',
  );
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
  assert.strictEqual(concurrency['cancel-in-progress'], true);
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

  // Same privilege-boundary requirement as the Executor Result Validator fix
  // (UTV2-1550): this job holds checks/pull-requests/issues: write, so the
  // checkout must never resolve to PR-controlled content for pull_request(_
  // review) events, or a PR could modify merge-gate-verdict.cjs to defeat
  // its own T1 freshness check.
  const checkoutStep = steps[checkoutIndex] as Record<string, unknown>;
  const withBlock = objectField(checkoutStep, 'with');
  assert.strictEqual(
    withBlock.ref,
    "${{ (github.event_name == 'pull_request' || github.event_name == 'pull_request_review') && github.event.pull_request.base.sha || github.sha }}",
    'Checkout must pin ref to the PR base SHA on pull_request(_review) so a PR can never make this privileged job execute its own modified verdict-validation module',
  );
});

test('UTV2-1543 bootstrap: merge-gate.yml recovers merge-gate-verdict.cjs from the PR head only when absent at the pinned base checkout', () => {
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
  const bootstrapIndex = steps.findIndex(
    (s) => typeof s.run === 'string' && (s.run as string).includes('merge-gate-verdict.cjs'),
  );

  assert.notStrictEqual(bootstrapIndex, -1, 'merge-gate.yml gate job must have a bootstrap-recovery step for merge-gate-verdict.cjs');
  assert.ok(
    checkoutIndex < bootstrapIndex && bootstrapIndex < evalIndex,
    'the bootstrap step must run after Checkout and before Evaluate merge gate',
  );

  const bootstrapStep = steps[bootstrapIndex] as Record<string, unknown>;

  // Must be scoped to pull_request(_review) only -- issue_comment/workflow_dispatch
  // already checkout github.sha (main HEAD), which by definition has the file
  // for any PR already merged, so the bootstrap path is meaningless there.
  assert.match(
    String(bootstrapStep.if),
    /pull_request/,
    'the bootstrap step must be scoped to pull_request(_review) events',
  );

  // Must only run when the file is genuinely absent at the pinned base
  // checkout -- for every PR that merely edits (not introduces) the file,
  // base.sha already has last-merged trusted content and this must stay a
  // no-op, or a malicious PR could force the bootstrap path unconditionally
  // and defeat the base-pin entirely.
  assert.match(
    String(bootstrapStep.if),
    /hashFiles\('scripts\/ops\/merge-gate-verdict\.cjs'\)\s*==\s*''/,
    'the bootstrap step must be gated on the file being absent from the base-pinned checkout, not run unconditionally',
  );

  // Must source content from the PR's own head SHA, not any other ref, and
  // must not silently fall back to trusting an unrelated/attacker-chosen ref.
  assert.match(
    String(bootstrapStep.run),
    /github\.event\.pull_request\.head\.sha/,
    'the bootstrap step must fetch and read the file from the PR head SHA specifically',
  );
});
