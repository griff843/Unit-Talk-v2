import { loadEnvironment } from '../../../../../packages/config/dist/env.js';
import type {
  OutboxRecord,
  PickRecord,
  ReceiptRecord,
  SubmissionRecord,
  SystemRunRecord,
} from '../../../../../packages/db/dist/types.js';
import { createDatabaseConnectionConfig } from './client';

import { getDataClient } from './client';
import {
  createPipelineLiveConfig,
  derivePipelineHealthSnapshot,
  type PipelineHealthSnapshot,
} from '../pipeline-health';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export async function getPipelineHealthSnapshot(): Promise<PipelineHealthSnapshot> {
  const client: Client = getDataClient();
  const observedAt = new Date().toISOString();

  const [submissionsResult, picksResult, outboxResult, receiptsResult, runsResult] = await Promise.all([
    client.from('submissions').select('status, created_at, updated_at').order('updated_at', { ascending: false }).limit(250),
    client.from('picks').select('status, promotion_status, promotion_score, created_at, updated_at').order('updated_at', { ascending: false }).limit(250),
    client.from('distribution_outbox').select('status, created_at, updated_at, claimed_at').order('updated_at', { ascending: false }).limit(250),
    client.from('distribution_receipts').select('recorded_at').order('recorded_at', { ascending: false }).limit(250),
    client.from('system_runs').select('run_type, status, started_at, finished_at').order('started_at', { ascending: false }).limit(100),
  ]);

  for (const result of [submissionsResult, picksResult, outboxResult, receiptsResult, runsResult]) {
    if (result.error) throw result.error;
  }

  const env = loadEnvironment();
  const anonConnection = createDatabaseConnectionConfig({ env, useServiceRole: false });

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
