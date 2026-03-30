import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

/**
 * GET /api/operator/exception-queues
 *
 * Returns counts and rows for all operational exception queues:
 * - failedDelivery: outbox rows with status='failed'
 * - deadLetter: outbox rows with status='dead_letter'
 * - pendingManualReview: settlement_records with status='manual_review'
 * - staleValidated: picks stuck in validated > 48h
 * - rerunCandidates: picks with approval_status='approved' and promotion_status in (not_eligible, suppressed)
 */
export async function handleExceptionQueuesRequest(
  _request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const provider = deps.provider as unknown as { _supabaseClient?: unknown };
  if (!provider._supabaseClient) {
    writeJson(response, 200, { ok: true, data: createEmptyQueues() });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = provider._supabaseClient as any;

  const staleThreshold = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const [failedResult, deadLetterResult, manualReviewResult, stalePicks, rerunCandidates] = await Promise.all([
    client.from('distribution_outbox').select('id, pick_id, target, status, attempt_count, last_error, created_at, updated_at').eq('status', 'failed').order('updated_at', { ascending: false }).limit(50),
    client.from('distribution_outbox').select('id, pick_id, target, status, attempt_count, last_error, created_at, updated_at').eq('status', 'dead_letter').order('updated_at', { ascending: false }).limit(50),
    client.from('settlement_records').select('id, pick_id, result, status, review_reason, settled_by, created_at').eq('status', 'manual_review').order('created_at', { ascending: false }).limit(50),
    client.from('picks').select('id, status, source, market, selection, promotion_score, created_at').eq('status', 'validated').lte('created_at', staleThreshold).order('created_at', { ascending: true }).limit(50),
    client.from('picks').select('id, status, source, market, selection, approval_status, promotion_status, promotion_score, promotion_target, created_at').eq('approval_status', 'approved').in('promotion_status', ['not_eligible', 'suppressed']).order('created_at', { ascending: false }).limit(50),
  ]);

  const failed = (failedResult.data ?? []) as Array<Record<string, unknown>>;
  const deadLetter = (deadLetterResult.data ?? []) as Array<Record<string, unknown>>;
  const manualReview = (manualReviewResult.data ?? []) as Array<Record<string, unknown>>;
  const stale = (stalePicks.data ?? []) as Array<Record<string, unknown>>;
  const rerun = (rerunCandidates.data ?? []) as Array<Record<string, unknown>>;

  // Enrich outbox rows with pick context
  const allOutboxPickIds = [...new Set([...failed, ...deadLetter].map((r) => r['pick_id'] as string))];
  let pickMap = new Map<string, Record<string, unknown>>();
  if (allOutboxPickIds.length > 0) {
    const { data: picks } = await client.from('picks').select('id, market, selection, source, status').in('id', allOutboxPickIds);
    for (const p of (picks ?? []) as Array<Record<string, unknown>>) {
      pickMap.set(p['id'] as string, p);
    }
  }

  const enrichOutbox = (rows: Array<Record<string, unknown>>) =>
    rows.map((r) => {
      const pick = pickMap.get(r['pick_id'] as string);
      const age = Math.floor((Date.now() - new Date(r['updated_at'] as string).getTime()) / 3600000);
      return { ...r, ageHours: age, pick: pick ? { market: pick['market'], selection: pick['selection'], source: pick['source'], status: pick['status'] } : null };
    });

  const enrichStale = (rows: Array<Record<string, unknown>>) =>
    rows.map((r) => {
      const age = Math.floor((Date.now() - new Date(r['created_at'] as string).getTime()) / 3600000);
      return { ...r, ageHours: age };
    });

  writeJson(response, 200, {
    ok: true,
    data: {
      counts: {
        failedDelivery: failed.length,
        deadLetter: deadLetter.length,
        pendingManualReview: manualReview.length,
        staleValidated: stale.length,
        rerunCandidates: rerun.length,
      },
      failedDelivery: enrichOutbox(failed),
      deadLetter: enrichOutbox(deadLetter),
      pendingManualReview: manualReview,
      staleValidated: enrichStale(stale),
      rerunCandidates: rerun,
    },
  });
}

function createEmptyQueues() {
  return {
    counts: { failedDelivery: 0, deadLetter: 0, pendingManualReview: 0, staleValidated: 0, rerunCandidates: 0 },
    failedDelivery: [], deadLetter: [], pendingManualReview: [], staleValidated: [], rerunCandidates: [],
  };
}
