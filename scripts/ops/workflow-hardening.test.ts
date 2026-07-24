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

interface MockCheckRun {
  id: number;
  name: string;
  head_sha: string;
  external_id: string;
  app: { slug: string };
  status: string;
  conclusion: string | null;
  output?: { title?: string; summary?: string };
}

interface MockComment {
  body: string;
  created_at: string;
  user: { login: string; type: string };
}

async function createMergeGateHarness(tier: 'T1' | 'T2' | 'T3', initialChecks: MockCheckRun[] = []) {
  const workflow = readWorkflowYaml('merge-gate.yml');
  const gate = objectField(objectField(workflow, 'jobs'), 'gate');
  const steps = gate.steps as Array<Record<string, unknown>>;
  const evalStep = steps.find(
    (step) => typeof step.with === 'object' && step.with && typeof (step.with as Record<string, unknown>).script === 'string',
  );
  assert.ok(evalStep, 'merge-gate.yml must have an executable github-script step');

  const script = stringField(objectField(evalStep, 'with'), 'script');

  type AsyncScript = (...args: unknown[]) => Promise<void>;
  type AsyncFunctionConstructor = new (...args: string[]) => AsyncScript;
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as AsyncFunctionConstructor;
  const evaluate = new AsyncFunction('github', 'context', 'core', 'require', script);
  const verdictModule = await import('./merge-gate-verdict.cjs');

  const prNumber = 1585;
  const headSha = '1585158515851585158515851585158515851585';
  const baseSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const pr = {
    number: prNumber,
    head: { sha: headSha, ref: 'codex/utv2-1585-canonical-check' },
    base: { sha: baseSha },
    title: 'feat(ops): UTV2-1585 canonical check identity',
  };
  const labels = [`tier:${tier}`];
  const comments: MockComment[] = [];
  const reviews: Array<{ state: string }> = [];
  const postedGateComments: string[] = [];
  const checks = initialChecks.map((check) => ({ ...check, app: { ...check.app } }));
  let createCount = 0;
  let nextCheckId = Math.max(0, ...checks.map((check) => check.id)) + 1;

  const listForRef = async (params: Record<string, unknown>) => {
    assert.strictEqual(params.ref, headSha);
    assert.strictEqual(params.check_name, 'Merge Gate');
    assert.strictEqual(params.filter, 'all');
    assert.strictEqual(params.per_page, 100);
    return { data: { check_runs: checks } };
  };

  const github = {
    paginate: async (
      endpoint: (params: Record<string, unknown>) => Promise<{ data: { check_runs: MockCheckRun[] } }>,
      params: Record<string, unknown>,
    ) => (await endpoint(params)).data.check_runs,
    rest: {
      checks: {
        listForRef,
        create: async (params: Record<string, unknown>) => {
          createCount += 1;
          const check: MockCheckRun = {
            id: nextCheckId++,
            name: String(params.name),
            head_sha: String(params.head_sha),
            external_id: String(params.external_id),
            app: { slug: 'github-actions' },
            status: String(params.status),
            conclusion: null,
          };
          checks.push(check);
          return { data: check };
        },
        update: async (params: Record<string, unknown>) => {
          const check = checks.find((candidate) => candidate.id === params.check_run_id);
          assert.ok(check, `check ${String(params.check_run_id)} must exist before update`);
          if (typeof params.status === 'string') check.status = params.status;
          if (typeof params.conclusion === 'string') check.conclusion = params.conclusion;
          if (params.status === 'in_progress') check.conclusion = null;
          if (params.output && typeof params.output === 'object') {
            check.output = params.output as MockCheckRun['output'];
          }
          return { data: check };
        },
      },
      issues: {
        get: async () => ({ data: { labels: labels.map((name) => ({ name })) } }),
        addLabels: async (params: Record<string, unknown>) => {
          for (const label of params.labels as string[]) {
            if (!labels.includes(label)) labels.push(label);
          }
          return { data: labels.map((name) => ({ name })) };
        },
        listComments: async () => ({ data: comments }),
        createComment: async (params: Record<string, unknown>) => {
          postedGateComments.push(String(params.body));
          return { data: { id: postedGateComments.length } };
        },
      },
      pulls: {
        get: async () => ({ data: pr }),
        listReviews: async () => ({ data: reviews }),
      },
      repos: {
        getContent: async () => ({
          data: {
            content: Buffer.from(JSON.stringify({ issue_id: 'UTV2-1585', tier })).toString('base64'),
            encoding: 'base64',
          },
        }),
      },
    },
  };

  async function run(eventName: 'pull_request' | 'pull_request_review' | 'issue_comment') {
    const payload =
      eventName === 'issue_comment'
        ? { issue: { number: prNumber }, comment: { body: 'PM_VERDICT:' } }
        : { pull_request: pr };
    let evaluatorFailure: string | null = null;
    const core = {
      setFailed: (message: string) => {
        evaluatorFailure = message;
      },
    };
    const requireModule = (specifier: unknown) => {
      assert.strictEqual(specifier, './scripts/ops/merge-gate-verdict.cjs');
      return verdictModule;
    };

    await evaluate(github, { eventName, payload, repo: { owner: 'unit-talk', repo: 'v2' } }, core, requireModule);
    assert.strictEqual(
      evaluatorFailure,
      null,
      'policy denial must fail the canonical check without failing the Merge Gate Evaluator job',
    );
  }

  return {
    checks,
    comments,
    reviews,
    labels,
    postedGateComments,
    prNumber,
    headSha,
    run,
    createCount: () => createCount,
  };
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

test('UTV2-1551: merge gate is structurally wired for PM verdict comments and evaluates fresh (opened) PRs', () => {
  // Prior to UTV2-1551 this list deliberately omitted `opened` -- a fresh PR
  // got zero Merge Gate evaluation from PR creation itself, only from a
  // later push/label/review/comment event, which could leave a brand-new
  // T1/T2 PR sitting `mergeStateStatus: BLOCKED` with the required check
  // never having run at all. `opened` is included now: the gate job's own
  // per-tier logic already fails closed (reports BLOCKED, does not approve)
  // when no tier label / lane manifest / PM verdict exists yet, which is
  // exactly the correct status for a truly fresh PR -- so evaluating on
  // `opened` cannot cause a premature approval, only an earlier, visible
  // BLOCKED status instead of silence.
  const pullRequest = workflowEvent('merge-gate.yml', 'pull_request');
  const issueComment = workflowEvent('merge-gate.yml', 'issue_comment');
  const jobs = objectField(readWorkflowYaml('merge-gate.yml'), 'jobs');
  const gateIf = stringField(objectField(jobs, 'gate'), 'if');

  assert.deepStrictEqual(stringArrayField(pullRequest, 'types'), [
    'opened',
    'synchronize',
    'reopened',
    'labeled',
    'unlabeled',
    'ready_for_review',
  ]);
  assert.deepStrictEqual(stringArrayField(issueComment, 'types'), ['created', 'edited']);
  assert.match(gateIf, /PM_VERDICT:/, 'merge gate must respond to PM verdict comments');
  // The gate job's own `if:` already runs unconditionally for every
  // pull_request event type (no per-type restriction beyond the trigger
  // list above), so adding `opened` to the trigger is sufficient by itself
  // -- no separate `if:` change is needed for the gate to evaluate on it.
  assert.match(
    gateIf,
    /github\.event_name == 'pull_request'/,
    'merge gate job condition must run unconditionally for pull_request events (including opened) without a narrower per-type restriction',
  );
});

test('UTV2-1585: only the custom exact-head check owns the required Merge Gate identity', () => {
  const workflow = readWorkflowYaml('merge-gate.yml');
  const pullRequestReview = workflowEvent('merge-gate.yml', 'pull_request_review');
  const gate = objectField(objectField(workflow, 'jobs'), 'gate');
  const concurrency = objectField(gate, 'concurrency');

  assert.strictEqual(
    gate.name,
    'Merge Gate Evaluator',
    'the native Actions job check must not collide with the required custom Merge Gate check',
  );
  assert.deepStrictEqual(stringArrayField(pullRequestReview, 'types'), ['submitted', 'edited', 'dismissed']);
  assert.match(
    stringField(concurrency, 'group'),
    /inputs\.pull_number/,
    'workflow_dispatch must serialize on the same per-PR concurrency identity as webhook events',
  );
  assert.strictEqual(
    concurrency['cancel-in-progress'],
    false,
    'canonical check evaluations must queue instead of cancelling a run that already marked the check in_progress',
  );
});

test('UTV2-1585: T1 pre-verdict, review, and exact-head verdict events update one canonical check in place', async () => {
  const harness = await createMergeGateHarness('T1');

  await harness.run('pull_request');
  assert.strictEqual(harness.createCount(), 1);
  assert.strictEqual(harness.checks.length, 1);
  const canonicalId = harness.checks[0].id;
  assert.strictEqual(harness.checks[0].external_id, `merge-gate:${harness.prNumber}:${harness.headSha}`);
  assert.strictEqual(harness.checks[0].conclusion, 'failure');

  await harness.run('pull_request_review');
  assert.strictEqual(harness.createCount(), 1, 'a pre-verdict review event must not create a second check');
  assert.strictEqual(harness.checks.length, 1);
  assert.strictEqual(harness.checks[0].id, canonicalId);
  assert.strictEqual(harness.checks[0].conclusion, 'failure');

  harness.labels.push('t1-approved');
  harness.comments.push({
    body: [
      'PM_VERDICT: APPROVED',
      'schema: pm-verdict/v1',
      'Issue: UTV2-1585',
      `PR: ${harness.prNumber}`,
      `Head SHA: ${harness.headSha}`,
    ].join('\n'),
    created_at: '2026-07-24T15:30:00Z',
    user: { login: 'griff843', type: 'User' },
  });

  await harness.run('issue_comment');
  assert.strictEqual(harness.createCount(), 1, 'the exact-head verdict event must reuse the existing check');
  assert.strictEqual(harness.checks.length, 1);
  assert.strictEqual(harness.checks[0].id, canonicalId);
  assert.strictEqual(harness.checks[0].conclusion, 'success');
});

test('UTV2-1585: T2 review approval and dismissal re-evaluate the same canonical check', async () => {
  const harness = await createMergeGateHarness('T2');

  await harness.run('pull_request');
  assert.strictEqual(harness.checks[0].conclusion, 'failure');

  harness.reviews.push({ state: 'APPROVED' });
  await harness.run('pull_request_review');
  assert.strictEqual(harness.checks[0].conclusion, 'success');

  harness.reviews.splice(0, harness.reviews.length, { state: 'DISMISSED' });
  await harness.run('pull_request_review');
  assert.strictEqual(harness.checks[0].conclusion, 'failure');
  assert.strictEqual(harness.createCount(), 1);
  assert.strictEqual(harness.checks.length, 1);
});

test('UTV2-1585: legacy duplicate exact-head failures are neutralized and cannot override the canonical result', async () => {
  const headSha = '1585158515851585158515851585158515851585';
  const harnessPrNumber = 1585;
  const harness = await createMergeGateHarness('T3', [
    {
      id: 4,
      name: 'Merge Gate',
      head_sha: headSha,
      external_id: `merge-gate:${harnessPrNumber}:${headSha}`,
      app: { slug: 'github-actions' },
      status: 'completed',
      conclusion: 'failure',
    },
    {
      id: 9,
      name: 'Merge Gate',
      head_sha: headSha,
      external_id: `merge-gate:${harnessPrNumber}:${headSha}`,
      app: { slug: 'github-actions' },
      status: 'completed',
      conclusion: 'failure',
    },
  ]);

  await harness.run('pull_request');

  assert.strictEqual(harness.createCount(), 0, 'an existing exact-head check must be reused');
  assert.strictEqual(harness.checks.find((check) => check.id === 9)?.conclusion, 'success');
  assert.strictEqual(harness.checks.find((check) => check.id === 4)?.conclusion, 'neutral');
  assert.ok(
    harness.checks.every((check) => check.conclusion !== 'failure'),
    'no older same-name failure may remain capable of blocking the unchanged head',
  );
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

test('UTV2-1554/UTV2-1543: merge-gate.yml gate job never fetches or executes content keyed on pull_request.head.sha', () => {
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

    // 2. No `run:` step may materialize file content by combining
    //    pull_request.head.sha with a fetch/read/write verb. This is the
    //    "PR-head bootstrap fetch fallback" shape that must never exist:
    //    it would let a PR overwrite the trusted verdict-validation module
    //    before this privileged job requires it.
    if (typeof step.run === 'string') {
      const referencesHeadSha = /pull_request\.head\.sha/.test(step.run);
      const materializesContent = /git\s+(fetch|show|checkout)|curl\s|wget\s|>\s*scripts\//.test(step.run);
      assert.ok(
        !(referencesHeadSha && materializesContent),
        `${stepName}: run step must not fetch/materialize content keyed on pull_request.head.sha -- found a bootstrap-style fallback:\n${step.run}`,
      );
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
});
