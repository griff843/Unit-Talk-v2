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
    .from('picks')
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
  const pickIds = picks.map((p) => p['id'] as string);

  let heldPickIds: Set<string> = new Set();
  if (pickIds.length > 0) {
    const { data: reviews } = await client
      .from('pick_reviews')
      .select('pick_id, decision, decided_at')
      .in('pick_id', pickIds)
      .order('decided_at', { ascending: false });

    const latestByPick = new Map<string, string>();
    for (const r of (reviews ?? []) as Array<Record<string, unknown>>) {
      const pid = r['pick_id'] as string;
      if (!latestByPick.has(pid)) {
        latestByPick.set(pid, r['decision'] as string);
      }
    }

    heldPickIds = new Set(
      [...latestByPick.entries()]
        .filter(([, decision]) => decision === 'hold')
        .map(([pid]) => pid),
    );
  }

  const reviewQueuePicks = picks
    .filter((p) => !heldPickIds.has(p['id'] as string))
    .map((pick) => ({
      ...pick,
      governanceQueueState:
        pick['status'] === 'awaiting_approval' ? 'awaiting_approval' : 'pending_review',
    }));

  writeJson(response, 200, {
    ok: true,
    data: {
      picks: reviewQueuePicks,
      total: reviewQueuePicks.length,
    },
  });
}
