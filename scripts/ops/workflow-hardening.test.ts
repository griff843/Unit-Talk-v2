import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUntrackedScriptFiles } from './clean-scripts.js';
import { evaluateIssueReferences, extractIssueIds } from './branch-discipline-guard.js';
import { buildFiberyPayloads } from './fibery-update-scaffold.js';

test('clean-scripts only keeps untracked files under scripts', () => {
  assert.deepStrictEqual(
    normalizeUntrackedScriptFiles(
      ['scripts/proof-a.ts', 'apps/api/src/scripts/proof-b.ts', 'scripts/nested/tool.ts', '../scripts/nope.ts'].join('\n'),
    ),
    ['scripts/nested/tool.ts', 'scripts/proof-a.ts'],
  );
});

test('branch discipline extracts unique issue IDs case-insensitively', () => {
  assert.deepStrictEqual(extractIssueIds('fix UTV2-123 and utv2-123, refs UTV2-124'), [
    'UTV2-123',
    'UTV2-124',
  ]);
});

test('branch discipline warns without failing on multiple issue IDs', () => {
  const result = evaluateIssueReferences('PR title UTV2-123\nBody mentions UTV2-124');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.code, 'multiple_issue_references');
  assert.match(result.warning ?? '', /UTV2-123, UTV2-124/);
});

test('fibery scaffold groups commit subjects into update payloads', () => {
  const payloads = buildFiberyPayloads([
    { sha: 'abc', subject: 'fix(api): UTV2-123 one thing' },
    { sha: 'def', subject: 'test(worker): refs UTV2-123 and UTV2-124' },
    { sha: 'ghi', subject: 'chore: no issue' },
  ]);

  assert.deepStrictEqual(
    payloads.map((payload) => [payload.issue_id, payload.commit_count]),
    [
      ['UTV2-123', 2],
      ['UTV2-124', 1],
    ],
  );
  assert.strictEqual(payloads[0]?.fibery.operation, 'update_issue_from_commit_activity');
});
