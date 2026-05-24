import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeUntrackedScriptFiles } from './clean-scripts.js';
import { evaluateIssueReferences, extractIssueIds } from './branch-discipline-guard.js';
import { ROOT } from './shared.js';

test('migration linter flags destructive audit_log statements with file and statement context', async () => {
  const { lintMigrationContent } = await import('../lint-migrations.mjs');

  const findings = lintMigrationContent(
    [
      '-- DELETE FROM public.audit_log is mentioned in a comment only',
      'DELETE FROM public.audit_log',
      "  WHERE created_at < NOW() - INTERVAL '90 days';",
      'UPDATE audit_log SET action = action;',
      'TRUNCATE TABLE public.audit_log;',
    ].join('\n'),
    'future_bad_migration.sql',
  );

  assert.deepStrictEqual(
    findings.map((finding: { rule: string }) => finding.rule),
    ['A1', 'A1', 'A1'],
  );
  assert.deepStrictEqual(
    findings.map((finding: { file: string }) => finding.file),
    ['future_bad_migration.sql', 'future_bad_migration.sql', 'future_bad_migration.sql'],
  );
  assert.match(findings[0].statement, /DELETE FROM public\.audit_log/i);
  assert.match(findings[1].statement, /UPDATE audit_log/i);
  assert.match(findings[2].statement, /TRUNCATE TABLE public\.audit_log/i);
});

test('migration linter allows audit_log inserts and immutability triggers', async () => {
  const { lintMigrationContent } = await import('../lint-migrations.mjs');

  const findings = lintMigrationContent(
    [
      'insert into public.audit_log (id, entity_type) values (gen_random_uuid(), \'pick\');',
      'create trigger audit_log_immutable',
      '  before update or delete on public.audit_log',
      '  for each row execute function public.prevent_audit_log_mutation();',
    ].join('\n'),
    'audit_safe_migration.sql',
  );

  assert.deepStrictEqual(findings, []);
});

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

test('required PR check workflows do not create stale merge-gate contexts on opened events', () => {
  const mergeGate = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'merge-gate.yml'), 'utf8');
  const mergeGatePullRequestBlock = mergeGate.match(/pull_request:\s*\r?\n\s+types:\s*\[([^\]]+)\]/);

  assert.ok(mergeGatePullRequestBlock, 'merge-gate.yml must declare explicit pull_request types');
  assert.doesNotMatch(
    mergeGatePullRequestBlock[1] ?? '',
    /(^|,\s*)opened(\s*,|$)/,
    'merge-gate.yml must not run required checks on pull_request.opened before labels settle',
  );
});

test('tier label sync runs on opened so PM does not manually apply GitHub tier labels', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'tier-label-check.yml'), 'utf8');
  const pullRequestBlock = workflow.match(/pull_request:\s*\r?\n\s+types:\s*\[([^\]]+)\]/);

  assert.ok(pullRequestBlock, 'tier-label-check.yml must declare explicit pull_request types');
  assert.match(
    pullRequestBlock[1] ?? '',
    /(^|,\s*)opened(\s*,|$)/,
    'tier-label-check.yml must run on pull_request.opened to apply missing tier evidence automatically',
  );
});
