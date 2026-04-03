import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryModelHealthSnapshotRepository } from './runtime-repositories.js';

test('create() returns record with alert_level=none by default', async () => {
  const repository = new InMemoryModelHealthSnapshotRepository();

  const record = await repository.create({
    modelId: 'model-1',
    sport: 'NBA',
    marketFamily: 'spread',
  });

  assert.equal(record.alert_level, 'none');
});

test('findLatestByModel() returns null when empty', async () => {
  const repository = new InMemoryModelHealthSnapshotRepository();

  const record = await repository.findLatestByModel('model-1');

  assert.equal(record, null);
});

test('findLatestByModel() returns most recent by snapshot_at', async () => {
  const repository = new InMemoryModelHealthSnapshotRepository();

  await repository.create({
    modelId: 'model-1',
    sport: 'NBA',
    marketFamily: 'spread',
    alertLevel: 'warning',
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const later = await repository.create({
    modelId: 'model-1',
    sport: 'NBA',
    marketFamily: 'spread',
    alertLevel: 'critical',
  });

  const latest = await repository.findLatestByModel('model-1');

  assert.ok(latest);
  assert.equal(latest.id, later.id);
});

test('listByModel() returns all snapshots sorted descending by snapshot_at', async () => {
  const repository = new InMemoryModelHealthSnapshotRepository();

  const first = await repository.create({
    modelId: 'model-1',
    sport: 'NBA',
    marketFamily: 'spread',
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = await repository.create({
    modelId: 'model-1',
    sport: 'NBA',
    marketFamily: 'spread',
  });

  const records = await repository.listByModel('model-1');

  assert.deepEqual(
    records.map((record) => record.id),
    [second.id, first.id],
  );
});

test('listAlerted() with no arg returns only non-none records', async () => {
  const repository = new InMemoryModelHealthSnapshotRepository();

  await repository.create({
    modelId: 'model-1',
    sport: 'NBA',
    marketFamily: 'spread',
  });
  const warning = await repository.create({
    modelId: 'model-1',
    sport: 'NBA',
    marketFamily: 'spread',
    alertLevel: 'warning',
  });
  const critical = await repository.create({
    modelId: 'model-2',
    sport: 'NFL',
    marketFamily: 'total',
    alertLevel: 'critical',
  });

  const records = await repository.listAlerted();

  assert.equal(records.length, 2);
  assert.deepEqual(
    new Set(records.map((record) => record.id)),
    new Set([warning.id, critical.id]),
  );
});

test("listAlerted('critical') returns only critical records", async () => {
  const repository = new InMemoryModelHealthSnapshotRepository();

  await repository.create({
    modelId: 'model-1',
    sport: 'NBA',
    marketFamily: 'spread',
    alertLevel: 'warning',
  });
  const critical = await repository.create({
    modelId: 'model-2',
    sport: 'NFL',
    marketFamily: 'total',
    alertLevel: 'critical',
  });

  const records = await repository.listAlerted('critical');

  assert.equal(records.length, 1);
  assert.equal(records[0]?.id, critical.id);
});
