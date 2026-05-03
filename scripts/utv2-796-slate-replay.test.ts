import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertProviderOfferWriteApproval,
  defaultPersistenceForEngine,
  parseCliOptions,
} from './utv2-796-slate-replay.ts';

test('provider-offer replay defaults to in-memory persistence', () => {
  const options = parseCliOptions(['--engine', 'provider-offer', '--action', 'replay']);

  assert.equal(options.persistence, 'in-memory');
  assert.equal(options.allowDbWrites, false);
  assert.equal(options.confirmBillingChecklist, false);
});

test('slate replay keeps database persistence as the default', () => {
  assert.equal(defaultPersistenceForEngine('slate'), 'database');
});

test('provider-offer database writes require explicit approval', () => {
  assert.throws(
    () =>
      assertProviderOfferWriteApproval({
        engine: 'provider-offer',
        persistence: 'database',
        allowDbWrites: false,
        confirmBillingChecklist: false,
      }),
    /--allow-db-writes/,
  );

  assert.throws(
    () =>
      assertProviderOfferWriteApproval({
        engine: 'provider-offer',
        persistence: 'database',
        allowDbWrites: true,
        confirmBillingChecklist: false,
      }),
    /--confirm-billing-checklist/,
  );

  assert.doesNotThrow(() =>
    assertProviderOfferWriteApproval({
      engine: 'provider-offer',
      persistence: 'database',
      allowDbWrites: true,
      confirmBillingChecklist: true,
    }),
  );
});
