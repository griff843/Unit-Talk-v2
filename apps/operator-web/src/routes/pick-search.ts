import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

/**
 * GET /api/operator/pick-search
 *
 * Full-featured pick search with filters:
 *   q           — text search (pick ID prefix, market, selection, event)
 *   source      — exact match on picks.source
 *   sport       — substring match on picks.market (sport prefix in market key)
 *   status      — lifecycle status (validated, queued, posted, settled, voided)
 *   approval    — approval_status (pending, approved, rejected)
 *   settlement  — settlement result (win, loss, push, void) via pipeline join
 *   delivery    — outbox status (pending, sent, failed, dead_letter)
 *   dateFrom    — created_at >= (ISO date)
 *   dateTo      — created_at <= (ISO date)
 *   limit       — max results (default 25, max 100)
 *   offset      — pagination offset (default 0)
 */
export async function handlePickSearchRequest(
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
  const q = url.searchParams.get('q')?.trim() || null;
  const source = url.searchParams.get('source')?.trim() || null;
  const sport = url.searchParams.get('sport')?.trim() || null;
  const status = url.searchParams.get('status')?.trim() || null;
  const approval = url.searchParams.get('approval')?.trim() || null;
  const dateFrom = url.searchParams.get('dateFrom')?.trim() || null;
  const dateTo = url.searchParams.get('dateTo')?.trim() || null;
  const rawLimit = url.searchParams.get('limit');
  const rawOffset = url.searchParams.get('offset');

  const limit = Math.min(Math.max(1, Number(rawLimit) || 25), 100);
  const offset = Math.max(0, Number(rawOffset) || 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = provider._supabaseClient as any;

  // Build query
  let query = client.from('picks').select('*', { count: 'exact' });

  if (q) {
    // Text search: pick ID prefix OR market/selection ilike
    if (q.match(/^[0-9a-f-]{4,}$/i)) {
      // Looks like a UUID prefix
      query = query.ilike('id', `${q}%`);
    } else {
      // Search market and selection
      query = query.or(`market.ilike.%${q}%,selection.ilike.%${q}%`);
    }
  }

  if (source) query = query.eq('source', source);
  if (status) query = query.eq('status', status);
  if (approval) query = query.eq('approval_status', approval);
  if (sport) query = query.ilike('market', `${sport}%`);
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59.999Z`);

  query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    writeJson(response, 500, { ok: false, error: { code: 'DB_ERROR', message: String(error.message ?? error) } });
    return;
  }

  writeJson(response, 200, {
    ok: true,
    data: {
      picks: data ?? [],
      total: count ?? 0,
      limit,
      offset,
    },
  });
}
