import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyDerivedTier,
  classifyMechanicalMinimum,
  maxTier,
  parseLaneTier,
} from './tier-classifier.js';
import {
  TIER_C_EXACT_PATHS,
  TIER_C_PATH_PREFIXES,
  isTierCPath,
} from './merge-risk.js';

test('docs/06_status lane files stay at declared tier with no mechanical escalation', () => {
  const result = classifyDerivedTier({
    declaredTier: 'T2',
    changedFiles: ['docs/06_status/lanes/UTV2-1514.json'],
  });

  assert.equal(result.mechanical_minimum, 'T3');
  assert.equal(result.derived_tier, 'T2');
  assert.equal(result.escalated, false);
  assert.equal(result.advisory.conclusion, 'success');
});

test('migrations force a T1 mechanical minimum', () => {
  const result = classifyDerivedTier({
    declaredTier: 'T3',
    changedFiles: ['supabase/migrations/0123_add_column.sql'],
  });

  assert.equal(result.mechanical_minimum, 'T1');
  assert.equal(result.derived_tier, 'T1');
  assert.equal(result.escalated, true);
});

test('domain, contracts, and worker paths force T1 through shared prefixes', () => {
  const result = classifyMechanicalMinimum([
    'packages/domain/src/models/scoring.ts',
    'packages/contracts/src/submission.ts',
    'apps/worker/src/delivery-adapter.ts',
  ]);

  assert.equal(result.mechanicalMinimum, 'T1');
  assert.deepStrictEqual(
    result.matches.map((match) => match.rule_id),
    ['tier-c-prefix', 'tier-c-prefix', 'tier-c-prefix'],
  );
});

test('env and config paths force T1', () => {
  const result = classifyMechanicalMinimum([
    '.env.example',
    'local.env',
    'packages/config/src/env.ts',
  ]);

  assert.equal(result.mechanicalMinimum, 'T1');
  assert.equal(result.matches.length, 3);
});

test('declared T1 is never downgraded by a T3-only diff', () => {
  const result = classifyDerivedTier({
    declaredTier: 'T1',
    changedFiles: ['scripts/ci/some-helper.ts'],
  });

  assert.equal(result.mechanical_minimum, 'T3');
  assert.equal(result.derived_tier, 'T1');
  assert.equal(result.escalated, false);
});

test('multi-path diff takes the maximum tier across all matches', () => {
  const result = classifyDerivedTier({
    declaredTier: 'T3',
    changedFiles: [
      'apps/command-center/src/Widget.tsx',
      'packages/domain/src/features/opportunity.ts',
    ],
  });

  assert.equal(result.mechanical_minimum, 'T1');
  assert.equal(result.derived_tier, 'T1');
  assert.equal(result.matches.length, 1);
});

test('governance docs and merge-gate workflow force T1', () => {
  const result = classifyMechanicalMinimum([
    'docs/05_operations/DELEGATION_POLICY.md',
    'docs/05_operations/MECHANICAL_TIER_CLASSIFIER_SPEC.md',
    '.github/workflows/merge-gate.yml',
  ]);

  assert.equal(result.mechanicalMinimum, 'T1');
  assert.equal(result.matches.length, 3);
});

test('unmatched application path defaults to T3 and preserves declared tier', () => {
  const result = classifyDerivedTier({
    declaredTier: 'T2',
    changedFiles: ['apps/command-center/src/Widget.tsx'],
  });

  assert.equal(result.mechanical_minimum, 'T3');
  assert.equal(result.derived_tier, 'T2');
});

test('test-only ops files do not trigger the orchestration implementation pattern', () => {
  const result = classifyDerivedTier({
    declaredTier: 'T2',
    changedFiles: ['scripts/ops/tier-classifier.test.ts', 'scripts/ops/merge-risk.test.ts'],
  });

  assert.equal(result.mechanical_minimum, 'T3');
  assert.equal(result.derived_tier, 'T2');
});

test('invalid declared tier is rejected instead of masked', () => {
  assert.throws(() => parseLaneTier('tier:T4'), /Invalid tier/);
  assert.equal(parseLaneTier('tier:T2'), 'T2');
});

test('shared Tier C constants cover classifier-sensitive runtime paths', () => {
  assert.equal(TIER_C_EXACT_PATHS.has('apps/api/src/submission-service.ts'), true);
  assert.equal(TIER_C_EXACT_PATHS.has('apps/api/src/settlement-service.ts'), true);
  assert.equal(TIER_C_PATH_PREFIXES.includes('supabase/migrations/'), true);
  assert.equal(TIER_C_PATH_PREFIXES.includes('packages/domain/src/'), true);
  assert.equal(TIER_C_PATH_PREFIXES.includes('packages/contracts/src/'), true);
  assert.equal(TIER_C_PATH_PREFIXES.includes('apps/worker/'), true);
  assert.equal(isTierCPath('apps/api/src/grading-service.ts'), true);
});

test('tier classifier source does not redeclare Tier C exact or prefix path lists', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts/ops/tier-classifier.ts'), 'utf8');

  assert.doesNotMatch(source, /new Set\(\[/u);
  assert.doesNotMatch(source, /supabase\/migrations\/.*packages\/contracts\/src\//su);
  assert.match(source, /from '\.\/merge-risk\.js'/u);
});

test('advisory-first escalation is neutral, not failing', () => {
  const result = classifyDerivedTier({
    declaredTier: 'T3',
    changedFiles: ['packages/domain/src/models/scoring.ts'],
  });

  assert.equal(result.escalated, true);
  assert.equal(result.advisory.conclusion, 'neutral');
  assert.match(result.advisory.message, /Advisory-only/);
});

test('maxTier preserves monotonic tier ordering', () => {
  assert.equal(maxTier('T3', 'T1'), 'T1');
  assert.equal(maxTier('T2', 'T3'), 'T2');
  assert.equal(maxTier('T1', 'T3'), 'T1');
});
