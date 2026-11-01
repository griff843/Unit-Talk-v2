/**
 * UTV2-1630 — negative tests for the staging-only writable DB path.
 *
 * These assert the properties that were *false* before this lane, each tied to
 * an observed failure rather than a hypothetical:
 *
 *   - 2026-07-29: 310 fixture rows written to production by lane test runs.
 *   - 2026-07-30: 7 picks + 4 submissions written to production from a pull
 *     request, because `verify:live-db-verdict` -> `test:live-db` -> `test:db`
 *     bypassed the guard that lived only inside `ci:db-smoke`.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertStagingTarget } from './assert-staging-target.js';
import {
  DEFAULT_DRAIN_MARGIN_MS,
  matchFixtureSignature,
  selectLeakedBoardFixtures,
  type BoardDrainCandidate,
} from './staging-board-drain.js';
import {
  MIN_REAP_AGE_MS,
  assertReapCutoff,
  assertWithinCap,
  chunk,
  classifyOrphanedSubmissions,
  parseReapArgs,
  readAllVerified,
  reapStagingFixtures,
  selectReapablePicks,
  type ReadSpec,
  type ReapCandidate,
  type ReapStore,
} from './staging-fixture-reap.js';
import {
  CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
  EXPECTED_STAGING_SUPABASE_PROJECT_REF,
} from './isolated-proof-attestation.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readRepo = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const pkg = JSON.parse(readRepo('package.json')) as { scripts: Record<string, string> };

const STAGING_URL = `https://${EXPECTED_STAGING_SUPABASE_PROJECT_REF}.supabase.co`;
const PRODUCTION_URL = `https://${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;

// ---------------------------------------------------------------------------
// A direct production-bound invocation must fail
// ---------------------------------------------------------------------------

test('a production target is refused before any client is constructed', () => {
  const result = assertStagingTarget({ SUPABASE_URL: PRODUCTION_URL });
  assert.equal(result.ok, false);
  assert.match(result.reason, /CANONICAL PRODUCTION/);
});

test('the staging target is accepted', () => {
  const result = assertStagingTarget({ SUPABASE_URL: STAGING_URL });
  assert.equal(result.ok, true);
  assert.equal(result.observedRef, EXPECTED_STAGING_SUPABASE_PROJECT_REF);
});

for (const [label, url] of [
  ['missing environment (no URL)', undefined],
  ['empty URL', ''],
  ['unknown project', 'https://abcdefghijklmnopqrst.supabase.co'],
  ['custom domain', 'https://db.unit-talk.com'],
  ['pooler', 'https://aws-0-us-east-1.pooler.supabase.com:6543'],
  ['tunnel', 'http://127.0.0.1:54321'],
  ['malformed', 'not-a-url'],
] as const) {
  test(`refused: ${label}`, () => {
    assert.equal(assertStagingTarget({ SUPABASE_URL: url as string | undefined }).ok, false);
  });
}

test('the gate CLI exits non-zero for production', () => {
  let status = 0;
  try {
    execFileSync(
      process.execPath,
      ['--import', 'tsx', path.join(REPO_ROOT, 'scripts/ci/assert-staging-target.ts')],
      { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, SUPABASE_URL: PRODUCTION_URL } },
    );
  } catch (error) {
    status = (error as { status?: number }).status ?? 1;
  }
  assert.equal(status, 1, 'assert-staging-target must exit 1 for a production target');
});

// ---------------------------------------------------------------------------
// The bypass must be structurally closed
// ---------------------------------------------------------------------------

test('every writable DB script is gated by ci:assert-staging', () => {
  for (const script of ['test:db', 'test:t1-proof:live']) {
    assert.match(
      pkg.scripts[script] ?? '',
      /^pnpm ci:assert-staging &&/,
      `${script} must begin with the staging gate — it is reachable directly, via ` +
        'test:live-db, and via verify:live-db-verdict',
    );
  }
});

test('test:live-db cannot reach a writable suite except through gated scripts', () => {
  const live = pkg.scripts['test:live-db'] ?? '';
  // It may only compose the two gated scripts.
  const composed = live.split('&&').map((part) => part.trim()).filter(Boolean);
  for (const part of composed) {
    assert.match(
      part,
      /^pnpm (test:db|test:t1-proof:live)$/,
      `test:live-db must compose only gated scripts; found "${part}"`,
    );
  }
});

test('ci:assert-staging is wired as a real script', () => {
  assert.equal(pkg.scripts['ci:assert-staging'], 'tsx scripts/ci/assert-staging-target.ts');
});

// ---------------------------------------------------------------------------
// PR-triggered workflows must not carry production write credentials
// ---------------------------------------------------------------------------

const PRODUCTION_DB_SECRETS = [
  'secrets.SUPABASE_URL',
  'secrets.SUPABASE_ANON_KEY',
  'secrets.SUPABASE_SERVICE_ROLE_KEY',
  'secrets.SUPABASE_DB_URL',
  'secrets.SUPABASE_DB_POOLER_URL',
];

test('ci.yml carries no production database credential', () => {
  const source = readRepo('.github/workflows/ci.yml');
  for (const secret of PRODUCTION_DB_SECRETS) {
    assert.ok(
      !source.includes(secret),
      `ci.yml must not reference ${secret} — it runs on pull_request and previously ` +
        'wrote fixture rows to production through the live-DB path',
    );
  }
});

test('ci.yml binds the staging-ci environment', () => {
  const source = readRepo('.github/workflows/ci.yml');
  assert.match(source, /environment:\s*staging-ci/, 'ci.yml must bind staging-ci');
  for (const name of [
    'secrets.CI_SUPABASE_URL',
    'secrets.CI_SUPABASE_PROJECT_REF',
    'secrets.CI_SUPABASE_PUBLISHABLE_KEY',
    'secrets.CI_SUPABASE_SECRET_KEY',
  ]) {
    assert.ok(source.includes(name), `ci.yml must read ${name}`);
  }
});

test('the staging proof workflow binds staging-ci and no production secret', () => {
  const source = readRepo('.github/workflows/staging-db-proof.yml');
  assert.match(source, /environment:\s*staging-ci/);
  for (const secret of PRODUCTION_DB_SECRETS) {
    assert.ok(!source.includes(secret), `staging-db-proof.yml must not reference ${secret}`);
  }
});

test('no workflow with DB credentials uses pull_request_target', () => {
  // Superseded in scope: the producer moved into ci.yml, so this property is
  // asserted on the workflow that actually carries the trigger. Comments are
  // stripped first — prose explaining why pull_request_target is avoided must
  // not read as a usage of it.
  for (const file of ['.github/workflows/ci.yml', '.github/workflows/staging-db-proof.yml']) {
    const source = readRepo(file)
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    assert.ok(
      !/^\s*pull_request_target:/mu.test(source),
      `${file}: pull_request_target would expose secrets to fork PRs`,
    );
  }
  const ci = readRepo('.github/workflows/ci.yml')
    .split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.match(ci, /^\s+pull_request:/mu, 'ci.yml must run on pull_request');
});

test('the proof auditor job depends on the DB job and downloads a same-run artifact', () => {
  const source = readRepo('.github/workflows/staging-db-proof.yml');
  assert.match(source, /needs:\s*staging-db-proof/, 'auditor must depend on the DB job');
  assert.match(
    source,
    /utv2-1630-db-proof-receipt-\$\{\{\s*github\.run_id\s*\}\}-\$\{\{\s*github\.run_attempt\s*\}\}/,
    'artifact name must be scoped to this run and attempt, so a previous run cannot be reused',
  );
  assert.match(source, /if-no-files-found:\s*error/, 'a missing artifact must fail, not skip');
});

// ---------------------------------------------------------------------------
// Mutation-driven regressions from the exact-head review.
// ---------------------------------------------------------------------------

// M4: `.evilxxx.com` is exactly as long as `.supabase.co`, so removing the
// host-suffix check made slice(0,-12) equal the staging ref and APPROVED an
// attacker host. The suffix check was correct but unpinned.
test('M4: a same-length lookalike TLD is refused', () => {
  for (const host of [
    'https://xskgrzbteyqdufktjrjx.evilxxx.com',
    'https://xskgrzbteyqdufktjrjx.supabase.io',
    'https://xskgrzbteyqdufktjrjx.aupabase.co',
  ]) {
    assert.equal(
      assertStagingTarget({ SUPABASE_URL: host }).ok,
      false,
      `${host} must be refused — only *.supabase.co is a Supabase project host`,
    );
  }
});

// M15: the check that turns "not production" into "positively staging".
// Deleting it let any non-production Supabase project verify.
test('M15: a non-production Supabase project that is not staging is refused', () => {
  const other = 'https://abcdefghijklmnopqrst.supabase.co';
  const result = assertStagingTarget({ SUPABASE_URL: other });
  assert.equal(result.ok, false);
  assert.match(result.reason, /is not the approved staging project/);
});

// M30: the job-identity pin in the auditor invocation.
test('M30: the auditor pins the producing job identity', () => {
  const source = readRepo('.github/workflows/staging-db-proof.yml');
  assert.match(
    source,
    /--expect-job\s+staging-db-proof/,
    'the auditor must pin --expect-job so another job cannot mint the receipt',
  );
});

// M26/M28/M29: artifact scoping and fail-closed download must hold on BOTH the
// upload and the download step, not just wherever the regex happened to match.
test('M26/M28/M29: artifact name is run+attempt scoped on upload AND download', () => {
  const source = readRepo('.github/workflows/staging-db-proof.yml');
  const scoped = source.match(
    /utv2-1630-db-proof-receipt-\$\{\{\s*github\.run_id\s*\}\}-\$\{\{\s*github\.run_attempt\s*\}\}/gu,
  );
  assert.ok(
    (scoped?.length ?? 0) >= 2,
    'both the upload and the download must use the run+attempt scoped name; ' +
      `found ${scoped?.length ?? 0} occurrence(s)`,
  );
  const failClosed = source.match(/if-no-files-found:\s*error/gu);
  assert.ok(
    (failClosed?.length ?? 0) >= 2,
    `upload and download must both fail closed; found ${failClosed?.length ?? 0}`,
  );
});

// ---------------------------------------------------------------------------
// UTV2-1630 — the receipt must gate the REQUIRED context.
//
// `verify` is one of only four required status checks (verify, Executor Result
// Validation, Merge Gate, P0 Protocol). `Proof Auditor Gate` is NOT required,
// so a receipt verified only there would gate nothing at merge time. These
// assertions fail if the same-run verifier is removed from `verify`, which is
// what makes deletion of the gate a required-CI failure rather than a silent
// downgrade.
// ---------------------------------------------------------------------------

const CI_YML = readRepo('.github/workflows/ci.yml');

test('the required verify job depends on the staging DB proof producer', () => {
  assert.match(CI_YML, /^\s+verify:/mu, 'the required context job must be named verify');
  assert.match(
    CI_YML,
    /needs:\s*staging-db-proof/,
    'verify must depend on the producer, so a failed DB proof fails the required context',
  );
});

test('verify downloads and verifies the SAME-RUN receipt', () => {
  assert.match(
    CI_YML,
    /utv2-1630-db-proof-receipt-\$\{\{\s*github\.run_id\s*\}\}-\$\{\{\s*github\.run_attempt\s*\}\}/,
    'the artifact must be run+attempt scoped so a previous run cannot be substituted',
  );
  assert.match(CI_YML, /if-no-files-found:\s*error/, 'a missing receipt must fail, not skip');
  assert.match(
    CI_YML,
    /verify-db-proof-receipt\.ts/,
    'verify must run the receipt verifier — removing it is what this test catches',
  );
  assert.match(CI_YML, /--expect-job\s+staging-db-proof/);
  assert.match(CI_YML, /--expect-workflow\s+"CI"/);
});

test('only the producer job holds database credentials', () => {
  const producer = CI_YML.slice(
    CI_YML.indexOf('  staging-db-proof:'),
    CI_YML.indexOf('  verify:'),
  );
  const verifyJob = CI_YML.slice(CI_YML.indexOf('  verify:'));
  assert.match(producer, /environment:\s*staging-ci/, 'producer must bind staging-ci');
  assert.ok(
    /secrets\.CI_SUPABASE_/.test(producer),
    'producer reads the staging credentials',
  );
  assert.ok(
    !/secrets\.(CI_)?SUPABASE_/.test(verifyJob),
    'verify must hold NO database credential — it only verifies the receipt',
  );
});

test('the retired standalone producer cannot auto-run alongside ci.yml', () => {
  const standalone = readRepo('.github/workflows/staging-db-proof.yml')
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  assert.ok(
    !/^\s*pull_request:/mu.test(standalone),
    'two divergent copies of the producer must not both run on pull_request',
  );
  assert.match(standalone, /workflow_dispatch:/);
});

test('writable DB commands cannot be proven by proof-file text', async () => {
  const mod = await import('../ops/proof-auditor-gate.js');
  for (const command of ['pnpm test:db', 'pnpm test:live-db', 'pnpm test:t1-proof:live', 'pnpm ci:db-smoke']) {
    assert.equal(mod.requiresCiProducedReceipt(command), true, command);
  }
  for (const command of ['pnpm test', 'pnpm verify:static', 'pnpm test:contracts']) {
    assert.equal(mod.requiresCiProducedReceipt(command), false, command);
  }
});

// ── The fail-open entrypoint class, enforced rather than remembered ──────────

test('no writable-path script guards its CLI entrypoint by filename', () => {
  // `process.argv[1].endsWith('/name.ts')` fails OPEN: under a rename, copy,
  // symlink or compiled-.js invocation main() never runs, the process exits 0,
  // and a `&&` chain proceeds as though the step succeeded. This lane fixed the
  // pattern in four files and MISSED one (required-db-smoke.ts) — the file that
  // actually runs the smoke test and writes the receipt. A reviewer found it.
  //
  // Guarding it mechanically is the only way this stops recurring.
  const GUARDED = [
    'scripts/ci/assert-staging-target.ts',
    'scripts/ci/required-db-smoke.ts',
    'scripts/ci/seed-staging-fixtures.ts',
    'scripts/ci/staging-fixture-reap.ts',
    'scripts/ci/verify-db-proof-receipt.ts',
    'scripts/ci/assert-unmodified-vs-base.ts',
    'scripts/ops/proof-auditor-gate.ts',
  ];

  for (const relative of GUARDED) {
    const source = readRepo(relative);
    assert.ok(
      !/process\.argv\[1\][^\n]*endsWith\(/u.test(source),
      `${relative} guards its entrypoint by filename, which fails open. Compare realpathSync(process.argv[1]) with realpathSync(fileURLToPath(import.meta.url)) instead.`,
    );
    assert.match(
      source,
      /realpathSync\([^)]*\)\s*===\s*realpathSync\(/u,
      `${relative} must compare resolved real paths to decide whether it is the CLI entrypoint`,
    );
  }
});


test('manual staging proof executes the complete gate before credentials are scrubbed', () => {
  const source = readRepo('.github/workflows/staging-db-proof.yml');
  const fullGate = source.indexOf('      - name: Run complete repository verification against staging');
  const scrub = source.indexOf('      - name: Scrub credentials');
  assert.ok(fullGate > source.indexOf('      - name: Run writable DB proof against staging'));
  assert.ok(scrub > fullGate, 'the complete gate must run while the staging-only environment exists');
  const step = source.slice(fullGate, scrub);
  assert.match(step, /run: pnpm verify/);
  assert.match(step, /CI_FIXTURE_RUN_ID: full-verify-/);
  assert.match(step, /CI_REQUIRE_DB_SMOKE: 'true'/);
  assert.doesNotMatch(step, /continue-on-error|secrets\.SUPABASE_/);
});

test('operator browser writes stay in the staging-only job before credential scrub', () => {
  const source = readRepo('.github/workflows/staging-db-proof.yml');
  const proof = source.indexOf('      - name: Run staging operator browser proof');
  assert.ok(proof > source.indexOf('      - name: Run complete repository verification against staging'));
  assert.ok(proof < source.indexOf('      - name: Scrub credentials'));
  assert.match(source.slice(proof, source.indexOf('      - name: Scrub credentials')), /run: pnpm proof:command-center-staging/);
  const runner = readRepo('scripts/ops/command-center/staging-operator-proof.ts');
  assert.ok(runner.indexOf('assert.equal(isApprovedStagingTarget') < runner.indexOf('const api = createApiServer'));
  assert.match(runner, /distributionMode: 'track-only'/);
  assert.doesNotMatch(runner, /setKilled|createWorker|runGradingPass/);
});

// UTV2-1951. This suite already asserts over the *text* of the scripts and
// workflows that CI executes, which is why this guard lives here rather than
// beside the rollback behaviour tests: the defect is not what the rollback does
// on the host, it is what the local shell does while assembling the string.
//
// `deploy/rollback.sh:95` opens the remote script with an UNQUOTED heredoc
// (`REMOTE_COMMAND=$(cat <<EOF`), so the body is expanded before it is ever
// sent. An unescaped backtick or `$(` therefore runs on the operator's machine
// at the moment a rollback is being assembled, and splices its stdout into the
// script. One comment reading "failed at `docker compose up`" was enough to
// invoke docker and rewrite itself as
// "failed at The command 'docker' could not be found ...".
//
// It survived review because GitHub runners have no docker binary: the
// substitution yields empty there and every existing test stayed green. Nothing
// mechanical asked the question this test asks.
test('the rollback remote heredoc performs no command substitution while it is assembled', () => {
  const source = readRepo('deploy/rollback.sh');
  const open = source.indexOf('REMOTE_COMMAND=$(cat <<EOF\n');
  assert.ok(open >= 0, 'rollback.sh must still assemble its remote script from a heredoc');

  const bodyStart = open + 'REMOTE_COMMAND=$(cat <<EOF\n'.length;
  const bodyEnd = source.indexOf('\nEOF\n', bodyStart);
  assert.ok(bodyEnd > bodyStart, 'the remote heredoc must be terminated');
  const body = source.slice(bodyStart, bodyEnd);

  // An odd number of preceding backslashes means the character is escaped.
  const isEscaped = (index: number) => {
    let backslashes = 0;
    for (let i = index - 1; i >= 0 && body[i] === '\\'; i -= 1) backslashes += 1;
    return backslashes % 2 === 1;
  };

  const offenders: string[] = [];
  for (let i = 0; i < body.length; i += 1) {
    const isBacktick = body[i] === '`';
    const isDollarParen = body[i] === '$' && body[i + 1] === '(';
    if (!isBacktick && !isDollarParen) continue;
    if (isEscaped(i)) continue;
    const lineNumber = source.slice(0, bodyStart + i).split('\n').length;
    offenders.push(`${lineNumber}: ${body.slice(0, i).split('\n').pop()!.trim()}`);
  }

  assert.deepEqual(
    offenders,
    [],
    'Unescaped command substitution inside the unquoted remote heredoc. It executes on the ' +
      'operator machine while the rollback script is being built, and its stdout is spliced into ' +
      'the script. Escape it as \\` or \\$( — see line 129 for the correct form.\n' +
      offenders.join('\n'),
  );
});

// ---------------------------------------------------------------------------
// WORK-2026092602 — the staging best-bets board drain selects positively
// ---------------------------------------------------------------------------
//
// The drain voids leaked CI fixture picks from inside the staging job. These
// tests pin what it may select. Every fixture below is copied from the suite
// that writes it; every excluding case is a row that must survive.

const DRAIN_NOW = new Date('2026-09-26T12:00:00.000Z');
const HOURS = 60 * 60 * 1000;
const agedIso = (hoursAgo: number) => new Date(DRAIN_NOW.getTime() - hoursAgo * HOURS).toISOString();
const RUN = '0192c49e';
const UUID_A = '01208542-1c88-4b3c-a6ad-1ab409f39c65';

function boardRow(overrides: Partial<BoardDrainCandidate>): BoardDrainCandidate {
  return {
    id: randomId(),
    source: 'smart-form',
    market: 'nba-spread',
    selection: 'placeholder',
    status: 'queued',
    promotion_target: 'best-bets',
    promotion_status: 'qualified',
    created_at: agedIso(24),
    metadata: {},
    ...overrides,
  };
}
let drainIdSeq = 0;
function randomId(): string {
  drainIdSeq += 1;
  return `00000000-0000-4000-8000-${String(drainIdSeq).padStart(12, '0')}`;
}

const atomicityFixture = () =>
  boardRow({ source: 't1-proof', market: 'nba-total', selection: 'Over 220.5', metadata: {} });
const riskFixture = () =>
  boardRow({
    selection: `UTV2-1022 RISK PROOF utv2-1022-risk-${UUID_A}`,
    metadata: { proof_fixture_id: `utv2-1022-risk-${UUID_A}`, proof_issue: 'UTV2-1022', band: 'B' },
  });
const rejectFixture = () =>
  boardRow({
    selection: `UTV2-1251 REJECT PROOF ${UUID_A}`,
    metadata: { proof_run: RUN, proof_issue: 'UTV2-1251-reject' },
  });
const serverAuthorizedFixture = () =>
  boardRow({
    status: 'validated',
    selection: `utv2-1842-${RUN}-server-authorized Challenger Alpha`,
    metadata: {
      sport: 'NBA',
      distributionMode: 'delivery-eligible',
      proof_run: RUN,
      proof_issue: 'UTV2-1842',
      deliveryAuthorization: { capperId: `utv2-1938-proof-${RUN}`, decision: 'authorized' },
    },
  });

test('drain selects each leaked fixture shape by its own signature', () => {
  const rows = [atomicityFixture(), riskFixture(), rejectFixture(), serverAuthorizedFixture()];
  const { selected } = selectLeakedBoardFixtures(rows, DRAIN_NOW);
  assert.deepEqual(
    selected.map((entry) => entry.signature),
    ['t1-proof-atomicity-enqueue', 'utv2-1022-risk-proof', 'utv2-1251-reject-proof', 'utv2-1842-server-authorized'],
  );
});

test('drain never selects a real operator pick carrying distributionMode', () => {
  // The shape of a genuine delivery-eligible Smart Form submission: no proof
  // markers, a real capper id, a real selection.
  const operatorPick = boardRow({
    status: 'validated',
    selection: 'Boston Celtics -3.5',
    metadata: {
      sport: 'NBA',
      distributionMode: 'delivery-eligible',
      deliveryAuthorization: { capperId: 'griff843', decision: 'authorized' },
    },
  });
  // A forged partial marker is still not the fixture: the selection and capper id
  // must both embed the same proof run.
  const partialMarker = boardRow({
    status: 'validated',
    selection: 'Boston Celtics -3.5',
    metadata: {
      distributionMode: 'delivery-eligible',
      proof_run: RUN,
      proof_issue: 'UTV2-1842',
      deliveryAuthorization: { capperId: `utv2-1938-proof-${RUN}` },
    },
  });
  const mismatchedRun = serverAuthorizedFixture();
  (mismatchedRun.metadata as Record<string, unknown>)['deliveryAuthorization'] = { capperId: 'utv2-1938-proof-deadbeef' };

  for (const row of [operatorPick, partialMarker, mismatchedRun]) {
    assert.equal(matchFixtureSignature(row), null, `matched: ${JSON.stringify(row)}`);
  }
  const { selected, skipped } = selectLeakedBoardFixtures([operatorPick, partialMarker, mismatchedRun], DRAIN_NOW);
  assert.equal(selected.length, 0);
  assert.equal(skipped.no_fixture_signature, 3);
});

test('drain never selects a Track Only pick, even one carrying a full fixture signature', () => {
  const trackOnlyFixture = serverAuthorizedFixture();
  (trackOnlyFixture.metadata as Record<string, unknown>)['distributionMode'] = 'track-only';
  const trackOnlyAtomicityShape = atomicityFixture();
  trackOnlyAtomicityShape.metadata = { distributionMode: 'track-only' };

  const { selected, skipped } = selectLeakedBoardFixtures([trackOnlyFixture, trackOnlyAtomicityShape], DRAIN_NOW);
  assert.equal(selected.length, 0);
  assert.equal(skipped.track_only, 2);
});

test('drain never selects a row younger than the safety margin', () => {
  const justInside = atomicityFixture();
  justInside.created_at = new Date(DRAIN_NOW.getTime() - DEFAULT_DRAIN_MARGIN_MS + 1000).toISOString();
  const atBoundary = riskFixture();
  atBoundary.created_at = new Date(DRAIN_NOW.getTime() - DEFAULT_DRAIN_MARGIN_MS).toISOString();
  const fresh = rejectFixture();
  fresh.created_at = agedIso(0);
  const future = serverAuthorizedFixture();
  future.created_at = agedIso(-1);

  const { selected, skipped } = selectLeakedBoardFixtures([justInside, atBoundary, fresh, future], DRAIN_NOW);
  assert.equal(selected.length, 0);
  assert.equal(skipped.younger_than_margin, 4);

  const justOutside = atomicityFixture();
  justOutside.created_at = new Date(DRAIN_NOW.getTime() - DEFAULT_DRAIN_MARGIN_MS - 1000).toISOString();
  assert.equal(selectLeakedBoardFixtures([justOutside], DRAIN_NOW).selected.length, 1);
});

test('drain refuses a margin shorter than the default', () => {
  assert.throws(() => selectLeakedBoardFixtures([], DRAIN_NOW, DEFAULT_DRAIN_MARGIN_MS - 1), /margin/);
  assert.throws(() => selectLeakedBoardFixtures([], DRAIN_NOW, Number.NaN), /margin/);
});

test('drain never selects a row that holds no board capacity or cannot be voided', () => {
  const settled = atomicityFixture();
  settled.status = 'settled';
  const posted = atomicityFixture();
  posted.status = 'posted';
  const otherTarget = atomicityFixture();
  otherTarget.promotion_target = 'trader-insights';
  const notEligible = atomicityFixture();
  notEligible.promotion_status = 'not_eligible';
  const nullSource = atomicityFixture();
  nullSource.source = null;
  const stale = atomicityFixture();
  stale.created_at = agedIso(24 * 8);
  const unparseable = atomicityFixture();
  unparseable.created_at = 'not-a-date';

  const { selected, skipped } = selectLeakedBoardFixtures(
    [settled, posted, otherTarget, notEligible, nullSource, stale, unparseable],
    DRAIN_NOW,
  );
  assert.equal(selected.length, 0);
  assert.equal(skipped.not_drainable_status, 2);
  assert.equal(skipped.not_on_board, 3);
  assert.equal(skipped.outside_board_window, 1);
  assert.equal(skipped.unparseable_created_at, 1);
});

test('drain does not generalize a signature: near-miss fixtures are left alone', () => {
  const atomicityWithMetadata = atomicityFixture();
  atomicityWithMetadata.metadata = { proof: true };
  const atomicityOtherSelection = atomicityFixture();
  atomicityOtherSelection.selection = 'Over 221.5';
  const riskSelectionMismatch = riskFixture();
  riskSelectionMismatch.selection = 'UTV2-1022 RISK PROOF somebody-else';
  const rejectBadRun = rejectFixture();
  (rejectBadRun.metadata as Record<string, unknown>)['proof_run'] = 'not-a-run';
  const riskWithDistribution = riskFixture();
  (riskWithDistribution.metadata as Record<string, unknown>)['distributionMode'] = 'delivery-eligible';
  const smartFormNoMarkers = boardRow({ selection: 'LAL -3.5', metadata: { sport: 'NBA' } });
  const arrayMetadata = atomicityFixture();
  arrayMetadata.metadata = [];

  for (const row of [
    atomicityWithMetadata,
    atomicityOtherSelection,
    riskSelectionMismatch,
    rejectBadRun,
    riskWithDistribution,
    smartFormNoMarkers,
    arrayMetadata,
  ]) {
    assert.equal(matchFixtureSignature(row), null, `matched: ${JSON.stringify(row)}`);
  }
});

// ---------------------------------------------------------------------------
// WORK-2026103009 — the staging fixture reap deletes only aged, unsettled picks
// ---------------------------------------------------------------------------

const REAP_NOW = new Date('2026-10-30T12:00:00.000Z');
const REAP_CUTOFF = new Date(REAP_NOW.getTime() - MIN_REAP_AGE_MS);

function reapRow(id: string, createdAt: string | null): ReapCandidate {
  return { id, created_at: createdAt, status: 'validated', source: 'smart-form' };
}

test('reap refuses a cutoff younger than the minimum age', () => {
  assert.doesNotThrow(() => assertReapCutoff(REAP_CUTOFF, REAP_NOW));
  assert.throws(() => assertReapCutoff(new Date(REAP_CUTOFF.getTime() + 1), REAP_NOW), /younger than/);
  assert.throws(() => assertReapCutoff(new Date('not a date'), REAP_NOW), /not a valid date/);
});

test('reap selects only rows strictly older than the cutoff', () => {
  const { selected, skipped } = selectReapablePicks(
    [
      reapRow('old', new Date(REAP_CUTOFF.getTime() - 1).toISOString()),
      reapRow('at-cutoff', REAP_CUTOFF.toISOString()),
      reapRow('young', REAP_NOW.toISOString()),
    ],
    REAP_CUTOFF,
    new Set(),
    new Set(),
  );
  assert.deepEqual(selected.map((r) => r.id), ['old']);
  assert.equal(skipped.not_older_than_cutoff, 2);
});

test('reap never selects a settled or reviewed pick, however old', () => {
  const old = '2026-08-01T00:00:00.000Z';
  const { selected, skipped } = selectReapablePicks(
    [reapRow('settled', old), reapRow('reviewed', old), reapRow('plain', old)],
    REAP_CUTOFF,
    new Set(['settled']),
    new Set(['reviewed']),
  );
  assert.deepEqual(selected.map((r) => r.id), ['plain']);
  assert.equal(skipped.settled, 1);
  assert.equal(skipped.reviewed, 1);
});

test('reap skips a row whose created_at cannot be parsed', () => {
  const { selected, skipped } = selectReapablePicks(
    [reapRow('null', null), reapRow('garbage', 'yesterday-ish')],
    REAP_CUTOFF,
    new Set(),
    new Set(),
  );
  assert.equal(selected.length, 0);
  assert.equal(skipped.unparseable_created_at, 2);
});

test('reap refuses an execute larger than the reviewed cap', () => {
  assert.doesNotThrow(() => assertWithinCap(100, 100));
  assert.throws(() => assertWithinCap(101, 100), /Nothing was deleted/);
  assert.throws(() => assertWithinCap(0, -1), /non-negative integer/);
  assert.throws(() => assertWithinCap(0, Number.NaN), /non-negative integer/);
});

test('reap execute requires an explicit cutoff and cap', () => {
  const cutoff = REAP_CUTOFF.toISOString();
  assert.throws(() => parseReapArgs(['--execute'], REAP_NOW), /requires both/);
  assert.throws(() => parseReapArgs(['--execute', '--cutoff', cutoff], REAP_NOW), /requires both/);
  assert.throws(() => parseReapArgs(['--execute', '--max-picks', '10'], REAP_NOW), /requires both/);
  const ok = parseReapArgs(['--execute', '--cutoff', cutoff, '--max-picks', '10'], REAP_NOW);
  assert.equal(ok.execute, true);
  assert.equal(ok.maxPicks, 10);
});

test('reap defaults to a dry run at the minimum age and rejects unknown flags', () => {
  const args = parseReapArgs([], REAP_NOW);
  assert.equal(args.execute, false);
  assert.equal(args.cutoff.getTime(), REAP_CUTOFF.getTime());
  assert.throws(() => parseReapArgs(['--cutoff', new Date(REAP_NOW.getTime() - 1000).toISOString()], REAP_NOW), /younger than/);
  assert.throws(() => parseReapArgs(['--force'], REAP_NOW), /unknown argument/);
});

test('reap batches ids within the request bound', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 2), []);
});

// The PM review of #1813: a read that PostgREST truncates at its 1,000-row cap
// must never make a retained pick invisible. These run the whole reap against
// an in-memory store that enforces that cap and the picks.submission_id
// ON DELETE SET NULL rule.

const REAP_OLD = new Date(REAP_CUTOFF.getTime() - 24 * 60 * 60 * 1000).toISOString();
const POSTGREST_MAX_ROWS = 1000;

type FakeRow = Record<string, string | null>;

interface FakeStoreOptions {
  /** Return only the first page of any read, as a single unpaged request would. */
  truncate?: boolean;
  /** Report a count that grows by one on every call, as if rows were being inserted. */
  drift?: boolean;
  nullCount?: boolean;
  /** Page with id >= after, so the boundary row repeats. */
  repeatBoundary?: boolean;
  onCount?: (spec: ReadSpec, call: number) => void;
}

function fakeReapStore(tables: Record<ReadSpec['table'], FakeRow[]>, options: FakeStoreOptions = {}) {
  let countCalls = 0;
  const matches = (spec: ReadSpec) =>
    tables[spec.table].filter(
      (row) =>
        (spec.createdBefore === undefined || (row['created_at'] ?? '') < spec.createdBefore) &&
        (spec.inFilter === undefined || spec.inFilter.values.includes(row[spec.inFilter.column] ?? '')),
    );
  const store: ReapStore = {
    async count(spec) {
      countCalls += 1;
      const n = matches(spec).length;
      options.onCount?.(spec, countCalls);
      if (options.nullCount) return null;
      return options.drift ? n + countCalls : n;
    },
    async page(spec, afterId, limit) {
      if (options.truncate && afterId !== null) return [];
      return matches(spec)
        .sort((a, b) => String(a['id']).localeCompare(String(b['id'])))
        .filter((row) => afterId === null || (options.repeatBoundary ? String(row['id']) >= afterId : String(row['id']) > afterId))
        .slice(0, Math.min(limit, POSTGREST_MAX_ROWS))
        .map((row) => ({ ...row }));
    },
    async deletePicks(ids, cutoffIso) {
      const doomed = new Set(tables.picks.filter((row) => ids.includes(String(row['id'])) && (row['created_at'] ?? '') < cutoffIso).map((row) => row['id']));
      tables.picks = tables.picks.filter((row) => !doomed.has(row['id']));
      return doomed.size;
    },
    async deleteSubmissions(ids, cutoffIso) {
      const doomed = new Set(tables.submissions.filter((row) => ids.includes(String(row['id'])) && (row['created_at'] ?? '') < cutoffIso).map((row) => row['id']));
      tables.submissions = tables.submissions.filter((row) => !doomed.has(row['id']));
      for (const pick of tables.picks) if (doomed.has(pick['submission_id'] ?? null)) pick['submission_id'] = null;
      return doomed.size;
    },
  };
  return store;
}

const pad = (prefix: string, n: number) => `${prefix}${String(n).padStart(4, '0')}`;
const fakePick = (id: string, submissionId: string | null): FakeRow => ({
  id,
  created_at: REAP_OLD,
  status: 'validated',
  source: 'smart-form',
  submission_id: submissionId,
});

/**
 * One submission with 1,100 aged picks. The last 100 by id are settled, so they
 * are retained, and they sort after the first 1,000 linking rows: an unpaged read
 * of picks by submission returns only the 1,000 reapable ones and calls s1 orphaned.
 * A second submission's picks are all reapable, so it is orphaned in truth.
 */
function overCapTables(): Record<ReadSpec['table'], FakeRow[]> {
  const picks = Array.from({ length: 1100 }, (_, i) => fakePick(pad('p', i), 's1'));
  picks.push(...Array.from({ length: 5 }, (_, i) => fakePick(pad('t', i), 's2')));
  return {
    picks,
    submissions: [
      { id: 's1', created_at: REAP_OLD },
      { id: 's2', created_at: REAP_OLD },
    ],
    settlement_records: Array.from({ length: 100 }, (_, i) => ({ id: pad('sr', i), pick_id: pad('p', 1000 + i) })),
    pick_reviews: [],
  };
}

test('reap keeps a submission whose retained picks sit past the 1,000-row cap, and never nulls their link', async () => {
  const tables = overCapTables();
  const store = fakeReapStore(tables);
  const dry = await reapStagingFixtures(store, { cutoff: REAP_CUTOFF, now: REAP_NOW, execute: false, projectRef: 'test' });
  assert.equal(dry.selected, 1005);
  assert.equal(dry.orphaned_submissions, 1, 'only s2 is orphaned');

  const report = await reapStagingFixtures(store, {
    cutoff: REAP_CUTOFF,
    now: REAP_NOW,
    execute: true,
    maxPicks: dry.selected,
    projectRef: 'test',
  });
  assert.equal(report.deleted_picks, 1005);
  assert.equal(report.deleted_submissions, 1);
  assert.deepEqual(tables.submissions.map((row) => row['id']), ['s1']);
  assert.equal(tables.picks.length, 100);
  assert.ok(
    tables.picks.every((row) => row['submission_id'] === 's1'),
    'every retained pick still references its submission',
  );
});

test('reap never selects a settled pick whose settlement row sits past the 1,000-row cap', async () => {
  // One batch of 150 picks; q0000 carries 1,100 settlement rows that sort first,
  // so an unpaged read would drop q0149's single row and call it unsettled.
  const picks = Array.from({ length: 150 }, (_, i) => fakePick(pad('q', i), null));
  const settlement = Array.from({ length: 1100 }, (_, i) => ({ id: pad('ra', i), pick_id: 'q0000' }));
  settlement.push({ id: 'rz0000', pick_id: 'q0149' });
  const store = fakeReapStore({ picks, submissions: [], settlement_records: settlement, pick_reviews: [] });
  const report = await reapStagingFixtures(store, { cutoff: REAP_CUTOFF, now: REAP_NOW, execute: false, projectRef: 'test' });
  assert.equal(report.selected, 148);
  assert.equal(report.skipped.settled, 2);
});

test('reap fails closed on an incomplete, changed, uncounted or repeating read', async () => {
  const spec: ReadSpec = { table: 'picks', columns: 'id', inFilter: { column: 'submission_id', values: ['s1'] } };
  await assert.rejects(readAllVerified(fakeReapStore(overCapTables(), { truncate: true }), spec), /incomplete: read 1000 of 1100/);
  await assert.rejects(readAllVerified(fakeReapStore(overCapTables(), { drift: true }), spec), /changed during the read/);
  await assert.rejects(readAllVerified(fakeReapStore(overCapTables(), { nullCount: true }), spec), /no exact count/);
  await assert.rejects(readAllVerified(fakeReapStore(overCapTables(), { repeatBoundary: true }), spec), /returned id p0999 twice/);
  assert.equal((await readAllVerified(fakeReapStore(overCapTables()), spec)).length, 1100);
  // A failed read aborts the whole run before anything is deleted.
  const tables = overCapTables();
  await assert.rejects(
    reapStagingFixtures(fakeReapStore(tables, { truncate: true }), {
      cutoff: REAP_CUTOFF,
      now: REAP_NOW,
      execute: true,
      maxPicks: 1005,
      projectRef: 'test',
    }),
    /incomplete/,
  );
  assert.equal(tables.picks.length, 1105);
  assert.equal(tables.submissions.length, 2);
});

test('reap re-reads each submission batch before deleting it and keeps one that gained a pick', async () => {
  const tables = overCapTables();
  let classificationCounts = 0;
  const store = fakeReapStore(tables, {
    // The classification read of s1/s2 counts before and after it reads. Right
    // after its second count has been taken, a new pick links to s2.
    onCount(spec) {
      if (spec.inFilter?.column !== 'submission_id' || tables.picks.length !== 100) return;
      classificationCounts += 1;
      if (classificationCounts === 2) tables.picks.push(fakePick('z0000', 's2'));
    },
  });
  const report = await reapStagingFixtures(store, {
    cutoff: REAP_CUTOFF,
    now: REAP_NOW,
    execute: true,
    maxPicks: 1005,
    projectRef: 'test',
  });
  assert.equal(report.orphaned_submissions, 1);
  assert.equal(report.raced_submissions, 1);
  assert.equal(report.deleted_submissions, 0);
  assert.deepEqual(tables.submissions.map((row) => row['id']).sort(), ['s1', 's2']);
  assert.ok(tables.picks.find((row) => row['id'] === 'z0000')?.['submission_id'] === 's2');
});

test('classifyOrphanedSubmissions orphans only submissions with no kept pick', () => {
  const links = [
    { id: 'a', submission_id: 's1' },
    { id: 'b', submission_id: 's1' },
    { id: 'c', submission_id: 's2' },
  ];
  assert.deepEqual(classifyOrphanedSubmissions(['s1', 's2', 's3'], links, new Set(['a', 'c'])), ['s2', 's3']);
  assert.deepEqual(classifyOrphanedSubmissions(['s1'], links, new Set(['a', 'b'])), ['s1']);
});
