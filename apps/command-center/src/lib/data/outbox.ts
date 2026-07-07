// Outbox / dispatch truth data module.
// Reads distribution_outbox + distribution_receipts (real tables, columns
// verified against packages/db/src/database.types.ts).

import { getDataClient } from './client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

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

export async function getOutboxOverview(filter: OutboxFilter = {}): Promise<OutboxOverview> {
  const client: Client = getDataClient();

  const countQueries = OUTBOX_STATUSES.map((status) =>
    client.from('distribution_outbox').select('id', { count: 'exact', head: true }).eq('status', status),
  );

  let rowQuery = client
    .from('distribution_outbox')
    .select('id, pick_id, status, target, attempt_count, last_error, next_attempt_at, claimed_at, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(100);
  if (filter.status) rowQuery = rowQuery.eq('status', filter.status);
  if (filter.target) rowQuery = rowQuery.eq('target', filter.target);

  const [countResults, rowsResult, oldestUnsentResult, targetsResult, receiptsResult] = await Promise.all([
    Promise.all(countQueries),
    rowQuery,
    client
      .from('distribution_outbox')
      .select('created_at')
      .in('status', ['pending', 'processing', 'failed'])
      .order('created_at', { ascending: true })
      .limit(1),
    client.from('distribution_outbox').select('target').order('created_at', { ascending: false }).limit(500),
    client
      .from('distribution_receipts')
      .select('id, outbox_id, channel, status, receipt_type, recorded_at')
      .order('recorded_at', { ascending: false })
      .limit(50),
  ]);

  const counts = {} as Record<OutboxStatus, number>;
  OUTBOX_STATUSES.forEach((status, index) => {
    counts[status] = countResults[index]?.count ?? 0;
  });

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

  const targets = [
    ...new Set(
      ((targetsResult.data ?? []) as Array<Record<string, unknown>>)
        .map((row) => row['target'])
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  ].sort();

  const oldestRow = ((oldestUnsentResult.data ?? []) as Array<Record<string, unknown>>)[0];

  return {
    counts,
    oldestUnsentCreatedAt: typeof oldestRow?.['created_at'] === 'string' ? oldestRow['created_at'] : null,
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
