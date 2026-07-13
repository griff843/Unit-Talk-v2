import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseScopeOverrideComment } from './scope-override-comment-parser.ts';

const REASON_BEFORE_PATHS = [
  'SCOPE_OVERRIDE: APPROVED',
  'schema: scope-override/v1',
  'Issue: UTV2-1524',
  'PR: #1200',
  'Head-SHA: abc123def456abc123def456abc123def456abc1',
  'Reason: unit test coverage',
  'Paths:',
  '- path/one.ts',
  '- path/two/**',
].join('\n');

// Matches docs/05_operations/schemas/scope-override-v1.md's own documented
// example order exactly (UTV2-1524 bug: this order previously produced an
// empty reason and was silently rejected downstream).
const REASON_AFTER_PATHS = [
  'SCOPE_OVERRIDE: APPROVED',
  'schema: scope-override/v1',
  'Issue: UTV2-1524',
  'PR: #1200',
  'Head-SHA: abc123def456abc123def456abc123def456abc1',
  'Paths:',
  '- path/one.ts',
  '- path/two/**',
  'Reason: unit test coverage',
].join('\n');

test('parses a well-formed override with Reason before Paths', () => {
  const parsed = parseScopeOverrideComment(REASON_BEFORE_PATHS);
  assert.ok(parsed);
  assert.equal(parsed.issue_id, 'UTV2-1524');
  assert.equal(parsed.pr_number, 1200);
  assert.equal(parsed.head_sha, 'abc123def456abc123def456abc123def456abc1');
  assert.deepEqual(parsed.paths, ['path/one.ts', 'path/two/**']);
  assert.equal(parsed.reason, 'unit test coverage');
});

test('parses a well-formed override with Reason after Paths (schema doc documented order)', () => {
  const parsed = parseScopeOverrideComment(REASON_AFTER_PATHS);
  assert.ok(parsed);
  assert.equal(parsed.reason, 'unit test coverage');
  assert.deepEqual(parsed.paths, ['path/one.ts', 'path/two/**']);
});

test('rejects a comment missing the two-line header', () => {
  const parsed = parseScopeOverrideComment('not an override\nat all');
  assert.equal(parsed, null);
});

test('rejects a comment with no Paths', () => {
  const noPaths = [
    'SCOPE_OVERRIDE: APPROVED',
    'schema: scope-override/v1',
    'Issue: UTV2-1524',
    'PR: #1200',
    'Head-SHA: abc123def456abc123def456abc123def456abc1',
    'Reason: unit test coverage',
  ].join('\n');
  assert.equal(parseScopeOverrideComment(noPaths), null);
});

test('rejects a comment with a malformed Issue field', () => {
  const badIssue = REASON_AFTER_PATHS.replace('Issue: UTV2-1524', 'Issue: not-an-issue');
  assert.equal(parseScopeOverrideComment(badIssue), null);
});
