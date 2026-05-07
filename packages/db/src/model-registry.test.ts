import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InMemoryExperimentLedgerRepository,
  InMemoryModelRegistryRepository,
  createModelRegistryRepositories,
} from './runtime-repositories.js';

test('model registry create() returns a staged record with correct fields', async () => {
  const repository = new InMemoryModelRegistryRepository();

  const record = await repository.create({
    modelName: 'nba-spread',
    version: 'v1',
    sport: 'NBA',
    marketFamily: 'spread',
    registryEntityType: 'champion_model',
    sourceTypeCompatibility: ['board-construction'],
    activeState: 'draft',
    metadata: { owner: 'mp' },
  });

  assert.equal(record.model_name, 'nba-spread');
  assert.equal(record.version, 'v1');
  assert.equal(record.sport, 'NBA');
  assert.equal(record.market_family, 'spread');
  assert.equal(record.status, 'staged');
  assert.equal(record.champion_since, null);
  assert.deepEqual(record.metadata, { owner: 'mp' });
  assert.equal(record.registry_entity_type, 'champion_model');
  assert.deepEqual(record.source_type_compatibility, ['board-construction']);
  assert.equal(record.active_state, 'draft');
});

test('model registry findChampion() returns null when no champion exists', async () => {
  const repository = new InMemoryModelRegistryRepository();

  const champion = await repository.findChampion('NBA', 'spread');

  assert.equal(champion, null);
});

test("model registry updateStatus(id, 'champion') sets status and champion_since", async () => {
  const repository = new InMemoryModelRegistryRepository();
  const record = await repository.create({
    modelName: 'nba-total',
    version: 'v1',
    sport: 'NBA',
    marketFamily: 'total',
  });

  const updated = await repository.updateStatus(record.id, 'champion');

  assert.equal(updated.status, 'champion');
  assert.ok(updated.champion_since);
});

test('model registry findChampion() returns the promoted champion', async () => {
  const repository = new InMemoryModelRegistryRepository();
  const record = await repository.create({
    modelName: 'mlb-moneyline',
    version: 'v2',
    sport: 'MLB',
    marketFamily: 'moneyline',
  });

  await repository.updateStatus(record.id, 'champion');
  const champion = await repository.findChampion('MLB', 'moneyline');

  assert.ok(champion);
  assert.equal(champion.id, record.id);
  assert.equal(champion.status, 'champion');
});

test('model registry findChampion() honors source compatibility when provided', async () => {
  const repository = new InMemoryModelRegistryRepository();
  await repository.create({
    modelName: 'nba-spread',
    version: 'v1',
    sport: 'NBA',
    marketFamily: 'spread',
    status: 'champion',
    registryEntityType: 'champion_model',
    sourceTypeCompatibility: ['system-pick-scanner'],
    activeState: 'champion',
  });

  const incompatible = await repository.findChampion('NBA', 'spread', 'board-construction');
  const compatible = await repository.findChampion('NBA', 'spread', 'system-pick-scanner');

  assert.equal(incompatible, null);
  assert.ok(compatible);
  assert.equal(compatible.source_type_compatibility?.[0], 'system-pick-scanner');
});

test('promoting a second champion archives the old champion for the same slot', async () => {
  const repository = new InMemoryModelRegistryRepository();
  const first = await repository.create({
    modelName: 'nba-spread',
    version: 'v1',
    sport: 'NBA',
    marketFamily: 'spread',
    status: 'champion',
  });
  const second = await repository.create({
    modelName: 'nba-spread',
    version: 'v2',
    sport: 'NBA',
    marketFamily: 'spread',
  });

  const promoted = await repository.updateStatus(second.id, 'champion');
  const currentChampion = await repository.findChampion('NBA', 'spread');
  const archivedFirst = await repository.findById(first.id);

  assert.equal(promoted.status, 'champion');
  assert.ok(promoted.champion_since);
  assert.ok(currentChampion);
  assert.equal(currentChampion.id, second.id);
  assert.ok(archivedFirst);
  assert.equal(archivedFirst.status, 'archived');
  assert.equal(archivedFirst.champion_since, null);
});

test('experiment ledger create() creates a running experiment linked to a model', async () => {
  const modelRepository = new InMemoryModelRegistryRepository();
  const experimentRepository = new InMemoryExperimentLedgerRepository();
  const model = await modelRepository.create({
    modelName: 'nfl-total',
    version: 'v1',
    sport: 'NFL',
    marketFamily: 'total',
  });

  const record = await experimentRepository.create({
    modelId: model.id,
    runType: 'training',
    sport: 'NFL',
    marketFamily: 'total',
    notes: 'initial train',
  });

  assert.equal(record.model_id, model.id);
  assert.equal(record.run_type, 'training');
  assert.equal(record.status, 'running');
  assert.equal(record.notes, 'initial train');
  assert.deepEqual(record.metrics, {});
});

test("experiment ledger complete() sets status='completed' and stores metrics", async () => {
  const repository = new InMemoryExperimentLedgerRepository();
  const record = await repository.create({
    modelId: 'model-1',
    runType: 'eval',
    sport: 'NBA',
    marketFamily: 'spread',
  });

  const completed = await repository.complete(record.id, { roi: 0.18, sampleSize: 240 });

  assert.equal(completed.status, 'completed');
  assert.ok(completed.finished_at);
  assert.deepEqual(completed.metrics, { roi: 0.18, sampleSize: 240 });
});

test("experiment ledger fail() sets status='failed'", async () => {
  const repository = new InMemoryExperimentLedgerRepository();
  const record = await repository.create({
    modelId: 'model-2',
    runType: 'backtest',
    sport: 'NBA',
    marketFamily: 'spread',
  });

  const failed = await repository.fail(record.id, 'timeout');

  assert.equal(failed.status, 'failed');
  assert.ok(failed.finished_at);
  assert.equal(failed.notes, 'timeout');
});

test('experiment ledger listByModelId() returns all experiments for a model', async () => {
  const repository = new InMemoryExperimentLedgerRepository();

  const first = await repository.create({
    modelId: 'model-3',
    runType: 'training',
    sport: 'MLB',
    marketFamily: 'moneyline',
  });
  const second = await repository.create({
    modelId: 'model-3',
    runType: 'eval',
    sport: 'MLB',
    marketFamily: 'moneyline',
  });
  await repository.create({
    modelId: 'model-4',
    runType: 'calibration',
    sport: 'MLB',
    marketFamily: 'moneyline',
  });

  const records = await repository.listByModelId('model-3');

  assert.equal(records.length, 2);
  assert.deepEqual(
    records.map((record) => record.id),
    [first.id, second.id],
  );
});

test('createModelRegistryRepositories() returns in-memory repositories when no client is provided', async () => {
  const repositories = createModelRegistryRepositories();

  const model = await repositories.modelRegistry.create({
    modelName: 'nhl-total',
    version: 'v1',
    sport: 'NHL',
    marketFamily: 'total',
  });
  const experiment = await repositories.experimentLedger.create({
    modelId: model.id,
    runType: 'training',
    sport: 'NHL',
    marketFamily: 'total',
  });

  assert.equal(model.status, 'staged');
  assert.equal(experiment.status, 'running');
});
