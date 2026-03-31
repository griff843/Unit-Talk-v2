import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

/**
 * GET /api/operator/review-history
 *
 * Returns pick review decisions with pick context and settlement outcome.
 *
 * Query params:
 *   decision  — filter by decision type (approve, deny, hold, return)
 *   limit     — max results (default 50, max 100)
 */
export async function handleReviewHistoryRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const provider = deps.provider as unknown as { _supabaseClient?: unknown };
  if (!provider._supabaseClient) {
    writeJson(response, 200, { ok: true, data: { reviews: [], total: 0 } });
    return;
  }

  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const decision = url.searchParams.get('decision')?.trim() || null;
  const rawLimit = url.searchParams.get('limit');
  const limit = Math.min(Math.max(1, Number(rawLimit) || 50), 100);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = provider._supabaseClient as any;

  let query = client
    .from('pick_reviews')
    .select('*')
    .order('decided_at', { ascending: false })
    .limit(limit);

  if (decision) {
    query = query.eq('decision', decision);
  }

  const { data: reviews, error: reviewsError } = await query;

  if (reviewsError) {
    writeJson(response, 500, { ok: false, error: { code: 'DB_ERROR', message: String(reviewsError) } });
    return;
  }

  const reviewRows = (reviews ?? []) as Array<Record<string, unknown>>;

  // Fetch associated picks for context + settlement outcome
  const pickIds = [...new Set(reviewRows.map((r) => r['pick_id'] as string))];

  const pickMap = new Map<string, Record<string, unknown>>();
  if (pickIds.length > 0) {
    const { data: picks } = await client
      .from('picks')
      .select('id, status, market, selection, source, promotion_score, settled_at')
      .in('id', pickIds);

    for (const p of (picks ?? []) as Array<Record<string, unknown>>) {
      pickMap.set(p['id'] as string, p);
    }
  }

  // Fetch settlement results for settled picks
  const settledPickIds = [...pickMap.values()]
    .filter((p) => p['status'] === 'settled')
    .map((p) => p['id'] as string);

  const settlementMap = new Map<string, string>();
  if (settledPickIds.length > 0) {
    const { data: settlements } = await client
      .from('settlement_records')
      .select('pick_id, result, corrects_id')
      .in('pick_id', settledPickIds)
      .order('created_at', { ascending: false });

    // For each pick, take the effective (latest non-correction or latest correction) result
    for (const s of (settlements ?? []) as Array<Record<string, unknown>>) {
      const pid = s['pick_id'] as string;
      if (!settlementMap.has(pid) && s['result']) {
        settlementMap.set(pid, s['result'] as string);
      }
    }
  }

  // Enrich reviews with pick context and outcome
  const enriched = reviewRows.map((r) => {
    const pick = pickMap.get(r['pick_id'] as string);
    return {
      id: r['id'],
      pickId: r['pick_id'],
      decision: r['decision'],
      reason: r['reason'],
      decidedBy: r['decided_by'],
      decidedAt: r['decided_at'],
      pick: pick
        ? {
            market: pick['market'],
            selection: pick['selection'],
            source: pick['source'],
            score: pick['promotion_score'],
            status: pick['status'],
          }
        : null,
      outcome: settlementMap.get(r['pick_id'] as string) ?? null,
    };
  });

  writeJson(response, 200, {
    ok: true,
    data: {
      reviews: enriched,
      total: enriched.length,
    },
  });
}
