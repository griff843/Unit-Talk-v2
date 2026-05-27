import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FeatureVectorSchemaRegistry,
  createFeatureVector,
} from './feature-vector.js';

function makeRegistry() {
  const r = new FeatureVectorSchemaRegistry();
  r.register({
    name: 'stat-v1',
    version: '1.0.0',
    fields: ['opportunity', 'efficiency', 'form'],
  });
  return r;
}

test('registry: register and retrieve schema', () => {
  const r = makeRegistry();
  const schema = r.get('stat-v1', '1.0.0');
  assert.ok(schema !== null);
  assert.equal(schema.name, 'stat-v1');
  assert.equal(schema.version, '1.0.0');
  assert.deepEqual(schema.fields, ['opportunity', 'efficiency', 'form']);
  assert.ok(typeof schema.registered_at === 'string');
});

test('registry: returns null for unknown schema', () => {
  const r = new FeatureVectorSchemaRegistry();
  assert.equal(r.get('nonexistent', '1.0.0'), null);
});

test('registry: duplicate registration throws (immutability)', () => {
  const r = makeRegistry();
  assert.throws(
    () => r.register({ name: 'stat-v1', version: '1.0.0', fields: ['x'] }),
    /already registered and immutable/
  );
});

test('registry: list returns all registered schemas', () => {
  const r = makeRegistry();
  r.register({ name: 'clv-v1', version: '1.0.0', fields: ['edge'] });
  assert.equal(r.list().length, 2);
});

test('createFeatureVector: ok on valid input', () => {
  const r = makeRegistry();
  const result = createFeatureVector(r, 'stat-v1', '1.0.0', {
    opportunity: 0.8,
    efficiency: 0.7,
    form: 0.6,
  });
  assert.ok(result.ok);
  if (!result.ok) throw new Error('unreachable');
  assert.equal(result.vector.schema_name, 'stat-v1');
  assert.equal(result.vector.schema_version, '1.0.0');
  assert.deepEqual(result.vector.fields, { opportunity: 0.8, efficiency: 0.7, form: 0.6 });
  assert.ok(typeof result.vector.hash === 'string' && result.vector.hash.length === 64);
});

test('createFeatureVector: fails on unknown schema', () => {
  const r = new FeatureVectorSchemaRegistry();
  const result = createFeatureVector(r, 'missing', '1.0.0', {});
  assert.ok(!result.ok);
  if (result.ok) throw new Error('unreachable');
  assert.match(result.reason, /Unknown schema/);
});

test('createFeatureVector: fails closed on missing required fields', () => {
  const r = makeRegistry();
  const result = createFeatureVector(r, 'stat-v1', '1.0.0', {
    opportunity: 0.8,
    // efficiency and form missing
  });
  assert.ok(!result.ok);
  if (result.ok) throw new Error('unreachable');
  assert.match(result.reason, /Missing required features/);
  assert.match(result.reason, /efficiency/);
  assert.match(result.reason, /form/);
});

test('createFeatureVector: extra input fields are silently dropped', () => {
  const r = makeRegistry();
  const result = createFeatureVector(r, 'stat-v1', '1.0.0', {
    opportunity: 0.8,
    efficiency: 0.7,
    form: 0.6,
    unexpected_extra: 99,
  });
  assert.ok(result.ok);
  if (!result.ok) throw new Error('unreachable');
  assert.ok(!('unexpected_extra' in result.vector.fields));
});

test('createFeatureVector: deterministic hash — same inputs produce same hash', () => {
  const r = makeRegistry();
  const fields = { opportunity: 0.8, efficiency: 0.7, form: 0.6 };
  const r1 = createFeatureVector(r, 'stat-v1', '1.0.0', fields);
  const r2 = createFeatureVector(r, 'stat-v1', '1.0.0', fields);
  assert.ok(r1.ok && r2.ok);
  if (!r1.ok || !r2.ok) throw new Error('unreachable');
  assert.equal(r1.vector.hash, r2.vector.hash);
});

test('createFeatureVector: hash differs for different field values', () => {
  const r = makeRegistry();
  const r1 = createFeatureVector(r, 'stat-v1', '1.0.0', {
    opportunity: 0.8,
    efficiency: 0.7,
    form: 0.6,
  });
  const r2 = createFeatureVector(r, 'stat-v1', '1.0.0', {
    opportunity: 0.9,
    efficiency: 0.7,
    form: 0.6,
  });
  assert.ok(r1.ok && r2.ok);
  if (!r1.ok || !r2.ok) throw new Error('unreachable');
  assert.notEqual(r1.vector.hash, r2.vector.hash);
});

test('createFeatureVector: hash differs for different schema versions', () => {
  const r = makeRegistry();
  r.register({ name: 'stat-v1', version: '2.0.0', fields: ['opportunity', 'efficiency', 'form'] });
  const fields = { opportunity: 0.8, efficiency: 0.7, form: 0.6 };
  const r1 = createFeatureVector(r, 'stat-v1', '1.0.0', fields);
  const r2 = createFeatureVector(r, 'stat-v1', '2.0.0', fields);
  assert.ok(r1.ok && r2.ok);
  if (!r1.ok || !r2.ok) throw new Error('unreachable');
  assert.notEqual(r1.vector.hash, r2.vector.hash);
});
