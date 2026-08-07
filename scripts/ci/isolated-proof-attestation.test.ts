import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCiProofReceipt,
  CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
  type CiContext,
  EXPECTED_STAGING_SUPABASE_PROJECT_REF,
  extractProjectRefFromUrl,
  isApprovedStagingTarget,
  parseTapCounts,
  RECEIPT_SCHEMA,
  sha256,
  verifyCiProofReceipt,
} from './isolated-proof-attestation.js';

const STAGING = EXPECTED_STAGING_SUPABASE_PROJECT_REF;
const PRODUCTION = CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF;
const STAGING_URL = `https://${STAGING}.supabase.co`;
const PRODUCTION_URL = `https://${PRODUCTION}.supabase.co`;
const TAP = '# tests 7\n# pass 7\n# fail 0\n# skipped 0';

const CI: CiContext = {
  repository: 'griff843/Unit-Talk-v2',
  workflow: 'Staging DB Proof',
  workflowRef: 'griff843/Unit-Talk-v2/.github/workflows/staging-db-proof.yml@refs/pull/1/merge',
  runId: '30500000001',
  runAttempt: '1',
  job: 'staging-db-proof',
  sha: 'a'.repeat(40),
  refName: '1/merge',
};

function receiptJson(overrides: Record<string, unknown> = {}, ci: CiContext = CI): string {
  const built = buildCiProofReceipt({
    supabaseUrl: STAGING_URL,
    command: 'pnpm test:db',
    startedAt: '2026-07-30T14:00:00.000Z',
    finishedAt: '2026-07-30T14:00:20.000Z',
    exitCode: 0,
    capturedOutput: TAP,
    repoMigrationHead: '20260714130000_bootstrap_delivery_kill_switch_posture.sql',
    fixtureRunId: 'utv2-1630-30500000001-1',
    cleanupResult: 'ok',
    ci,
  });
  if (Object.keys(overrides).length === 0) return JSON.stringify(built);
  // Re-hash so the tamper under test is the ONLY thing that fails — otherwise
  // every mutation would trip the integrity check and prove nothing specific.
  const tampered: Record<string, unknown> = { ...built, ...overrides };
  delete tampered['receipt_sha256'];
  tampered['receipt_sha256'] = sha256(JSON.stringify(tampered));
  return JSON.stringify(tampered);
}

// ---------------------------------------------------------------------------
// Target identity
// ---------------------------------------------------------------------------

test('staging project is accepted', () => {
  assert.equal(isApprovedStagingTarget(STAGING_URL), true);
  assert.equal(extractProjectRefFromUrl(STAGING_URL).projectRef, STAGING);
});

test('production project is rejected', () => {
  assert.equal(isApprovedStagingTarget(PRODUCTION_URL), false);
});

test('an unknown but well-formed project is rejected', () => {
  assert.equal(isApprovedStagingTarget('https://abcdefghijklmnopqrst.supabase.co'), false);
});

for (const [label, url] of [
  ['custom domain', 'https://db.unit-talk.com'],
  ['pooler host', 'https://aws-0-us-east-1.pooler.supabase.com:6543'],
  ['loopback tunnel', 'http://127.0.0.1:54321'],
  ['db.<ref> subdomain form', `https://db.${STAGING}.supabase.co`],
  ['supabase.co as attacker subdomain', `https://${STAGING}.supabase.co.evil.com`],
  ['20-char run on foreign host', 'https://abcdefghijklmnopqrst.evil.example'],
  ['missing', undefined],
  ['empty', ''],
  ['unresolvable', 'not-a-url'],
] as const) {
  test(`rejected target: ${label}`, () => {
    assert.equal(isApprovedStagingTarget(url as string | undefined), false);
  });
}

test('percent-encoded production host is decoded and rejected', () => {
  // %6d is "m" — a live production URL.
  const disguised = 'https://zfzdnfwdarxucxtaojx%6d.supabase.co';
  assert.equal(extractProjectRefFromUrl(disguised).projectRef, PRODUCTION);
  assert.equal(isApprovedStagingTarget(disguised), false);
});

test('uppercase percent-encoding is also decoded', () => {
  assert.equal(
    extractProjectRefFromUrl('https://zfzdnfwdarxucxtaojx%4D.supabase.co').projectRef,
    PRODUCTION,
  );
});

test('trailing-dot FQDN cannot evade the suffix test', () => {
  assert.equal(extractProjectRefFromUrl(`https://${PRODUCTION}.supabase.co.`).projectRef, PRODUCTION);
  assert.equal(isApprovedStagingTarget(`https://${STAGING}.supabase.co.`), true);
});

test('userinfo in the URL does not change the resolved host', () => {
  assert.equal(
    extractProjectRefFromUrl(`https://${STAGING}.supabase.co@${PRODUCTION}.supabase.co`).projectRef,
    PRODUCTION,
  );
});

// ---------------------------------------------------------------------------
// Receipt verification — the CI binding
// ---------------------------------------------------------------------------

test('a genuine same-run staging receipt verifies', () => {
  const verdict = verifyCiProofReceipt(receiptJson(), 'pnpm test:db', { ci: CI });
  assert.equal(verdict.ok, true, verdict.reason);
});

test('verification fails closed outside CI (no run to bind to)', () => {
  const verdict = verifyCiProofReceipt(receiptJson(), 'pnpm test:db', {
    ci: { ...CI, runId: null, sha: null },
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /outside GitHub Actions/);
});

test('a hand-authored receipt is rejected (wrong run identity)', () => {
  const forged = JSON.stringify({
    schema: RECEIPT_SCHEMA,
    command: 'pnpm test:db',
    observed_project_ref: STAGING,
    exit_code: 0,
    captured_output: TAP,
    tap: { tests: 7, pass: 7, fail: 0, skipped: 0 },
    github_run_id: '1',
    github_sha: 'b'.repeat(40),
    receipt_sha256: 'deadbeef',
  });
  const verdict = verifyCiProofReceipt(forged, 'pnpm test:db', { ci: CI });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /receipt_sha256 does not match/);
});

test('a forged canonicalProduction-style claim cannot launder a production run', () => {
  const verdict = verifyCiProofReceipt(
    receiptJson({ observed_project_ref: PRODUCTION, observed_host: `${PRODUCTION}.supabase.co` }),
    'pnpm test:db',
    { ci: CI },
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /canonical production/);
});

test('stale SHA is rejected', () => {
  const verdict = verifyCiProofReceipt(receiptJson({ github_sha: 'c'.repeat(40) }), 'pnpm test:db', { ci: CI });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /github_sha/);
});

test('wrong run id is rejected (previous-run artifact reuse)', () => {
  const verdict = verifyCiProofReceipt(receiptJson({ github_run_id: '30499999999' }), 'pnpm test:db', { ci: CI });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /github_run_id/);
});

test('wrong run attempt is rejected', () => {
  const verdict = verifyCiProofReceipt(receiptJson({ github_run_attempt: '2' }), 'pnpm test:db', { ci: CI });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /github_run_attempt/);
});

test('wrong job is rejected when the caller pins it', () => {
  const verdict = verifyCiProofReceipt(receiptJson({ github_job: 'some-other-job' }), 'pnpm test:db', {
    ci: CI,
    expectedJob: 'staging-db-proof',
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /github_job/);
});

test('wrong workflow is rejected when the caller pins it', () => {
  const verdict = verifyCiProofReceipt(receiptJson({ workflow: 'Some Other Workflow' }), 'pnpm test:db', {
    ci: CI,
    expectedWorkflow: 'Staging DB Proof',
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /workflow/);
});

test('wrong repository is rejected', () => {
  const verdict = verifyCiProofReceipt(receiptJson({ repository: 'someone/else' }), 'pnpm test:db', { ci: CI });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /repository/);
});

// ---------------------------------------------------------------------------
// Output integrity — declared counters are never trusted
// ---------------------------------------------------------------------------

test('edited TAP counters are rejected (counts re-parsed from output)', () => {
  const verdict = verifyCiProofReceipt(
    receiptJson({ tap: { tests: 99, pass: 99, fail: 0, skipped: 0 } }),
    'pnpm test:db',
    { ci: CI },
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /declared TAP counts do not match/);
});

test('edited captured output is rejected by its hash', () => {
  const verdict = verifyCiProofReceipt(
    receiptJson({ captured_output: '# tests 1\n# pass 1\n# fail 0\n# skipped 0' }),
    'pnpm test:db',
    { ci: CI },
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /output_sha256 does not match/);
});

test('missing captured output is rejected', () => {
  const verdict = verifyCiProofReceipt(receiptJson({ captured_output: '' }), 'pnpm test:db', { ci: CI });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /no captured_output/);
});

test('nonzero exit code is rejected', () => {
  const verdict = verifyCiProofReceipt(receiptJson({ exit_code: 1 }), 'pnpm test:db', { ci: CI });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /exited 1/);
});

test('failing TAP is rejected even with exit code 0', () => {
  const failing = '# tests 7\n# pass 5\n# fail 2\n# skipped 0';
  const built = buildCiProofReceipt({
    supabaseUrl: STAGING_URL,
    command: 'pnpm test:db',
    startedAt: '2026-07-30T14:00:00.000Z',
    finishedAt: '2026-07-30T14:00:20.000Z',
    exitCode: 0,
    capturedOutput: failing,
    ci: CI,
  });
  const verdict = verifyCiProofReceipt(JSON.stringify(built), 'pnpm test:db', { ci: CI });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /2 failing tests/);
});

test('a receipt for a different command does not satisfy this one', () => {
  const verdict = verifyCiProofReceipt(receiptJson(), 'pnpm test:live-db', { ci: CI });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /is for "pnpm test:db"/);
});

test('non-JSON and wrong-schema receipts are rejected', () => {
  assert.equal(verifyCiProofReceipt('not json', 'pnpm test:db', { ci: CI }).ok, false);
  assert.equal(
    verifyCiProofReceipt(JSON.stringify({ schema: 'other/v1' }), 'pnpm test:db', { ci: CI }).ok,
    false,
  );
});

test('parseTapCounts reads counters it is given', () => {
  assert.deepEqual(parseTapCounts(TAP), { tests: 7, pass: 7, fail: 0, skipped: 0 });
  assert.deepEqual(parseTapCounts('nothing here'), {
    tests: null, pass: null, fail: null, skipped: null,
  });
});

test('a receipt built against production records it truthfully and is rejected', () => {
  const built = buildCiProofReceipt({
    supabaseUrl: PRODUCTION_URL,
    command: 'pnpm test:db',
    startedAt: '2026-07-30T14:00:00.000Z',
    finishedAt: '2026-07-30T14:00:20.000Z',
    exitCode: 0,
    capturedOutput: TAP,
    ci: CI,
  });
  assert.equal(built.observed_project_ref, PRODUCTION);
  const verdict = verifyCiProofReceipt(JSON.stringify(built), 'pnpm test:db', { ci: CI });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /canonical production/);
});

// P2 from review: a first-match, loosely-anchored parse let an earlier block
// shadow the real TAP summary and let indented prose parse as counters.
test('TAP parsing takes the last summary and ignores indented prose', () => {
  const shadowed = [
    '# pass 99',
    '# fail 0',
    '# skipped 0',
    'some later real run:',
    '# tests 3',
    '# pass 1',
    '# fail 3',
    '# skipped 0',
  ].join('\n');
  assert.deepEqual(parseTapCounts(shadowed), { tests: 3, pass: 1, fail: 3, skipped: 0 });

  assert.deepEqual(parseTapCounts('   #   pass   5'), {
    tests: null, pass: null, fail: null, skipped: null,
  });
});
