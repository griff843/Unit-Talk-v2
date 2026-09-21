// Outbox / dispatch truth data module.
// Reads distribution_outbox + distribution_receipts (real tables, columns
// verified against packages/db/src/database.types.ts).

import { getDataClient } from './client';
import { applyOperatorPickPopulation, governedOutboxTargets } from '../governed-population';
import { assertQuerySucceeded, readAuthoritativeCount } from '../query-result';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../../../packages/db/src/database.types.js';

export const OUTBOX_STATUSES = ['pending', 'processing', 'sent', 'failed', 'dead_letter'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export interface OutboxOverviewRow {
  id: string;
  pickId: string;
  status: string;
  target: string;
  attemptCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  claimedAt: string | null;
  createdAt: string;
  updatedAt: string;
  retryEligible: boolean;
}

export interface OutboxOverview {
  counts: Record<OutboxStatus, number>;
  oldestUnsentCreatedAt: string | null;
  targets: string[];
  rows: OutboxOverviewRow[];
  recentReceipts: Array<{
    id: string;
    outboxId: string;
    channel: string | null;
    status: string;
    receiptType: string;
    recordedAt: string;
  }>;
}

export interface OutboxFilter {
  status?: string | undefined;
  target?: string | undefined;
}

function isRetryEligible(status: string, attemptCount: number): boolean {
  // dead_letter is terminal; failed rows remain worker-retryable while a
  // next attempt is still schedulable. Attempt ceiling mirrors the worker's
  // dead-letter threshold — display-only heuristic, not authority.
  return status === 'failed' && attemptCount < 5;
}

export async function getOutboxSummary(): Promise<Pick<OutboxOverview, 'counts' | 'oldestUnsentCreatedAt'>> {
  const client = (await getDataClient()) as SupabaseClient<Database>;
  const signal = AbortSignal.timeout(8_000);
  const [countResults, oldestUnsentResult] = await Promise.all([
    Promise.all(OUTBOX_STATUSES.map((status) =>
      applyOperatorPickPopulation(client.from('distribution_outbox').select('id,pick:picks!inner(id)', { count: 'exact', head: true }), 'pick')
        .in('target', governedOutboxTargets).eq('status', status).abortSignal(signal))),
    applyOperatorPickPopulation(client.from('distribution_outbox').select('created_at,pick:picks!inner(id)'), 'pick')
      .in('target', governedOutboxTargets).in('status', ['pending', 'processing', 'failed'])
      .order('created_at', { ascending: true }).limit(1).abortSignal(signal),
  ]);
  const counts = {} as Record<OutboxStatus, number>;
  OUTBOX_STATUSES.forEach((status, index) => {
    counts[status] = readAuthoritativeCount(countResults[index]!, `outbox ${status}`);
  });
  assertQuerySucceeded(oldestUnsentResult, 'oldest unsent');
  return { counts, oldestUnsentCreatedAt: oldestUnsentResult.data?.[0]?.created_at ?? null };
}

export async function getOutboxOverview(filter: OutboxFilter = {}): Promise<OutboxOverview> {
  const client = (await getDataClient()) as SupabaseClient<Database>;

  let rowQuery = applyOperatorPickPopulation(client
    .from('distribution_outbox')
    .select('id, pick_id, status, target, attempt_count, last_error, next_attempt_at, claimed_at, created_at, updated_at,pick:picks!inner(id)'), 'pick')
    .in('target', governedOutboxTargets)
    .order('updated_at', { ascending: false })
    .limit(100);
  if (filter.status) rowQuery = rowQuery.eq('status', filter.status);
  if (filter.target) rowQuery = rowQuery.eq('target', filter.target);

  const [summary, rowsResult, receiptsResult] = await Promise.all([
    getOutboxSummary(),
    rowQuery,
    applyOperatorPickPopulation(client
      .from('distribution_receipts')
      .select('id, outbox_id, channel, status, receipt_type, recorded_at,outbox:distribution_outbox!inner(target,pick:picks!inner(id))'), 'outbox.pick').in('outbox.target', governedOutboxTargets)
      .order('recorded_at', { ascending: false })
      .limit(50),
  ]);

  assertQuerySucceeded(rowsResult, 'outbox rows');
  assertQuerySucceeded(receiptsResult, 'delivery receipts');

  const rows: OutboxOverviewRow[] = ((rowsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const status = String(row['status'] ?? '');
    const attemptCount = Number(row['attempt_count'] ?? 0);
    return {
      id: String(row['id'] ?? ''),
      pickId: String(row['pick_id'] ?? ''),
      status,
      target: String(row['target'] ?? ''),
      attemptCount,
      lastError: typeof row['last_error'] === 'string' ? row['last_error'] : null,
      nextAttemptAt: typeof row['next_attempt_at'] === 'string' ? row['next_attempt_at'] : null,
      claimedAt: typeof row['claimed_at'] === 'string' ? row['claimed_at'] : null,
      createdAt: String(row['created_at'] ?? ''),
      updatedAt: String(row['updated_at'] ?? ''),
      retryEligible: isRetryEligible(status, attemptCount),
    };
  });

  const targets = [...governedOutboxTargets].sort();

  return {
    ...summary,
    targets,
    rows,
    recentReceipts: ((receiptsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row['id'] ?? ''),
      outboxId: String(row['outbox_id'] ?? ''),
      channel: typeof row['channel'] === 'string' ? row['channel'] : null,
      status: String(row['status'] ?? ''),
      receiptType: String(row['receipt_type'] ?? ''),
      recordedAt: String(row['recorded_at'] ?? ''),
    })),
  };
}
