import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../../../packages/db/src/database.types.js';
import { getDataClient } from './client';
import { applyOperatorPickPopulation } from '../governed-population';
import { assertQuerySucceeded, readAuthoritativeCount } from '../query-result';

export async function getOperationsMetrics() {
  const client = await getDataClient() as SupabaseClient<Database>;
  const observedAt = new Date().toISOString();
  const today = `${observedAt.slice(0, 10)}T00:00:00.000Z`;
  const dayAgo = new Date(Date.parse(observedAt) - 86_400_000).toISOString();
  const signal = AbortSignal.timeout(8_000);
  const [total, submittedToday, manualReview, awaitingSettlement, agedPosted] = await Promise.all([
    applyOperatorPickPopulation(client.from('picks').select('id', { count: 'exact', head: true })).abortSignal(signal),
    applyOperatorPickPopulation(client.from('picks').select('id', { count: 'exact', head: true })).gte('created_at', today).abortSignal(signal),
    applyOperatorPickPopulation(client.from('picks_current_state').select('id', { count: 'exact', head: true })).eq('settlement_status', 'manual_review').abortSignal(signal),
    applyOperatorPickPopulation(client.from('picks_current_state').select('id', { count: 'exact', head: true }))
      .eq('status', 'posted').is('settlement_recorded_at', null).eq('metadata->deliveryAuthorization->>decision', 'authorized').abortSignal(signal),
    applyOperatorPickPopulation(client.from('picks_current_state').select('id', { count: 'exact', head: true }))
      .eq('status', 'posted').is('settlement_recorded_at', null).lte('posted_at', dayAgo).abortSignal(signal),
  ]);
  return {
    observedAt,
    total: readAuthoritativeCount(total, 'operator picks'),
    submittedToday: readAuthoritativeCount(submittedToday, 'operator submissions today'),
    manualReview: readAuthoritativeCount(manualReview, 'current manual review'),
    awaitingSettlement: readAuthoritativeCount(awaitingSettlement, 'delivered awaiting settlement'),
    agedPosted: readAuthoritativeCount(agedPosted, 'posted over 24h without settlement'),
  };
}

export async function getOperationsActivity() {
  const client = await getDataClient() as SupabaseClient<Database>;
  const result = await applyOperatorPickPopulation(client.from('pick_lifecycle')
    .select('id,pick_id,from_state,to_state,writer_role,reason,created_at,pick:picks!inner(id,selection)'), 'pick')
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(10).abortSignal(AbortSignal.timeout(8_000));
  assertQuerySucceeded(result, 'recent operator lifecycle activity');
  return result.data ?? [];
}
