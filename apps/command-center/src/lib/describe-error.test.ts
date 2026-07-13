import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeThrown } from './describe-error.js';

test('Error instances render their message', () => {
  assert.equal(describeThrown(new Error('boom')), 'boom');
});

test('PostgREST-style error objects render message/code, never [object Object]', () => {
  const out = describeThrown({ message: 'canceling statement due to statement timeout', code: '57014' });
  assert.ok(out.includes('57014'));
  assert.ok(!out.includes('[object Object]'));
});

test('objects without known keys fall back to compact JSON', () => {
  assert.equal(describeThrown({ weird: true }), '{"weird":true}');
});

test('empty objects and unserializable values degrade explicitly', () => {
  assert.equal(describeThrown({}), 'unserializable error object');
  const circular: Record<string, unknown> = {};
  circular['self'] = circular;
  assert.equal(describeThrown(circular), 'unserializable error object');
});

test('primitives pass through', () => {
  assert.equal(describeThrown('nope'), 'nope');
  assert.equal(describeThrown(42), '42');
  assert.equal(describeThrown(null), 'null');
  assert.equal(describeThrown(undefined), 'undefined');
});
