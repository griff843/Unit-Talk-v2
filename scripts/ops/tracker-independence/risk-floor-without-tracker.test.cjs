'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Matches the sibling trusted-evaluator tests: plain CommonJS, no candidate build. */

/**
 * Cutover exit condition 3, demonstrated rather than asserted: with Linear
 * absent, the repository's own risk floor and its historical P0 obligations
 * still bind.
 *
 * The two are tested together on purpose. Tracker independence is only safe if
 * removing the tracker removes *bookkeeping* and nothing else -- and the two
 * things Linear used to carry that were not bookkeeping are exactly these: the
 * authoritative tier (truth-check L2 used to overwrite the manifest tier from
 * the tracker) and the P0 classification (`p0-protocol.yml` used to read a
 * Linear label through a GraphQL call). Both now resolve from the repository.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { HISTORICAL_P0, classifyRepositoryP0 } = require('./p0-classifier.cjs');

const REPO = path.resolve(__dirname, '../../..');

function gitFixture(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Risk floor fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  return { root, git };
}

/** A tracker that cannot be reached, and credentials that would fail if it were. */
function credentialFreeEnv(root) {
  const guard = path.join(root, 'block-network.cjs');
  fs.writeFileSync(
    guard,
    "global.fetch=()=>{throw Error('NETWORK FORBIDDEN')};for(const m of ['node:http','node:https']){require(m).request=()=>{throw Error('NETWORK FORBIDDEN')};require(m).get=require(m).request;}",
  );
  return {
    guard,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_OPTIONS: `--require=${guard}`,
      LINEAR_API_TOKEN: 'stale-fixture-token',
      LINEAR_API_KEY: 'stale-fixture-token',
    },
  };
}

test('the mechanical risk floor refuses a lowered tier with no tracker consulted', async () => {
  const { runLinearChecks } = await import('../preflight.ts');

  const collect = async (tier, files, issueId = 'WORK-2026091001') => {
    const checks = [];
    // `env` is null and `refresh` is false: there is no tracker handle to pass,
    // which is the point -- admission authority must not depend on one.
    await runLinearChecks(issueId, tier, null, files, false,
      (id, status, detail) => { checks.push({ id, status, detail }); });
    const pe2 = checks.find((check) => check.id === 'PE2');
    assert.ok(pe2, 'PE2 must always be emitted');
    return { pe2, checks };
  };

  // `scripts/ci/file-scope-guard.ts` is a Tier C exact path, so its mechanical
  // minimum is T1. A lane declaring T3 over it is declaring below the floor.
  const lowered = await collect('T3', ['scripts/ci/file-scope-guard.ts']);
  assert.equal(lowered.pe2.status, 'fail');
  assert.match(lowered.pe2.detail, /below the mechanical floor T1/u);
  assert.match(lowered.pe2.detail, /scripts\/ci\/file-scope-guard\.ts/u,
    'the refusal must name the path that raised the floor');
  assert.match(lowered.pe2.detail, /never lowered to avoid tracker bookkeeping/u);

  // T2 is still below the floor -- the floor is a floor, not a nudge.
  assert.equal((await collect('T2', ['scripts/ci/file-scope-guard.ts'])).pe2.status, 'fail');

  // Declaring at or above the floor is admitted, so the check is not simply
  // refusing everything.
  const met = await collect('T1', ['scripts/ci/file-scope-guard.ts']);
  assert.equal(met.pe2.status, 'skip');
  assert.match(met.pe2.detail, /satisfies the mechanical floor T1/u);

  // And a file with no Tier C rule floors at T3, so an ordinary lane is not
  // escalated by the mere existence of the check.
  assert.equal((await collect('T3', ['docs/06_status/CURRENT_STATE.md'])).pe2.status, 'skip');

  // Identity namespace changes nothing: a repo-minted identity is held to the
  // same floor as a tracker key. If it were not, minting a WORK id would be a
  // route to a lower tier.
  const trackerKeyed = await collect('T3', ['scripts/ci/file-scope-guard.ts'], 'UTV2-1556');
  assert.equal(trackerKeyed.pe2.status, 'fail');
  assert.equal(trackerKeyed.pe2.detail, lowered.pe2.detail);

  // The optional tracker checks degrade to `skip`, never to `pass`: an absent
  // tracker must not be reported as a satisfied check.
  for (const id of ['PL1', 'PL2', 'PL3', 'PL4']) {
    const check = lowered.checks.find((entry) => entry.id === id);
    assert.equal(check?.status, 'skip', `${id} must skip without a tracker`);
  }

  // A floor that any tier could waive would not be a floor.
  const source = fs.readFileSync(path.join(REPO, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  const waivable = source.match(/const WAIVABLE_CHECKS[\s\S]*?\n};/);
  assert.ok(waivable);
  assert.doesNotMatch(waivable[0], /PE2/u, 'PE2 must not be waivable at any tier');
});

test('historical P0 obligations survive a candidate that declares them away, with no tracker reachable', (t) => {
  const f = gitFixture(t, 'p0-historical-floor-');
  const [historical] = HISTORICAL_P0;
  assert.match(historical, /^UTV2-\d+$/u);

  // A trusted base that says nothing at all about this identity. The obligation
  // is therefore carried by the frozen list alone, which is the case that
  // matters: nothing in the repository can be edited to clear it.
  fs.writeFileSync(path.join(f.root, 'README.md'), 'trusted base\n');
  f.git('add', '.');
  f.git('commit', '-qm', 'trusted base with no classification');
  const base = f.git('rev-parse', 'HEAD');

  // The candidate does everything available to it to declare the obligation
  // away: a manifest saying `required: false`, and a registry entry agreeing.
  const lanes = path.join(f.root, 'docs/06_status/lanes');
  fs.mkdirSync(lanes, { recursive: true });
  fs.writeFileSync(path.join(lanes, `${historical}.json`), JSON.stringify({
    issue_id: historical, tier: 'T3', p0_protocol: { required: false },
  }));
  const registryDir = path.join(f.root, 'docs/governance/tracker-independence');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(path.join(registryDir, 'p0-classifications.json'), JSON.stringify({
    schema_version: 1,
    classifications: [{ issue_id: historical, required: false, evidence: 'candidate claims this was never P0' }],
  }));
  f.git('add', '.');
  f.git('commit', '-qm', 'candidate declares the historical obligation away');

  const verdict = classifyRepositoryP0({
    root: f.root, issueId: historical, baseRef: base, headRef: 'HEAD', approval: true,
  });
  assert.equal(verdict.classification, 'p0');
  assert.equal(verdict.source, 'historical');
  assert.equal(verdict.is_p0, true);

  // The same identity, resolved through the CLI that CI would run, with the
  // network blocked and stale tracker credentials present. Exit 0 is the P0
  // verdict; a tracker-dependent path would have thrown NETWORK FORBIDDEN.
  const { guard, env } = credentialFreeEnv(f.root);
  const cli = spawnSync(process.execPath, [
    '--require', guard,
    path.join(REPO, 'node_modules/tsx/dist/cli.mjs'),
    path.join(REPO, 'scripts/ops/p0-detect.ts'),
    historical, '--base', base, '--head', 'HEAD', '--json',
  ], { cwd: f.root, encoding: 'utf8', env });

  assert.equal(cli.status, 0, cli.stderr);
  assert.doesNotMatch(`${cli.stdout}${cli.stderr}`, /NETWORK FORBIDDEN/u,
    'the classification must not have attempted a network call at all');
  assert.deepEqual(JSON.parse(cli.stdout), {
    schema_version: 1,
    issue_id: historical,
    classification: 'p0',
    is_p0: true,
    source: 'historical',
    reason: 'Ratified or historically committed positive P0 classification',
  });

  // Non-vacuity: the same harness, same fixture, a non-historical identity with
  // the identical candidate declaration resolves non_p0. So the P0 verdict above
  // is the frozen list doing the work, not the harness refusing everything.
  const control = 'WORK-999';
  fs.writeFileSync(path.join(lanes, `${control}.json`), JSON.stringify({
    issue_id: control, tier: 'T3', p0_protocol: { required: false },
  }));
  f.git('add', '.');
  f.git('commit', '-qm', 'control identity with the same declaration');
  const controlCli = spawnSync(process.execPath, [
    '--require', guard,
    path.join(REPO, 'node_modules/tsx/dist/cli.mjs'),
    path.join(REPO, 'scripts/ops/p0-detect.ts'),
    control, '--base', base, '--head', 'HEAD', '--json',
  ], { cwd: f.root, encoding: 'utf8', env });
  assert.equal(controlCli.status, 10, controlCli.stderr);
  assert.equal(JSON.parse(controlCli.stdout).classification, 'non_p0');
});
