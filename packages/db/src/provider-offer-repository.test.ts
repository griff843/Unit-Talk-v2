import test from 'node:test';
import assert from 'node:assert/strict';

import { DatabaseProviderOfferRepository } from './runtime-repositories.js';
import type { ProviderOfferUpsertInput, ProviderOfferUpsertResult } from './repositories.js';

type ProviderOfferRepositoryHarness = {
  client: {
    from(table: string): {
      select(columns: string): {
        in(
          column: string,
          values: string[],
        ): Promise<{
          data: Array<{ idempotency_key: string }>;
          error: null;
        }>;
      };
      upsert(
        rows: Array<Record<string, unknown>>,
        options: Record<string, unknown>,
      ): Promise<{ error: null }>;
    };
  };
  upsertBatch(offers: ProviderOfferUpsertInput[]): Promise<ProviderOfferUpsertResult>;
};

test('DatabaseProviderOfferRepository.upsertBatch uses ignoreDuplicates to preserve first-write flags', async () => {
  const selectCalls: string[][] = [];
  const upsertCalls: Array<{
    rows: Array<Record<string, unknown>>;
    options: Record<string, unknown>;
  }> = [];

  const fakeClient = {
    from(table: string) {
      assert.equal(table, 'provider_offers');

      return {
        select(columns: string) {
          assert.equal(columns, 'idempotency_key');
          return {
            async in(column: string, values: string[]) {
              assert.equal(column, 'idempotency_key');
              selectCalls.push(values);
              return {
                data: [{ idempotency_key: 'dup-key' }],
                error: null,
              };
            },
          };
        },
        async upsert(rows: Array<Record<string, unknown>>, options: Record<string, unknown>) {
          upsertCalls.push({ rows, options });
          return {
            error: null,
          };
        },
      };
    },
  };

  const repository = Object.create(
    DatabaseProviderOfferRepository.prototype,
  ) as unknown as ProviderOfferRepositoryHarness;
  repository.client = fakeClient;

  const offers: ProviderOfferUpsertInput[] = [
    {
      providerKey: 'sgo',
      providerEventId: 'evt-1',
      providerMarketKey: 'points-all-game-ou',
      providerParticipantId: null,
      sportKey: 'NBA',
      line: 220.5,
      overOdds: -110,
      underOdds: -110,
      devigMode: 'PAIRED',
      isOpening: true,
      isClosing: false,
      snapshotAt: '2026-04-06T17:15:06.008Z',
      idempotencyKey: 'dup-key',
      bookmakerKey: 'pinnacle',
    },
    {
      providerKey: 'sgo',
      providerEventId: 'evt-1',
      providerMarketKey: 'points-all-game-ou',
      providerParticipantId: null,
      sportKey: 'NBA',
      line: 220.5,
      overOdds: -110,
      underOdds: -110,
      devigMode: 'PAIRED',
      isOpening: false,
      isClosing: true,
      snapshotAt: '2026-04-06T17:15:06.008Z',
      idempotencyKey: 'dup-key',
      bookmakerKey: 'pinnacle',
    },
  ];

  const result = await repository.upsertBatch(offers);

  assert.deepEqual(selectCalls, [['dup-key']]);
  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(upsertCalls[0]?.options, {
    onConflict: 'idempotency_key',
    ignoreDuplicates: true,
  });
  assert.equal(upsertCalls[0]?.rows.length, 1);
  assert.equal(upsertCalls[0]?.rows[0]?.idempotency_key, 'dup-key');
  assert.equal(upsertCalls[0]?.rows[0]?.is_opening, false);
  assert.equal(upsertCalls[0]?.rows[0]?.is_closing, true);
  assert.deepEqual(result, {
    insertedCount: 0,
    updatedCount: 1,
    totalProcessed: 1,
  });
});
