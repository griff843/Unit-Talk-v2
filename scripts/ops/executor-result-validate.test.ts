import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseExecutorResultComment,
  selectLatestExecutorResult,
  validateExecutorResultFields,
  resolveCheckName,
  isRequiredCheckName,
  proofArtifactRequired,
  REQUIRED_CHECK_NAME,
  PREFLIGHT_CHECK_NAME,
} from './executor-result-validate.ts';

const VALID_COMMENT = `EXECUTOR_RESULT: READY_FOR_REVIEW
schema: executor-result/v1
Issue: UTV2-1549
Lane: codex
Branch: codex/utv2-1549-pilot-r1-runtime-truth-refresh
PR: #1235
Head SHA: 4a279235b08cdd2bd07facce3b59bd65587867ee
Proof Artifact: docs/06_status/proof/UTV2-1549/verification.md
Checklist:
- [x] example`;

const CTX = {
  prNumber: 1235,
  headRef: 'codex/utv2-1549-pilot-r1-runtime-truth-refresh',
  headSha: '4a279235b08cdd2bd07facce3b59bd65587867ee',
  prLabels: ['tier:T2'],
};

// ── check-name resolution (the core UTV2-1550 fix) ──────────────────────────

test('resolveCheckName: pull_request always resolves to the non-required preflight name', () => {
  assert.equal(resolveCheckName('pull_request'), PREFLIGHT_CHECK_NAME);
});

test('resolveCheckName: issue_comment resolves to the required validation name', () => {
  assert.equal(resolveCheckName('issue_comment'), REQUIRED_CHECK_NAME);
});

test('resolveCheckName: workflow_dispatch resolves to the required validation name', () => {
  assert.equal(resolveCheckName('workflow_dispatch'), REQUIRED_CHECK_NAME);
});

test('isRequiredCheckName: false for pull_request, true for issue_comment and workflow_dispatch', () => {
  assert.equal(isRequiredCheckName('pull_request'), false);
  assert.equal(isRequiredCheckName('issue_comment'), true);
  assert.equal(isRequiredCheckName('workflow_dispatch'), true);
});

// ── parsing ──────────────────────────────────────────────────────────────

test('parseExecutorResultComment: well-formed comment parses all fields', () => {
  const r = parseExecutorResultComment(VALID_COMMENT);
  assert.ok(r);
  assert.equal(r.issueId, 'UTV2-1549');
  assert.equal(r.lane, 'codex');
  assert.equal(r.branch, 'codex/utv2-1549-pilot-r1-runtime-truth-refresh');
  assert.equal(r.pr, '#1235');
  assert.equal(r.headSha, '4a279235b08cdd2bd07facce3b59bd65587867ee');
  assert.equal(r.proofPath, 'docs/06_status/proof/UTV2-1549/verification.md');
});

test('parseExecutorResultComment: null/empty body does not parse', () => {
  assert.equal(parseExecutorResultComment(null), null);
  assert.equal(parseExecutorResultComment(undefined), null);
  assert.equal(parseExecutorResultComment(''), null);
});

test('parseExecutorResultComment: unrelated comment does not parse', () => {
  assert.equal(parseExecutorResultComment('looks good to me'), null);
});

test('parseExecutorResultComment: missing schema line does not parse', () => {
  const body = 'EXECUTOR_RESULT: READY_FOR_REVIEW\nIssue: UTV2-1549';
  assert.equal(parseExecutorResultComment(body), null);
});

// ── scenario: missing result ────────────────────────────────────────────

test('selectLatestExecutorResult: no comments at all returns null (missing result)', () => {
  assert.equal(selectLatestExecutorResult([]), null);
});

test('selectLatestExecutorResult: only non-executor-result comments returns null (missing result)', () => {
  assert.equal(selectLatestExecutorResult(['hi', 'looks good', null]), null);
});

// ── scenario: valid result ──────────────────────────────────────────────

test('selectLatestExecutorResult + validateExecutorResultFields: valid result has zero errors', () => {
  const r = selectLatestExecutorResult([VALID_COMMENT]);
  assert.ok(r);
  const errors = validateExecutorResultFields(r, CTX);
  assert.deepEqual(errors, []);
});

// ── scenario: corrected result ──────────────────────────────────────────

test('selectLatestExecutorResult: a corrected later comment supersedes an earlier stale one', () => {
  const staleComment = VALID_COMMENT.replace(
    '4a279235b08cdd2bd07facce3b59bd65587867ee',
    'oldstale00000000000000000000000000000000',
  );
  const r = selectLatestExecutorResult([staleComment, VALID_COMMENT]);
  assert.ok(r);
  assert.equal(r.headSha, '4a279235b08cdd2bd07facce3b59bd65587867ee');
  assert.deepEqual(validateExecutorResultFields(r, CTX), []);
});

test('selectLatestExecutorResult: a corrected comment after a defective one still finds the fix', () => {
  const missingIssue = VALID_COMMENT.replace('Issue: UTV2-1549\n', '');
  const r = selectLatestExecutorResult([missingIssue, VALID_COMMENT]);
  assert.ok(r);
  assert.deepEqual(validateExecutorResultFields(r, CTX), []);
});

// ── scenario: head-change invalidation ──────────────────────────────────

test('validateExecutorResultFields: stale Head SHA after a push produces a head-mismatch error, not silence', () => {
  const r = parseExecutorResultComment(VALID_COMMENT);
  assert.ok(r);
  const newHeadCtx = { ...CTX, headSha: 'brandnewsha0000000000000000000000000000' };
  const errors = validateExecutorResultFields(r, newHeadCtx);
  assert.ok(errors.some((e) => e.includes('HEAD SHA mismatch')));
});

test('validateExecutorResultFields: this head-mismatch error must never surface under the required check name for a pull_request-triggered re-evaluation', () => {
  // This is the actual UTV2-1550 regression: a push (pull_request: synchronize)
  // re-evaluating a now-stale comment must report under PREFLIGHT_CHECK_NAME,
  // never REQUIRED_CHECK_NAME, regardless of how many field errors it finds.
  const checkNameForThisPush = resolveCheckName('pull_request');
  assert.equal(checkNameForThisPush, PREFLIGHT_CHECK_NAME);
  assert.notEqual(checkNameForThisPush, REQUIRED_CHECK_NAME);
});

// ── proof artifact requirement ───────────────────────────────────────────

test('proofArtifactRequired: required for T1/T2 when path is missing', () => {
  const r = parseExecutorResultComment(VALID_COMMENT);
  assert.ok(r);
  const noProof = { ...r, proofPath: null };
  assert.equal(proofArtifactRequired(noProof, ['tier:T2']), true);
  assert.equal(proofArtifactRequired(noProof, ['tier:T1']), true);
});

test('proofArtifactRequired: not required for T3', () => {
  const r = parseExecutorResultComment(VALID_COMMENT);
  assert.ok(r);
  const noProof = { ...r, proofPath: null };
  assert.equal(proofArtifactRequired(noProof, ['tier:T3']), false);
});

test('proofArtifactRequired: "CI only" and "N/A" count as skipped', () => {
  const r = parseExecutorResultComment(VALID_COMMENT);
  assert.ok(r);
  assert.equal(proofArtifactRequired({ ...r, proofPath: 'CI only' }, ['tier:T2']), true);
  assert.equal(proofArtifactRequired({ ...r, proofPath: 'N/A' }, ['tier:T2']), true);
});

// ── field-level validation coverage ──────────────────────────────────────

test('validateExecutorResultFields: invalid issue ID format is rejected', () => {
  const r = parseExecutorResultComment(VALID_COMMENT);
  assert.ok(r);
  const bad = { ...r, issueId: 'not-an-issue' };
  const errors = validateExecutorResultFields(bad, CTX);
  assert.ok(errors.some((e) => e.includes('Invalid Issue ID')));
});

test('validateExecutorResultFields: invalid lane is rejected', () => {
  const r = parseExecutorResultComment(VALID_COMMENT);
  assert.ok(r);
  const bad = { ...r, lane: 'gpt' };
  const errors = validateExecutorResultFields(bad, CTX);
  assert.ok(errors.some((e) => e.includes('Invalid Lane')));
});

test('validateExecutorResultFields: PR number mismatch is rejected', () => {
  const r = parseExecutorResultComment(VALID_COMMENT);
  assert.ok(r);
  const errors = validateExecutorResultFields(r, { ...CTX, prNumber: 9999 });
  assert.ok(errors.some((e) => e.includes('PR mismatch')));
});
