import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_REGISTRY, ScenarioRegistry } from './registry.js';

import type { ScenarioDefinition } from './types.js';

test('DEFAULT_REGISTRY contains all built-in scenarios', () => {
  assert.equal(DEFAULT_REGISTRY.getAll().length, 6);
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
    ['promotion-routing', 'settlement-resolution', 'slate-replay', 'submission-validation']
  );
});

test('registry.getByTag(tag) filters correctly', () => {
  const settlementScenarios = DEFAULT_REGISTRY.getByTag('settlement');
  assert.deepEqual(
    settlementScenarios.map(scenario => scenario.id),
    ['settlement-resolution']
  );
});

test('registry duplicate scenario registration is idempotent, not duplicated', () => {
  const registry = new ScenarioRegistry();
  const scenario: ScenarioDefinition = {
    id: 'duplicate-check',
    name: 'Duplicate Check',
    mode: 'replay',
    lifecycleStagesExpected: ['validated'],
    expectedAssertions: ['no-duplicates'],
    tags: ['registry'],
  };

  registry.register(scenario);
  registry.register({ ...scenario, name: 'Duplicate Check Replacement' });

  assert.equal(registry.getAll().length, 1);
  assert.equal(registry.get('duplicate-check')?.name, 'Duplicate Check Replacement');
});

test('registry missing scenario lookup returns undefined consistently', () => {
  const registry = new ScenarioRegistry();

  assert.equal(registry.get('missing-scenario'), undefined);
  assert.equal(registry.getFixturePath('missing-scenario'), undefined);
});
