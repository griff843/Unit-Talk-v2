import test from 'node:test';
import assert from 'node:assert/strict';
import { P0_PROJECT_ID, P0_PROJECT_NAME } from './p0-detect.js';

test('P0_PROJECT_ID is the Runtime Hardening P0 project UUID', () => {
  assert.strictEqual(P0_PROJECT_ID, '46229dc4-c7c1-4ccb-af0d-dedaf8147a97');
});

test('P0_PROJECT_NAME matches the Linear project name verbatim', () => {
  assert.strictEqual(P0_PROJECT_NAME, 'Runtime Hardening P0 - Runtime Trustworthiness');
});

// Synthetic counter-tests that mirror the workflow guards in
// .github/workflows/p0-protocol.yml. These do not require Linear access —
// they verify the regex / grep predicates the workflow uses, so a regression
// in the predicate is caught locally before CI sees it.

const RUNTIME_VERIFY_FAIL_PATTERN = /^\s*-\s*\[[ xX]\]\s+.*:\s*(FAIL|SKIP|SKIPPED)\s*$/m;
const RUNTIME_VERIFY_RESULT_PATTERN = /^result:\s*(pass|fail)\s*$/im;
const AUTOMERGE_LABEL_PATTERN = /^(automerge|auto-merge|auto_merge)$/i;
const PM_VERDICT_HEAD_PATTERN = /^PM_VERDICT:\s+(APPROVED|CHANGES_REQUIRED)$/i;

test('runtime-verification FAIL detector matches "- [x] item: FAIL"', () => {
  const body = [
    '- [x] type-check exits 0: PASS',
    '- [x] db connectivity: FAIL',
    'result: pass',
  ].join('\n');
  assert.ok(RUNTIME_VERIFY_FAIL_PATTERN.test(body));
});

test('runtime-verification FAIL detector matches "- [ ] item: SKIPPED"', () => {
  const body = [
    '- [ ] auth flow: SKIPPED',
    'result: pass',
  ].join('\n');
  assert.ok(RUNTIME_VERIFY_FAIL_PATTERN.test(body));
});

test('runtime-verification FAIL detector does not match all-PASS body', () => {
  const body = [
    '- [x] type-check: PASS',
    '- [x] db connectivity: PASS',
    'result: pass',
  ].join('\n');
  assert.ok(!RUNTIME_VERIFY_FAIL_PATTERN.test(body));
});

test('runtime-verification FAIL detector does NOT match narrative mention of `: FAIL`', () => {
  const body = [
    '- [x] type-check: PASS',
    '- [ ] synthetic PR with `: FAIL` in runtime-verification.md is rejected — deferred',
    'result: pass',
  ].join('\n');
  assert.ok(!RUNTIME_VERIFY_FAIL_PATTERN.test(body));
});

test('runtime-verification result: pass line is required', () => {
  const withResult = '- [x] item: PASS\n\nresult: pass\n';
  const withoutResult = '- [x] item: PASS\n';
  assert.ok(RUNTIME_VERIFY_RESULT_PATTERN.test(withResult));
  assert.ok(!RUNTIME_VERIFY_RESULT_PATTERN.test(withoutResult));
});

test('runtime-verification result: fail line is detected (and treated as not pass)', () => {
  const failBody = '- [x] item: PASS\n\nresult: fail\n';
  const match = failBody.match(RUNTIME_VERIFY_RESULT_PATTERN);
  assert.ok(match);
  assert.strictEqual(match![1].toLowerCase(), 'fail');
});

test('automerge label detector matches automerge / auto-merge / auto_merge case-insensitive', () => {
  assert.ok(AUTOMERGE_LABEL_PATTERN.test('automerge'));
  assert.ok(AUTOMERGE_LABEL_PATTERN.test('AUTO-MERGE'));
  assert.ok(AUTOMERGE_LABEL_PATTERN.test('Auto_Merge'));
});

test('automerge label detector does not match unrelated labels', () => {
  assert.ok(!AUTOMERGE_LABEL_PATTERN.test('tier:T1'));
  assert.ok(!AUTOMERGE_LABEL_PATTERN.test('p0:requires-protocol'));
  assert.ok(!AUTOMERGE_LABEL_PATTERN.test('approved'));
});

test('PM verdict head pattern matches valid APPROVED / CHANGES_REQUIRED', () => {
  assert.ok(PM_VERDICT_HEAD_PATTERN.test('PM_VERDICT: APPROVED'));
  assert.ok(PM_VERDICT_HEAD_PATTERN.test('PM_VERDICT: CHANGES_REQUIRED'));
});

test('PM verdict head pattern rejects bot impersonation strings', () => {
  assert.ok(!PM_VERDICT_HEAD_PATTERN.test('PM_VERDICT:LGTM'));
  assert.ok(!PM_VERDICT_HEAD_PATTERN.test('approved'));
});

// Full pm-verdict/v1 body parser invariant: must have head + schema + Issue
function parseVerdictBody(body: string): { verdict: string; issueId: string } | null {
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return null;
  const head = lines[0].match(PM_VERDICT_HEAD_PATTERN);
  if (!head) return null;
  if (lines[1] !== 'schema: pm-verdict/v1') return null;
  const issueMatch = lines[2].match(/^Issue:\s+((?:UTV2|UNI)-\d+)$/i);
  if (!issueMatch) return null;
  return { verdict: head[1].toUpperCase(), issueId: issueMatch[1].toUpperCase() };
}

test('pm-verdict/v1 body parser accepts a well-formed APPROVED verdict', () => {
  const body = ['PM_VERDICT: APPROVED', 'schema: pm-verdict/v1', 'Issue: UTV2-948'].join('\n');
  const parsed = parseVerdictBody(body);
  assert.deepStrictEqual(parsed, { verdict: 'APPROVED', issueId: 'UTV2-948' });
});

test('pm-verdict/v1 body parser rejects missing schema line', () => {
  const body = ['PM_VERDICT: APPROVED', 'Issue: UTV2-948'].join('\n');
  assert.strictEqual(parseVerdictBody(body), null);
});

test('pm-verdict/v1 body parser rejects wrong schema version', () => {
  const body = [
    'PM_VERDICT: APPROVED',
    'schema: pm-verdict/v2',
    'Issue: UTV2-948',
  ].join('\n');
  assert.strictEqual(parseVerdictBody(body), null);
});

test('pm-verdict/v1 body parser rejects missing Issue line', () => {
  const body = ['PM_VERDICT: APPROVED', 'schema: pm-verdict/v1'].join('\n');
  assert.strictEqual(parseVerdictBody(body), null);
});
