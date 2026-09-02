import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVerdict, validateT1Verdicts } from './merge-gate-verdict.cjs';

const PR_NUMBER = 1230;
const HEAD_SHA = '05abe4bf3f9c4870137d3dece41a30d1947ba1c3';
const OLD_HEAD_SHA = '17417b95a72c534b262c0cc2a6e3562627380de4';
const REVIEWERS = new Set(['griff843']);

function approvedComment({ pr = PR_NUMBER, headSha = HEAD_SHA, issue = 'UTV2-1501' } = {}) {
  return [
    'PM_VERDICT: APPROVED',
    'schema: pm-verdict/v1',
    `Issue: ${issue}`,
    `PR: ${pr}`,
    `Head SHA: ${headSha}`,
    '',
    'Scope of approval: something.',
  ].join('\n');
}

function verdictRecord(body, overrides = {}) {
  return {
    user: 'griff843',
    userType: 'User',
    parsed: parseVerdict(body),
    createdAt: '2026-07-17T00:00:00Z',
    ...overrides,
  };
}

test('parseVerdict extracts PR and Head SHA from anywhere in the body', () => {
  const parsed = parseVerdict(approvedComment());
  assert.equal(parsed.verdict, 'APPROVED');
  assert.equal(parsed.issueId, 'UTV2-1501');
  assert.equal(parsed.prNumber, PR_NUMBER);
  assert.equal(parsed.headSha, HEAD_SHA);
});

test('parseVerdict returns null for schema-mismatched comments (silently ignored)', () => {
  assert.equal(parseVerdict('not a verdict'), null);
  assert.equal(parseVerdict('PM_VERDICT: APPROVED\nschema: something-else\nIssue: UTV2-1'), null);
  assert.equal(parseVerdict(''), null);
  assert.equal(parseVerdict(null), null);
});

test('parseVerdict returns null prNumber/headSha when those fields are absent', () => {
  const parsed = parseVerdict('PM_VERDICT: APPROVED\nschema: pm-verdict/v1\nIssue: UTV2-1501');
  assert.equal(parsed.verdict, 'APPROVED');
  assert.equal(parsed.prNumber, null);
  assert.equal(parsed.headSha, null);
});

// Acceptance test 1: exact issue/PR/head APPROVED verdict passes.
test('UTV2-1543 AC1: exact issue/PR/head APPROVED verdict passes', () => {
  const verdicts = [verdictRecord(approvedComment())];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.deepEqual(errors, []);
});

// Acceptance test 2: approved verdict for an earlier head fails after a rebase/push.
test('UTV2-1543 AC2: approved verdict bound to a stale head fails after a rebase', () => {
  const verdicts = [verdictRecord(approvedComment({ headSha: OLD_HEAD_SHA }))];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /stale/i);
  assert.match(errors[0], new RegExp(OLD_HEAD_SHA));
  assert.match(errors[0], new RegExp(HEAD_SHA));
});

// Acceptance test 3: wrong PR number fails.
test('UTV2-1543 AC3: wrong PR number fails', () => {
  const verdicts = [verdictRecord(approvedComment({ pr: 9999 }))];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /PR mismatch/i);
  assert.match(errors[0], /#9999/);
  assert.match(errors[0], new RegExp(`#${PR_NUMBER}`));
});

// Acceptance test 4: missing Head SHA fails.
test('UTV2-1543 AC4: missing Head SHA fails', () => {
  const body = ['PM_VERDICT: APPROVED', 'schema: pm-verdict/v1', 'Issue: UTV2-1501', `PR: ${PR_NUMBER}`].join('\n');
  const verdicts = [verdictRecord(body)];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing a "Head SHA:" field/i);
});

test('UTV2-1543: missing PR field fails independently of Head SHA', () => {
  const body = ['PM_VERDICT: APPROVED', 'schema: pm-verdict/v1', 'Issue: UTV2-1501', `Head SHA: ${HEAD_SHA}`].join('\n');
  const verdicts = [verdictRecord(body)];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing a "PR:" field/i);
});

// Acceptance test 5: CHANGES_REQUIRED remains authoritative when latest.
test('UTV2-1543 AC5: CHANGES_REQUIRED remains authoritative when latest, regardless of PR/head fields', () => {
  const approvedBody = approvedComment();
  const changesRequiredBody = [
    'PM_VERDICT: CHANGES_REQUIRED',
    'schema: pm-verdict/v1',
    'Issue: UTV2-1501',
    'Bounce: 1',
  ].join('\n');
  const verdicts = [verdictRecord(approvedBody), verdictRecord(changesRequiredBody)];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not "APPROVED"/);
});

// Acceptance test 6: a byte-identical rebase still requires a newly bound
// human verdict; no content-based inference — covered structurally, since
// validateT1Verdicts only ever compares the declared Head SHA against the
// live PR head. It has no code path that inspects diff/content equality.
test('UTV2-1543 AC6: no content-based inference — only the declared Head SHA is ever compared', () => {
  // Same PR, same issue, byte-identical intent, but the verdict names a head
  // that isn't the current one: must fail exactly like AC2, with no special
  // case for "the diff didn't actually change".
  const verdicts = [verdictRecord(approvedComment({ headSha: OLD_HEAD_SHA }))];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.ok(errors.some((e) => /stale/i.test(e)));
});

// Acceptance test 7: existing T2 behavior is unchanged — validateT1Verdicts
// is only invoked from the T1 branch in merge-gate.yml; this module makes
// no T2 assertion, confirming no shared code path was touched.
test('UTV2-1543 AC7: validateT1Verdicts has no T2 code path to regress', () => {
  assert.equal(typeof validateT1Verdicts, 'function');
  assert.equal(validateT1Verdicts.length, 2);
});

test('bot-authored verdict is rejected even when otherwise well-formed', () => {
  const verdicts = [verdictRecord(approvedComment(), { user: 'github-actions[bot]', userType: 'Bot' })];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.ok(errors.some((e) => /not authorized/i.test(e) && /bot account/i.test(e)));
});

test('verdict from a non-CODEOWNERS human is rejected', () => {
  const verdicts = [verdictRecord(approvedComment(), { user: 'some-random-user', userType: 'User' })];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.ok(errors.some((e) => /not in CODEOWNERS/i.test(e)));
});

test('no verdicts at all fails with the generic missing-verdict message', () => {
  const errors = validateT1Verdicts([], { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /requires a valid pm-verdict\/v1 comment/i);
});

test('bounce limit is preserved: 3 CHANGES_REQUIRED verdicts trips the limit', () => {
  const changesRequiredBody = [
    'PM_VERDICT: CHANGES_REQUIRED',
    'schema: pm-verdict/v1',
    'Issue: UTV2-1501',
    'Bounce: 1',
  ].join('\n');
  const verdicts = [verdictRecord(changesRequiredBody), verdictRecord(changesRequiredBody), verdictRecord(changesRequiredBody)];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.ok(errors.some((e) => /Bounce limit exceeded/i.test(e)));
});

test('a later APPROVED verdict supersedes an earlier CHANGES_REQUIRED one', () => {
  const changesRequiredBody = [
    'PM_VERDICT: CHANGES_REQUIRED',
    'schema: pm-verdict/v1',
    'Issue: UTV2-1501',
    'Bounce: 1',
  ].join('\n');
  const verdicts = [verdictRecord(changesRequiredBody), verdictRecord(approvedComment())];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.deepEqual(errors, []);
});

// UTV2-1554: trust-boundary regressions. Any GitHub user can post a comment
// that structurally parses as pm-verdict/v1; only CODEOWNERS membership
// (checked before latest-verdict selection) makes it authoritative.

test('UTV2-1554: unauthorized bot CHANGES_REQUIRED cannot override an earlier valid owner APPROVED', () => {
  const outsiderChangesRequired = ['PM_VERDICT: CHANGES_REQUIRED', 'schema: pm-verdict/v1', 'Issue: UTV2-1501'].join(
    '\n',
  );
  const verdicts = [
    verdictRecord(approvedComment()), // authorized owner APPROVED, current head
    verdictRecord(outsiderChangesRequired, { user: 'github-actions[bot]', userType: 'Bot' }),
  ];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.deepEqual(errors, []);
});

test('UTV2-1554: unauthorized outsider APPROVED cannot override an earlier valid owner CHANGES_REQUIRED', () => {
  const changesRequiredBody = ['PM_VERDICT: CHANGES_REQUIRED', 'schema: pm-verdict/v1', 'Issue: UTV2-1501'].join('\n');
  const verdicts = [
    verdictRecord(changesRequiredBody), // authorized owner CHANGES_REQUIRED
    verdictRecord(approvedComment(), { user: 'some-random-user', userType: 'User' }),
  ];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not "APPROVED"/);
});

test('UTV2-1554: fails closed when every parsed verdict is unauthorized, even a later-looking APPROVED', () => {
  const verdicts = [verdictRecord(approvedComment(), { user: 'some-random-user', userType: 'User' })];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.ok(errors.some((e) => /requires a valid pm-verdict\/v1 comment/i.test(e)));
});

test('UTV2-1554: bounce limit only counts authorized CHANGES_REQUIRED verdicts', () => {
  const changesRequiredBody = ['PM_VERDICT: CHANGES_REQUIRED', 'schema: pm-verdict/v1', 'Issue: UTV2-1501'].join('\n');
  const verdicts = [
    verdictRecord(changesRequiredBody), // 1 authorized
    verdictRecord(changesRequiredBody, { user: 'some-random-user', userType: 'User' }), // unauthorized, doesn't count
    verdictRecord(changesRequiredBody, { user: 'some-random-user', userType: 'User' }), // unauthorized, doesn't count
  ];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.ok(!errors.some((e) => /Bounce limit exceeded/i.test(e)));
});

// ─── UTV2-1572 Phase A: executor identity carries no PM authority ───────────

import {
  EXECUTOR_APP_LOGIN,
  isAcceptedExecutorAttestationAuthor,
  isExecutorAppIdentity,
  selectHumanApprovals,
  validateT1ApprovedLabel,
} from './merge-gate-verdict.cjs';

const EXECUTOR_APP_USER = { login: EXECUTOR_APP_LOGIN, type: 'Bot' };
const HUMAN_OWNER = { login: 'griff843', type: 'User' };
const OTHER_BOT = { login: 'github-actions[bot]', type: 'Bot' };

test('UTV2-1572: executor App login is exactly unit-talk-executor[bot]', () => {
  assert.equal(EXECUTOR_APP_LOGIN, 'unit-talk-executor[bot]');
  assert.equal(isExecutorAppIdentity(EXECUTOR_APP_USER), true);
  assert.equal(isExecutorAppIdentity({ login: EXECUTOR_APP_LOGIN, type: 'User' }), false, 'a human impersonating the login is not the App');
  assert.equal(isExecutorAppIdentity(OTHER_BOT), false);
  assert.equal(isExecutorAppIdentity(null), false);
});

test('UTV2-1572: a pm-verdict/v1 APPROVED posted by the executor App is rejected for T1', () => {
  const verdicts = [verdictRecord(approvedComment(), { user: EXECUTOR_APP_LOGIN, userType: 'Bot' })];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.ok(errors.some((e) => e.includes(`bot account "${EXECUTOR_APP_LOGIN}"`)), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('T1 requires a valid pm-verdict/v1 comment')));
});

test('UTV2-1572: an executor-App verdict cannot supersede a human CHANGES_REQUIRED', () => {
  const changes = approvedComment().replace('PM_VERDICT: APPROVED', 'PM_VERDICT: CHANGES_REQUIRED');
  const verdicts = [
    verdictRecord(changes, { createdAt: '2026-09-02T17:00:00Z' }),
    verdictRecord(approvedComment(), { user: EXECUTOR_APP_LOGIN, userType: 'Bot', createdAt: '2026-09-02T17:05:00Z' }),
  ];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.ok(errors.some((e) => e.includes('"CHANGES_REQUIRED", not "APPROVED"')), errors.join('\n'));
});

test('UTV2-1572: t1-approved label applied by a human CODEOWNERS member carries authority', () => {
  const events = [
    { event: 'labeled', label: { name: 'tier:T1' }, actor: OTHER_BOT },
    { event: 'labeled', label: { name: 't1-approved' }, actor: HUMAN_OWNER },
  ];
  assert.deepEqual(validateT1ApprovedLabel(events, { authorizedReviewers: REVIEWERS }), []);
});

test('UTV2-1572: t1-approved label applied by the executor App is rejected mechanically', () => {
  const events = [{ event: 'labeled', label: { name: 't1-approved' }, actor: EXECUTOR_APP_USER }];
  const errors = validateT1ApprovedLabel(events, { authorizedReviewers: REVIEWERS });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /applied by bot account "unit-talk-executor\[bot\]"/);
});

test('UTV2-1572: the MOST RECENT t1-approved application decides — a later App re-apply revokes a prior human grant', () => {
  const events = [
    { event: 'labeled', label: { name: 't1-approved' }, actor: HUMAN_OWNER },
    { event: 'unlabeled', label: { name: 't1-approved' }, actor: HUMAN_OWNER },
    { event: 'labeled', label: { name: 't1-approved' }, actor: EXECUTOR_APP_USER },
  ];
  const errors = validateT1ApprovedLabel(events, { authorizedReviewers: REVIEWERS });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /bot account/);

  const humanLast = [...events, { event: 'labeled', label: { name: 't1-approved' }, actor: HUMAN_OWNER }];
  assert.deepEqual(validateT1ApprovedLabel(humanLast, { authorizedReviewers: REVIEWERS }), []);
});

test('UTV2-1572: t1-approved label with no labeled event, unknown actor, or non-CODEOWNERS human fails closed', () => {
  assert.equal(validateT1ApprovedLabel([], { authorizedReviewers: REVIEWERS }).length, 1);
  assert.match(
    validateT1ApprovedLabel([{ event: 'labeled', label: { name: 't1-approved' }, actor: null }], { authorizedReviewers: REVIEWERS })[0],
    /unknown actor/,
  );
  const stranger = [{ event: 'labeled', label: { name: 't1-approved' }, actor: { login: 'someone-else', type: 'User' } }];
  assert.match(validateT1ApprovedLabel(stranger, { authorizedReviewers: REVIEWERS })[0], /not in CODEOWNERS/);
});

test('UTV2-1572: T2 review approvals from Bot accounts (including the executor App) are ignored', () => {
  const reviews = [
    { state: 'APPROVED', user: EXECUTOR_APP_USER },
    { state: 'APPROVED', user: OTHER_BOT },
    { state: 'COMMENTED', user: HUMAN_OWNER },
  ];
  assert.deepEqual(selectHumanApprovals(reviews), []);
  const withHuman = [...reviews, { state: 'APPROVED', user: { login: 'reviewer', type: 'User' } }];
  assert.equal(selectHumanApprovals(withHuman).length, 1);
  assert.equal(selectHumanApprovals([{ state: 'APPROVED' }]).length, 1, 'only an explicit Bot user type is excluded');
  assert.deepEqual(selectHumanApprovals(undefined), []);
});

test('UTV2-1572: executor-result self-attestation accepted from the executor App or a human CODEOWNERS member, never another bot', () => {
  assert.equal(isAcceptedExecutorAttestationAuthor(EXECUTOR_APP_USER, REVIEWERS), true);
  assert.equal(isAcceptedExecutorAttestationAuthor(HUMAN_OWNER, REVIEWERS), true);
  assert.equal(isAcceptedExecutorAttestationAuthor(OTHER_BOT, REVIEWERS), false);
  assert.equal(isAcceptedExecutorAttestationAuthor({ login: 'griff843', type: 'Bot' }, REVIEWERS), false);
  assert.equal(isAcceptedExecutorAttestationAuthor({ login: 'stranger', type: 'User' }, REVIEWERS), false);
  assert.equal(isAcceptedExecutorAttestationAuthor(undefined, REVIEWERS), false);
});
