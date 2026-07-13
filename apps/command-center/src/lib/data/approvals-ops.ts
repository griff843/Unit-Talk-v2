// Approvals cockpit data module — awaiting_approval picks read directly
// from picks_current_state (status is the lifecycle column; awaiting_approval
// is a real lifecycle state introduced by the Phase 7A governance brake).

import { getDataClient } from './client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export interface AwaitingApprovalPick {
  id: string;
  source: string | null;
  market: string | null;
  selection: string | null;
  status: string | null;
  approvalStatus: string | null;
  promotionScore: number | null;
  sportDisplayName: string | null;
  capperDisplayName: string | null;
  createdAt: string | null;
}

export async function getAwaitingApprovalPicks(limit = 100): Promise<AwaitingApprovalPick[]> {
  const client: Client = getDataClient();
  const result = await client
    .from('picks_current_state')
    .select('id, source, market, selection, status, approval_status, promotion_score, sport_display_name, capper_display_name, created_at')
    .eq('status', 'awaiting_approval')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (result.error) throw result.error;

  return ((result.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row['id'] ?? ''),
    source: typeof row['source'] === 'string' ? row['source'] : null,
    market: typeof row['market'] === 'string' ? row['market'] : null,
    selection: typeof row['selection'] === 'string' ? row['selection'] : null,
    status: typeof row['status'] === 'string' ? row['status'] : null,
    approvalStatus: typeof row['approval_status'] === 'string' ? row['approval_status'] : null,
    promotionScore: typeof row['promotion_score'] === 'number' ? row['promotion_score'] : null,
    sportDisplayName: typeof row['sport_display_name'] === 'string' ? row['sport_display_name'] : null,
    capperDisplayName: typeof row['capper_display_name'] === 'string' ? row['capper_display_name'] : null,
    createdAt: typeof row['created_at'] === 'string' ? row['created_at'] : null,
  }));
}
