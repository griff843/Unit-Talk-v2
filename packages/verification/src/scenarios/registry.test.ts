import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_REGISTRY } from './registry.js';

test('DEFAULT_REGISTRY contains all five built-in scenarios', () => {
  assert.equal(DEFAULT_REGISTRY.getAll().length, 5);
});

test('registry.get(id) returns the correct scenario', () => {
  const scenario = DEFAULT_REGISTRY.get('promotion-routing');
  assert.ok(scenario);
  assert.equal(scenario.name, 'Promotion Evaluation and Routing');
});

test("registry.getByMode('replay') filters correctly", () => {
  const replayScenarios = DEFAULT_REGISTRY.getByMode('replay');
  assert.deepEqual(
    replayScenarios.map(scenario => scenario.id).sort(),
    ['promotion-routing', 'settlement-resolution', 'submission-validation']
  );
});

test('registry.getByTag(tag) filters correctly', () => {
  const settlementScenarios = DEFAULT_REGISTRY.getByTag('settlement');
  assert.deepEqual(
    settlementScenarios.map(scenario => scenario.id),
    ['settlement-resolution']
  );
});
