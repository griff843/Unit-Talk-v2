import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryExecutionQualityRepository } from './runtime-repositories.js';

test('summarizeByProvider() returns empty when no seed data', async () => {
  const repository = new InMemoryExecutionQualityRepository();

  const reports = await repository.summarizeByProvider();

  assert.deepEqual(reports, []);
});

test('summarizeByProvider() returns all when no sport filter', async () => {
  const repository = new InMemoryExecutionQualityRepository([
    {
      providerKey: 'draftkings',
      sportKey: 'NFL',
      marketFamily: 'spread',
      sampleSize: 10,
      avgEntryLine: -110,
      avgClosingLine: -115,
      avgLineDelta: 5,
      winRate: null,
      roi: null,
    },
    {
      providerKey: 'fanduel',
      sportKey: 'NBA',
      marketFamily: 'total',
      sampleSize: 8,
      avgEntryLine: -105,
      avgClosingLine: -108,
      avgLineDelta: 3,
      winRate: null,
      roi: null,
    },
  ]);

  const reports = await repository.summarizeByProvider();

  assert.equal(reports.length, 2);
});

test("summarizeByProvider('NFL') filters to NFL only", async () => {
  const repository = new InMemoryExecutionQualityRepository([
    {
      providerKey: 'draftkings',
      sportKey: 'NFL',
      marketFamily: 'spread',
      sampleSize: 10,
      avgEntryLine: -110,
      avgClosingLine: -115,
      avgLineDelta: 5,
      winRate: null,
      roi: null,
    },
    {
      providerKey: 'fanduel',
      sportKey: 'NBA',
      marketFamily: 'total',
      sampleSize: 8,
      avgEntryLine: -105,
      avgClosingLine: -108,
      avgLineDelta: 3,
      winRate: null,
      roi: null,
    },
  ]);

  const reports = await repository.summarizeByProvider('NFL');

  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.sportKey, 'NFL');
});

test("summarizeByMarketFamily('draftkings') returns only draftkings", async () => {
  const repository = new InMemoryExecutionQualityRepository([
    {
      providerKey: 'draftkings',
      sportKey: 'NFL',
      marketFamily: 'spread',
      sampleSize: 10,
      avgEntryLine: -110,
      avgClosingLine: -115,
      avgLineDelta: 5,
      winRate: null,
      roi: null,
    },
    {
      providerKey: 'fanduel',
      sportKey: 'NFL',
      marketFamily: 'spread',
      sampleSize: 9,
      avgEntryLine: -108,
      avgClosingLine: -112,
      avgLineDelta: 4,
      winRate: null,
      roi: null,
    },
  ]);

  const reports = await repository.summarizeByMarketFamily('draftkings');

  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.providerKey, 'draftkings');
});

test('avgLineDelta computed correctly', async () => {
  const repository = new InMemoryExecutionQualityRepository([
    {
      providerKey: 'draftkings',
      sportKey: 'NFL',
      marketFamily: 'spread',
      sampleSize: 10,
      avgEntryLine: -110,
      avgClosingLine: -115,
      avgLineDelta: 5,
      winRate: null,
      roi: null,
    },
  ]);

  const reports = await repository.summarizeByMarketFamily('draftkings');

  assert.equal(reports[0]?.avgLineDelta, 5);
});
