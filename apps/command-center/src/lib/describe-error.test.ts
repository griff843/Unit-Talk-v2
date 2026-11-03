import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeOperatorFailure, describeThrown } from './describe-error.js';

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

const failures: Array<[unknown, string]> = [
  [{ code: '42501' }, 'Access to this data was refused. Ask an administrator to check your access.'],
  [{ status: 403 }, 'Access to this data was refused. Ask an administrator to check your access.'],
  [{ status: 401 }, 'Your session could not be verified. Sign in again, then retry.'],
  [{ code: 'PGRST301' }, 'Your session could not be verified. Sign in again, then retry.'],
  [{ code: '57014' }, 'This data took too long to load. Retry; if it continues, contact support.'],
  [new Error('statement timeout'), 'This data took too long to load. Retry; if it continues, contact support.'],
  ['request timed out', 'This data took too long to load. Retry; if it continues, contact support.'],
  [new TypeError('fetch failed'), 'The data service could not be reached. Retry; if it continues, contact support.'],
  ['Failed to fetch', 'The data service could not be reached. Retry; if it continues, contact support.'],
  ['Network request failed', 'The data service could not be reached. Retry; if it continues, contact support.'],
  [null, 'Data source unavailable. Retry; if it continues, contact support.'],
];
for (const [error, expected] of failures) {
  test(`operator failure provides an action: ${JSON.stringify(error)} ${expected}`, () => {
    assert.equal(describeOperatorFailure(error), expected);
  });
}

test('operator failure never returns raw message, code, details or stack', () => {
  for (const code of ['42501', 'PGRST301', '57014', 'XX999']) {
    const error = { code, message: 'secret database relation internal_table', details: 'secret details', stack: 'at secret stack frame' };
    const text = describeOperatorFailure(error);
    for (const raw of Object.values(error)) assert.ok(!text.includes(raw));
    assert.match(text, /administrator|Sign in|Retry/);
    assert.ok(describeThrown(error).includes(error.message));
    assert.ok(describeThrown(error).includes(code));
  }
  assert.equal(describeOperatorFailure({}, 'Canonical pick state could not be loaded.'),
    'Canonical pick state could not be loaded. Retry; if it continues, contact support.');
});
