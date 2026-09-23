import test from 'node:test';
import assert from 'node:assert/strict';

import { readApiErrorMessage } from './api-error.js';

test('reads the message the API nests under error', () => {
  assert.equal(
    readApiErrorMessage(
      {
        ok: false,
        error: {
          code: 'SETTLEMENT_ALREADY_RECORDED',
          message: 'Pick p1 already carries a settlement for source operator that this request did not write.',
        },
      },
      409,
    ),
    'Pick p1 already carries a settlement for source operator that this request did not write.',
  );
});

test('falls back to a top-level message when one is present', () => {
  assert.equal(readApiErrorMessage({ message: 'upstream said no' }, 502), 'upstream said no');
});

test('the nested message wins over a top-level one', () => {
  assert.equal(
    readApiErrorMessage({ message: 'outer', error: { message: 'inner' } }, 400),
    'inner',
  );
});

test('an unreadable body falls back to the status, never to an empty string', () => {
  for (const body of [{}, null, 'text', { error: 'flat' }, { error: { message: '' } }, { error: { message: 42 } }]) {
    assert.equal(readApiErrorMessage(body, 500), 'API error 500');
  }
});
