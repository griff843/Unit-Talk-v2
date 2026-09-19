import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  applyPickPopulation,
  filterDeliveryTargetPopulation,
  GOVERNED_POPULATION_METADATA_PATH,
  governedOutboxTargetListLiteral,
  governedOutboxTargets,
  hasGovernedPopulationMetadata,
  isGovernedOutboxTarget,
  isHistoricalDeadLetter,
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

// Resolve from this file, never from process.cwd(): the package test script runs
// with cwd = apps/command-center while a repo-root run has cwd = the repo root, so
// a cwd-relative path silently reads a different file -- or none -- depending on
// which command invoked the suite.
const LIB_DIR = dirname(fileURLToPath(import.meta.url));

test('discovery and performance import the shared predicate instead of re-expressing it', () => {
  const root = LIB_DIR;
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
  const analytics = readFileSync(join(LIB_DIR, 'data/analytics.ts'), 'utf8');
  const picksReads = analytics.match(/\.from\('picks'\)/g) ?? [];
  const governedReads = analytics.match(/applyPickPopulation\(/g) ?? [];
  assert.equal(picksReads.length, governedReads.length,
    `${picksReads.length} picks reads but ${governedReads.length} governed predicates`);
  assert.equal(analytics.includes("picksMap.get(pickId) ?? {}"), false);
});

test('outbox membership delegates to the shared governed delivery predicate', () => {
  assert.equal(isGovernedOutboxTarget('discord:best-bets'), true);
  assert.equal(isGovernedOutboxTarget('discord:official-picks'), true);
  assert.equal(isGovernedOutboxTarget('discord:trader-insights'), true);
  assert.equal(isGovernedOutboxTarget('discord:canary'), false);
  assert.equal(isGovernedOutboxTarget('discord:123456'), false);
  assert.equal(isGovernedOutboxTarget(null), false);

  const rows = [
    { target: 'discord:best-bets' },
    { target: 'discord:canary' },
    { target: 'discord:official-picks' },
  ];
  assert.deepEqual(filterDeliveryTargetPopulation(rows, 'governed'), [rows[0], rows[2]]);
  assert.deepEqual(filterDeliveryTargetPopulation(rows, 'non-governed'), [rows[1]]);
});

test('only recent dead letters remain live delivery exceptions', () => {
  const nowMs = Date.parse('2026-09-19T20:00:00.000Z');
  assert.equal(isHistoricalDeadLetter({ status: 'dead_letter', updated_at: '2026-07-30T12:00:00.000Z' }, nowMs), true);
  assert.equal(isHistoricalDeadLetter({ status: 'dead_letter', updated_at: '2026-09-19T19:30:00.000Z' }, nowMs), false);
  assert.equal(isHistoricalDeadLetter({ status: 'failed', updated_at: '2026-07-30T12:00:00.000Z' }, nowMs), false);
});

test('exceptions data and UI keep governed operations separate from diagnostic rows', () => {
  const picks = readFileSync(join(LIB_DIR, 'data/picks.ts'), 'utf8');
  const exceptionsPage = readFileSync(join(LIB_DIR, '../app/exceptions/page.tsx'), 'utf8');

  assert.match(picks, /filterDeliveryTargetPopulation\([^\n]*'governed'/);
  assert.match(picks, /historicalDeadLetter/);
  assert.match(picks, /getNonGovernedDeliveryRows/);
  assert.match(exceptionsPage, /Show non-governed delivery rows/);
  assert.match(exceptionsPage, /Non-governed delivery rows — diagnostic only/);
  assert.match(exceptionsPage, /No live governed delivery exceptions\. This is an empty queue/);
});

test('the governed outbox target list is derived from the contracts registry, not re-typed', () => {
  assert.deepEqual([...governedOutboxTargets].sort(), [
    'discord:best-bets',
    'discord:exclusive-insights',
    'discord:official-picks',
    'discord:trader-insights',
  ].sort());
  // Every enumerated literal must satisfy the predicate, and the predicate must
  // reject everything outside it — otherwise the query partition and the
  // in-memory partition could disagree on the same row.
  for (const target of governedOutboxTargets) assert.equal(isGovernedOutboxTarget(target), true);
  const literal = governedOutboxTargetListLiteral();
  for (const target of governedOutboxTargets) assert.ok(literal.includes(`"${target}"`));
});

test('negative control: synthetic and canary residue cannot enter the governed delivery population', () => {
  // The exact target values measured in production 2026-09-19 on the 3,984
  // non-governed rows, including the four stranded `utv2-1497-canary-*`
  // processing rows that must be preserved as evidence and must never appear
  // as an operator exception.
  const residue = [
    { target: 'discord:canary' },
    { target: 'discord:recaps' },
    { target: 'discord:1384052464189440120' },
    { target: 'utv2-1497-canary-a' },
    { target: 'utv2-1497-canary-b' },
    { target: 'utv2-1497-canary-c' },
    { target: 'utv2-1497-canary-d' },
  ];
  assert.deepEqual(filterDeliveryTargetPopulation(residue, 'governed'), []);
  assert.equal(filterDeliveryTargetPopulation(residue, 'non-governed').length, residue.length);
  // The two populations partition the input: no row is in both, none is lost.
  const mixed = [...residue, { target: 'discord:official-picks' }];
  assert.equal(
    filterDeliveryTargetPopulation(mixed, 'governed').length +
      filterDeliveryTargetPopulation(mixed, 'non-governed').length,
    mixed.length,
  );
});

test('negative control: a fixture pick is outside the governed exception population', () => {
  // `isTestFixturePick` is a heuristic blocklist of five metadata keys plus a
  // /proof/i match on `selection`. A fixture carrying none of them passes it,
  // which is why membership must be decided positively instead.
  const undetectableFixture = { metadata: { note: 'ci row' }, selection: 'Lakers -3.5' };
  assert.equal(hasGovernedPopulationMetadata(undetectableFixture), false);
  assert.equal(hasGovernedPopulationMetadata({ metadata: { distributionMode: 'track-only' } }), true);
});

test('every picks read in the exceptions data layer carries the population predicate', () => {
  const picks = readFileSync(join(LIB_DIR, 'data/picks.ts'), 'utf8');
  const body = picks.slice(picks.indexOf('export async function getExceptionQueues'));
  const exceptionQueueReads = body.match(/client\.from\('picks'\)\.select\('id, submission_id, participant_id, status,/g) ?? [];
  const governedReads = body.match(/applyPickPopulation\(client\.from\('picks'\)/g) ?? [];
  assert.equal(exceptionQueueReads.length, 3);
  assert.equal(governedReads.length, exceptionQueueReads.length,
    `${exceptionQueueReads.length} exception-queue picks reads but ${governedReads.length} governed predicates`);
  // Both outbox reads partition in the query, not only after the fact.
  const governedOutboxReads = body.match(/\.in\('target', governedOutboxTargets\)/g) ?? [];
  assert.equal(governedOutboxReads.length, 2);
});
