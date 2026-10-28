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
    source: string | null;
    settledAt: string | null;
    correctsId: string | null;
  } | null;
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
  const ordered = [...settlements].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  const current = ordered[0];
  const identity = buildPickIdentity({
    source: string(pick.source), market: string(pick.market), selection: string(pick.selection),
    line: number(pick.line), odds: number(pick.odds), metadata,
    submissionPayload, sportDisplayName: string(pick.sport_display_name),
    capperDisplayName: string(pick.capper_display_name), marketTypeDisplayName: string(pick.market_type_display_name),
    eventName: string(metadata.eventName) ?? string(metadata.event_name),
  });
  return {
    id: String(pick.id), identity, status: string(pick.status) ?? 'unknown',
    submittedAt: string(pick.created_at), stakeUnits: number(pick.stake_units), line: number(pick.line), odds: number(pick.odds),
    settlement: current ? {
      result: string(current.result) ?? 'unknown', source: string(current.source) ?? string(object(current.payload).source),
      settledAt: string(current.settled_at), correctsId: string(current.corrects_id),
    } : null,
  };
}

export async function getPickIdentity(pickId: string): Promise<PickIdentityRead | null> {
  const { getDataClient } = await import('./client.js');
  const client = await getDataClient();
  const [pickResult, settlementResult] = await Promise.all([
    client.from('picks_current_state').select('id, source, market, selection, line, odds, stake_units, created_at, status, metadata, sport_display_name, capper_display_name, market_type_display_name, submission_id').eq('id', pickId).maybeSingle(),
    client.from('settlement_records').select('result, source, settled_at, corrects_id, created_at, payload').eq('pick_id', pickId).order('created_at', { ascending: false }),
  ]);
  if (pickResult.error || !pickResult.data || settlementResult.error) return null;
  let submissionPayload: Row | null = null;
  if (pickResult.data.submission_id) {
    const submission = await client.from('submissions').select('payload').eq('id', pickResult.data.submission_id).maybeSingle();
    submissionPayload = object(submission.data?.payload);
  }
  return mapPickIdentityRead(pickResult.data as Row, (settlementResult.data ?? []) as Row[], submissionPayload);
}
