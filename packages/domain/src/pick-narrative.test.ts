import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePickNarrative } from './pick-narrative.js';
import type { PickNarrativeInput } from './pick-narrative.js';

const qualifiedBase: PickNarrativeInput = {
  qualified: true,
  target: 'best-bets',
  score: 82,
  breakdown: { edge: 85, trust: 80, readiness: 88, uniqueness: 75, boardFit: 82 },
  edgeSourceQuality: 'market-backed',
  edgeSource: 'consensus-edge',
  market: 'player points over',
  sport: 'NBA',
  suppressionReasons: [],
  minimumScore: 65,
};

test('qualified: includes edge phrase, trust, score, and target', () => {
  const narrative = generatePickNarrative(qualifiedBase);
  assert.ok(narrative.includes('market-backed consensus edge'), `got: ${narrative}`);
  assert.ok(narrative.includes('trust'), `got: ${narrative}`);
  assert.ok(narrative.includes('82'), `got: ${narrative}`);
  assert.ok(narrative.includes('Best Bets'), `got: ${narrative}`);
});

test('qualified: SGO edge source produces SGO label', () => {
  const narrative = generatePickNarrative({ ...qualifiedBase, edgeSource: 'sgo-edge' });
  assert.ok(narrative.includes('SGO'), `got: ${narrative}`);
});

test('qualified: explicit edge source', () => {
  const narrative = generatePickNarrative({ ...qualifiedBase, edgeSourceQuality: 'explicit', edgeSource: 'explicit' });
  assert.ok(narrative.includes('explicit model edge'), `got: ${narrative}`);
});

test('qualified: confidence-fallback edge source', () => {
  const narrative = generatePickNarrative({ ...qualifiedBase, edgeSourceQuality: 'confidence-fallback', edgeSource: 'confidence-delta' });
  assert.ok(narrative.includes('confidence-derived'), `got: ${narrative}`);
});

test('qualified: exclusive-insights target', () => {
  const narrative = generatePickNarrative({ ...qualifiedBase, target: 'exclusive-insights' });
  assert.ok(narrative.includes('Exclusive Insights'), `got: ${narrative}`);
});

test('suppressed: board cap reason', () => {
  const narrative = generatePickNarrative({
    ...qualifiedBase,
    qualified: false,
    target: undefined,
    suppressionReasons: ['board cap for the sport has been reached'],
  });
  assert.ok(narrative.includes('board capacity limit'), `got: ${narrative}`);
  assert.ok(narrative.includes('Requeue'), `got: ${narrative}`);
});

test('suppressed: score below threshold', () => {
  const narrative = generatePickNarrative({
    ...qualifiedBase,
    qualified: false,
    target: undefined,
    score: 58,
    breakdown: { edge: 40, trust: 70, readiness: 72, uniqueness: 65, boardFit: 68 },
    suppressionReasons: ['promotion score 58.00 is below threshold 65.00'],
  });
  assert.ok(narrative.includes('58'), `got: ${narrative}`);
  assert.ok(narrative.includes('threshold'), `got: ${narrative}`);
  assert.ok(narrative.includes('edge'), `got: ${narrative}`);
});

test('suppressed: gate failure', () => {
  const narrative = generatePickNarrative({
    ...qualifiedBase,
    qualified: false,
    target: undefined,
    suppressionReasons: ['pick is stale'],
  });
  assert.ok(narrative.includes('Blocked'), `got: ${narrative}`);
  assert.ok(narrative.includes('stale'), `got: ${narrative}`);
});

test('suppressed: no reasons falls back to score line', () => {
  const narrative = generatePickNarrative({
    ...qualifiedBase,
    qualified: false,
    target: undefined,
    score: 60,
    suppressionReasons: [],
    minimumScore: 65,
  });
  assert.ok(narrative.includes('60'), `got: ${narrative}`);
  assert.ok(narrative.includes('65'), `got: ${narrative}`);
});

test('narrative is always a non-empty string', () => {
  const inputs: PickNarrativeInput[] = [
    qualifiedBase,
    { ...qualifiedBase, qualified: false, target: undefined, suppressionReasons: ['some reason'] },
    { ...qualifiedBase, market: undefined, sport: undefined },
  ];
  for (const input of inputs) {
    const result = generatePickNarrative(input);
    assert.ok(typeof result === 'string' && result.length > 0, `empty narrative for ${JSON.stringify(input)}`);
  }
});
