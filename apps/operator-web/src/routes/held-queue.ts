import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

/**
 * GET /api/operator/held-queue
 *
 * Returns picks in held state:
 *   (status = 'awaiting_approval' OR approval_status = 'pending')
 *   AND latest pick_reviews decision = 'hold'
 *
 * Query params:
 *   search  — pick ID prefix or market/selection text
 *   source  — exact match on picks.source
 *   sort    — newest (default), oldest, score
 *   limit   — max 100, default 50
 */
export async function handleHeldQueueRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const provider = deps.provider as unknown as { _supabaseClient?: unknown };
  if (!provider._supabaseClient) {
    writeJson(response, 200, { ok: true, data: { picks: [], total: 0 } });
    return;
  }

  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const search = url.searchParams.get('search')?.trim() || null;
  const source = url.searchParams.get('source')?.trim() || null;
  const sort = url.searchParams.get('sort')?.trim() || 'newest';
  const limit = Math.min(Math.max(1, Number(url.searchParams.get('limit')) || 50), 100);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = provider._supabaseClient as any;

  let query = client
    .from('picks_current_state')
    .select('*')
    .or('status.eq.awaiting_approval,approval_status.eq.pending');

  if (source) query = query.eq('source', source);
  if (search) {
    if (search.match(/^[0-9a-f-]{4,}$/i)) {
      query = query.ilike('id', `${search}%`);
    } else {
      query = query.or(`market.ilike.%${search}%,selection.ilike.%${search}%`);
    }
  }

  switch (sort) {
    case 'oldest': query = query.order('created_at', { ascending: true }); break;
    case 'score': query = query.order('promotion_score', { ascending: false }); break;
    default: query = query.order('created_at', { ascending: false }); break;
  }

  const { data: pendingPicks, error: picksError } = await query.limit(limit);

  if (picksError) {
    writeJson(response, 500, { ok: false, error: { code: 'DB_ERROR', message: String(picksError) } });
    return;
  }

  const picks = (pendingPicks ?? []) as Array<Record<string, unknown>>;

  if (picks.length === 0) {
    writeJson(response, 200, { ok: true, data: { picks: [], total: 0 } });
    return;
  }

  // The view includes review_decision, review_decided_by, review_decided_at — use them directly.
  const now = Date.now();
  const heldPicks = picks
    .filter((p) => p['review_decision'] === 'hold')
    .map((p) => {
      const heldAt = p['review_decided_at'] as string | null;
      const ageMs = heldAt ? now - new Date(heldAt).getTime() : 0;
      const ageHours = Math.floor(ageMs / (1000 * 60 * 60));

      const metadata = (p['metadata'] ?? {}) as Record<string, unknown>;
      const eventName = typeof metadata['eventName'] === 'string' ? metadata['eventName'] : null;
      const eventStartTime =
        typeof metadata['eventTime'] === 'string'
          ? metadata['eventTime']
          : typeof metadata['eventStartTime'] === 'string'
            ? metadata['eventStartTime']
            : null;

      return {
        ...p,
        heldBy: p['review_decided_by'] ?? null,
        heldAt,
        holdReason: null,
        ageHours,
        eventName,
        eventStartTime,
        sportDisplayName: p['sport_display_name'] ?? null,
        capperDisplayName: p['capper_display_name'] ?? null,
        marketTypeDisplayName: p['market_type_display_name'] ?? null,
        settlementResult: p['settlement_result'] ?? null,
        reviewDecision: p['review_decision'] ?? null,
        governanceQueueState:
          p['status'] === 'awaiting_approval' ? 'awaiting_approval' : 'pending_review',
      };
    });

  writeJson(response, 200, {
    ok: true,
    data: {
      picks: heldPicks,
      total: heldPicks.length,
    },
  });
}
