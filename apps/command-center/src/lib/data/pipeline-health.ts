import { loadEnvironment } from '../../../../../packages/config/dist/env.js';
import type {
  OutboxRecord,
  PickRecord,
  ReceiptRecord,
  SubmissionRecord,
  SystemRunRecord,
} from '../../../../../packages/db/dist/types.js';
import { createDatabaseConnectionConfig, type DatabaseConnectionConfig } from './client';

import { getDataClient } from './client';
import { fetchObservedRuns } from './snapshot';
import {
  createPipelineLiveConfig,
  derivePipelineHealthSnapshot,
  type PipelineHealthSnapshot,
} from '../pipeline-health';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export async function getPipelineHealthSnapshot(): Promise<PipelineHealthSnapshot> {
  const client: Client = await getDataClient();
  const observedAt = new Date().toISOString();

  const [submissionsResult, picksResult, outboxResult, receiptsResult, runsResult] = await Promise.all([
    client.from('submissions').select('status, created_at, updated_at').order('updated_at', { ascending: false }).limit(250),
    client.from('picks').select('status, promotion_status, promotion_score, created_at, updated_at').order('updated_at', { ascending: false }).limit(250),
    client.from('distribution_outbox').select('status, created_at, updated_at, claimed_at').order('updated_at', { ascending: false }).limit(250),
    client.from('distribution_receipts').select('recorded_at').order('recorded_at', { ascending: false }).limit(250),
    // Per run_type, not a global "latest 100". `worker.heartbeat` is 97.5% of
    // this table, so a global ordering returns 100 heartbeats and this snapshot
    // saw no other run type at all. See `fetchObservedRuns`.
    fetchObservedRuns(client, undefined, 25),
  ]);

  for (const result of [submissionsResult, picksResult, outboxResult, receiptsResult, runsResult]) {
    if (result.error) throw result.error;
  }

  const anonConnection = resolveOptionalAnonConnection();

  return derivePipelineHealthSnapshot({
    observedAt,
    submissions: (submissionsResult.data ?? []) as SubmissionRecord[],
    picks: (picksResult.data ?? []) as PickRecord[],
    outbox: (outboxResult.data ?? []) as OutboxRecord[],
    receipts: (receiptsResult.data ?? []) as ReceiptRecord[],
    runs: (runsResult.data ?? []) as SystemRunRecord[],
    liveConfig: createPipelineLiveConfig(anonConnection.url, anonConnection.key),
  });
}

/**
 * Resolve the anon credentials used *only* to build the optional realtime
 * subscription config.
 *
 * UTV2-1948: `createPipelineLiveConfig` is already written to return `null`
 * when either credential is absent -- the live config has always been
 * optional. But resolving the anon connection threw before that graceful path
 * could be reached, and the throw propagated out of
 * `getPipelineHealthSnapshot()` *after* every real read had already succeeded.
 * On a service-role-only deployment (production has `SUPABASE_URL` and
 * `SUPABASE_SERVICE_ROLE_KEY` but no `SUPABASE_ANON_KEY`) that discarded a
 * complete, healthy snapshot and rendered "GLOBAL HEALTH unavailable" /
 * "API HEALTH Down" across every page carrying the global header.
 *
 * Degrading here is the whole point: an unavailable *optional* dependency must
 * cost the live subscription and nothing else.
 *
 * `resolve` is injectable so the degradation is testable directly, without
 * mocking the module graph or mutating process env.
 */
export function resolveOptionalAnonConnection(
  resolve: () => DatabaseConnectionConfig = () =>
    createDatabaseConnectionConfig({ env: loadEnvironment(), useServiceRole: false }),
): { url: string | null; key: string | null } {
  try {
    const connection = resolve();
    return { url: connection.url ?? null, key: connection.key ?? null };
  } catch {
    return { url: null, key: null };
  }
}
