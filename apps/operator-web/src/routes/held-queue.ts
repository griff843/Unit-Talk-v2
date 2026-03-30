import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

/**
 * GET /api/operator/held-queue
 *
 * Returns picks in held state:
 *   approval_status = 'pending' AND latest pick_reviews decision = 'hold'
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

  let query = client.from('picks').select('*').eq('approval_status', 'pending');

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

  if (pickIds.length === 0) {
    writeJson(response, 200, { ok: true, data: { picks: [], total: 0 } });
    return;
  }

  const { data: reviews } = await client
    .from('pick_reviews')
    .select('*')
    .in('pick_id', pickIds)
    .order('decided_at', { ascending: false });

  const latestReviewByPick = new Map<string, Record<string, unknown>>();
  for (const r of (reviews ?? []) as Array<Record<string, unknown>>) {
    const pid = r['pick_id'] as string;
    if (!latestReviewByPick.has(pid)) {
      latestReviewByPick.set(pid, r);
    }
  }

  const now = Date.now();
  const heldPicks = picks
    .filter((p) => {
      const review = latestReviewByPick.get(p['id'] as string);
      return review && review['decision'] === 'hold';
    })
    .map((p) => {
      const review = latestReviewByPick.get(p['id'] as string)!;
      const heldAt = review['decided_at'] as string;
      const ageMs = now - new Date(heldAt).getTime();
      const ageHours = Math.floor(ageMs / (1000 * 60 * 60));

      return {
        ...p,
        heldBy: review['decided_by'],
        heldAt,
        holdReason: review['reason'],
        ageHours,
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
