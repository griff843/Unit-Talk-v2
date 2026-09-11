import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
  EXECUTOR_RESULT_ISSUE_ID_RE,
  EXECUTOR_RESULT_BRANCH_RE,
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


// ── UTV2-1688: the bootstrap/ namespace, and the duplication that hid it ────
//
// `Executor Result Validation` is a REQUIRED context, and it is created only by
// an EXECUTOR_RESULT comment. A branch namespace the validator does not
// recognize therefore cannot produce that context at all, which makes every
// lane on that namespace permanently unmergeable. Recorded live on PR #1399.

const BOOTSTRAP_COMMENT = `EXECUTOR_RESULT: READY_FOR_REVIEW
schema: executor-result/v1
Issue: UTV2-1619
Lane: claude
Branch: bootstrap/utv2-1619-repository-truth-integrity
PR: #1399
Head SHA: 9f1c2ab34d5e6f708192a3b4c5d6e7f809a1b2c3
Proof Artifact: docs/06_status/proof/UTV2-1619/verification.md
Checklist:
- [x] example`;

const BOOTSTRAP_CTX = {
  prNumber: 1399,
  headRef: 'bootstrap/utv2-1619-repository-truth-integrity',
  headSha: '9f1c2ab34d5e6f708192a3b4c5d6e7f809a1b2c3',
  prLabels: ['tier:T2'],
};

test('UTV2-1688: a bootstrap/ branch validates with zero errors', () => {
  const r = parseExecutorResultComment(BOOTSTRAP_COMMENT);
  assert.ok(r);
  assert.deepEqual(validateExecutorResultFields(r, BOOTSTRAP_CTX), []);
});

// Controls. Widening the namespace must not have weakened anything the
// validator actually binds -- a green result above only means something if
// each of these still fails on the condition it names.

test('UTV2-1688 control: a bootstrap/ branch that disagrees with the PR head is still rejected', () => {
  const r = parseExecutorResultComment(BOOTSTRAP_COMMENT);
  assert.ok(r);
  const errors = validateExecutorResultFields(r, {
    ...BOOTSTRAP_CTX,
    headRef: 'bootstrap/utv2-1619-something-else',
  });
  assert.ok(
    errors.some((e) => e.includes('Branch mismatch')),
    'the Branch: == PR head ref binding must survive the namespace widening',
  );
});

test('UTV2-1688 control: an unrecognized namespace is still rejected', () => {
  const r = parseExecutorResultComment(BOOTSTRAP_COMMENT);
  assert.ok(r);
  const bad = { ...r, branch: 'feature/utv2-1619-repository-truth-integrity' };
  const errors = validateExecutorResultFields(bad, {
    ...BOOTSTRAP_CTX,
    headRef: 'feature/utv2-1619-repository-truth-integrity',
  });
  assert.ok(errors.some((e) => e.includes('Invalid branch')));
});

test('UTV2-1688 control: a bootstrap/ branch with a stale head SHA is still rejected', () => {
  const r = parseExecutorResultComment(BOOTSTRAP_COMMENT);
  assert.ok(r);
  const errors = validateExecutorResultFields(r, {
    ...BOOTSTRAP_CTX,
    headSha: '0000000000000000000000000000000000000000',
  });
  assert.ok(errors.some((e) => e.includes('HEAD SHA mismatch')));
});

// ── the anti-drift assertion the issue asked for ───────────────────────────
//
// The field validation is duplicated in an actions/github-script block, which
// is a YAML string and cannot import this module. The copy in the workflow is
// the one that gates merges, so a test that only exercises this module proves
// nothing about the gate. These two read the workflow and compare literals.

const WORKFLOW_RELATIVE_PATH = path.join('.github', 'workflows', 'executor-result-validator.yml');

/**
 * Walks up from the cwd to the repo root rather than assuming one. `tsx --test`
 * is invoked from the repo root by `test:ops`, but a lane runs from a worktree
 * and an editor runs from anywhere; a test whose location assumption is wrong
 * fails for a reason that has nothing to do with what it asserts.
 */
function readValidatorWorkflow(): string {
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, WORKFLOW_RELATIVE_PATH);
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf8');
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`could not locate ${WORKFLOW_RELATIVE_PATH} above ${process.cwd()}`);
    dir = parent;
  }
}

const VALIDATOR_WORKFLOW = readValidatorWorkflow();

test('UTV2-1688: the workflow issue-ID literal is byte-identical to the exported one', () => {
  // UTV2-1882: the locator is deliberately namespace-AGNOSTIC (`[A-Za-z0-9|]+`
  // rather than a spelled-out alternation). A locator that names the very
  // namespaces it is checking has to be edited in lockstep with the literal
  // it guards, and an assertion you must edit to keep green is not a guard.
  const match = VALIDATOR_WORKFLOW.match(/!(\/\^\([A-Za-z0-9|]+\)-\\d\+\$\/i)\.test\(r\.issueId\)/);
  assert.ok(match, 'could not locate the inline issue-ID regex in executor-result-validator.yml');
  assert.equal(
    match[1],
    EXECUTOR_RESULT_ISSUE_ID_RE.toString(),
    'the workflow copy has drifted from EXECUTOR_RESULT_ISSUE_ID_RE',
  );
});

test('UTV2-1688: the workflow branch literal is byte-identical to the exported one', () => {
  const match = VALIDATOR_WORKFLOW.match(/const branchRe = (\/\^.*?\/i);/);
  assert.ok(match, 'could not locate the inline branchRe in executor-result-validator.yml');
  assert.equal(
    match[1],
    EXECUTOR_RESULT_BRANCH_RE.toString(),
    'the workflow copy has drifted from EXECUTOR_RESULT_BRANCH_RE',
  );
});

// ── UTV2-1882: the WORK-### namespace ──────────────────────────────────────
//
// `WORK-###` is a repository-minted work identity: `shared.ts` BRANCH_PATTERN
// has accepted `work-\d+` since UTV2-1837 and ISSUE_ID_NAMESPACES since
// UTV2-1840, but this validator did not, so a WORK lane could never produce the
// required `Executor Result Validation` context and was unmergeable.
//
// These assert the widening in BOTH directions. Admission alone is not the
// property worth locking -- a regex that admitted everything would pass an
// admission-only test -- so every malformed case below names the specific
// condition it violates, and the pair is asserted non-vacuous at the end.

const WORK_COMMENT = `EXECUTOR_RESULT: READY_FOR_REVIEW
schema: executor-result/v1
Issue: WORK-2026091001
Lane: codex
Branch: codex/work-2026091001-tracker-independence
PR: #1556
Head SHA: 3dc57bc84e47b94dc640d00d394e8525f538c1a7
Proof Artifact: docs/06_status/proof/WORK-2026091001/verification.md
Checklist:
- [x] example`;

const WORK_CTX = {
  prNumber: 1556,
  headRef: 'codex/work-2026091001-tracker-independence',
  headSha: '3dc57bc84e47b94dc640d00d394e8525f538c1a7',
  prLabels: ['tier:T1'],
};

test('UTV2-1882: a well-formed WORK-### executor result validates end to end', () => {
  const parsed = parseExecutorResultComment(WORK_COMMENT);
  assert.ok(parsed, 'the WORK-### comment should parse');
  assert.deepEqual(validateExecutorResultFields(parsed!, WORK_CTX), []);
});

test('UTV2-1882: valid WORK identifiers are admitted by both exported regexes', () => {
  for (const id of ['WORK-2026091001', 'WORK-1', 'work-42']) {
    assert.ok(EXECUTOR_RESULT_ISSUE_ID_RE.test(id), `expected ${id} to be admitted`);
  }
  for (const br of [
    'codex/work-2026091001-tracker-independence',
    'claude/work-1-x',
    'bootstrap/work-7-x',
  ]) {
    assert.ok(EXECUTOR_RESULT_BRANCH_RE.test(br), `expected ${br} to be admitted`);
  }
});

test('UTV2-1882: the existing namespaces are untouched by the widening', () => {
  for (const id of ['UTV2-1882', 'UNI-5']) {
    assert.ok(EXECUTOR_RESULT_ISSUE_ID_RE.test(id), `${id} must still be admitted`);
  }
  for (const br of ['claude/utv2-1882-erv', 'codex/uni-3-x', 'bootstrap/utv2-1688-x']) {
    assert.ok(EXECUTOR_RESULT_BRANCH_RE.test(br), `${br} must still be admitted`);
  }
});

test('UTV2-1882: malformed identifiers are still rejected, each on the rule it breaks', () => {
  const badIds: Array<[string, string]> = [
    ['WORK', 'no separator and no digits'],
    ['WORK-', 'separator present but no digits'],
    ['WORK-abc', 'non-numeric suffix'],
    ['WORK-12a', 'trailing garbage after the digits ($ anchor)'],
    ['xWORK-12', 'leading garbage before the namespace (^ anchor)'],
    ['WORKS-12', 'near-miss namespace must not be admitted by a prefix match'],
    ['FOO-123', 'wrong namespace entirely'],
    ['', 'empty'],
  ];
  for (const [id, why] of badIds) {
    assert.equal(EXECUTOR_RESULT_ISSUE_ID_RE.test(id), false, `${JSON.stringify(id)} must be rejected: ${why}`);
  }

  const badBranches: Array<[string, string]> = [
    ['codex/work-x', 'no digits after the namespace'],
    ['codex/work', 'no separator'],
    ['codex/works-1-x', 'near-miss namespace must not be admitted by a prefix match'],
    ['foo/work-1-x', 'wrong executor prefix'],
    ['work-1-x', 'no executor prefix at all'],
    ['x/codex/work-1', 'leading garbage before the executor prefix (^ anchor)'],
  ];
  for (const [br, why] of badBranches) {
    assert.equal(EXECUTOR_RESULT_BRANCH_RE.test(br), false, `${JSON.stringify(br)} must be rejected: ${why}`);
  }
});

test('UTV2-1882: a malformed WORK issue ID still produces a validation error', () => {
  const parsed = parseExecutorResultComment(WORK_COMMENT.replace('Issue: WORK-2026091001', 'Issue: WORK-abc'));
  assert.ok(parsed);
  const errors = validateExecutorResultFields(parsed!, WORK_CTX);
  assert.ok(
    errors.some((e) => e.includes('Invalid Issue ID')),
    `expected an Invalid Issue ID error, got: ${JSON.stringify(errors)}`,
  );
});

test('UTV2-1882: an ABSENT issue ID still fails -- the widening admits a namespace, not an omission', () => {
  const parsed = parseExecutorResultComment(WORK_COMMENT.replace('Issue: WORK-2026091001\n', ''));
  assert.ok(parsed);
  const errors = validateExecutorResultFields(parsed!, WORK_CTX);
  assert.ok(
    errors.some((e) => e.includes('Invalid Issue ID')),
    `an executor result with no Issue: row must still fail, got: ${JSON.stringify(errors)}`,
  );
});

test('UTV2-1882: the three binding controls still fail on a WORK lane', () => {
  const parsed = parseExecutorResultComment(WORK_COMMENT)!;

  // Branch must equal the PR head ref.
  assert.ok(
    validateExecutorResultFields(parsed, { ...WORK_CTX, headRef: 'codex/work-2026091001-something-else' })
      .some((e) => e.includes('Branch mismatch')),
    'a head-ref mismatch must still be reported',
  );

  // The declared PR must equal the actual PR.
  assert.ok(
    validateExecutorResultFields(parsed, { ...WORK_CTX, prNumber: 9999 })
      .some((e) => e.includes('PR mismatch')),
    'a PR-number mismatch must still be reported',
  );

  // The declared head SHA must equal the current head.
  assert.ok(
    validateExecutorResultFields(parsed, { ...WORK_CTX, headSha: 'f'.repeat(40) })
      .some((e) => e.includes('HEAD SHA mismatch')),
    'a stale head SHA must still be reported',
  );
});

test('UTV2-1882: the widening is non-vacuous in both directions', () => {
  const NARROW_ID = /^(UTV2|UNI)-\d+$/i;
  const NARROW_BR = /^(claude|codex|bootstrap)\/(utv2|uni)-\d+/i;

  // Something is newly admitted -- otherwise the change did nothing.
  assert.ok(EXECUTOR_RESULT_ISSUE_ID_RE.test('WORK-1') && !NARROW_ID.test('WORK-1'));
  assert.ok(
    EXECUTOR_RESULT_BRANCH_RE.test('codex/work-1-x') && !NARROW_BR.test('codex/work-1-x'),
  );

  // And something is still refused -- otherwise the tests above are satisfied
  // by a regex that admits everything.
  assert.equal(EXECUTOR_RESULT_ISSUE_ID_RE.test('FOO-1'), false);
  assert.equal(EXECUTOR_RESULT_BRANCH_RE.test('foo/work-1-x'), false);
});
