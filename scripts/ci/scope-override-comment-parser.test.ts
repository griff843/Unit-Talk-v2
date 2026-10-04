import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { parse as parseYaml } from 'yaml';

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
  const badIssue = REASON_AFTER_PATHS.replace(
    'Issue: UTV2-1524',
    'Issue: not-an-issue',
  );
  assert.equal(parseScopeOverrideComment(badIssue), null);
});

test('accepts repository-owned WORK IDs in either documented field order', () => {
  for (const body of [REASON_BEFORE_PATHS, REASON_AFTER_PATHS]) {
    const parsed = parseScopeOverrideComment(
      body.replace('UTV2-1524', 'WORK-2026100202'),
    );
    assert.deepEqual(parsed, {
      ...parseScopeOverrideComment(body),
      issue_id: 'WORK-2026100202',
    });
  }
});

test('WORK support does not admit malformed IDs or other namespaces', () => {
  for (const issue of [
    'WORK-',
    'WORK-abc',
    'WORK-123-extra',
    'work-123',
    'UNI-123',
    'OTHER-123',
  ]) {
    assert.equal(
      parseScopeOverrideComment(REASON_AFTER_PATHS.replace('UTV2-1524', issue)),
      null,
    );
  }
});

interface Comment {
  body: string;
  user?: { login: string; type: string };
}

// Execute the deployed inline collector, so its duplicate parser cannot drift
// from the tested helper or silently relax the human authorization boundary.
async function collectWorkflowOverrides(comments: Comment[]): Promise<unknown> {
  const workflow = parseYaml(
    readFileSync(
      new URL(
        '../../.github/workflows/file-scope-lock-check.yml',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as {
    jobs: {
      check: { steps: Array<{ name: string; with?: { script?: string } }> };
    };
  };
  const script = workflow.jobs.check.steps.find((step) =>
    step.name.startsWith('Collect authorized scope-override comments'),
  )?.with?.script;
  assert.ok(script);
  let output: unknown;
  await runInNewContext(`(async () => { ${script} })()`, {
    require: (name: string) => {
      assert.equal(name, 'fs');
      return {
        mkdirSync: () => {},
        writeFileSync: (file: string, body: string) => {
          assert.equal(file, '.out/scope-overrides.json');
          output = JSON.parse(body) as unknown;
        },
      };
    },
    github: {
      paginate: async () => comments,
      rest: { issues: { listComments: () => {} } },
    },
    context: {
      repo: { owner: 'griff843', repo: 'Unit-Talk-v2' },
      payload: { pull_request: { number: 1711 } },
    },
  });
  return output;
}

test('workflow collector accepts UTV2 and WORK only from the authorized human', async () => {
  const workBody = REASON_AFTER_PATHS.replace('UTV2-1524', 'WORK-2026100202');
  const comments: Comment[] = [
    { body: REASON_AFTER_PATHS, user: { login: 'griff843', type: 'User' } },
    { body: workBody, user: { login: 'griff843', type: 'User' } },
    { body: workBody, user: { login: 'unknown-user', type: 'User' } },
    { body: workBody, user: { login: 'griff843', type: 'Bot' } },
    { body: workBody },
  ];
  assert.deepEqual(await collectWorkflowOverrides(comments), [
    {
      ...parseScopeOverrideComment(REASON_AFTER_PATHS),
      authorized_by: 'griff843',
    },
    { ...parseScopeOverrideComment(workBody), authorized_by: 'griff843' },
  ]);
});

test('workflow collector fails closed for malformed WORK overrides', async () => {
  const body = REASON_AFTER_PATHS.replace('UTV2-1524', 'WORK-2026100202');
  const invalid = [
    body.replace('WORK-2026100202', 'WORK-abc'),
    body.replace('WORK-2026100202', 'OTHER-123'),
    body.replace('schema: scope-override/v1', 'schema: scope-override/v2'),
    body.replace('PR: #1200', 'PR: invalid'),
    body.replace(/Head-SHA: .+\n/, ''),
    body.replace(/Paths:\n- path\/one.ts\n- path\/two\/\*\*\n/, ''),
  ];
  assert.deepEqual(
    await collectWorkflowOverrides(
      invalid.map((text) => ({
        body: text,
        user: { login: 'griff843', type: 'User' },
      })),
    ),
    [],
  );
});
