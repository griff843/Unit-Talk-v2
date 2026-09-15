'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Exercises the production CommonJS evaluator directly in node:test. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { classifyP0Evidence, classifyRepositoryP0, validateClassificationApproval, HISTORICAL_P0 } = require('./p0-classifier.cjs');
const { evaluatePullRequest } = require('./p0-workflow.cjs');
const { parseVerdict, validateT1Verdicts } = require('../merge-gate-verdict.cjs');
const work = 'WORK-2026091001';
const head = 'a'.repeat(40);
const manifest = (required, issue_id = work) => ({ issue_id, tier: 'T1', p0_protocol: {
  required, merge_type: 'manual',
  claude_critique: {recorded: true, artifact_path: `docs/06_status/proof/${issue_id}/claude-critique.md`},
  runtime_verification: {recorded: true, result: 'pass', artifact_path: `docs/06_status/proof/${issue_id}/runtime-verification.md`},
} });
const comment = (verdict = 'APPROVED', sha = head, issue = work) => ({
  body: `PM_VERDICT: ${verdict}\nschema: pm-verdict/v1\nIssue: ${issue}\nPR: 42\nHead SHA: ${sha}`,
  user: { login: 'griff843', type: 'User' }, created_at: '2026-09-10T01:00:00Z',
});

test('historical initial and later positives survive candidate removal and false declarations', () => {
  assert.ok(HISTORICAL_P0.includes('UTV2-949'));
  assert.ok(HISTORICAL_P0.includes('UTV2-953'));
  for (const issueId of HISTORICAL_P0) {
    assert.equal(classifyP0Evidence({ issueId, candidateManifest: manifest(false, issueId), approval: true }).classification, 'p0');
  }
});
test('trusted base positive survives candidate erasure, registry edits and approval', () => {
  for (const candidateManifest of [null, manifest(false)]) {
    assert.equal(classifyP0Evidence({ issueId: work, baseManifest: manifest(true), candidateManifest, approval: true }).classification, 'p0');
  }
  assert.equal(classifyP0Evidence({issueId: work, baseRegistry: {schema_version: 1, classifications: [{issue_id: work, required: true, evidence: 'reviewed'}]}, candidateManifest: manifest(false), approval: true}).classification, 'p0');
});
test('unknown and malformed identities, missing flags and malformed base fail closed', () => {
  for (const issueId of ['', '../../oops', 'WORK-invalid']) assert.equal(classifyP0Evidence({issueId}).classification, 'unknown');
  assert.equal(classifyP0Evidence({issueId: work, candidateManifest: {issue_id: work}}).classification, 'unknown');
  assert.equal(classifyP0Evidence({issueId: work, baseError: 'bad base', candidateManifest: manifest(false), approval: true}).classification, 'unknown');
  assert.equal(classifyP0Evidence({issueId: work, candidateManifest: manifest('false'), approval: true}).classification, 'unknown');
});
test('explicit classification reuses tier policy; candidate true escalates and missing tier remains unresolved', () => {
  for (const tier of ['T1', 'T2', 'T3']) {
    const candidateManifest = {...manifest(false), tier};
    const result = classifyP0Evidence({issueId: work, candidateManifest});
    assert.equal(result.classification, 'non_p0');
    assert.match(result.reason, new RegExp(`existing ${tier} merge and review`));
  }
  assert.equal(classifyP0Evidence({issueId: work, candidateManifest: {...manifest(false), tier: undefined}}).classification, 'unknown');
  assert.equal(classifyP0Evidence({issueId: work, candidateManifest: manifest(false), approval: true}).classification, 'non_p0');
  assert.equal(classifyP0Evidence({issueId: work, baseManifest: manifest(false)}).classification, 'non_p0');
  assert.equal(classifyP0Evidence({issueId: work, baseManifest: manifest(false), candidateManifest: manifest(true)}).classification, 'p0');
});
test('strict PM classification review rejects missing, stale, unauthorized and later withdrawal', () => {
  const check = (comments) => validateClassificationApproval({issueId: work, prNumber: 42, headSha: head, comments, authorizedReviewers: ['griff843']});
  assert.equal(check([comment()]), true);
  assert.equal(check([]), false);
  assert.equal(check([comment('APPROVED', 'b'.repeat(40))]), false);
  assert.equal(check([{...comment(), user: {login: 'untrusted', type: 'User'}}]), false);
  assert.equal(check([{...comment(), user: {login: 'griff843', type: 'Bot'}}]), false);
  assert.equal(check([comment(), {...comment('CHANGES_REQUIRED'), created_at: '2026-09-10T02:00:00Z'}]), false);
  assert.equal(check([comment('APPROVED', head, 'UTV2-948')]), false);
});
test('non-P0 applicability does not bypass the ordinary T1 exact-head merge gate', () => {
  assert.equal(classifyP0Evidence({issueId: work, candidateManifest: manifest(false)}).classification, 'non_p0');
  const context = {prNumber: 42, headSha: head, authorizedReviewers: new Set(['griff843'])};
  assert.match(validateT1Verdicts([], context)[0], /requires a valid pm-verdict\/v1/);
  const stale = comment('APPROVED', 'b'.repeat(40));
  const verdicts = [{
    user: stale.user.login,
    userType: stale.user.type,
    parsed: parseVerdict(stale.body),
    createdAt: stale.created_at,
  }];
  assert.match(validateT1Verdicts(verdicts, context)[0], /stale/);
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-local-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git('init', '-q'); git('config', 'user.name', 'P0 fixture'); git('config', 'user.email', 'fixture@example.invalid');
  const dir = path.join(root, 'docs/06_status/lanes'); fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, `${work}.json`); fs.writeFileSync(file, JSON.stringify(manifest(true)));
  git('add', '.'); git('commit', '-qm', 'positive base');
  return {root, git, file, base: git('rev-parse', 'HEAD')};
}
test('repository entrypoint protects pinned base positive after real git candidate commit', (t) => {
  const f = fixture(t); fs.writeFileSync(f.file, JSON.stringify(manifest(false))); f.git('add', '.'); f.git('commit', '-qm', 'candidate clears flag');
  assert.equal(classifyRepositoryP0({root: f.root, issueId: work, baseRef: f.base, headRef: 'HEAD', approval: true}).classification, 'p0');
  assert.equal(classifyRepositoryP0({root: f.root, issueId: work, baseRef: 'unavailable'}).classification, 'unknown');
});
test('CLI executes without tracker even with invalid credentials and network blocked', (t) => {
  const f = fixture(t);
  const guard = path.join(f.root, 'block-network.cjs');
  fs.writeFileSync(guard, "global.fetch=()=>{throw Error('NETWORK FORBIDDEN')};for(const m of ['node:http','node:https']){require(m).request=()=>{throw Error('NETWORK FORBIDDEN')};require(m).get=require(m).request;}");
  const repo = path.resolve(__dirname, '../../..');
  const cli = spawnSync(process.execPath, ['--require', guard, path.join(repo, 'node_modules/tsx/dist/cli.mjs'), path.join(repo, 'scripts/ops/p0-detect.ts'), work, '--base', f.base, '--json'], {
    cwd: f.root, encoding: 'utf8', env: {PATH: process.env.PATH, HOME: process.env.HOME, NODE_OPTIONS: `--require=${guard}`, LINEAR_API_TOKEN: 'invalid-fixture', LINEAR_API_KEY: 'invalid-fixture'},
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).classification, 'p0');
});
test('CLI reports explicit committed non-P0 with exit 10 and unknown with exit 3 without credentials', (t) => {
  const f = fixture(t); fs.writeFileSync(f.file, JSON.stringify(manifest(false))); f.git('add', '.'); f.git('commit', '-qm', 'reviewed negative fixture');
  const repo = path.resolve(__dirname, '../../..');
  for (const [id, expectedStatus, expectedClassification] of [[work, 10, 'non_p0'], ['WORK-999', 3, 'unknown']]) {
    const cli = spawnSync(process.execPath, [path.join(repo, 'node_modules/tsx/dist/cli.mjs'), path.join(repo, 'scripts/ops/p0-detect.ts'), id, '--base', 'HEAD', '--json'], {cwd: f.root, encoding: 'utf8', env: {PATH: process.env.PATH, HOME: process.env.HOME}});
    assert.equal(cli.status, expectedStatus, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).classification, expectedClassification);
  }
});
test('CLI classifies a new T3 WORK-999 non-P0 without approval when tracker tokens are stale and network is blocked', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-new-work-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git('init', '-q'); git('config', 'user.name', 'P0 fixture'); git('config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(root, 'README.md'), 'trusted base\n');
  git('add', '.'); git('commit', '-qm', 'trusted base without classification');
  const base = git('rev-parse', 'HEAD');
  const issueId = 'WORK-999';
  const dir = path.join(root, 'docs/06_status/lanes');
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, `${issueId}.json`), JSON.stringify({...manifest(false, issueId), tier: 'T3'}));
  git('add', '.'); git('commit', '-qm', 'new T3 repository work');
  const guard = path.join(root, 'block-network.cjs');
  fs.writeFileSync(guard, "global.fetch=()=>{throw Error('NETWORK FORBIDDEN')};for(const m of ['node:http','node:https']){require(m).request=()=>{throw Error('NETWORK FORBIDDEN')};require(m).get=require(m).request;}");
  const repo = path.resolve(__dirname, '../../..');
  const cli = spawnSync(process.execPath, ['--require', guard, path.join(repo, 'node_modules/tsx/dist/cli.mjs'), path.join(repo, 'scripts/ops/p0-detect.ts'), issueId, '--base', base, '--head', 'HEAD', '--json'], {
    cwd: root,
    encoding: 'utf8',
    env: {PATH: process.env.PATH, HOME: process.env.HOME, NODE_OPTIONS: `--require=${guard}`, LINEAR_API_TOKEN: 'stale-token', LINEAR_API_KEY: 'stale-token'},
  });
  assert.equal(cli.status, 10, cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout), {
    schema_version: 1,
    issue_id: issueId,
    classification: 'non_p0',
    is_p0: false,
    source: 'manifest',
    reason: 'Explicit repository non-P0 declaration; existing T3 merge and review requirements still apply',
  });
});
test('CLI classifies new T1 and T2 negative declarations without a separate P0 approval', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-tier-policy-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git('init', '-q'); git('config', 'user.name', 'P0 fixture'); git('config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(root, 'README.md'), 'trusted base\n');
  git('add', '.'); git('commit', '-qm', 'trusted base without classifications');
  const base = git('rev-parse', 'HEAD');
  const dir = path.join(root, 'docs/06_status/lanes');
  fs.mkdirSync(dir, {recursive: true});
  for (const [issueId, tier] of [['WORK-997', 'T1'], ['WORK-998', 'T2']]) {
    fs.writeFileSync(path.join(dir, `${issueId}.json`), JSON.stringify({...manifest(false, issueId), tier}));
  }
  git('add', '.'); git('commit', '-qm', 'new T1 and T2 repository work');
  const repo = path.resolve(__dirname, '../../..');
  for (const [issueId, tier] of [['WORK-997', 'T1'], ['WORK-998', 'T2']]) {
    const cli = spawnSync(process.execPath, [path.join(repo, 'node_modules/tsx/dist/cli.mjs'), path.join(repo, 'scripts/ops/p0-detect.ts'), issueId, '--base', base, '--head', 'HEAD', '--json'], {
      cwd: root,
      encoding: 'utf8',
      env: {PATH: process.env.PATH, HOME: process.env.HOME},
    });
    assert.equal(cli.status, 10, cli.stderr);
    const result = JSON.parse(cli.stdout);
    assert.equal(result.classification, 'non_p0');
    assert.match(result.reason, new RegExp(`existing ${tier} merge and review requirements still apply`));
  }
});

function fakeGitHub({required = true, baseRequired, approval = true, critique = 'Independent critique', verification = '- [x] runtime: PASS\nresult: pass', labels = [], title = work, branch = `codex/${work}`, candidate = null, baseBranch = 'main', baseRepo = 'fixture/fixture'} = {}) {
  const pr = {title, head: {sha: head, ref: branch}, base: {sha: 'b'.repeat(40), ref: baseBranch, repo: {full_name: baseRepo}}, labels, auto_merge: null};
  const github = {
    rest: {
      pulls: {get: async () => ({data: pr})}, issues: {listComments: 'comments'},
      repos: {getContent: async ({path: file, ref}) => {
        let value;
        if (file.includes('/lanes/')) value = ref === head ? (required === undefined ? null : JSON.stringify(candidate ?? manifest(required))) : (baseRequired === undefined ? null : JSON.stringify(manifest(baseRequired)));
        else if (file.endsWith('claude-critique.md')) value = critique;
        else if (file.endsWith('runtime-verification.md')) value = verification;
        if (value == null) throw Object.assign(new Error('not found'), {status: 404});
        return {data: {type: 'file', encoding: 'base64', content: Buffer.from(value).toString('base64')}};
      }},
    },
    paginate: async () => approval ? [comment()] : [],
  };
  return {github, repo: {owner: 'fixture', repo: 'fixture'}, number: 42, headSha: head};
}
test('actual workflow evaluator permits reviewed new non-P0 and fully evidenced P0', async () => {
  assert.match(await evaluatePullRequest(fakeGitHub({required: false})), /non_p0/);
  assert.match(await evaluatePullRequest(fakeGitHub()), /: p0/);
  assert.match(await evaluatePullRequest(fakeGitHub({title: `UTV2-948 reference for ${work}`})), new RegExp(`^${work}: p0`));
});
test('actual workflow evaluator preserves trusted-base and P0 approval/artifact gates', async () => {
  await assert.rejects(evaluatePullRequest(fakeGitHub({baseBranch: 'untrusted'})), /protected main/);
  await assert.rejects(evaluatePullRequest(fakeGitHub({baseRepo: 'attacker/fixture'})), /protected main/);
  assert.match(await evaluatePullRequest(fakeGitHub({required: false, approval: false, candidate: {...manifest(false), tier: 'T3'}})), /non_p0/);
  await assert.rejects(evaluatePullRequest(fakeGitHub({required: false, baseRequired: true})), /retain/);
  await assert.rejects(evaluatePullRequest(fakeGitHub({approval: false})), /human PM/);
  await assert.rejects(evaluatePullRequest(fakeGitHub({critique: ''})), /critique/);
  for (const status of ['FAIL', 'SKIP', 'SKIPPED']) await assert.rejects(evaluatePullRequest(fakeGitHub({verification: `- [x] runtime: ${status}\nresult: pass`})), /FAIL\/SKIP/);
  await assert.rejects(evaluatePullRequest(fakeGitHub({labels: [{name: 'auto-merge'}]})), /auto-merge/);
  await assert.rejects(evaluatePullRequest(fakeGitHub({title: `${work} UTV2-948`, branch: 'codex/no-identity'})), /unambiguous/);
  const staleRecord = manifest(true);
  staleRecord.p0_protocol.runtime_verification.artifact_path = 'docs/06_status/proof/UTV2-948/runtime-verification.md';
  await assert.rejects(evaluatePullRequest(fakeGitHub({candidate: staleRecord})), /canonical passing/);
  const missingRecord = manifest(true);
  missingRecord.p0_protocol.claude_critique.recorded = false;
  await assert.rejects(evaluatePullRequest(fakeGitHub({candidate: missingRecord})), /canonical critique/);
});
