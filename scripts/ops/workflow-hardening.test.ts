import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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
  const reviews: Array<{ state: string; user?: { login: string; type: string } }> = [];
  // UTV2-1572: issue timeline events, so the evaluator can verify WHO applied
  // `t1-approved`. Tier labels the evaluator itself applies are recorded as
  // applied by the Actions bot, exactly as GitHub would record them.
  const labelEvents: Array<{ event: string; label: { name: string }; actor: { login: string; type: string } | null }> = [];
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
          if (typeof params.external_id === 'string') check.external_id = params.external_id;
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
            labelEvents.push({ event: 'labeled', label: { name: label }, actor: { login: 'github-actions[bot]', type: 'Bot' } });
          }
          return { data: labels.map((name) => ({ name })) };
        },
        listEvents: async (params: Record<string, unknown>) => {
          assert.strictEqual(params.issue_number, prNumber);
          return { data: Number(params.page ?? 1) === 1 ? labelEvents : [] };
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
    labelEvents,
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
  harness.labelEvents.push({ event: 'labeled', label: { name: 't1-approved' }, actor: { login: 'griff843', type: 'User' } });
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

test('UTV2-1572: a t1-approved label applied by unit-talk-executor[bot] is rejected by the live evaluator script', async () => {
  const harness = await createMergeGateHarness('T1');
  await harness.run('pull_request');

  // A valid human verdict exists; only the label provenance is wrong.
  harness.comments.push({
    body: [
      'PM_VERDICT: APPROVED',
      'schema: pm-verdict/v1',
      'Issue: UTV2-1585',
      `PR: ${harness.prNumber}`,
      `Head SHA: ${harness.headSha}`,
    ].join('\n'),
    created_at: '2026-09-02T18:00:00Z',
    user: { login: 'griff843', type: 'User' },
  });
  harness.labels.push('t1-approved');
  harness.labelEvents.push({ event: 'labeled', label: { name: 't1-approved' }, actor: { login: 'unit-talk-executor[bot]', type: 'Bot' } });

  await harness.run('issue_comment');
  assert.strictEqual(harness.checks[0].conclusion, 'failure');
  assert.match(
    JSON.stringify(harness.checks[0].output ?? {}),
    /applied by bot account \\"unit-talk-executor\[bot\]\\"/,
    'the check output must name the executor App as the rejected label actor',
  );

  // The human re-applying the label (most recent grant) restores authority.
  harness.labelEvents.push({ event: 'unlabeled', label: { name: 't1-approved' }, actor: { login: 'griff843', type: 'User' } });
  harness.labelEvents.push({ event: 'labeled', label: { name: 't1-approved' }, actor: { login: 'griff843', type: 'User' } });
  await harness.run('issue_comment');
  assert.strictEqual(harness.checks[0].conclusion, 'success');
});

test('UTV2-1572: a pm-verdict/v1 APPROVED posted by unit-talk-executor[bot] does not satisfy T1 in the live evaluator script', async () => {
  const harness = await createMergeGateHarness('T1');
  await harness.run('pull_request');
  harness.labels.push('t1-approved');
  harness.labelEvents.push({ event: 'labeled', label: { name: 't1-approved' }, actor: { login: 'griff843', type: 'User' } });
  harness.comments.push({
    body: [
      'PM_VERDICT: APPROVED',
      'schema: pm-verdict/v1',
      'Issue: UTV2-1585',
      `PR: ${harness.prNumber}`,
      `Head SHA: ${harness.headSha}`,
    ].join('\n'),
    created_at: '2026-09-02T18:00:00Z',
    user: { login: 'unit-talk-executor[bot]', type: 'Bot' },
  });
  await harness.run('issue_comment');
  assert.strictEqual(harness.checks[0].conclusion, 'failure');
  assert.match(JSON.stringify(harness.checks[0].output ?? {}), /bot account \\"unit-talk-executor\[bot\]\\" is not authorized/);
});

test('UTV2-1572: T2 ignores an App review approval but accepts an EXECUTOR_RESULT self-attestation posted by unit-talk-executor[bot]', async () => {
  const harness = await createMergeGateHarness('T2');
  await harness.run('pull_request');
  assert.strictEqual(harness.checks[0].conclusion, 'failure');

  harness.reviews.push({ state: 'APPROVED', user: { login: 'unit-talk-executor[bot]', type: 'Bot' } });
  await harness.run('pull_request_review');
  assert.strictEqual(harness.checks[0].conclusion, 'failure', 'a Bot review approval carries no authority');

  harness.reviews.splice(0, harness.reviews.length);
  harness.comments.push({
    body: [
      'EXECUTOR_RESULT: READY_FOR_REVIEW',
      'schema: executor-result/v1',
      'Issue: UTV2-1585',
      'Lane: claude',
      `PR: ${harness.prNumber}`,
      `Head SHA: ${harness.headSha}`,
    ].join('\n'),
    created_at: '2026-09-02T18:00:00Z',
    user: { login: 'unit-talk-executor[bot]', type: 'Bot' },
  });
  await harness.run('issue_comment');
  assert.strictEqual(harness.checks[0].conclusion, 'success', 'the migrated executor identity must keep T2 self-attestation working');

  // Any OTHER bot posting the same attestation is rejected.
  harness.comments.splice(0, harness.comments.length, { ...harness.comments[0], user: { login: 'github-actions[bot]', type: 'Bot' } });
  await harness.run('issue_comment');
  assert.strictEqual(harness.checks[0].conclusion, 'failure');
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

test('UTV2-1585: same-identity duplicate exact-head failures are neutralized and cannot override the canonical result', async () => {
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

// UTV2-1585 (adversarial review finding): true pre-fix duplicates -- the ones
// actually left on already-polluted heads like PR #1304's, created by the
// former create-on-every-event behavior -- never had a canonical (or any
// matching) external_id set. Matching on external_id alone would let those
// survive untouched forever. Adoption must work by name + exact head SHA +
// app alone, regardless of external_id.
test('UTV2-1585: pre-fix legacy duplicates without a canonical external_id are adopted and neutralized, not left blocking', async () => {
  const headSha = '1585158515851585158515851585158515851585';
  const harnessPrNumber = 1585;
  // Mirrors the real state observed on PR #1304's head after the former
  // create-on-every-event behavior: six same-head "Merge Gate" checks, none
  // carrying the canonical external_id format, four of them failure.
  const harness = await createMergeGateHarness('T3', [
    { id: 100, name: 'Merge Gate', head_sha: headSha, external_id: '3dd4c479-23c0-58a9-94de-3da9c130d6a9', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'failure' },
    { id: 101, name: 'Merge Gate', head_sha: headSha, external_id: 'ea2023ef-0e17-54d1-a5ec-18c7a0431972', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'failure' },
    { id: 102, name: 'Merge Gate', head_sha: headSha, external_id: '066178b1-5a03-5e40-a62d-aae8aa550458', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'failure' },
    { id: 103, name: 'Merge Gate', head_sha: headSha, external_id: 'ee820f51-4b9a-58ba-b049-ba1e6ee02988', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'failure' },
    { id: 104, name: 'Merge Gate', head_sha: headSha, external_id: 'af7bb44a-f42d-58a9-b23f-66a41ffb4dd8', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success' },
    { id: 105, name: 'Merge Gate', head_sha: headSha, external_id: '', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success' },
  ]);

  await harness.run('pull_request');

  assert.strictEqual(harness.createCount(), 0, 'a same-head legacy check must be adopted, not duplicated with a 7th check');
  assert.strictEqual(harness.checks.length, 6, 'no new check-run is created when six legacy same-head checks already exist');
  const canonical = harness.checks.find((check) => check.id === 105);
  assert.strictEqual(canonical?.external_id, `merge-gate:${harnessPrNumber}:${headSha}`, 'the adopted legacy check (highest id among non-canonical matches) must be bound to the canonical external_id going forward');
  for (const legacyId of [100, 101, 102, 103, 104]) {
    assert.strictEqual(harness.checks.find((check) => check.id === legacyId)?.conclusion, 'neutral', `legacy check ${legacyId} must be neutralized, not left as failure`);
  }
  assert.ok(
    harness.checks.every((check) => check.conclusion !== 'failure'),
    'no pre-fix legacy failure may remain capable of blocking an already-polluted head once this evaluator runs',
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

  const raw = fs.readFileSync(path.join(ROOT, '.github/workflows/executor-result-validator.yml'), 'utf8');
  assert.match(
    raw,
    /conclusion: passed \? 'success' : isRequired \? 'failure' : 'neutral'/,
    'non-required executor preflight failures must be neutral while required validation stays fail-closed',
  );
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
  RECEIPT_SCHEMA,
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
