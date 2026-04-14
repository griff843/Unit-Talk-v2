import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

/**
 * GET /api/operator/review-queue
 *
 * Returns picks awaiting operator review:
 *   (status = 'awaiting_approval' OR approval_status = 'pending')
 *   AND NOT held (latest review decision != 'hold')
 *
 * Query params:
 *   search  — pick ID prefix or market/selection text
 *   source  — exact match on picks.source
 *   sort    — newest (default), oldest, score
 *   limit   — max 100, default 50
 */
export async function handleReviewQueueRequest(
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

  // The view includes review_decision — filter out held picks without a secondary query.
  const reviewQueuePicks = picks
    .filter((p) => p['review_decision'] !== 'hold')
    .map((pick) => {
      const metadata = (pick['metadata'] ?? {}) as Record<string, unknown>;
      const eventName = typeof metadata['eventName'] === 'string' ? metadata['eventName'] : null;
      const eventStartTime =
        typeof metadata['eventTime'] === 'string'
          ? metadata['eventTime']
          : typeof metadata['eventStartTime'] === 'string'
            ? metadata['eventStartTime']
            : null;

      return {
        ...pick,
        eventName,
        eventStartTime,
        sportDisplayName: pick['sport_display_name'] ?? null,
        capperDisplayName: pick['capper_display_name'] ?? null,
        marketTypeDisplayName: pick['market_type_display_name'] ?? null,
        settlementResult: pick['settlement_result'] ?? null,
        reviewDecision: pick['review_decision'] ?? null,
        governanceQueueState:
          pick['status'] === 'awaiting_approval' ? 'awaiting_approval' : 'pending_review',
      };
    });

  writeJson(response, 200, {
    ok: true,
    data: {
      picks: reviewQueuePicks,
      total: reviewQueuePicks.length,
    },
  });
}
