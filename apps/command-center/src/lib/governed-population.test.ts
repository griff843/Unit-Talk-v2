import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  applyPickPopulation,
  GOVERNED_POPULATION_METADATA_PATH,
  hasGovernedPopulationMetadata,
  readPickPopulation,
} from './governed-population.js';

test('governed membership is positive metadata-key presence, including a null value', () => {
  assert.equal(hasGovernedPopulationMetadata({ metadata: { distributionMode: 'track-only' } }), true);
  assert.equal(hasGovernedPopulationMetadata({ metadata: { distributionMode: null } }), true);
  assert.equal(hasGovernedPopulationMetadata({ metadata: {} }), false);
  assert.equal(hasGovernedPopulationMetadata({ metadata: null }), false);
  assert.equal(hasGovernedPopulationMetadata({ metadata: [] }), false);
});

test('population control defaults to governed and only accepts the labelled fixture mode', () => {
  assert.equal(readPickPopulation(undefined), 'governed');
  assert.equal(readPickPopulation('governed'), 'governed');
  assert.equal(readPickPopulation('fixtures'), 'fixtures');
});

test('one helper emits matching positive and fixture-complement query predicates', () => {
  const calls: Array<[string, string, null] | [string, null]> = [];
  const query = {
    not(column: string, operator: string, value: null) {
      calls.push([column, operator, value]);
      return this;
    },
    is(column: string, value: null) {
      calls.push([column, value]);
      return this;
    },
  };

  assert.equal(applyPickPopulation(query, 'governed'), query);
  assert.deepEqual(calls, [[GOVERNED_POPULATION_METADATA_PATH, 'is', null]]);
  calls.length = 0;
  assert.equal(applyPickPopulation(query, 'fixtures'), query);
  assert.deepEqual(calls, [[GOVERNED_POPULATION_METADATA_PATH, null]]);
});

test('discovery and performance import the shared predicate instead of re-expressing it', () => {
  const root = join(process.cwd(), 'apps/command-center/src/lib');
  const queues = readFileSync(join(root, 'data/queues.ts'), 'utf8');
  const analytics = readFileSync(join(root, 'data/analytics.ts'), 'utf8');

  assert.match(queues, /applyPickPopulation/);
  assert.match(analytics, /applyPickPopulation/);
  assert.doesNotMatch(queues, /metadata->distributionMode/);
  assert.doesNotMatch(analytics, /metadata->distributionMode/);
});
