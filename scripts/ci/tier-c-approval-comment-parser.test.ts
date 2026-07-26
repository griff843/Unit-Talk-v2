import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseTierCApprovalComment } from './tier-c-approval-comment-parser.ts';

const REASON_BEFORE_PATHS = [
  'TIER_C_APPROVAL: APPROVED',
  'schema: tier-c-approval/v1',
  'Issue: UTV2-1570',
  'PR: #1300',
  'Head-SHA: abc123def456abc123def456abc123def456abc1',
  'Reason: unit test coverage',
  'Paths:',
  '- packages/domain/src/example.ts',
  '- supabase/migrations/**',
].join('\n');

// Mirrors scope-override-v1's documented Reason-after-Paths ordering (UTV2-1524
// taught us this ordering must parse correctly too).
const REASON_AFTER_PATHS = [
  'TIER_C_APPROVAL: APPROVED',
  'schema: tier-c-approval/v1',
  'Issue: UTV2-1570',
  'PR: #1300',
  'Head-SHA: abc123def456abc123def456abc123def456abc1',
  'Paths:',
  '- packages/domain/src/example.ts',
  '- supabase/migrations/**',
  'Reason: unit test coverage',
].join('\n');

test('parses a well-formed tier-c approval with Reason before Paths', () => {
  const parsed = parseTierCApprovalComment(REASON_BEFORE_PATHS);
  assert.ok(parsed);
  assert.equal(parsed.issue_id, 'UTV2-1570');
  assert.equal(parsed.pr_number, 1300);
  assert.equal(parsed.head_sha, 'abc123def456abc123def456abc123def456abc1');
  assert.deepEqual(parsed.paths, ['packages/domain/src/example.ts', 'supabase/migrations/**']);
  assert.equal(parsed.reason, 'unit test coverage');
});

test('parses a well-formed tier-c approval with Reason after Paths', () => {
  const parsed = parseTierCApprovalComment(REASON_AFTER_PATHS);
  assert.ok(parsed);
  assert.equal(parsed.reason, 'unit test coverage');
  assert.deepEqual(parsed.paths, ['packages/domain/src/example.ts', 'supabase/migrations/**']);
});

test('rejects a comment missing the two-line header', () => {
  const parsed = parseTierCApprovalComment('not an approval\nat all');
  assert.equal(parsed, null);
});

test('rejects a scope-override/v1 comment (wrong schema header, not this schema)', () => {
  const scopeOverride = REASON_AFTER_PATHS.replace(
    'TIER_C_APPROVAL: APPROVED\nschema: tier-c-approval/v1',
    'SCOPE_OVERRIDE: APPROVED\nschema: scope-override/v1',
  );
  assert.equal(parseTierCApprovalComment(scopeOverride), null);
});

test('rejects a comment with no Paths', () => {
  const noPaths = [
    'TIER_C_APPROVAL: APPROVED',
    'schema: tier-c-approval/v1',
    'Issue: UTV2-1570',
    'PR: #1300',
    'Head-SHA: abc123def456abc123def456abc123def456abc1',
    'Reason: unit test coverage',
  ].join('\n');
  assert.equal(parseTierCApprovalComment(noPaths), null);
});

test('rejects a comment with a malformed Issue field', () => {
  const badIssue = REASON_AFTER_PATHS.replace('Issue: UTV2-1570', 'Issue: not-an-issue');
  assert.equal(parseTierCApprovalComment(badIssue), null);
});

test('rejects a comment with a malformed PR field', () => {
  const badPr = REASON_AFTER_PATHS.replace('PR: #1300', 'PR: 1300');
  assert.equal(parseTierCApprovalComment(badPr), null);
});

test('rejects a comment missing Head-SHA', () => {
  const noSha = REASON_AFTER_PATHS.replace('Head-SHA: abc123def456abc123def456abc123def456abc1\n', '');
  assert.equal(parseTierCApprovalComment(noSha), null);
});
