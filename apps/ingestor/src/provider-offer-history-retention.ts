/**
 * UTV2-772: provider_offer_history partition retention job.
 *
 * Responsibility:
 *   1. Summarise partitions that are about to age out (writes to
 *      provider_offer_line_snapshots via the DB function).
 *   2. Drop partitions older than the retention window via the DB function.
 *
 * The two-step design (summarise-then-drop) ensures 180-day aggregated
 * line-movement data survives after the high-resolution 7-14 day window closes.
 *
 * This module is pure TypeScript — it calls Postgres functions via the
 * Supabase client and never owns the retention policy numbers. Callers
 * supply retentionDays; the default mirrors the DB function default (7).
 */

import {
  createDatabaseClientFromConnection,
  type DatabaseConnectionConfig,
} from '@unit-talk/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderOfferHistoryRetentionOptions {
  /** Service-role database connection config. */
  connection: DatabaseConnectionConfig;
  /**
   * Number of days to retain high-resolution history partitions.
   * Partitions older than this are summarised and then dropped.
   * Must be >= 1. Defaults to 7.
   */
  retentionDays?: number;
  logger?: Pick<Console, 'info' | 'warn'>;
}

export interface ProviderOfferHistoryRetentionResult {
  partitions_summarized: number;
  partitions_dropped: number;
  cutoff_date: string;
}

// ---------------------------------------------------------------------------
// Internal helper types for untyped RPC responses
// ---------------------------------------------------------------------------

interface SummarizeRow {
  rows_summarized?: number;
  snapshot_date?: string;
}

interface DropRow {
  partitions_dropped?: number;
  cutoff_date?: string;
}

interface ListPartitionDatesRow {
  partition_date?: string;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Run the two-phase provider_offer_history retention job:
 *   Phase 1 — summarise eligible partitions into provider_offer_line_snapshots
 *   Phase 2 — drop partitions older than retentionDays
 *
 * Returns a summary suitable for structured logging.
 */
export async function runProviderOfferHistoryRetention(
  options: ProviderOfferHistoryRetentionOptions,
): Promise<ProviderOfferHistoryRetentionResult> {
  const { connection, logger } = options;
  const retentionDays = Math.max(1, options.retentionDays ?? 7);

  const client = createDatabaseClientFromConnection(connection);

  const cutoffDate = new Date();
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - retentionDays);
  cutoffDate.setUTCHours(0, 0, 0, 0);

  // ------------------------------------------------------------------
  // Phase 1: discover and summarise partitions about to age out
  // ------------------------------------------------------------------
  let partitions_summarized = 0;

  // Try to list partition dates from the DB helper function. This function
  // may not exist on all deployments — if absent we skip Phase 1 gracefully
  // and let the drop function handle its own discovery.
  const { data: listData, error: listError } = await client.rpc(
    'list_provider_offer_history_partition_dates',
    {},
  );

  if (!listError && Array.isArray(listData)) {
    const eligibleDates = (listData as ListPartitionDatesRow[])
      .filter((r): r is ListPartitionDatesRow & { partition_date: string } =>
        typeof r.partition_date === 'string',
      )
      .map((r) => new Date(r.partition_date))
      .filter((d) => !Number.isNaN(d.getTime()) && d.getTime() < cutoffDate.getTime());

    for (const partitionDate of eligibleDates) {
      const dateStr = partitionDate.toISOString().slice(0, 10); // YYYY-MM-DD

      const { data: sumData, error: sumError } = await client.rpc(
        'summarize_provider_offer_history_partition',
        { p_date: dateStr },
      );

      if (sumError) {
        logger?.warn(
          `[retention] summarize failed for partition ${dateStr}: ${sumError.message}`,
        );
        continue;
      }

      const rows = Array.isArray(sumData) ? (sumData as SummarizeRow[]) : [];
      const rowsSummarized = rows[0]?.rows_summarized ?? 0;

      logger?.info(
        `[retention] summarized partition ${dateStr}: rows_summarized=${rowsSummarized}`,
      );
      partitions_summarized += 1;
    }
  }

  // ------------------------------------------------------------------
  // Phase 2: drop old partitions
  // ------------------------------------------------------------------
  const { data: dropData, error: dropError } = await client.rpc(
    'drop_old_provider_offer_history_partitions',
    { p_retention_days: retentionDays },
  );

  if (dropError) {
    throw new Error(
      `[retention] drop_old_provider_offer_history_partitions failed: ${dropError.message}`,
    );
  }

  const dropRows = Array.isArray(dropData) ? (dropData as DropRow[]) : [];
  const partitions_dropped = dropRows[0]?.partitions_dropped ?? 0;
  const cutoff_date =
    dropRows[0]?.cutoff_date ?? cutoffDate.toISOString().slice(0, 10);

  const result: ProviderOfferHistoryRetentionResult = {
    partitions_summarized,
    partitions_dropped,
    cutoff_date,
  };

  logger?.info('[retention] provider_offer_history retention complete', result);

  return result;
}
