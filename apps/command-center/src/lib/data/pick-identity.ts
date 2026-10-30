import { buildPickIdentity, type PickIdentityModel } from '../pick-identity';

type Row = Record<string, unknown>;

export interface PickIdentityRead {
  id: string;
  identity: PickIdentityModel;
  status: string;
  submittedAt: string | null;
  stakeUnits: number | null;
  line: number | null;
  odds: number | null;
  settlement: {
    result: string;
    status: string;
    source: string | null;
    settledAt: string | null;
    correctsId: string | null;
  } | null;
}

export function effectiveSettlementLabel(settlement: PickIdentityRead['settlement'], hasHistory: boolean): string {
  if (!settlement) return hasHistory ? 'Settlement history unavailable' : 'Pending settlement';
  const result = settlement.status === 'settled' ? settlement.result : settlement.status;
  return settlement.correctsId ? `${result} (corrected)` : result;
}

function object(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

// numeric columns arrive from PostgREST as strings ("3.50")
function number(value: unknown): number | null {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
}

export function mapPickIdentityRead(pick: Row, settlements: Row[], submissionPayload?: Row | null): PickIdentityRead {
  const metadata = object(pick.metadata);
  const ids = new Set(settlements.map((row) => string(row.id)).filter((id): id is string => id !== null));
  if (ids.size !== settlements.length) throw new Error('Settlement history has missing or duplicate IDs');
  const parents = new Set<string>();
  for (const row of settlements) {
    const parent = string(row.corrects_id);
    if (parent && (!ids.has(parent) || parents.has(parent))) throw new Error('Settlement correction chain is incomplete or branches');
    if (parent) parents.add(parent);
  }
  const byId = new Map(settlements.map((row) => [String(row.id), row]));
  for (const row of settlements) {
    const seen = new Set<string>();
    let cursor: Row | undefined = row;
    while (cursor) {
      const id = String(cursor.id);
      if (seen.has(id)) throw new Error('Settlement correction chain is circular');
      seen.add(id);
      const parent = string(cursor.corrects_id);
      cursor = parent ? byId.get(parent) : undefined;
    }
  }
  const tips = settlements.filter((row) => !parents.has(String(row.id)));
  if (settlements.length && !tips.length) throw new Error('Settlement correction chain is circular');
  const current = tips.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')) || String(b.id).localeCompare(String(a.id)))[0];
  const identity = buildPickIdentity({
    source: string(pick.source), market: string(pick.market), selection: string(pick.selection),
    line: number(pick.line), odds: number(pick.odds), metadata,
    submissionPayload, sportDisplayName: string(pick.sport_display_name),
    capperDisplayName: string(pick.capper_display_name), marketTypeDisplayName: string(pick.market_type_display_name),
    eventName: string(metadata.eventName) ?? string(metadata.event_name),
  });
  identity.capper = string(pick.capper_id) ? string(pick.capper_display_name) ?? string(pick.capper_id) : null;
  return {
    id: String(pick.id), identity, status: string(pick.status) ?? 'unknown',
    submittedAt: string(pick.created_at), stakeUnits: number(pick.stake_units), line: number(pick.line), odds: number(pick.odds),
    settlement: current ? {
      result: string(current.result) ?? 'unknown', source: string(current.source) ?? string(object(current.payload).source),
      status: string(current.status) ?? 'unknown',
      settledAt: string(current.settled_at), correctsId: string(current.corrects_id),
    } : null,
  };
}

export async function getPickIdentity(pickId: string): Promise<PickIdentityRead | null> {
  const { getDataClient } = await import('./client.js');
  const client = await getDataClient();
  const [pickResult, settlementResult] = await Promise.all([
    client.from('picks_current_state').select('id, source, market, selection, line, odds, stake_units, created_at, status, metadata, capper_id, sport_display_name, capper_display_name, market_type_display_name, submission_id').eq('id', pickId).maybeSingle(),
    client.from('settlement_records').select('id, status, result, source, settled_at, corrects_id, created_at, payload', { count: 'exact' }).eq('pick_id', pickId).order('created_at', { ascending: false }),
  ]);
  if (pickResult.error || !pickResult.data || settlementResult.error || settlementResult.count !== (settlementResult.data ?? []).length) return null;
  let submissionPayload: Row | null = null;
  if (pickResult.data.submission_id) {
    const submission = await client.from('submissions').select('payload').eq('id', pickResult.data.submission_id).maybeSingle();
    submissionPayload = object(submission.data?.payload);
  }
  return mapPickIdentityRead(pickResult.data as Row, (settlementResult.data ?? []) as Row[], submissionPayload);
}
