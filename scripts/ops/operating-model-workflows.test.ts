import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parse as parseYaml } from 'yaml';
import { ROOT } from './shared.js';
import { createTempWorkspace } from './temp-workspace.js';

// WORK-2026110804: executes the REAL github-script bodies of the changed
// workflows against stubbed GitHub APIs, so the cutover/compatibility matrix is
// demonstrated on the code that actually runs in CI, not on a re-implementation.

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<unknown>;
const rootRequire = createRequire(path.join(ROOT, 'noop.js'));

function readWorkflowText(name: string): string {
  return fs.readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8');
}
function readWorkflow(name: string): Doc {
  return parseYaml(readWorkflowText(name)) as Doc;
}
function findStep(workflow: Doc, jobId: string, stepName: string): Doc {
  const step = (workflow.jobs[jobId].steps as Doc[]).find(candidate => candidate.name === stepName);
  assert.ok(step, `step "${stepName}" not found in job ${jobId}`);
  return step as Doc;
}

const HEAD = 'c'.repeat(40);
const BASE = 'd'.repeat(40);
// Must be in the past: a future LEAN_MODE_ACTIVATED_AT disarms lean.
const ACTIVATED = '2026-01-01T00:00:00Z';
const CODEX_GQL = 'chatgpt-codex-connector';
const DOC = 'docs/03_product/notes.md';

interface Fixture {
  branch: string;
  title?: string;
  labels?: string[];
  files?: Array<Record<string, unknown>>;
  reviews?: Array<Record<string, unknown>>;
  threads?: Array<Record<string, unknown>>;
  summaries?: Array<Record<string, unknown>>;
  comments?: Array<Record<string, unknown>>;
  contents?: Record<string, string>;
  manifest?: Record<string, unknown> | null;
  liveHead?: string;
  env: Record<string, string>;
}

function standardFile(filename = DOC) {
  return { filename, status: 'modified', additions: 4, deletions: 1, patch: '@@ -1 +1 @@\n+new text\n-old text\n' };
}
const PROTECTED_FILE = { filename: '.github/workflows/ci.yml', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n+a\n-b\n' };
// GraphQL review shape (what collectIndependentReviewInputs reads).
function trustedReview(commit = HEAD, overrides: Record<string, unknown> = {}) {
  return { databaseId: 10, author: { login: CODEX_GQL, __typename: 'Bot' }, commit: { oid: commit }, state: 'COMMENTED', body: 'No blocking issues.', submittedAt: '2026-12-03T01:00:00Z', ...overrides };
}
function cleanSummary(commit = HEAD) {
  const state = { code_review: { commit_sha: commit, has_any_findings: false, has_unresolved_findings: false, status: 'completed' } };
  return { author: { login: CODEX_GQL, __typename: 'Bot' }, editor: { login: CODEX_GQL }, updatedAt: '2026-12-03T02:00:00Z', body: `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify(state)} -->` };
}
function p1Thread(isResolved: boolean, reviewId = 10) {
  return { isResolved, comments: [{ author: { login: CODEX_GQL, __typename: 'Bot' }, body: '![P1 Badge](x) broken', createdAt: '2026-12-03T00:59:00Z', pullRequestReview: { databaseId: reviewId } }] };
}
function verdictComment(headSha = HEAD, pr = 77, issue = 'WORK-9') {
  return {
    user: { login: 'griff843', type: 'User' },
    body: ['PM_VERDICT: APPROVED', 'schema: pm-verdict/v1', `Issue: ${issue}`, `PR: ${pr}`, `Head SHA: ${headSha}`, '', 'Scope of approval: test.'].join('\n'),
    created_at: '2026-12-03T00:00:00Z',
    html_url: 'https://example.invalid/c/1',
  };
}

function makeHarness(fixture: Fixture) {
  const failures: string[] = [];
  const notices: string[] = [];
  const outputs: Record<string, string> = {};
  const files = fixture.files ?? [standardFile()];
  const payloadPr = {
    number: 77,
    changed_files: files.length,
    title: fixture.title ?? 'change',
    head: { sha: HEAD, ref: fixture.branch },
    base: { sha: BASE },
    user: { login: 'griff843' },
    state: 'open',
  };
  const livePr = { ...payloadPr, head: { ...payloadPr.head, sha: fixture.liveHead ?? HEAD } };
  const wrap = <T,>(data: T) => async () => ({ data });
  const rest = {
    issues: {
      get: async () => ({ data: { labels: (fixture.labels ?? []).map(name => ({ name })) } }),
      listComments: wrap(fixture.comments ?? []),
    },
    pulls: {
      get: async () => ({ data: livePr }),
      listFiles: wrap(files),
      listReviews: wrap([]),
      listCommits: wrap([{ author: { login: 'griff843' } }]),
    },
    repos: {
      getContent: async ({ path: requested }: { path: string }) => {
        const contents = fixture.contents ?? {};
        if (requested in contents) {
          return { data: { content: Buffer.from(contents[requested]!).toString('base64'), encoding: 'base64' } };
        }
        if (!fixture.manifest || !String(requested).includes('lanes')) throw Object.assign(new Error('Not Found'), { status: 404 });
        return { data: { content: Buffer.from(JSON.stringify(fixture.manifest)).toString('base64'), encoding: 'base64' } };
      },
    },
  };
  const github = {
    rest,
    paginate: async (fn: (p: unknown) => Promise<{ data: unknown }>, params: unknown) => (await fn(params)).data,
    graphql: async (query: string) => {
      const nodes = query.includes('reviewThreads')
        ? (fixture.threads ?? []).map(thread => ({ isResolved: thread.isResolved, comments: { pageInfo: { hasNextPage: Boolean(thread.moreComments) }, nodes: thread.comments } }))
        : query.includes('reviews(') ? (fixture.reviews ?? []) : (fixture.summaries ?? []);
      return { repository: { pullRequest: { connection: { pageInfo: { hasNextPage: false }, nodes } } } };
    },
  };
  const summary = { addHeading: () => summary, addRaw: () => summary, addCodeBlock: () => summary, write: async () => summary };
  const core = {
    info: () => undefined,
    warning: () => undefined,
    notice: (message: string) => { notices.push(message); },
    setFailed: (message: string) => { failures.push(message); },
    setOutput: (key: string, value: string) => { outputs[key] = value; },
    summary,
  };
  const context = {
    repo: { owner: 'o', repo: 'r' },
    eventName: 'pull_request',
    runId: 1,
    serverUrl: 'https://github.com',
    payload: { pull_request: payloadPr },
  };
  return { github, core, context, failures, notices, outputs, process: { env: { ...fixture.env } } };
}

type RequireFn = (specifier: string) => unknown;
// Simulates a base commit that predates scripts/ops/operating-model.cjs.
const missingModuleRequire: RequireFn = specifier => {
  if (specifier.endsWith('operating-model.cjs')) {
    throw Object.assign(new Error(`Cannot find module '${specifier}'`), { code: 'MODULE_NOT_FOUND' });
  }
  return rootRequire(specifier);
};
// Proves laziness: any load of the module fails the test.
const forbidModuleRequire: RequireFn = specifier => {
  if (specifier.endsWith('operating-model.cjs')) throw new Error('operating-model.cjs must not be loaded when lean is not requested');
  return rootRequire(specifier);
};

async function runStep(script: string, fixture: Fixture, extraEnv: Record<string, string> = {}, requireFn: RequireFn = rootRequire) {
  const harness = makeHarness(fixture);
  harness.process.env = { ...harness.process.env, ...extraEnv };
  const fn = new AsyncFunction('github', 'context', 'core', 'require', 'process', script);
  try {
    await fn(harness.github, harness.context, harness.core, requireFn, harness.process);
  } catch (error) {
    harness.failures.push(`uncaught: ${(error as Error).message}`);
  }
  return harness;
}

const LEAN_ENV = { OPERATING_MODEL: 'lean', LEAN_MODE_ACTIVATED_AT: ACTIVATED };
const LEGACY_ENV = { OPERATING_MODEL: 'legacy', LEAN_MODE_ACTIVATED_AT: ACTIVATED };
const UNSET_ENV = {};

const gateScript = findStep(readWorkflow('merge-gate.yml'), 'gate', 'Evaluate merge gate').with.script as string;
const executorScript = findStep(readWorkflow('executor-result-validator.yml'), 'validate', 'Validate executor result').with.script as string;
const riskScript = findStep(readWorkflow('risk-class.yml'), 'classify', 'Classify pull request').with.script as string;
const reviewScript = findStep(readWorkflow('independent-review.yml'), 'review', 'Evaluate independent review').with.script as string;
const effScript = findStep(readWorkflow('post-merge-qa-gate.yml'), 'qa-gate', 'Resolve effective tier').with.script as string;

function gate(fixture: Fixture, requireFn: RequireFn = rootRequire) {
  return runStep(gateScript, fixture, {}, requireFn);
}

// ── Static contract ─────────────────────────────────────────────────────────

const POLICY_WORKFLOWS = ['merge-gate.yml', 'risk-class.yml', 'independent-review.yml', 'executor-result-validator.yml', 'post-merge-qa-gate.yml'];

test('workflows: every embedded script compiles', () => {
  for (const name of [...POLICY_WORKFLOWS, 'required-check-refresh.yml']) {
    const workflow = readWorkflow(name);
    for (const job of Object.values(workflow.jobs as Record<string, Doc>)) {
      for (const step of (job.steps ?? []) as Doc[]) {
        if (typeof step.with?.script === 'string') {
          assert.doesNotThrow(() => new AsyncFunction('github', 'context', 'core', 'require', 'process', step.with.script), `${name}: ${step.name}`);
        }
      }
    }
  }
});

test('bootstrap: every require of operating-model.cjs is lazy (behind OPERATING_MODEL=lean) and MODULE_NOT_FOUND-guarded', () => {
  const guard = "error.code === 'MODULE_NOT_FOUND' && String(error.message || '').includes('operating-model.cjs')";
  for (const name of POLICY_WORKFLOWS) {
    const text = readWorkflowText(name);
    const requires = text.split("require('./scripts/ops/operating-model.cjs')").length - 1;
    assert.equal(requires, 1, `${name}: exactly one require site`);
    assert.equal(text.split(guard).length - 1, requires, `${name}: require is not MODULE_NOT_FOUND-guarded`);
    const before = text.slice(0, text.indexOf("require('./scripts/ops/operating-model.cjs')"));
    const lastLeanCheck = before.lastIndexOf(".toLowerCase() === 'lean'");
    assert.ok(lastLeanCheck >= 0 && before.lastIndexOf('try {') > lastLeanCheck, `${name}: require is not inside the lean-requested branch`);
  }
  assert.ok(!readWorkflowText('merge-gate.yml').includes('LEAN_MODE_DEACTIVATED_AT'));
});

test('Step A is add-only: the four required contexts keep their names and new contexts exist', () => {
  assert.match(readWorkflow('merge-gate.yml').jobs.gate.name as string, /'Merge Gate'/);
  assert.match(readWorkflow('executor-result-validator.yml').jobs.validate.name as string, /'Executor Result Validation'/);
  assert.match(readWorkflow('risk-class.yml').jobs.classify.name as string, /'Risk Class'/);
  assert.match(readWorkflow('independent-review.yml').jobs.review.name as string, /'Independent Review'/);
  assert.ok(readWorkflowText('p0-protocol.yml').includes('P0 Protocol'));
  assert.ok(readWorkflowText('ci.yml').includes('verify:'));
});

test('new check workflows run from the immutable base SHA and never check out PR head code', () => {
  for (const [name, jobId] of [['risk-class.yml', 'classify'], ['independent-review.yml', 'review']] as const) {
    const text = readWorkflowText(name);
    const checkout = (readWorkflow(name).jobs[jobId].steps as Doc[]).find(step => String(step.uses ?? '').startsWith('actions/checkout'))!;
    assert.equal(checkout.with.ref, '${{ github.event.pull_request.base.sha }}', name);
    assert.ok(!text.includes('ref: ${{ github.event.pull_request.head'), name);
    assert.ok(!text.includes('pull_request_target'), name);
  }
});

test('lean inputs are repo variables; no rollback window variable remains', () => {
  for (const name of POLICY_WORKFLOWS) {
    const text = readWorkflowText(name);
    assert.ok(text.includes('vars.OPERATING_MODEL'), name);
    assert.ok(text.includes('vars.LEAN_MODE_ACTIVATED_AT'), name);
    assert.ok(text.includes('vars.TRUSTED_REVIEWER_LOGINS'), name);
    assert.ok(!text.includes('LEAN_MODE_DEACTIVATED_AT'), name);
  }
});

test('required-check-refresh: Independent Review target and signals exist only behind the lean check', () => {
  const text = readWorkflowText('required-check-refresh.yml');
  assert.ok(text.includes("workflowId: 'independent-review.yml'"));
  assert.ok(text.includes("targets: ['independent', 'merge']"));
  assert.ok(!text.includes("body.includes('codex-review-state:v1')"), 'raw substring signal is gone');
  assert.ok(text.includes('operatingModel.parseCodexState(body)'));
});

// ── Missing module on base => legacy, everywhere ────────────────────────────

test('bootstrap (adversarial): base without operating-model.cjs + OPERATING_MODEL=lean => pure legacy in every workflow', async () => {
  const manifestless: Fixture = { branch: 'claude/standard-change', env: LEAN_ENV, summaries: [cleanSummary()] };
  const mg = await gate(manifestless, missingModuleRequire);
  assert.equal(mg.failures.length, 1);
  assert.match(mg.failures[0]!, /No issue ID|authoritative lane manifest/u);
  assert.doesNotMatch(mg.failures[0]!, /MODULE_NOT_FOUND|Cannot find module|Internal error/u);
  const t1 = await gate({ branch: 'claude/work-9-legacy-change', labels: ['tier:T1', 't1-approved'], manifest: { issue_id: 'WORK-9', tier: 'T1' }, comments: [verdictComment()], env: LEAN_ENV }, missingModuleRequire);
  assert.deepEqual(t1.failures, [], 'legacy T1 with full approval still passes when the module is absent');

  const ex = await runStep(executorScript, manifestless, {}, missingModuleRequire);
  assert.equal(ex.failures.length, 1);
  assert.match(ex.failures[0]!, /executor-result|No valid executor-result/u);

  for (const script of [riskScript, reviewScript]) {
    const result = await runStep(script, manifestless, {}, missingModuleRequire);
    assert.deepEqual(result.failures, []);
    assert.ok(result.notices.some(n => /not applicable/u.test(n)));
  }
  const eff = await runStep(effScript, { ...manifestless, files: [PROTECTED_FILE] }, { LABEL_TIER: '', PR_NUMBER: '77' }, missingModuleRequire);
  assert.equal(eff.outputs.tier, '');
});

test('bootstrap: with the flag unset the module is never loaded (lazy) and legacy runs unchanged', async () => {
  const manifestless: Fixture = { branch: 'claude/standard-change', env: UNSET_ENV };
  assert.match((await gate(manifestless, forbidModuleRequire)).failures[0]!, /No issue ID|authoritative lane manifest/u);
  for (const script of [riskScript, reviewScript]) {
    assert.deepEqual((await runStep(script, manifestless, {}, forbidModuleRequire)).failures, []);
  }
  assert.equal((await runStep(executorScript, manifestless, {}, forbidModuleRequire)).failures.length, 1);
  assert.equal((await runStep(effScript, manifestless, { LABEL_TIER: '', PR_NUMBER: '77' }, forbidModuleRequire)).outputs.tier, '');
});

test('bootstrap: a module that exists but throws for another reason fails closed (not silently legacy)', async () => {
  const broken: RequireFn = specifier => {
    if (specifier.endsWith('operating-model.cjs')) throw Object.assign(new Error('SyntaxError in operating-model.cjs'), { code: 'ERR_SYNTAX' });
    return rootRequire(specifier);
  };
  const fixture: Fixture = { branch: 'claude/standard-change', env: LEAN_ENV, summaries: [cleanSummary()] };
  assert.equal((await gate(fixture, broken)).failures.length, 1);
  assert.equal((await runStep(reviewScript, fixture, {}, broken)).failures.length, 1);
});

// ── Merge Gate matrix ───────────────────────────────────────────────────────

const LEGACY_T1_MANIFEST = { issue_id: 'WORK-9', tier: 'T1' };
function legacyT1(env: Record<string, string>, approved: boolean): Fixture {
  return {
    branch: 'claude/work-9-legacy-change',
    labels: approved ? ['tier:T1', 't1-approved'] : ['tier:T1'],
    manifest: LEGACY_T1_MANIFEST,
    comments: approved ? [verdictComment()] : [],
    env,
  };
}

for (const [label, env] of [['flag=legacy', LEGACY_ENV], ['flag unset', UNSET_ENV]] as const) {
  test(`gate matrix: legacy T1 is evaluated by the unchanged legacy logic (${label})`, async () => {
    const blocked = await gate(legacyT1(env, false));
    assert.equal(blocked.failures.length, 1, 'legacy T1 without approval must block');
    assert.match(blocked.failures[0]!, /t1-approved|pm-verdict|PM verdict|verdict/iu);
    assert.deepEqual((await gate(legacyT1(env, true))).failures, [], 'legacy T1 with label + head-bound verdict must pass');
  });
}

test('gate matrix: under lean, an approved T1 lane PR touching Protected paths still needs Independent Review, then passes', async () => {
  const fixture = { ...legacyT1(LEAN_ENV, true), files: [PROTECTED_FILE] };
  const noReview = await gate(fixture);
  assert.equal(noReview.failures.length, 1);
  assert.match(noReview.failures[0]!, /Independent Review/);
  assert.deepEqual((await gate({ ...fixture, summaries: [cleanSummary()] })).failures, []);
});

test('gate matrix: lean Standard needs no manifest, tier label, scope-override or pm-verdict', async () => {
  assert.deepEqual((await gate({ branch: 'claude/standard-change', env: LEAN_ENV, summaries: [cleanSummary()] })).failures, []);
  assert.deepEqual((await gate({ branch: 'claude/standard-change', env: LEAN_ENV, summaries: [cleanSummary()] })).failures, [], 'clean PR passes on connector summary');
});

test('gate matrix: lean Standard is blocked without a trusted head-bound pass, by a stale pass, and by a moved head', async () => {
  const none = await gate({ branch: 'claude/standard-change', env: LEAN_ENV });
  assert.equal(none.failures.length, 1);
  assert.match(none.failures[0]!, /Independent Review/);
  assert.equal((await gate({ branch: 'claude/standard-change', env: LEAN_ENV, reviews: [trustedReview('e'.repeat(40))] })).failures.length, 1);
  assert.equal((await gate({ branch: 'claude/standard-change', env: LEAN_ENV, summaries: [cleanSummary('e'.repeat(40))] })).failures.length, 1);
  assert.equal((await gate({ branch: 'claude/standard-change', env: LEAN_ENV, summaries: [cleanSummary()], liveHead: 'f'.repeat(40) })).failures.length, 1);
});

test('gate matrix (adversarial): a P1 at the head is never cleared at that head; a new head with a fresh clean summary clears it', async () => {
  const findingReview = trustedReview(HEAD, { databaseId: 10, body: 'Here are some automated review suggestions.' });
  const resolvedOnly = await gate({ branch: 'claude/standard-change', env: LEAN_ENV, reviews: [findingReview], threads: [p1Thread(true)] });
  assert.equal(resolvedOnly.failures.length, 1);
  assert.match(resolvedOnly.failures[0]!, /Independent Review/);
  const sameHeadSummary = await gate({ branch: 'claude/standard-change', env: LEAN_ENV, reviews: [findingReview], threads: [p1Thread(true)], summaries: [cleanSummary()] });
  assert.equal(sameHeadSummary.failures.length, 1, 'later clean summary at the SAME head does not clear a finding at that head');
  const oldHeadReview = trustedReview(BASE, { databaseId: 10, body: 'Here are some automated review suggestions.' });
  const newHead = await gate({ branch: 'claude/standard-change', env: LEAN_ENV, reviews: [oldHeadReview], threads: [p1Thread(true)], summaries: [cleanSummary()] });
  assert.deepEqual(newHead.failures, []);
  const deleted = await gate({ branch: 'claude/standard-change', env: LEAN_ENV, reviews: [findingReview] });
  assert.equal(deleted.failures.length, 1, 'deleting the P1 thread and summary leaves only a review object: FAIL');
});

test('gate matrix: lean Standard is blocked by governance:pause', async () => {
  const result = await gate({ branch: 'claude/standard-change', env: LEAN_ENV, summaries: [cleanSummary()], labels: ['governance:pause'] });
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0]!, /governance:pause/);
});

test('gate matrix: lean Protected requires t1-approved and a head-bound pm-verdict in addition to review', async () => {
  const base = { branch: 'claude/protected-change', env: LEAN_ENV, files: [PROTECTED_FILE] };
  const reviewOnly = await gate({ ...base, summaries: [cleanSummary()] });
  assert.equal(reviewOnly.failures.length, 1);
  assert.match(reviewOnly.failures[0]!, /t1-approved/);
  assert.equal((await gate({ ...base, summaries: [cleanSummary()], labels: ['t1-approved'], comments: [verdictComment('e'.repeat(40))] })).failures.length, 1);
  assert.deepEqual((await gate({ ...base, summaries: [cleanSummary()], labels: ['t1-approved'], comments: [verdictComment()] })).failures, []);
});

test('gate matrix: lean Protected without Independent Review is blocked even with full human approval', async () => {
  const migration = { filename: 'supabase/migrations/202612010000_x.sql', status: 'added', additions: 5, deletions: 0, patch: '@@ -0,0 +1 @@\n+select 1;\n' };
  const result = await gate({ branch: 'claude/protected-change', env: LEAN_ENV, files: [migration], labels: ['t1-approved'], comments: [verdictComment()] });
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0]!, /Independent Review/);
});

test('rollback (adversarial): OPERATING_MODEL=legacy immediately returns an in-flight lean PR to the legacy gate (stopped)', async () => {
  const inFlight: Fixture = { branch: 'claude/standard-change', env: LEAN_ENV, summaries: [cleanSummary()] };
  assert.deepEqual((await gate(inFlight)).failures, [], 'mergeable while lean');
  for (const env of [LEGACY_ENV, UNSET_ENV, { OPERATING_MODEL: 'legacy', LEAN_MODE_ACTIVATED_AT: ACTIVATED, LEAN_MODE_DEACTIVATED_AT: '2099-01-01T00:00:00Z' }]) {
    const stopped = await gate({ ...inFlight, env });
    assert.equal(stopped.failures.length, 1, JSON.stringify(env));
    assert.match(stopped.failures[0]!, /No issue ID|authoritative lane manifest/u);
    const executor = await runStep(executorScript, { ...inFlight, env });
    assert.equal(executor.failures.length, 1, 'executor validation is required again after rollback');
  }
});

// ── RISK-CLASS: PROTECTED is honored by every consumer ──────────────────────

test('reviewer escalation (RISK-CLASS: PROTECTED) is honored by Merge Gate, Executor Result Validation, Risk Class and post-merge QA', async () => {
  const escalation = trustedReview('e'.repeat(40), { databaseId: 3, body: 'Touches payout semantics.\nRISK-CLASS: PROTECTED', submittedAt: '2026-12-03T00:00:00Z' });
  const fixture: Fixture = { branch: 'claude/standard-change', env: LEAN_ENV, reviews: [escalation], summaries: [cleanSummary()] };
  const mg = await gate(fixture);
  assert.equal(mg.failures.length, 1);
  assert.match(mg.failures[0]!, /t1-approved/);
  const ex = await runStep(executorScript, fixture);
  assert.equal(ex.failures.length, 1, 'escalated PR must not skip executor validation');
  const risk = await runStep(riskScript, fixture);
  assert.ok(risk.notices.some(n => /Risk Class: Protected/u.test(n)));
  const eff = await runStep(effScript, fixture, { LABEL_TIER: '', PR_NUMBER: '77' });
  assert.equal(eff.outputs.tier, 'T1');
});

// ── Executor Result Validation ──────────────────────────────────────────────

test('executor validation: lean Standard passes without an executor-result comment', async () => {
  const result = await runStep(executorScript, { branch: 'claude/standard-change', env: LEAN_ENV });
  assert.deepEqual(result.failures, []);
  assert.ok(result.notices.some(notice => /not required for lean-mode Standard/u.test(notice)));
});

test('executor validation: lean Protected, legacy and unset-flag PRs are still validated (missing result fails)', async () => {
  for (const fixture of [
    { branch: 'claude/protected-change', env: LEAN_ENV, files: [PROTECTED_FILE] },
    { branch: 'claude/work-9-legacy', env: LEGACY_ENV },
    { branch: 'claude/work-9-legacy', env: UNSET_ENV },
  ] as Fixture[]) {
    const result = await runStep(executorScript, fixture);
    assert.equal(result.failures.length, 1, JSON.stringify(fixture.env));
    assert.match(result.failures[0]!, /executor-result|No valid executor-result/u);
  }
});

// ── Risk Class / Independent Review workflows ───────────────────────────────

test('Risk Class: not-applicable for legacy; reports class for lean PRs; UI component head content is fetched', async () => {
  const legacy = await runStep(riskScript, { branch: 'claude/x', env: LEGACY_ENV });
  assert.deepEqual(legacy.failures, []);
  assert.ok(legacy.notices.some(n => /not applicable/u.test(n)));
  assert.ok((await runStep(riskScript, { branch: 'claude/x', env: LEAN_ENV })).notices.some(n => /Risk Class: Standard/u.test(n)));
  const nested = { filename: 'apps/api/src/routes/kill-switch.ts', status: 'modified', additions: 1, deletions: 0, patch: '@@ -1 +1 @@\n+a\n' };
  assert.ok((await runStep(riskScript, { branch: 'claude/x', env: LEAN_ENV, files: [nested] })).notices.some(n => /Risk Class: Protected/u.test(n)));
  const component = 'apps/command-center/src/components/MiniSparkline.tsx';
  const uiFile = { filename: component, status: 'modified', additions: 1, deletions: 0, patch: '@@ -1 +1 @@\n+export const x = 1;\n' };
  assert.ok((await runStep(riskScript, { branch: 'claude/x', env: LEAN_ENV, files: [uiFile], contents: { [component]: "import React from 'react';\nexport const x = 1;\n" } })).notices.some(n => /Risk Class: Standard/u.test(n)));
  assert.ok((await runStep(riskScript, { branch: 'claude/x', env: LEAN_ENV, files: [uiFile], contents: { [component]: "import { settle } from '@/app/actions/settle';\n" } })).notices.some(n => /Risk Class: Protected/u.test(n)));
});

test('Independent Review: not applicable for legacy; fails closed for lean without a pass; passes only on a clean summary', async () => {
  assert.deepEqual((await runStep(reviewScript, { branch: 'claude/x', env: LEGACY_ENV })).failures, []);
  assert.deepEqual((await runStep(reviewScript, { branch: 'claude/x', env: UNSET_ENV })).failures, []);
  assert.equal((await runStep(reviewScript, { branch: 'claude/x', env: LEAN_ENV })).failures.length, 1);
  assert.equal((await runStep(reviewScript, { branch: 'claude/x', env: LEAN_ENV, reviews: [trustedReview()] })).failures.length, 1, 'a bare review object never passes');
  assert.deepEqual((await runStep(reviewScript, { branch: 'claude/x', env: LEAN_ENV, summaries: [cleanSummary()] })).failures, []);
  assert.equal((await runStep(reviewScript, { branch: 'claude/x', env: LEAN_ENV, reviews: [trustedReview('f'.repeat(40))] })).failures.length, 1);
  assert.equal((await runStep(reviewScript, { branch: 'claude/x', env: LEAN_ENV, summaries: [cleanSummary()], threads: [p1Thread(false, 99)] })).failures.length, 1);
});

// ── required-check-refresh: executed against stubbed Actions APIs ──────────

const refreshScript = findStep(readWorkflow('required-check-refresh.yml'), 'refresh', 'Resolve trusted signal and retry exact-head native run').with.script as string;
const REPO = 'o/r';

function refreshRun(id: number, workflowPath: string, status = 'completed') {
  return { id, event: 'pull_request', path: workflowPath, head_sha: HEAD, status, pull_requests: [{ number: 77, head: { sha: HEAD } }] };
}

async function runRefresh({ eventName, payload, env, runs, issueComments = [], reviews = [], reviewComments = [] }: { eventName: string; payload: Record<string, unknown>; env: Record<string, string>; runs: Record<string, Array<Record<string, unknown>>>; issueComments?: Array<Record<string, unknown>>; reviews?: Array<Record<string, unknown>>; reviewComments?: Array<Record<string, unknown>> }, requireFn: RequireFn = rootRequire) {
  const reruns: number[] = [];
  const warnings: string[] = [];
  const pr = { number: 77, state: 'open', head: { sha: HEAD, repo: { full_name: REPO } }, base: { ref: 'main', repo: { full_name: REPO } } };
  const github = {
    rest: {
      pulls: { get: async () => ({ data: pr }), listReviews: async () => ({ data: reviews }), listReviewComments: async () => ({ data: reviewComments }) },
      actions: {
        listWorkflowRuns: async ({ workflow_id }: { workflow_id: string }) => ({ data: runs[workflow_id] ?? [] }),
        reRunWorkflow: async ({ run_id }: { run_id: number }) => { reruns.push(run_id); return { data: {} }; },
        getWorkflowRun: async () => ({ data: (payload.workflow_run as Record<string, unknown>) }),
      },
      repos: { listPullRequestsAssociatedWithCommit: async () => ({ data: [pr] }) },
      issues: { listComments: async () => ({ data: issueComments }) },
    },
    paginate: async (fn: (p: unknown) => Promise<{ data: unknown }>, params: unknown) => (await fn(params)).data,
  };
  const core = { info: () => undefined, notice: () => undefined, warning: (m: string) => { warnings.push(m); }, setFailed: () => undefined };
  const context = { repo: { owner: 'o', repo: 'r' }, eventName, payload: { repository: { default_branch: 'main' }, ...payload } };
  const fn = new AsyncFunction('github', 'context', 'core', 'require', 'process', refreshScript);
  let error: Error | null = null;
  try {
    await fn(github, context, core, requireFn, { env });
  } catch (caught) {
    error = caught as Error;
  }
  return { reruns, warnings, error };
}

const ALL_RUNS = {
  'independent-review.yml': [refreshRun(101, '.github/workflows/independent-review.yml')],
  'merge-gate.yml': [refreshRun(202, '.github/workflows/merge-gate.yml')],
};
function summaryCommentEvent(user: Record<string, unknown>, body = cleanSummary().body) {
  return { eventName: 'issue_comment', payload: { issue: { number: 77, pull_request: {} }, comment: { body, user } } };
}
const CODEX_BOT_USER = { login: 'chatgpt-codex-connector[bot]', type: 'Bot' };

test('required-check-refresh (lean): the anchored summary from the trusted Bot reruns Independent Review and Merge Gate', async () => {
  const result = await runRefresh({ ...summaryCommentEvent(CODEX_BOT_USER), env: LEAN_ENV, runs: ALL_RUNS });
  assert.equal(result.error, null);
  assert.deepEqual(result.reruns, [101, 202]);
});

test('required-check-refresh (adversarial P3): the summary signal is ignored from a user, another bot, an unanchored marker, or outside lean', async () => {
  for (const [label, event, env] of [
    ['user with bot login', summaryCommentEvent({ login: 'chatgpt-codex-connector', type: 'User' }), LEAN_ENV],
    ['other bot', summaryCommentEvent({ login: 'some-app[bot]', type: 'Bot' }), LEAN_ENV],
    ['unanchored marker', summaryCommentEvent(CODEX_BOT_USER, `echo ${cleanSummary().body}`), LEAN_ENV],
    ['legacy', summaryCommentEvent(CODEX_BOT_USER), LEGACY_ENV],
    ['unset', summaryCommentEvent(CODEX_BOT_USER), UNSET_ENV],
    ['future activation', summaryCommentEvent(CODEX_BOT_USER), { OPERATING_MODEL: 'lean', LEAN_MODE_ACTIVATED_AT: '2999-01-01T00:00:00Z' }],
  ] as const) {
    const result = await runRefresh({ ...event, env, runs: ALL_RUNS });
    assert.equal(result.error, null, label);
    assert.deepEqual(result.reruns, [], label);
  }
  // Legacy never loads the module for a summary comment.
  const legacy = await runRefresh({ ...summaryCommentEvent(CODEX_BOT_USER), env: UNSET_ENV, runs: ALL_RUNS }, forbidModuleRequire);
  assert.equal(legacy.error, null);
});

test('required-check-refresh (P3): outside lean, Independent Review handling is a legacy no-op', async () => {
  const run = { id: 9, name: 'Independent Review', path: '.github/workflows/independent-review.yml', event: 'pull_request_review', status: 'completed', head_sha: HEAD, repository: { full_name: REPO }, head_repository: { full_name: REPO }, pull_requests: [] };
  const legacy = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: run }, env: LEGACY_ENV, runs: ALL_RUNS });
  assert.equal(legacy.error, null);
  assert.deepEqual(legacy.reruns, []);
  const dispatch = await runRefresh({ eventName: 'repository_dispatch', payload: { action: 'required-check-refresh', client_payload: { pr_number: 77, target: 'independent' } }, env: LEGACY_ENV, runs: ALL_RUNS });
  assert.match(String(dispatch.error?.message), /Unknown manual refresh target/u, 'legacy refuses the independent target, as before');
  const lean = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: run }, env: LEAN_ENV, runs: {
    ...ALL_RUNS,
    'executor-result-validator.yml': [refreshRun(303, '.github/workflows/executor-result-validator.yml')],
    'risk-class.yml': [refreshRun(404, '.github/workflows/risk-class.yml')],
  } });
  assert.equal(lean.error, null);
  assert.deepEqual(lean.reruns, [101, 202, 303, 404]);
});

test('required-check-refresh (P3): a missing or in-flight Independent Review run does not abort the Merge Gate rerun', async () => {
  const missing = await runRefresh({ ...summaryCommentEvent(CODEX_BOT_USER), env: LEAN_ENV, runs: { 'merge-gate.yml': ALL_RUNS['merge-gate.yml'] } });
  assert.equal(missing.error, null);
  assert.deepEqual(missing.reruns, [202]);
  assert.ok(missing.warnings.some(w => /Independent Review/u.test(w)));
  const running = await runRefresh({ ...summaryCommentEvent(CODEX_BOT_USER), env: LEAN_ENV, runs: { ...ALL_RUNS, 'independent-review.yml': [refreshRun(103, '.github/workflows/independent-review.yml', 'in_progress')] } });
  assert.deepEqual(running.reruns, [202]);
  // A missing Merge Gate run still fails closed.
  const noGate = await runRefresh({ ...summaryCommentEvent(CODEX_BOT_USER), env: LEAN_ENV, runs: { 'independent-review.yml': ALL_RUNS['independent-review.yml'] } });
  assert.match(String(noGate.error?.message), /No eligible Merge Gate/u);
});

const ESCALATION_RUNS = {
  ...ALL_RUNS,
  'executor-result-validator.yml': [refreshRun(303, '.github/workflows/executor-result-validator.yml')],
  'risk-class.yml': [refreshRun(404, '.github/workflows/risk-class.yml')],
};
function escalationCommentEvent(user: Record<string, unknown>, body = 'RISK-CLASS: PROTECTED') {
  return { eventName: 'issue_comment', payload: { issue: { number: 77, pull_request: {} }, comment: { body, user } } };
}

test('required-check-refresh (lean, P1): a trusted RISK-CLASS: PROTECTED issue comment reruns Merge Gate, Executor Result Validation, Risk Class and Independent Review', async () => {
  for (const user of [CODEX_BOT_USER, { login: 'chatgpt-codex-connector', type: 'User' }]) {
    const result = await runRefresh({ ...escalationCommentEvent(user, 'Escalating.\nRISK-CLASS: PROTECTED\n'), env: LEAN_ENV, runs: ESCALATION_RUNS });
    assert.equal(result.error, null, user.login);
    assert.deepEqual(result.reruns, [202, 303, 101, 404], user.login);
  }
  // A configured reviewer list is honored exactly as classification honors it.
  const configured = await runRefresh({ ...escalationCommentEvent({ login: 'alice', type: 'User' }), env: { ...LEAN_ENV, TRUSTED_REVIEWER_LOGINS: 'alice' }, runs: ESCALATION_RUNS });
  assert.deepEqual(configured.reruns, [202, 303, 101, 404]);
  // Note 2: a missing Risk Class run fails closed, but only after Independent Review was rerun.
  const noRisk = await runRefresh({ ...escalationCommentEvent(CODEX_BOT_USER), env: LEAN_ENV, runs: { ...ESCALATION_RUNS, 'risk-class.yml': [] } });
  assert.deepEqual(noRisk.reruns, [202, 303, 101]);
  assert.match(String(noRisk.error?.message), /No eligible Risk Class/u);
});

function independentReviewWorkflowRun() {
  return { id: 9, name: 'Independent Review', path: '.github/workflows/independent-review.yml', event: 'pull_request_review', status: 'completed', head_sha: HEAD, repository: { full_name: REPO }, head_repository: { full_name: REPO }, pull_requests: [] };
}

test('required-check-refresh (lean, note 1): a completed Independent Review run also refreshes Executor Result Validation and Risk Class', async () => {
  const result = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: independentReviewWorkflowRun() }, env: LEAN_ENV, runs: ESCALATION_RUNS });
  assert.equal(result.error, null);
  assert.deepEqual(result.reruns, [101, 202, 303, 404]);
  // Missing Risk Class fails closed after the other three reruns.
  const noRisk = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: independentReviewWorkflowRun() }, env: LEAN_ENV, runs: { ...ESCALATION_RUNS, 'risk-class.yml': [] } });
  assert.deepEqual(noRisk.reruns, [101, 202, 303]);
  assert.match(String(noRisk.error?.message), /No eligible Risk Class/u);
  // Outside lean the Independent Review signal stays a legacy no-op.
  for (const env of [LEGACY_ENV, UNSET_ENV]) {
    const legacy = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: independentReviewWorkflowRun() }, env, runs: ESCALATION_RUNS });
    assert.equal(legacy.error, null);
    assert.deepEqual(legacy.reruns, []);
  }
  // Other trusted workflow_run signals keep their legacy targets in lean and legacy.
  const ci = { ...independentReviewWorkflowRun(), name: 'CI', path: '.github/workflows/ci.yml', event: 'pull_request', conclusion: 'success', pull_requests: [{ number: 77, head: { sha: HEAD } }] };
  for (const env of [LEAN_ENV, LEGACY_ENV]) {
    const ciRun = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: ci }, env, runs: ESCALATION_RUNS });
    assert.equal(ciRun.error, null);
    assert.deepEqual(ciRun.reruns, [303]);
  }
});

// Codex P2 on #1842: a clean summary that lands while the native pull_request
// Independent Review run is in flight is skipped by the issue_comment refresh.
// The completion of that stale run must recover it, exactly once, in lean only.
const RUN_STARTED = '2026-12-03T01:00:00Z';
function nativeIndependentReviewRun(overrides: Record<string, unknown> = {}) {
  return { ...independentReviewWorkflowRun(), event: 'pull_request', conclusion: 'failure', run_started_at: RUN_STARTED, run_attempt: 1, pull_requests: [{ number: 77, head: { sha: HEAD } }], ...overrides };
}
function summaryIssueComment(updatedAt: string, user: Record<string, unknown> = CODEX_BOT_USER, body = cleanSummary().body) {
  return { user, body, created_at: updatedAt, updated_at: updatedAt };
}

test('required-check-refresh (lean, P2): a summary written while the native run was in flight is recovered when that run completes', async () => {
  // 1. The race: the summary arrives while the native run is in progress; the
  //    issue_comment refresh can only rerun Merge Gate.
  const during = await runRefresh({ ...summaryCommentEvent(CODEX_BOT_USER), env: LEAN_ENV, runs: { ...ALL_RUNS, 'independent-review.yml': [refreshRun(103, '.github/workflows/independent-review.yml', 'in_progress')] } });
  assert.deepEqual(during.reruns, [202]);
  // 2. The stale run then completes red: its completion reruns it and Merge Gate.
  const recovered = await runRefresh({
    eventName: 'workflow_run',
    payload: { workflow_run: nativeIndependentReviewRun() },
    env: LEAN_ENV,
    runs: ALL_RUNS,
    issueComments: [summaryIssueComment('2026-12-03T01:00:05Z')],
  });
  assert.equal(recovered.error, null);
  assert.deepEqual(recovered.reruns, [101, 202]);
  // A run that succeeded but missed a newer summary (which may report findings)
  // is recomputed too: the stale pass must not stand.
  const stalePass = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: nativeIndependentReviewRun({ conclusion: 'success' }) }, env: LEAN_ENV, runs: ALL_RUNS, issueComments: [summaryIssueComment('2026-12-03T01:00:05Z')] });
  assert.deepEqual(stalePass.reruns, [101, 202]);
  // A summary written exactly at the run start is also treated as possibly missed.
  const sameSecond = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: nativeIndependentReviewRun() }, env: LEAN_ENV, runs: ALL_RUNS, issueComments: [summaryIssueComment(RUN_STARTED)] });
  assert.deepEqual(sameSecond.reruns, [101, 202]);
});

test('required-check-refresh (lean, P2, adversarial): the native-run recovery is bounded and trusts only the connector Bot summary', async () => {
  for (const [label, run, comments] of [
    // Bounded: the rerun started after the summary, so its own completion does nothing (no loop).
    ['summary older than the run', nativeIndependentReviewRun(), [summaryIssueComment('2026-12-03T00:59:59Z')]],
    ['no summary at all', nativeIndependentReviewRun(), []],
    ['summary from a user account', nativeIndependentReviewRun(), [summaryIssueComment('2026-12-03T01:00:05Z', { login: 'chatgpt-codex-connector', type: 'User' })]],
    ['summary from another bot', nativeIndependentReviewRun(), [summaryIssueComment('2026-12-03T01:00:05Z', { login: 'some-app[bot]', type: 'Bot' })]],
    ['unanchored marker', nativeIndependentReviewRun(), [summaryIssueComment('2026-12-03T01:00:05Z', CODEX_BOT_USER, `echo ${cleanSummary().body}`)]],
  ] as const) {
    const result = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: run }, env: LEAN_ENV, runs: ALL_RUNS, issueComments: [...comments] });
    assert.equal(result.error, null, label);
    assert.deepEqual(result.reruns, [], label);
  }
  // Missing start time fails closed rather than guessing.
  const noStart = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: nativeIndependentReviewRun({ run_started_at: undefined }) }, env: LEAN_ENV, runs: ALL_RUNS, issueComments: [summaryIssueComment('2026-12-03T01:00:05Z')] });
  assert.match(String(noStart.error?.message), /run_started_at/u);
  assert.deepEqual(noStart.reruns, []);
  // A recovered signal for a head that is no longer live is refused, as before.
  const stale = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: nativeIndependentReviewRun({ head_sha: 'e'.repeat(40), pull_requests: [{ number: 77, head: { sha: 'e'.repeat(40) } }] }) }, env: LEAN_ENV, runs: ALL_RUNS, issueComments: [summaryIssueComment('2026-12-03T01:00:05Z')] });
  assert.match(String(stale.error?.message), /not live PR head/u);
  assert.deepEqual(stale.reruns, []);
  // Another workflow's native pull_request run is still untrusted as a signal.
  const ercRun = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: nativeIndependentReviewRun({ name: 'Executor Result Validator', path: '.github/workflows/executor-result-validator.yml' }) }, env: LEAN_ENV, runs: ALL_RUNS, issueComments: [summaryIssueComment('2026-12-03T01:00:05Z')] });
  assert.match(String(ercRun.error?.message), /concluded failure; refusing refresh/u);
  // A summary is not a Merge Gate signal: the native gate completion ignores it.
  const gateRun = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: nativeIndependentReviewRun({ name: 'Merge Gate', path: '.github/workflows/merge-gate.yml' }) }, env: LEAN_ENV, runs: ALL_RUNS, issueComments: [summaryIssueComment('2026-12-03T01:00:05Z')] });
  assert.equal(gateRun.error, null);
  assert.deepEqual(gateRun.reruns, []);
});

test('required-check-refresh (P2): outside lean the native Independent Review completion is a legacy no-op without loading the module', async () => {
  for (const env of [LEGACY_ENV, UNSET_ENV]) {
    const result = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: nativeIndependentReviewRun() }, env, runs: ALL_RUNS, issueComments: [summaryIssueComment('2026-12-03T01:00:05Z')] }, env === UNSET_ENV ? forbidModuleRequire : rootRequire);
    assert.equal(result.error, null);
    assert.deepEqual(result.reruns, []);
  }
  // Lean requested but the module is absent on the default branch: legacy no-op.
  const absent = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: nativeIndependentReviewRun() }, env: LEAN_ENV, runs: ALL_RUNS, issueComments: [summaryIssueComment('2026-12-03T01:00:05Z')] }, missingModuleRequire);
  assert.equal(absent.error, null);
  assert.deepEqual(absent.reruns, []);
});

// Codex P1 on #1842 (round 2): an escalation that lands while the native Merge
// Gate run is in flight. The comment refresh must still rerun every other
// target before failing, and the stale gate's own completion must recover.
function nativeMergeGateRun(overrides: Record<string, unknown> = {}) {
  return { ...nativeIndependentReviewRun(), name: 'Merge Gate', path: '.github/workflows/merge-gate.yml', conclusion: 'success', ...overrides };
}
const IN_FLIGHT_GATE_RUNS = { ...ESCALATION_RUNS, 'merge-gate.yml': [refreshRun(203, '.github/workflows/merge-gate.yml', 'in_progress')] };

test('required-check-refresh (lean, P1): an in-flight Merge Gate does not stop the other reruns; the broker fails closed afterwards', async () => {
  const result = await runRefresh({ ...escalationCommentEvent(CODEX_BOT_USER), env: LEAN_ENV, runs: IN_FLIGHT_GATE_RUNS });
  assert.deepEqual(result.reruns, [303, 101, 404], 'ERV, Independent Review and Risk Class are rerun');
  assert.match(String(result.error?.message), /Merge Gate run 203 is in_progress/u);
  // Several unrecoverable targets are all reported, after every possible rerun.
  const two = await runRefresh({ ...escalationCommentEvent(CODEX_BOT_USER), env: LEAN_ENV, runs: { ...IN_FLIGHT_GATE_RUNS, 'executor-result-validator.yml': [] } });
  assert.deepEqual(two.reruns, [101, 404]);
  assert.match(String(two.error?.message), /Merge Gate run 203 is in_progress.*No eligible Executor Result Validation/su);
});

test('required-check-refresh (lean, P1): the stale native Merge Gate completion is recovered when an escalation was written after it started', async () => {
  const escalation = (when: string, user: Record<string, unknown> = CODEX_BOT_USER, body = 'RISK-CLASS: PROTECTED') => ({ user, body, created_at: when, updated_at: when });
  // Issue comment, review body and inline review comment escalations all count.
  for (const [label, extra] of [
    ['issue comment', { issueComments: [escalation('2026-12-03T01:00:05Z')] }],
    ['issue comment at the start second', { issueComments: [escalation(RUN_STARTED)] }],
    ['review body', { reviews: [{ user: CODEX_BOT_USER, body: 'Found a gap.\nRISK-CLASS: PROTECTED', submitted_at: '2026-12-03T01:00:05Z' }] }],
    ['inline review comment', { reviewComments: [escalation('2026-12-03T01:00:05Z')] }],
    ['configured reviewer', { issueComments: [escalation('2026-12-03T01:00:05Z', { login: 'alice', type: 'User' })], env: { ...LEAN_ENV, TRUSTED_REVIEWER_LOGINS: 'alice' } }],
  ] as const) {
    const result = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: nativeMergeGateRun() }, env: LEAN_ENV, runs: ESCALATION_RUNS, ...extra });
    assert.equal(result.error, null, label);
    assert.deepEqual(result.reruns, [202, 303, 101, 404], label);
  }
});

test('required-check-refresh (lean, P1, adversarial): the Merge Gate recovery is bounded, trusted-only and fails closed', async () => {
  const escalation = (when: string, user: Record<string, unknown> = CODEX_BOT_USER, body = 'RISK-CLASS: PROTECTED') => ({ user, body, created_at: when, updated_at: when });
  for (const [label, comments] of [
    // Bounded: the rerun started after the escalation, so its completion is a no-op.
    ['escalation older than the run', [escalation('2026-12-03T00:59:59Z')]],
    ['no escalation', []],
    ['untrusted user', [escalation('2026-12-03T01:00:05Z', { login: 'griff843', type: 'User' })]],
    ['untrusted bot', [escalation('2026-12-03T01:00:05Z', { login: 'some-app[bot]', type: 'Bot' })]],
    ['not an exact line', [escalation('2026-12-03T01:00:05Z', CODEX_BOT_USER, 'maybe RISK-CLASS: PROTECTED?')]],
    ['a clean summary is not an escalation', [summaryIssueComment('2026-12-03T01:00:05Z')]],
  ] as const) {
    const result = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: nativeMergeGateRun() }, env: LEAN_ENV, runs: ESCALATION_RUNS, issueComments: [...comments] });
    assert.equal(result.error, null, label);
    assert.deepEqual(result.reruns, [], label);
  }
  const noStart = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: nativeMergeGateRun({ run_started_at: null }) }, env: LEAN_ENV, runs: ESCALATION_RUNS, issueComments: [escalation('2026-12-03T01:00:05Z')] });
  assert.match(String(noStart.error?.message), /run_started_at/u);
  assert.deepEqual(noStart.reruns, []);
  const noTimestamp = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: nativeMergeGateRun() }, env: LEAN_ENV, runs: ESCALATION_RUNS, issueComments: [{ user: CODEX_BOT_USER, body: 'RISK-CLASS: PROTECTED' }] });
  assert.match(String(noTimestamp.error?.message), /no valid timestamp/u);
  assert.deepEqual(noTimestamp.reruns, []);
  const stale = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: nativeMergeGateRun({ head_sha: 'e'.repeat(40), pull_requests: [{ number: 77, head: { sha: 'e'.repeat(40) } }] }) }, env: LEAN_ENV, runs: ESCALATION_RUNS, issueComments: [escalation('2026-12-03T01:00:05Z')] });
  assert.match(String(stale.error?.message), /not live PR head/u);
  assert.deepEqual(stale.reruns, []);
});

test('required-check-refresh (P1): outside lean a native Merge Gate completion is refused exactly as before, without loading the module', async () => {
  const comments = [{ user: CODEX_BOT_USER, body: 'RISK-CLASS: PROTECTED', created_at: '2026-12-03T01:00:05Z', updated_at: '2026-12-03T01:00:05Z' }];
  for (const env of [LEGACY_ENV, UNSET_ENV]) {
    const result = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: nativeMergeGateRun() }, env, runs: ESCALATION_RUNS, issueComments: comments }, env === UNSET_ENV ? forbidModuleRequire : rootRequire);
    assert.match(String(result.error?.message), /Untrusted workflow_run identity Merge Gate\/.*\/pull_request/u);
    assert.deepEqual(result.reruns, []);
  }
  const absent = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: nativeMergeGateRun() }, env: LEAN_ENV, runs: ESCALATION_RUNS, issueComments: comments }, missingModuleRequire);
  assert.match(String(absent.error?.message), /Untrusted workflow_run identity/u);
  assert.deepEqual(absent.reruns, []);
  // The pull_request_review Merge Gate signal is unchanged in legacy.
  const review = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: nativeMergeGateRun({ event: 'pull_request_review', pull_requests: [] }) }, env: LEGACY_ENV, runs: ESCALATION_RUNS });
  assert.equal(review.error, null);
  assert.deepEqual(review.reruns, [202]);
});

test('required-check-refresh (adversarial P1): untrusted or malformed escalation comments trigger nothing new', async () => {
  for (const [label, event, env] of [
    ['untrusted user', escalationCommentEvent({ login: 'griff843', type: 'User' }), LEAN_ENV],
    ['untrusted bot', escalationCommentEvent({ login: 'some-app[bot]', type: 'Bot' }), LEAN_ENV],
    ['default reviewer not in configured list', escalationCommentEvent(CODEX_BOT_USER), { ...LEAN_ENV, TRUSTED_REVIEWER_LOGINS: 'alice' }],
    ['not an exact line', escalationCommentEvent(CODEX_BOT_USER, 'maybe RISK-CLASS: PROTECTED?'), LEAN_ENV],
    ['STANDARD', escalationCommentEvent(CODEX_BOT_USER, 'RISK-CLASS: STANDARD'), LEAN_ENV],
    ['future activation', escalationCommentEvent(CODEX_BOT_USER), { OPERATING_MODEL: 'lean', LEAN_MODE_ACTIVATED_AT: '2999-01-01T00:00:00Z' }],
  ] as const) {
    const result = await runRefresh({ ...event, env, runs: ESCALATION_RUNS });
    assert.equal(result.error, null, label);
    assert.deepEqual(result.reruns, [], label);
  }
});

test('required-check-refresh (P1): outside lean an escalation comment is ignored exactly as before, without loading the module', async () => {
  for (const env of [LEGACY_ENV, UNSET_ENV]) {
    const result = await runRefresh({ ...escalationCommentEvent(CODEX_BOT_USER), env, runs: ESCALATION_RUNS }, env === UNSET_ENV ? forbidModuleRequire : rootRequire);
    assert.equal(result.error, null);
    assert.deepEqual(result.reruns, []);
  }
  // Legacy signals are untouched: EXECUTOR_RESULT / PM_VERDICT still map to their single targets.
  const legacyExecutor = await runRefresh({ ...escalationCommentEvent(CODEX_BOT_USER, 'EXECUTOR_RESULT: READY\nRISK-CLASS: PROTECTED'), env: UNSET_ENV, runs: ESCALATION_RUNS }, forbidModuleRequire);
  assert.deepEqual(legacyExecutor.reruns, [303]);
  const legacyVerdict = await runRefresh({ ...escalationCommentEvent({ login: 'griff843', type: 'User' }, 'PM_VERDICT: APPROVED'), env: LEGACY_ENV, runs: ESCALATION_RUNS });
  assert.deepEqual(legacyVerdict.reruns, [202]);
});

test('Independent Review / Merge Gate (P2): a review thread with more than 100 comments fails closed in lean', async () => {
  const comment = { author: { login: CODEX_GQL, __typename: 'Bot' }, body: 'nit', createdAt: '2026-12-03T00:59:00Z', pullRequestReview: { databaseId: 10 } };
  const fixture: Fixture = { branch: 'feature/x', env: LEAN_ENV, reviews: [trustedReview()], summaries: [cleanSummary()], threads: [{ isResolved: true, comments: [comment], moreComments: true }] };
  const review = await runStep(reviewScript, fixture);
  assert.ok(review.failures.some(f => /more than 100 comments/u.test(f)), JSON.stringify(review.failures));
  const merge = await gate(fixture);
  assert.ok(merge.failures.some(f => /more than 100 comments/u.test(f)), JSON.stringify(merge.failures));
  // Same fixture with a complete thread is not blocked by pagination.
  const complete = await runStep(reviewScript, { ...fixture, threads: [{ isResolved: true, comments: [comment] }] });
  assert.ok(!complete.failures.some(f => /more than 100 comments/u.test(f)));
});

// ── Event-family audit: every input evaluation reads recomputes in lean ─────

function commentEvent(action: string, user: Record<string, unknown>, body: string) {
  return { eventName: 'issue_comment', payload: { action, issue: { number: 77, pull_request: {} }, comment: { body, user } } };
}

test('event audit: Independent Review subscribes to every review and inline-comment action, read-only', () => {
  const workflow = readWorkflow('independent-review.yml');
  assert.deepEqual(workflow.on.pull_request_review.types, ['submitted', 'edited', 'dismissed']);
  assert.deepEqual(workflow.on.pull_request_review_comment.types, ['created', 'edited', 'deleted']);
  assert.equal(workflow.on.pull_request_target, undefined);
  for (const job of Object.values(workflow.jobs as Record<string, Doc>)) {
    for (const value of Object.values((job.permissions ?? {}) as Record<string, string>)) assert.equal(value, 'read');
  }
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const refresh = readWorkflow('required-check-refresh.yml');
  assert.deepEqual(refresh.on.issue_comment.types, ['created', 'edited', 'deleted']);
  assert.equal(refresh.on.pull_request_review_comment, undefined, 'the privileged broker is never fork-event triggered');
});

test('event audit (lean): an inline review-thread comment run recomputes all four class-dependent checks', async () => {
  const run = { ...independentReviewWorkflowRun(), event: 'pull_request_review_comment' };
  const result = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: run }, env: LEAN_ENV, runs: ESCALATION_RUNS });
  assert.equal(result.error, null);
  assert.deepEqual(result.reruns, [101, 202, 303, 404]);
  for (const env of [LEGACY_ENV, UNSET_ENV]) {
    const legacy = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: run }, env, runs: ESCALATION_RUNS });
    assert.equal(legacy.error, null);
    assert.deepEqual(legacy.reruns, []);
  }
  // Only the Independent Review workflow may carry this event.
  const spoof = { ...run, name: 'Merge Gate', path: '.github/workflows/merge-gate.yml' };
  const refused = await runRefresh({ eventName: 'workflow_run', payload: { workflow_run: spoof }, env: LEAN_ENV, runs: ESCALATION_RUNS });
  assert.match(String(refused.error?.message), /Untrusted workflow_run identity/u);
  assert.deepEqual(refused.reruns, []);
});

test('event audit (lean): editing or deleting a trusted-login issue comment recomputes all four checks', async () => {
  for (const action of ['edited', 'deleted']) {
    for (const [label, user, body] of [
      ['summary', CODEX_BOT_USER, cleanSummary().body],
      ['escalation removed', CODEX_BOT_USER, 'no longer protected'],
      ['user with trusted login', { login: 'chatgpt-codex-connector', type: 'User' }, 'anything'],
    ] as const) {
      const result = await runRefresh({ ...commentEvent(action, user, body), env: LEAN_ENV, runs: ESCALATION_RUNS });
      assert.equal(result.error, null, `${action} ${label}`);
      assert.deepEqual([...result.reruns].sort(), [101, 202, 303, 404], `${action} ${label}`);
    }
  }
  // A trusted-login comment that is created as plain text affects nothing.
  const created = await runRefresh({ ...commentEvent('created', CODEX_BOT_USER, 'thanks'), env: LEAN_ENV, runs: ESCALATION_RUNS });
  assert.deepEqual(created.reruns, []);
});

test('event audit (adversarial): untrusted comment edits/deletions trigger nothing; legacy ignores deletions entirely', async () => {
  for (const action of ['created', 'edited', 'deleted']) {
    const untrusted = await runRefresh({ ...commentEvent(action, { login: 'mallory', type: 'User' }, 'RISK-CLASS: PROTECTED\n![P1 Badge](x)'), env: LEAN_ENV, runs: ESCALATION_RUNS });
    assert.equal(untrusted.error, null, action);
    assert.deepEqual(untrusted.reruns, [], action);
  }
  // Legacy: deleted is a no-op even for legacy body signals; created/edited unchanged.
  for (const env of [LEGACY_ENV, UNSET_ENV]) {
    const requireFn = env === UNSET_ENV ? forbidModuleRequire : rootRequire;
    const deleted = await runRefresh({ ...commentEvent('deleted', { login: 'griff843', type: 'User' }, 'EXECUTOR_RESULT: READY\nPM_VERDICT: APPROVED'), env, runs: ESCALATION_RUNS }, requireFn);
    assert.equal(deleted.error, null);
    assert.deepEqual(deleted.reruns, []);
    const trustedDeleted = await runRefresh({ ...commentEvent('deleted', CODEX_BOT_USER, cleanSummary().body), env, runs: ESCALATION_RUNS }, requireFn);
    assert.deepEqual(trustedDeleted.reruns, []);
    const edited = await runRefresh({ ...commentEvent('edited', { login: 'griff843', type: 'User' }, 'EXECUTOR_RESULT: READY'), env, runs: ESCALATION_RUNS }, requireFn);
    assert.deepEqual(edited.reruns, [303]);
    const trustedEdited = await runRefresh({ ...commentEvent('edited', CODEX_BOT_USER, 'anything'), env, runs: ESCALATION_RUNS }, requireFn);
    assert.deepEqual(trustedEdited.reruns, []);
  }
});

// ── post-merge-qa-gate tier derivation ─────────────────────────────────────

test('post-merge-qa-gate: label tier wins; lean Protected derives T1; lean Standard and legacy stay non-lane', async () => {
  const worker = { filename: 'apps/worker/src/a.ts', status: 'modified', additions: 1, deletions: 0, patch: '@@ -1 +1 @@\n+a\n' };
  assert.equal((await runStep(effScript, { branch: 'x', env: LEAN_ENV }, { LABEL_TIER: 'T2', PR_NUMBER: '77' })).outputs.tier, 'T2');
  assert.equal((await runStep(effScript, { branch: 'x', env: LEAN_ENV, files: [worker] }, { LABEL_TIER: '', PR_NUMBER: '77' })).outputs.tier, 'T1');
  assert.equal((await runStep(effScript, { branch: 'x', env: LEAN_ENV }, { LABEL_TIER: '', PR_NUMBER: '77' })).outputs.tier, '');
  assert.equal((await runStep(effScript, { branch: 'x', env: UNSET_ENV, files: [worker] }, { LABEL_TIER: '', PR_NUMBER: '77' })).outputs.tier, '');
});

test('post-merge-qa-gate (P3): in lean the tier is derived from the diff (Protected -> T1 over any label); legacy forwards the label unchanged', async () => {
  const worker = { filename: 'apps/worker/src/a.ts', status: 'modified', additions: 1, deletions: 0, patch: '@@ -1 +1 @@\n+a\n' };
  assert.equal((await runStep(effScript, { branch: 'x', env: LEAN_ENV, files: [worker] }, { LABEL_TIER: 'T3', PR_NUMBER: '77' })).outputs.tier, 'T1', 'T3 label on a Protected diff');
  assert.equal((await runStep(effScript, { branch: 'x', env: LEAN_ENV }, { LABEL_TIER: 'T1', PR_NUMBER: '77' })).outputs.tier, 'T1', 'label never lowered');
  for (const env of [LEGACY_ENV, UNSET_ENV]) {
    assert.equal((await runStep(effScript, { branch: 'x', env, files: [worker] }, { LABEL_TIER: 'T3', PR_NUMBER: '77' }, forbidModuleRequire)).outputs.tier, 'T3');
  }
});

test('post-merge-qa-gate (P3): an unlabelled legacy PR skips checkout and tier resolution exactly as on base c3168c525', () => {
  const workflow = readWorkflow('post-merge-qa-gate.yml');
  const checkout = findStep(workflow, 'qa-gate', 'Checkout');
  const eff = findStep(workflow, 'qa-gate', 'Resolve effective tier');
  // Both conditions reduce to the base condition (tier != '') whenever the lean flag is absent.
  for (const condition of [checkout.if as string, eff.if as string]) {
    assert.match(condition, /steps\.pr\.outputs\.tier != ''/u);
    assert.match(condition, /contains\(vars\.OPERATING_MODEL, 'lean'\)/u);
    assert.doesNotMatch(condition.replace(/contains\(vars\.OPERATING_MODEL, 'lean'\)/u, 'false'), /vars\./u);
  }
  // Downstream steps key on steps.eff.outputs.tier only; with eff skipped that output is '' => skipped, as before.
  for (const step of workflow.jobs['qa-gate'].steps as Doc[]) {
    if (typeof step.if === 'string' && step.if.includes('steps.eff.outputs.tier')) assert.match(step.if, /^steps\.eff\.outputs\.tier != ''$/u, step.name);
  }
});

test('post-merge-qa-gate: every downstream step keys on the effective tier, none on the raw label output', () => {
  const downstream = readWorkflowText('post-merge-qa-gate.yml').split('- name: Collect changed files')[1]!;
  assert.ok(!downstream.includes('steps.pr.outputs.tier'), 'downstream steps must use steps.eff.outputs.tier');
});

// ── post-merge-lane-close: manifest-optional, executed ─────────────────────

function runBash(script: string, env: Record<string, string>, cwd: string, binDir?: string) {
  const outputFile = path.join(cwd, 'github_output.txt');
  fs.writeFileSync(outputFile, '');
  const result = spawnSync('bash', ['-c', script], {
    cwd,
    encoding: 'utf8',
    env: { PATH: `${binDir ? `${binDir}:` : ''}${process.env.PATH}`, GITHUB_OUTPUT: outputFile, ...env },
  });
  return { status: result.status, stdout: result.stdout, output: fs.readFileSync(outputFile, 'utf8') };
}

test('post-merge-lane-close: a Standard merge with no lane id or no manifest closes nothing and does not fail', () => {
  const dir = createTempWorkspace('lean-lane-close-');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\necho "[]"\n', { mode: 0o755 });
  const workflow = readWorkflow('post-merge-lane-close.yml');
  const extract = findStep(workflow, 'lane-close', 'Extract issue ID from commit message and PR branch');
  const noId = runBash(extract.run as string, { COMMIT_MSG: 'feat: standard change (#4242)', COMMIT_SHA: 'abc', GITHUB_TOKEN: 'x', DISPATCH_ISSUE_ID: '', DISPATCH_PR: '' }, dir, bin);
  assert.equal(noId.status, 0);
  assert.match(noId.output, /issue_id=\n/u);

  const manifest = findStep(workflow, 'lane-close', 'Check lane manifest exists');
  const noManifest = runBash(manifest.run as string, { ISSUE_ID: 'WORK-424242' }, dir);
  assert.equal(noManifest.status, 0);
  assert.match(noManifest.output, /exists=false/u);
});

test('post-merge-lane-close: every closeout/proof/mutex step is gated on an extracted issue AND an existing manifest', () => {
  const workflow = readWorkflow('post-merge-lane-close.yml');
  const closeSteps = (workflow.jobs['lane-close'].steps as Doc[]).filter(step =>
    /pnpm ops:/u.test(String(step.run ?? '')));
  assert.ok(closeSteps.length > 0);
  for (const step of closeSteps) {
    const condition = String(step.if ?? '');
    assert.ok(condition.includes("steps.extract.outputs.issue_id != ''") || condition.includes('steps.manifest.outputs.exists') || condition.includes('steps.lane_close.'), `${step.name} is not manifest-gated`);
  }
});
