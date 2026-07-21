import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  extractIssueIdFromCommentUrl,
  matchesLockPattern,
  parseSingletonApprovalComment,
  validateSingletonApprovalRef,
} from './singleton-approval.ts';

const ISSUE_ID = 'UTV2-1570';
const VALID_URL =
  'https://linear.app/unit-talk-v2/issue/UTV2-1570/implement-tier-c-authorization-gate-singleton-approval-record-utv2#comment-386f974e';

const OWNER = { id: 'owner-uuid-1', name: 'A Griffin', email: 'griffadavi@gmail.com' };
const IMPOSTER = { id: 'imposter-uuid-2', name: 'Someone Else', email: 'someone@example.com' };

function fakeFetch(issue: unknown): typeof fetch {
  return (async () =>
    ({
      json: async () => ({ data: { issue } }),
    }) as Response) as typeof fetch;
}

function validComment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'comment-uuid-1',
    url: VALID_URL,
    body: ['SINGLETON_APPROVED', 'schema: singleton-approval/v1', `Issue: ${ISSUE_ID}`, 'Paths:', '- package.json', 'Reason: bootstrap'].join(
      '\n',
    ),
    user: OWNER,
    botActor: null,
    ...overrides,
  };
}

function issueWith(comments: unknown[], creator: unknown = OWNER) {
  return { id: 'issue-uuid', identifier: ISSUE_ID, creator, comments: { nodes: comments } };
}

// ── Pure helpers ─────────────────────────────────────────────────────────

test('extractIssueIdFromCommentUrl parses a well-formed Linear comment URL', () => {
  assert.equal(extractIssueIdFromCommentUrl(VALID_URL), 'UTV2-1570');
});

test('extractIssueIdFromCommentUrl returns null for a non-Linear URL', () => {
  assert.equal(extractIssueIdFromCommentUrl('https://example.com/not-linear'), null);
});

test('extractIssueIdFromCommentUrl returns null for a malformed URL', () => {
  assert.equal(extractIssueIdFromCommentUrl('not a url at all'), null);
});

test('matchesLockPattern: exact match', () => {
  assert.equal(matchesLockPattern('package.json', 'package.json'), true);
  assert.equal(matchesLockPattern('package.json', 'other.json'), false);
});

test('matchesLockPattern: /** directory prefix', () => {
  assert.equal(matchesLockPattern('.github/workflows/foo.yml', '.github/workflows/**'), true);
  assert.equal(matchesLockPattern('.github/other/foo.yml', '.github/workflows/**'), false);
});

test('parseSingletonApprovalComment: well-formed body', () => {
  const parsed = parseSingletonApprovalComment(
    ['SINGLETON_APPROVED', 'schema: singleton-approval/v1', 'Issue: UTV2-1570', 'Paths:', '- package.json', '- .github/workflows/**', 'Reason: x'].join(
      '\n',
    ),
  );
  assert.ok(parsed);
  assert.equal(parsed.issue_id, 'UTV2-1570');
  assert.deepEqual(parsed.paths, ['package.json', '.github/workflows/**']);
  assert.equal(parsed.reason, 'x');
});

test('parseSingletonApprovalComment: rejects wrong header', () => {
  assert.equal(parseSingletonApprovalComment('not the right format'), null);
});

test('parseSingletonApprovalComment: rejects missing Paths', () => {
  const body = ['SINGLETON_APPROVED', 'schema: singleton-approval/v1', 'Issue: UTV2-1570', 'Reason: x'].join('\n');
  assert.equal(parseSingletonApprovalComment(body), null);
});

// ── validateSingletonApprovalRef ────────────────────────────────────────

test('fails closed on a malformed ref', async () => {
  const result = await validateSingletonApprovalRef({
    approvalRef: 'not-a-url',
    issueId: ISSUE_ID,
    singletonPaths: ['package.json'],
    linearToken: 'token',
    fetchImpl: fakeFetch(null),
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, 'singleton_approval_malformed_ref');
});

test('fails closed when the ref points at a different issue', async () => {
  const result = await validateSingletonApprovalRef({
    approvalRef: 'https://linear.app/unit-talk-v2/issue/UTV2-9999/some-other-issue#comment-abcd1234',
    issueId: ISSUE_ID,
    singletonPaths: ['package.json'],
    linearToken: 'token',
    fetchImpl: fakeFetch(null),
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, 'singleton_approval_issue_mismatch');
});

test('fails closed when the issue cannot be resolved', async () => {
  const result = await validateSingletonApprovalRef({
    approvalRef: VALID_URL,
    issueId: ISSUE_ID,
    singletonPaths: ['package.json'],
    linearToken: 'token',
    fetchImpl: fakeFetch(null),
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, 'singleton_approval_not_found');
});

test('fails closed when no comment matches the referenced URL', async () => {
  const result = await validateSingletonApprovalRef({
    approvalRef: VALID_URL,
    issueId: ISSUE_ID,
    singletonPaths: ['package.json'],
    linearToken: 'token',
    fetchImpl: fakeFetch(issueWith([validComment({ url: VALID_URL + '-different' })])),
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, 'singleton_approval_not_found');
});

test('fails closed on a bot-authored comment', async () => {
  const result = await validateSingletonApprovalRef({
    approvalRef: VALID_URL,
    issueId: ISSUE_ID,
    singletonPaths: ['package.json'],
    linearToken: 'token',
    fetchImpl: fakeFetch(issueWith([validComment({ botActor: { id: 'bot-1' } })])),
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, 'singleton_approval_bot_author');
});

test('fails closed when the comment author is not the issue owner', async () => {
  const result = await validateSingletonApprovalRef({
    approvalRef: VALID_URL,
    issueId: ISSUE_ID,
    singletonPaths: ['package.json'],
    linearToken: 'token',
    fetchImpl: fakeFetch(issueWith([validComment({ user: IMPOSTER })])),
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, 'singleton_approval_wrong_author');
});

test('fails closed on a schema-mismatched comment body', async () => {
  const result = await validateSingletonApprovalRef({
    approvalRef: VALID_URL,
    issueId: ISSUE_ID,
    singletonPaths: ['package.json'],
    linearToken: 'token',
    fetchImpl: fakeFetch(issueWith([validComment({ body: 'just a regular comment, not an approval' })])),
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, 'singleton_approval_schema_mismatch');
});

test('fails closed on incomplete path coverage', async () => {
  const result = await validateSingletonApprovalRef({
    approvalRef: VALID_URL,
    issueId: ISSUE_ID,
    singletonPaths: ['package.json', 'pnpm-lock.yaml'],
    linearToken: 'token',
    fetchImpl: fakeFetch(issueWith([validComment()])), // only covers package.json
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, 'singleton_approval_incomplete_coverage');
  assert.deepEqual((result as { uncovered_paths?: string[] }).uncovered_paths, ['pnpm-lock.yaml']);
});

test('a /** Paths entry covers every singleton path under that prefix', async () => {
  const result = await validateSingletonApprovalRef({
    approvalRef: VALID_URL,
    issueId: ISSUE_ID,
    singletonPaths: ['.github/workflows/a.yml', '.github/workflows/b.yml'],
    linearToken: 'token',
    fetchImpl: fakeFetch(
      issueWith([
        validComment({
          body: [
            'SINGLETON_APPROVED',
            'schema: singleton-approval/v1',
            `Issue: ${ISSUE_ID}`,
            'Paths:',
            '- .github/workflows/**',
            'Reason: bootstrap',
          ].join('\n'),
        }),
      ]),
    ),
  });
  assert.equal(result.ok, true);
});

test('passes for a valid, fully-covering, owner-authored approval', async () => {
  const result = await validateSingletonApprovalRef({
    approvalRef: VALID_URL,
    issueId: ISSUE_ID,
    singletonPaths: ['package.json'],
    linearToken: 'token',
    fetchImpl: fakeFetch(issueWith([validComment()])),
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.approved_by.id, OWNER.id);
    assert.deepEqual(result.covered_paths, ['package.json']);
  }
});

test('the issue-id match is case-insensitive on the URL but normalized to uppercase', async () => {
  const lowerCaseRefUrl = VALID_URL.replace('UTV2-1570', 'utv2-1570');
  const result = await validateSingletonApprovalRef({
    approvalRef: lowerCaseRefUrl,
    issueId: 'utv2-1570',
    singletonPaths: ['package.json'],
    linearToken: 'token',
    fetchImpl: fakeFetch(issueWith([validComment({ url: lowerCaseRefUrl })])),
  });
  assert.equal(result.ok, true);
});
