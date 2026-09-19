import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  applyPickPopulation,
  GOVERNED_POPULATION_METADATA_PATH,
  hasGovernedPopulationMetadata,
  readPickPopulation,
  resolveGovernedPick,
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

test('a settlement whose pick is outside the governed map is dropped, not defaulted', () => {
  // picksMap is built from a query carrying applyPickPopulation, so it holds
  // governed rows only. A fixture settlement's pick_id is therefore absent.
  const picksById = new Map<string, { stake_units: number; source: string }>([
    ['governed-1', { stake_units: 3.5, source: 'smart-form' }],
  ]);

  assert.deepEqual(resolveGovernedPick(picksById, 'governed-1'), { stake_units: 3.5, source: 'smart-form' });
  assert.equal(resolveGovernedPick(picksById, 'fixture-9'), null);

  // The regression this guards: `picksMap.get(id) ?? {}` returns a truthy empty
  // object, so the fixture settlement survives every downstream check and is
  // counted with a null stake and an 'unknown' source.
  const settlements = ['governed-1', 'fixture-9'];
  const kept = settlements.filter((id) => resolveGovernedPick(picksById, id) !== null);
  assert.deepEqual(kept, ['governed-1']);
});

test('every picks read on a presented analytics surface carries the population predicate', () => {
  const analytics = readFileSync(join(process.cwd(), 'apps/command-center/src/lib/data/analytics.ts'), 'utf8');
  const picksReads = analytics.match(/\.from\('picks'\)/g) ?? [];
  const governedReads = analytics.match(/applyPickPopulation\(/g) ?? [];
  assert.equal(picksReads.length, governedReads.length,
    `${picksReads.length} picks reads but ${governedReads.length} governed predicates`);
  assert.equal(analytics.includes("picksMap.get(pickId) ?? {}"), false);
});
