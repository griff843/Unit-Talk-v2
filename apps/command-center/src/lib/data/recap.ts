import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../../../packages/db/src/database.types.js';
import { getDataClient } from './client';
import { readAllQueryPages } from '../query-result';
import { summarizeRecapEvidence } from '../recap-status';

type Run = Database['public']['Tables']['system_runs']['Row'];
export async function getSettlementRecapStatus(pickId: string, settlementRecordId: string, verifiedNoDelivery: boolean) {
  const client = await getDataClient() as SupabaseClient<Database>;
  const signal = AbortSignal.timeout(8_000);
  const runs = await readAllQueryPages<Run>('per-pick recap evidence', (from, to) => client.from('system_runs')
    .select('*', { count: 'exact' }).eq('run_type', 'recap.post')
    .eq('details->>recapKind', 'settlement-pick').eq('details->>pickId', pickId)
    .eq('details->>settlementRecordId', settlementRecordId)
    .order('started_at', { ascending: false }).order('id', { ascending: false })
    .range(from, to).abortSignal(signal));
  return summarizeRecapEvidence(runs.map((run) => ({ ...run,
    details: run.details && typeof run.details === 'object' && !Array.isArray(run.details) ? run.details : {},
  })), verifiedNoDelivery);
}
