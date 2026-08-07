import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildCiProofReceipt,
  type CiContext,
  EXPECTED_STAGING_SUPABASE_PROJECT_REF,
} from './isolated-proof-attestation.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AUDITOR = path.join(HERE, 'verify-db-proof-receipt.ts');
const REPO_ROOT = path.resolve(HERE, '../..');
const TAP = '# tests 7\n# pass 7\n# fail 0\n# skipped 0';

const CI: CiContext = {
  repository: 'griff843/Unit-Talk-v2',
  workflow: 'Staging DB Proof',
  workflowRef: 'griff843/Unit-Talk-v2/.github/workflows/staging-db-proof.yml@refs/pull/1/merge',
  runId: '30500000042',
  runAttempt: '1',
  job: 'staging-db-proof',
  sha: 'd'.repeat(40),
  refName: '1/merge',
};

/** Run the auditor CLI exactly as CI does, returning {status, json}. */
function runAuditor(args: string[], env: Record<string, string> = {}) {
  const merged = {
    ...process.env,
    GITHUB_REPOSITORY: CI.repository ?? '',
    GITHUB_WORKFLOW: CI.workflow ?? '',
    GITHUB_RUN_ID: CI.runId ?? '',
    GITHUB_RUN_ATTEMPT: CI.runAttempt ?? '',
    GITHUB_JOB: CI.job ?? '',
    GITHUB_SHA: CI.sha ?? '',
    GITHUB_STEP_SUMMARY: '',
    ...env,
  };
  try {
    const out = execFileSync(
      process.execPath,
      ['--import', 'tsx', AUDITOR, ...args, '--json'],
      { cwd: REPO_ROOT, encoding: 'utf8', env: merged },
    );
    return { status: 0, json: JSON.parse(out.trim().split('\n').pop() as string) };
  } catch (error) {
    const err = error as { status?: number; stdout?: string };
    const line = (err.stdout ?? '').trim().split('\n').pop();
    return {
      status: err.status ?? 1,
      json: line && line.startsWith('{') ? JSON.parse(line) : { verdict: 'FAIL', reason: err.stdout ?? '' },
    };
  }
}

function writeReceipt(dir: string, overrides: Record<string, unknown> = {}): string {
  const built = buildCiProofReceipt({
    supabaseUrl: `https://${EXPECTED_STAGING_SUPABASE_PROJECT_REF}.supabase.co`,
    command: 'pnpm test:db',
    startedAt: '2026-07-30T14:00:00.000Z',
    finishedAt: '2026-07-30T14:00:20.000Z',
    exitCode: 0,
    capturedOutput: TAP,
    ci: CI,
  });
  const file = path.join(dir, 'ci-db-proof-receipt.json');
  writeFileSync(file, JSON.stringify({ ...built, ...overrides }, null, 2), 'utf8');
  return file;
}

test('a genuine same-run receipt PASSES the auditor CLI', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'utv2-1630-ok-'));
  try {
    const file = writeReceipt(dir);
    const result = runAuditor(['--receipt', file, '--command', 'pnpm test:db']);
    assert.equal(result.json.verdict, 'PASS', result.json.reason);
    assert.equal(result.status, 0);
    assert.equal(result.json.observedProjectRef, EXPECTED_STAGING_SUPABASE_PROJECT_REF);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a MISSING artifact fails closed — deleting the upload cannot make the gate green', () => {
  const result = runAuditor([
    '--receipt', path.join(os.tmpdir(), 'utv2-1630-does-not-exist', 'ci-db-proof-receipt.json'),
    '--command', 'pnpm test:db',
  ]);
  assert.equal(result.json.verdict, 'FAIL');
  assert.equal(result.status, 1);
  assert.match(result.json.reason, /not found|fails closed/);
});

test('no --receipt argument fails closed', () => {
  const result = runAuditor(['--command', 'pnpm test:db']);
  assert.equal(result.json.verdict, 'FAIL');
  assert.equal(result.status, 1);
});

test('a previous-run receipt is rejected by the CLI', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'utv2-1630-stale-'));
  try {
    const file = writeReceipt(dir);
    // Simulate the auditor running in a LATER run than the receipt.
    const result = runAuditor(['--receipt', file, '--command', 'pnpm test:db'], {
      GITHUB_RUN_ID: '30500000099',
    });
    assert.equal(result.json.verdict, 'FAIL');
    assert.equal(result.status, 1);
    assert.match(result.json.reason, /github_run_id/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a receipt from a different commit SHA is rejected', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'utv2-1630-sha-'));
  try {
    const file = writeReceipt(dir);
    const result = runAuditor(['--receipt', file, '--command', 'pnpm test:db'], {
      GITHUB_SHA: 'e'.repeat(40),
    });
    assert.equal(result.json.verdict, 'FAIL');
    assert.match(result.json.reason, /github_sha/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--expect-job pins job identity', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'utv2-1630-job-'));
  try {
    const file = writeReceipt(dir);
    const result = runAuditor([
      '--receipt', file, '--command', 'pnpm test:db', '--expect-job', 'some-other-job',
    ]);
    assert.equal(result.json.verdict, 'FAIL');
    assert.match(result.json.reason, /github_job/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a hand-edited receipt is rejected by its own hash', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'utv2-1630-edit-'));
  try {
    const file = writeReceipt(dir);
    const receipt = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    receipt['observed_project_ref'] = EXPECTED_STAGING_SUPABASE_PROJECT_REF;
    receipt['exit_code'] = 0;
    receipt['tap'] = { tests: 999, pass: 999, fail: 0, skipped: 0 };
    writeFileSync(file, JSON.stringify(receipt, null, 2), 'utf8');
    const result = runAuditor(['--receipt', file, '--command', 'pnpm test:db']);
    assert.equal(result.json.verdict, 'FAIL');
    assert.match(result.json.reason, /receipt_sha256 does not match/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the receipt carries no credential material', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'utv2-1630-secret-'));
  try {
    const raw = readFileSync(writeReceipt(dir), 'utf8');
    // JWTs start eyJ; Supabase modern keys are sb_secret_/sb_publishable_.
    assert.doesNotMatch(raw, /eyJ[A-Za-z0-9_-]{10,}/, 'receipt must not embed a JWT');
    assert.doesNotMatch(raw, /sb_secret_/, 'receipt must not embed a secret key');
    assert.doesNotMatch(raw, /sb_publishable_/, 'receipt must not embed a publishable key');
    assert.doesNotMatch(raw, /SERVICE_ROLE/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
