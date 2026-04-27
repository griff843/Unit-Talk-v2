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

type ClosingOffersHarness = {
  client: {
    from(table: string): {
      select(columns: string): {
        eq(column: string, value: boolean): {
          gte(column: string, value: string): {
            lt(column: string, value: string): {
              range(
                from: number,
                to: number,
              ): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
            };
          };
        };
      };
    };
  };
  listClosingOffers(since: string): Promise<unknown[]>;
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

test('DatabaseProviderOfferRepository.listClosingOffers paginates windowed results', async () => {
  const fixedNow = Date.parse('2026-04-27T15:30:00.000Z');
  const originalNow = Date.now;
  Date.now = () => fixedNow;

  const ltFilters: Array<{ column: string; value: string }> = [];
  const rangeCalls: Array<{ from: number; to: number }> = [];
  const firstPage = Array.from({ length: 1000 }, (_unused, index) => ({
    id: `id-${String(1000 - index).padStart(4, '0')}`,
    snapshot_at: '2026-04-27T15:15:00.000Z',
  }));

  const pages = [
    {
      data: firstPage,
      error: null,
    },
    {
      data: [
        {
          id: '90000000-0000-0000-0000-000000000000',
          snapshot_at: '2026-04-27T14:58:00.000Z',
        },
      ],
      error: null,
    },
  ];
  let pageIndex = 0;

  const fakeClient = {
    from(table: string) {
      assert.equal(table, 'provider_offers');
      return {
        select(columns: string) {
          assert.equal(columns, '*');
          return {
            eq(column: string, value: boolean) {
              assert.equal(column, 'is_closing');
              assert.equal(value, true);
              return {
                gte(gteColumn: string, gteValue: string) {
                  assert.equal(gteColumn, 'snapshot_at');
                  assert.equal(gteValue, '2026-04-27T15:00:00.000Z');
                  return {
                    lt(ltColumn: string, ltValue: string) {
                      ltFilters.push({ column: ltColumn, value: ltValue });
                      return {
                        async range(from: number, to: number) {
                          rangeCalls.push({ from, to });
                          return pages[pageIndex++] ?? { data: [], error: null };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  const repository = Object.create(
    DatabaseProviderOfferRepository.prototype,
  ) as unknown as ClosingOffersHarness;
  repository.client = fakeClient;

  try {
    const rows = await repository.listClosingOffers('2026-04-27T15:00:00.000Z');
    assert.equal(rows.length, 1001);
    assert.deepEqual(rangeCalls, [
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
    ]);
    assert.deepEqual(ltFilters, [
      { column: 'snapshot_at', value: '2026-04-27T15:30:00.000Z' },
      { column: 'snapshot_at', value: '2026-04-27T15:30:00.000Z' },
    ]);
  } finally {
    Date.now = originalNow;
  }
});

test('DatabaseProviderOfferRepository.listClosingOffers fails loudly on timeout', async () => {
  const fakeClient = {
    from(table: string) {
      assert.equal(table, 'provider_offers');
      return {
        select() {
          return {
            eq() {
              return {
                gte() {
                  return {
                    lt() {
                      return {
                        async range(_from: number, _to: number) {
                          return {
                            data: null,
                            error: { message: 'canceling statement due to statement timeout' },
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  const repository = Object.create(
    DatabaseProviderOfferRepository.prototype,
  ) as unknown as ClosingOffersHarness;
  repository.client = fakeClient;

  await assert.rejects(
    () => repository.listClosingOffers('2026-04-27T00:00:00.000Z'),
    /must fail loudly when closing data is unavailable/i,
  );
});
