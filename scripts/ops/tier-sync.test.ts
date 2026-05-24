import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTierSync, extractTierLabels } from './tier-sync.js';

test('extractTierLabels normalizes supported tier labels only', () => {
  assert.deepStrictEqual(
    extractTierLabels(['tier:t1', 'kind:governance', 'tier:T2', 'tier:T4']),
    ['tier:T1', 'tier:T2'],
  );
});

test('missing PR tier label returns sync action for authoritative T1 lane', () => {
  const result = evaluateTierSync({
    issueId: 'UTV2-1200',
    manifestTier: 'T1',
    prNumber: 900,
    prLabels: ['kind:governance'],
    sync: true,
  });

  assert.deepStrictEqual(result.failures, []);
  assert.deepStrictEqual(result.actions, [
    {
      type: 'add',
      label: 'tier:T1',
      reason: 'PR #900 is missing tier:T1; applying authoritative lane tier',
    },
  ]);
});

test('missing PR tier label fails with actionable message when sync is disabled', () => {
  const result = evaluateTierSync({
    issueId: 'UTV2-1200',
    manifestTier: 'T1',
    prNumber: 900,
    prLabels: ['kind:governance'],
    sync: false,
  });

  assert.equal(result.actions[0]?.type, 'add');
  assert.match(result.failures.join('\n'), /Re-run with --sync/);
});

test('PR tier T2 but authoritative lane T1 fails closed', () => {
  const result = evaluateTierSync({
    issueId: 'UTV2-1200',
    manifestTier: 'T1',
    prNumber: 900,
    prLabels: ['tier:T2'],
    sync: true,
  });

  assert.match(result.failures.join('\n'), /Tier drift/);
  assert.match(result.failures.join('\n'), /fails closed/);
  assert.deepStrictEqual(result.actions, [
    {
      type: 'remove',
      label: 'tier:T2',
      reason: 'Remove stale GitHub evidence tier:T2; authoritative tier is tier:T1',
    },
    {
      type: 'add',
      label: 'tier:T1',
      reason: 'Apply authoritative lane tier tier:T1',
    },
  ]);
});

test('no authoritative tier fails closed even when PR has a manual tier label', () => {
  const result = evaluateTierSync({
    issueId: 'UTV2-1200',
    manifestTier: null,
    prNumber: 900,
    prLabels: ['tier:T2'],
    sync: true,
  });

  assert.match(result.failures.join('\n'), /No authoritative tier/);
  assert.match(result.failures.join('\n'), /label alone cannot authorize merge/);
  assert.deepStrictEqual(result.actions, []);
});

test('manual label alone cannot override authoritative tier', () => {
  const result = evaluateTierSync({
    issueId: 'UTV2-1200',
    manifestTier: 'T1',
    prNumber: 900,
    prLabels: ['tier:T2', 't1-approved'],
    sync: false,
  });

  assert.match(result.failures.join('\n'), /authoritative lane tier is tier:T1/);
  assert.equal(result.expectedLabel, 'tier:T1');
});

test('matching authoritative tier and PR label passes without actions', () => {
  const result = evaluateTierSync({
    issueId: 'UTV2-1200',
    manifestTier: 'T2',
    prNumber: 900,
    prLabels: ['tier:T2', 'kind:governance'],
    sync: true,
  });

  assert.deepStrictEqual(result.failures, []);
  assert.deepStrictEqual(result.actions, []);
});
