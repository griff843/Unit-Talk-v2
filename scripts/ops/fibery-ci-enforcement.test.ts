import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateFiberyCiEnforcement,
  isProofSensitiveFile,
  normalizeChangedFiles,
  parseLabels,
} from './fibery-ci-enforcement.js';
import type { SyncMetadata } from './fibery-sync-lib.js';

function metadata(input: Partial<SyncMetadata> = {}): SyncMetadata {
  return {
    version: 1,
    approval: {
      allow_multiple_issues: false,
      skip_sync_required: false,
      ...input.approval,
    },
    entities: {
      issues: ['UTV2-123'],
      findings: [],
      controls: [],
      proofs: [],
      ...input.entities,
    },
  };
}

test('normalizes changed file input', () => {
  assert.deepStrictEqual(normalizeChangedFiles(['apps\\api\\src\\a.ts\n./packages/db/src/b.ts']), [
    'apps/api/src/a.ts',
    'packages/db/src/b.ts',
  ]);
});

test('parses labels from csv and json forms', () => {
  assert.deepStrictEqual(parseLabels(['fibery-sync-bypass-approved, other', '["multi-issue-pr-approved"]']), [
    'fibery-sync-bypass-approved',
    'other',
    'multi-issue-pr-approved',
  ]);
});

test('fails implementation work when sync metadata is missing', () => {
  const result = evaluateFiberyCiEnforcement({
    changedFiles: ['apps/api/src/submission-service.ts'],
    syncFilePresent: false,
    metadata: null,
    referencedText: 'fix: UTV2-123',
    labels: [],
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.failures.join('\n'), /\.ops\/sync\.yml is required/);
});

test('allows missing sync metadata only with explicit bypass label', () => {
  const result = evaluateFiberyCiEnforcement({
    changedFiles: ['apps/api/src/domain-analysis-service.ts'],
    syncFilePresent: false,
    metadata: null,
    referencedText: 'fix: UTV2-123',
    labels: ['fibery-sync-bypass-approved'],
  });
  assert.strictEqual(result.ok, true);
});

test('fails multiple issue IDs without sync flag and label', () => {
  const result = evaluateFiberyCiEnforcement({
    changedFiles: ['packages/domain/src/market-key.ts'],
    syncFilePresent: true,
    metadata: metadata({ entities: { issues: ['UTV2-123', 'UTV2-124'], findings: [], controls: [], proofs: [] } }),
    referencedText: 'fix: UTV2-123 refs UTV2-124',
    labels: [],
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.failures.join('\n'), /Multiple UTV2 issue IDs/);
});

test('allows multiple issue IDs only with sync flag and approval label', () => {
  const result = evaluateFiberyCiEnforcement({
    changedFiles: ['packages/domain/src/market-key.ts'],
    syncFilePresent: true,
    metadata: metadata({
      approval: { allow_multiple_issues: true, skip_sync_required: false },
      entities: { issues: ['UTV2-123', 'UTV2-124'], findings: [], controls: [], proofs: [] },
    }),
    referencedText: 'fix: UTV2-123 refs UTV2-124',
    labels: ['multi-issue-pr-approved'],
  });
  assert.strictEqual(result.ok, true);
});

test('requires proof metadata for proof-sensitive paths', () => {
  const result = evaluateFiberyCiEnforcement({
    changedFiles: ['apps/api/src/promotion-service.ts'],
    syncFilePresent: true,
    metadata: metadata(),
    referencedText: 'fix: UTV2-123',
    labels: [],
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.failures.join('\n'), /must declare proof metadata/);
});

test('proof-sensitive matcher includes expanded script paths', () => {
  assert.strictEqual(isProofSensitiveFile('apps/api/src/scripts/utv2-123-proof.ts'), true);
  assert.strictEqual(isProofSensitiveFile('packages/db/src/scripts/utv2-123-proof.ts'), true);
});

test('passes implementation work with issue and proof metadata', () => {
  const result = evaluateFiberyCiEnforcement({
    changedFiles: ['apps/api/src/submission-service.ts', '.ops/sync.yml'],
    syncFilePresent: true,
    metadata: metadata({ entities: { issues: ['UTV2-123'], findings: [], controls: [], proofs: ['PROOF-123'] } }),
    referencedText: 'fix: UTV2-123',
    labels: [],
  });
  assert.strictEqual(result.ok, true);
});
