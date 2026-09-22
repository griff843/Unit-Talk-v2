import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../../../packages/db/src/database.types.js';
import { resolveEffectiveSettlement, type SettlementInput } from '../../../../../packages/domain/dist/outcomes/settlement-downstream.js';
import { getDataClient } from './client';
import { applyOperatorPickPopulation } from '../governed-population';
import { readAllQueryPages } from '../query-result';

type PickState = Database['public']['Views']['picks_current_state']['Row'];
type Settlement = Database['public']['Tables']['settlement_records']['Row'];
export type PerformancePick = Pick<PickState,
  'id' | 'source' | 'capper_id' | 'capper_display_name' | 'market' | 'selection' | 'odds' |
  'stake_units' | 'promotion_score' | 'metadata' | 'status' | 'created_at' | 'review_decision' | 'sport_display_name'>;
export interface PerformanceCohort {
  observedAt: string;
  picks: PerformancePick[];
  settlements: Settlement[];
  correctionCounts: Map<string, number>;
}

/**
 * Every read authenticates through getDataClient; no shared result cache.
 * Read the complete governed cohort for an all-time aggregate, in bounded pages.
 * Resolve the complete immutable chain before applying any performance window.
 */
export async function getPerformanceCohort(): Promise<PerformanceCohort> {
  const client = await getDataClient() as SupabaseClient<Database>;
  const observedAt = new Date().toISOString();
  const signal = AbortSignal.timeout(8_000);
  const picks = await readAllQueryPages<PerformancePick>('performance picks', (from, to) =>
    applyOperatorPickPopulation(client.from('picks_current_state')
      .select('id,source,capper_id,capper_display_name,market,selection,odds,stake_units,promotion_score,metadata,status,created_at,review_decision,sport_display_name', { count: 'exact' }))
      .lte('created_at', observedAt).order('id').range(from, to).abortSignal(signal));
  const ids = picks.map((pick) => pick.id).filter((id): id is string => id !== null);
  const histories: Settlement[] = [];
  for (let start = 0; start < ids.length; start += 100) {
    const chunk = ids.slice(start, start + 100);
    histories.push(...await readAllQueryPages<Settlement>('performance settlement history', (from, to) =>
      client.from('settlement_records').select('*', { count: 'exact' })
        .in('pick_id', chunk).lte('created_at', observedAt)
        .order('created_at').order('id').range(from, to).abortSignal(signal)));
  }
  const byPick = new Map<string, Settlement[]>();
  for (const record of histories) {
    const records = byPick.get(record.pick_id) ?? [];
    records.push(record);
    byPick.set(record.pick_id, records);
  }
  const settlements: Settlement[] = [];
  const correctionCounts = new Map<string, number>();
  for (const [pickId, records] of byPick) {
    if (records.some((record) => record.status !== 'settled' && record.status !== 'manual_review')) {
      throw new Error('Performance settlement has an unsupported status');
    }
    const ids = new Set(records.map((record) => record.id));
    if (records.some((record) => record.corrects_id !== null && !ids.has(record.corrects_id))) {
      throw new Error('Performance settlement history is incomplete');
    }
    const resolved = resolveEffectiveSettlement(records.map((record): SettlementInput => ({
      id: record.id, pick_id: record.pick_id, status: record.status as SettlementInput['status'],
      result: record.result, confidence: record.confidence, corrects_id: record.corrects_id, settled_at: record.settled_at,
    })));
    if (!resolved.ok) throw new Error(`Performance settlement chain unavailable: ${resolved.reason}`);
    const effective = records.find((record) => record.id === resolved.settlement.effective_record_id);
    if (!effective || resolved.settlement.correction_depth + 1 !== records.length) {
      throw new Error('Performance settlement chain does not reconcile');
    }
    settlements.push(effective);
    correctionCounts.set(pickId, resolved.settlement.correction_depth);
  }
  return { observedAt, picks, settlements, correctionCounts };
}
