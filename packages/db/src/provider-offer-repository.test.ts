import test from 'node:test';
import assert from 'node:assert/strict';

import { DatabaseProviderOfferRepository } from './runtime-repositories.js';
import type {
  ProviderCycleStatusUpsertInput,
  ProviderOfferMergeResult,
  ProviderOfferStageInput,
  ProviderOfferStageResult,
  ProviderOfferUpsertInput,
  ProviderOfferUpsertResult,
} from './repositories.js';

type ProviderOfferRepositoryHarness = {
  client: {
    from(table: string): {
      select?: (columns: string) => {
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
            order(
              column: string,
              options: Record<string, unknown>,
            ): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
          };
        };
      };
    };
  };
  listClosingOffers(since: string): Promise<unknown[]>;
};

type StageBatchHarness = {
  client: {
    from(table: string): {
      select(columns: string): {
        in(column: string, values: string[]): {
          in(
            secondColumn: string,
            secondValues: string[],
          ): Promise<{
            data: Array<{ run_id: string; idempotency_key: string }>;
            error: null;
          }>;
        };
      };
      upsert(
        rows: Array<Record<string, unknown>>,
        options: Record<string, unknown>,
      ): Promise<{ data: unknown; error: null }>;
    };
  };
  stageBatch(offers: ProviderOfferStageInput[]): Promise<ProviderOfferStageResult>;
};

type MergeHarness = {
  client: {
    rpc(
      fn: string,
      args: Record<string, unknown>,
    ): Promise<{
      data: Array<{
        processed_count: number;
        merged_count: number;
        duplicate_count: number;
      }>;
      error: null;
    }>;
  };
  mergeStagedCycle(input: {
    runId: string;
    maxRows: number;
    identityStrategy: string;
  }): Promise<ProviderOfferMergeResult>;
};

type CycleStatusHarness = {
  client: {
    from(table: string): {
      upsert(row: Record<string, unknown>, options: Record<string, unknown>): {
        select(columns: string): {
          single(): Promise<{
            data: Record<string, unknown>;
            error: null;
          }>;
        };
      };
    };
  };
  upsertCycleStatus(input: ProviderCycleStatusUpsertInput): Promise<Record<string, unknown>>;
};

test('DatabaseProviderOfferRepository.upsertBatch uses ignoreDuplicates to preserve first-write flags', async () => {
  const selectCalls: string[][] = [];
  const upsertCalls: Array<{
    rows: Array<Record<string, unknown>>;
    options: Record<string, unknown>;
  }> = [];

  const fakeClient = {
    from(table: string) {
      assert.ok(
        table === 'provider_offer_current' || table === 'provider_offer_history_compact',
      );

      if (table === 'provider_offer_current') {
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
      }

      return {
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
  assert.equal(upsertCalls.length, 2);
  assert.deepEqual(upsertCalls[0]?.options, {
    onConflict: 'identity_key',
    ignoreDuplicates: true,
  });
  assert.equal(upsertCalls[0]?.rows.length, 1);
  assert.equal(upsertCalls[0]?.rows[0]?.idempotency_key, 'dup-key');
  assert.equal(upsertCalls[0]?.rows[0]?.is_opening, false);
  assert.equal(upsertCalls[0]?.rows[0]?.is_closing, true);
  assert.deepEqual(upsertCalls[1]?.options, {
    onConflict: 'snapshot_at,idempotency_key',
    ignoreDuplicates: true,
  });
  assert.equal(upsertCalls[1]?.rows.length, 1);
  assert.deepEqual(result, {
    insertedCount: 0,
    updatedCount: 1,
    totalProcessed: 1,
  });
});

test('DatabaseProviderOfferRepository.listClosingOffers reads compact closing rows ordered by snapshot', async () => {
  const orderCalls: Array<{ column: string; options: Record<string, unknown> }> = [];
  const fakeClient = {
    from(table: string) {
      assert.equal(table, 'provider_offer_history_compact');
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
                    async order(column: string, options: Record<string, unknown>) {
                      orderCalls.push({ column, options });
                      return {
                        data: [
                          {
                            id: 'id-1000',
                            snapshot_at: '2026-04-27T15:15:00.000Z',
                          },
                          {
                            id: 'id-0999',
                            snapshot_at: '2026-04-27T14:58:00.000Z',
                          },
                        ],
                        error: null,
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

  const rows = await repository.listClosingOffers('2026-04-27T15:00:00.000Z');
  assert.equal(rows.length, 2);
  assert.deepEqual(orderCalls, [
    { column: 'snapshot_at', options: { ascending: false } },
  ]);
});

test('DatabaseProviderOfferRepository.listClosingOffers fails loudly on timeout', async () => {
  const fakeClient = {
    from(table: string) {
      assert.equal(table, 'provider_offer_history_compact');
      return {
        select() {
          return {
            eq() {
              return {
                gte() {
                  return {
                    async order(_column: string, _options: Record<string, unknown>) {
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

  const repository = Object.create(
    DatabaseProviderOfferRepository.prototype,
  ) as unknown as ClosingOffersHarness;
  repository.client = fakeClient;

  await assert.rejects(
    () => repository.listClosingOffers('2026-04-27T00:00:00.000Z'),
    /Failed to list closing offers: canceling statement due to statement timeout/i,
  );
});

test('DatabaseProviderOfferRepository.stageBatch scopes idempotency to run_id plus idempotency_key', async () => {
  const upsertCalls: Array<{
    rows: Array<Record<string, unknown>>;
    options: Record<string, unknown>;
  }> = [];

  const fakeClient = {
    from(table: string) {
      assert.equal(table, 'provider_offer_staging');
      return {
        select(columns: string) {
          assert.equal(columns, 'run_id,idempotency_key');
          return {
            in(column: string, values: string[]) {
              assert.equal(column, 'run_id');
              assert.deepEqual(values, ['run-1']);
              return {
                async in(secondColumn: string, secondValues: string[]) {
                  assert.equal(secondColumn, 'idempotency_key');
                  assert.deepEqual(secondValues, ['dup-key', 'fresh-key']);
                  return {
                    data: [{ run_id: 'run-1', idempotency_key: 'dup-key' }],
                    error: null,
                  };
                },
              };
            },
          };
        },
        async upsert(rows: Array<Record<string, unknown>>, options: Record<string, unknown>) {
          upsertCalls.push({ rows, options });
          return { data: null, error: null };
        },
      };
    },
  };

  const repository = Object.create(
    DatabaseProviderOfferRepository.prototype,
  ) as unknown as StageBatchHarness;
  repository.client = fakeClient;

  const result = await repository.stageBatch([
    {
      runId: 'run-1',
      league: 'NBA',
      identityKey: 'identity-1',
      providerKey: 'sgo',
      providerEventId: 'evt-1',
      providerMarketKey: 'points-all-game-ou',
      providerParticipantId: 'player-1',
      sportKey: 'NBA',
      line: 22.5,
      overOdds: -110,
      underOdds: -110,
      devigMode: 'PAIRED',
      isOpening: true,
      isClosing: false,
      snapshotAt: '2026-04-28T12:00:00.000Z',
      idempotencyKey: 'dup-key',
      bookmakerKey: 'pinnacle',
    },
    {
      runId: 'run-1',
      league: 'NBA',
      identityKey: 'identity-2',
      providerKey: 'sgo',
      providerEventId: 'evt-1',
      providerMarketKey: 'points-all-game-ou',
      providerParticipantId: 'player-1',
      sportKey: 'NBA',
      line: 23.5,
      overOdds: -108,
      underOdds: -112,
      devigMode: 'PAIRED',
      isOpening: false,
      isClosing: false,
      snapshotAt: '2026-04-28T12:01:00.000Z',
      idempotencyKey: 'fresh-key',
      bookmakerKey: 'pinnacle',
    },
  ]);

  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(upsertCalls[0]?.options, {
    onConflict: 'run_id,idempotency_key',
    ignoreDuplicates: true,
  });
  assert.equal(upsertCalls[0]?.rows.length, 2);
  assert.equal(upsertCalls[0]?.rows[0]?.run_id, 'run-1');
  assert.equal(upsertCalls[0]?.rows[0]?.identity_key, 'identity-1');
  assert.deepEqual(result, {
    stagedCount: 1,
    duplicateCount: 1,
    totalProcessed: 2,
  });
});

test('DatabaseProviderOfferRepository.mergeStagedCycle delegates to bounded merge rpc', async () => {
  let rpcCall: { fn: string; args: Record<string, unknown> } | null = null;

  const fakeClient = {
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcCall = { fn, args };
      return {
        data: [{ processed_count: 2, merged_count: 1, duplicate_count: 1 }],
        error: null,
      };
    },
  };

  const repository = Object.create(
    DatabaseProviderOfferRepository.prototype,
  ) as unknown as MergeHarness;
  repository.client = fakeClient;

  const result = await repository.mergeStagedCycle({
    runId: 'run-merge-1',
    maxRows: 50,
    identityStrategy: 'provider_event_market_participant_book',
  });

  assert.deepEqual(rpcCall, {
    fn: 'merge_provider_offer_staging_cycle',
    args: {
      p_run_id: 'run-merge-1',
      p_max_rows: 50,
      p_identity_strategy: 'provider_event_market_participant_book',
    },
  });
  assert.deepEqual(result, {
    processedCount: 2,
    mergedCount: 1,
    duplicateCount: 1,
  });
});

test('DatabaseProviderOfferRepository.upsertCycleStatus persists freshness and proof state', async () => {
  let capturedRow: Record<string, unknown> | null = null;

  const fakeClient = {
    from(table: string) {
      assert.equal(table, 'provider_cycle_status');
      return {
        upsert(row: Record<string, unknown>, options: Record<string, unknown>) {
          capturedRow = row;
          assert.deepEqual(options, { onConflict: 'run_id' });
          return {
            select(columns: string) {
              assert.equal(columns, '*');
              return {
                async single() {
                  return {
                    data: {
                      ...row,
                      created_at: '2026-04-28T12:00:00.000Z',
                      updated_at: '2026-04-28T12:01:00.000Z',
                    },
                    error: null,
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
  ) as unknown as CycleStatusHarness;
  repository.client = fakeClient;

  const result = await repository.upsertCycleStatus({
    runId: 'run-status-1',
    providerKey: 'sgo',
    league: 'NBA',
    cycleSnapshotAt: '2026-04-28T12:00:00.000Z',
    stageStatus: 'merge_blocked',
    freshnessStatus: 'stale',
    proofStatus: 'required',
    stagedCount: 12,
    duplicateCount: 3,
    lastError: 'Freshness gate blocked merge with status=stale',
    metadata: { gate: 'freshness' },
  });

  assert.deepEqual(capturedRow, {
    run_id: 'run-status-1',
    provider_key: 'sgo',
    league: 'NBA',
    cycle_snapshot_at: '2026-04-28T12:00:00.000Z',
    stage_status: 'merge_blocked',
    freshness_status: 'stale',
    proof_status: 'required',
    staged_count: 12,
    merged_count: 0,
    duplicate_count: 3,
    failure_category: null,
    failure_scope: null,
    affected_provider_key: null,
    affected_sport_key: null,
    affected_market_key: null,
    last_error: 'Freshness gate blocked merge with status=stale',
    metadata: { gate: 'freshness' },
  });
  assert.equal(result.run_id, 'run-status-1');
  assert.equal(result.stage_status, 'merge_blocked');
});
