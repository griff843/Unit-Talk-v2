import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

/**
 * GET /api/operator/pick-search
 *
 * Full-featured pick search with filters:
 *   q           - text search (pick ID prefix, market, selection)
 *   source      - exact match on picks.source
 *   capper      - ilike match on canonical submitter/capper identity
 *   sport       - substring match on canonical sport metadata
 *   status      - lifecycle status (validated, queued, posted, settled, voided)
 *   approval    - approval_status (pending, approved, rejected)
 *   result      - settlement result (win, loss, push, void) - filters settled picks only
 *   dateFrom    - created_at >= (ISO date)
 *   dateTo      - created_at <= (ISO date)
 *   sort        - newest (default), oldest, score
 *   limit       - max results (default 25, max 100)
 *   offset      - pagination offset (default 0)
 */
export async function handlePickSearchRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const provider = deps.provider as unknown as { _supabaseClient?: unknown };
  if (!provider._supabaseClient) {
    writeJson(response, 200, { ok: true, data: { picks: [], total: 0, limit: 25, offset: 0 } });
    return;
  }

  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const q = url.searchParams.get('q')?.trim() || null;
  const source = url.searchParams.get('source')?.trim() || null;
  const capper = url.searchParams.get('capper')?.trim() || null;
  const sport = url.searchParams.get('sport')?.trim() || null;
  const status = url.searchParams.get('status')?.trim() || null;
  const approval = url.searchParams.get('approval')?.trim() || null;
  const result = url.searchParams.get('result')?.trim() || null;
  const dateFrom = url.searchParams.get('dateFrom')?.trim() || null;
  const dateTo = url.searchParams.get('dateTo')?.trim() || null;
  const sort = url.searchParams.get('sort')?.trim() || 'newest';
  const rawLimit = url.searchParams.get('limit');
  const rawOffset = url.searchParams.get('offset');

  const limit = Math.min(Math.max(1, Number(rawLimit) || 25), 100);
  const offset = Math.max(0, Number(rawOffset) || 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = provider._supabaseClient as any;

  let query = client.from('picks').select('*', { count: 'exact' });

  if (q) {
    if (q.match(/^[0-9a-f-]{4,}$/i)) {
      query = query.ilike('id', `${q}%`);
    } else {
      query = query.or(`market.ilike.%${q}%,selection.ilike.%${q}%`);
    }
  }

  if (source) query = query.eq('source', source);
  if (status) query = query.eq('status', status);
  if (approval) query = query.eq('approval_status', approval);
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59.999Z`);

  switch (sort) {
    case 'oldest':
      query = query.order('created_at', { ascending: true });
      break;
    case 'score':
      query = query.order('promotion_score', { ascending: false });
      break;
    default:
      query = query.order('created_at', { ascending: false });
      break;
  }

  if (!capper && !sport) {
    query = query.range(offset, offset + limit - 1);
  }

  const { data, error, count } = await query;

  if (error) {
    writeJson(response, 500, { ok: false, error: { code: 'DB_ERROR', message: String(error.message ?? error) } });
    return;
  }

  let picks = (data ?? []) as Array<Record<string, unknown>>;
  let total = count ?? 0;

  const submissionIds = picks
    .map((pick) => pick['submission_id'])
    .filter((submissionId): submissionId is string => typeof submissionId === 'string' && submissionId.length > 0);

  const submissionsById = new Map<string, Record<string, unknown>>();
  if (submissionIds.length > 0) {
    const { data: submissions } = await client
      .from('submissions')
      .select('*')
      .in('id', submissionIds);

    for (const row of (submissions ?? []) as Array<Record<string, unknown>>) {
      const submissionId = row['id'];
      if (typeof submissionId === 'string' && submissionId.length > 0) {
        submissionsById.set(submissionId, row);
      }
    }
  }

  picks = picks
    .map((pick) => {
      const submissionId = typeof pick['submission_id'] === 'string' ? pick['submission_id'] : null;
      const submission = submissionId ? submissionsById.get(submissionId) ?? null : null;

      return {
        ...pick,
        submitter: readSubmittedBy(pick, submission),
        sport: readMetadataString(pick, 'sport'),
      };
    })
    .filter((pick) => {
      if (!capper) {
        return true;
      }

      const submitter = pick['submitter'];
      return typeof submitter === 'string' && submitter.toLowerCase().includes(capper.toLowerCase());
    })
    .filter((pick) => {
      if (!sport) {
        return true;
      }

      const canonicalSport = pick['sport'];
      return typeof canonicalSport === 'string' && canonicalSport.toLowerCase().includes(sport.toLowerCase());
    });

  if (capper || sport) {
    total = picks.length;
    picks = picks.slice(offset, offset + limit);
  }

  if (result && picks.length > 0) {
    const settledIds = picks.filter((pick) => pick['status'] === 'settled').map((pick) => pick['id'] as string);
    if (settledIds.length > 0) {
      const { data: settlements } = await client
        .from('settlement_records')
        .select('pick_id, result, corrects_id')
        .in('pick_id', settledIds)
        .order('created_at', { ascending: false });

      const resultByPick = new Map<string, string>();
      for (const settlement of (settlements ?? []) as Array<Record<string, unknown>>) {
        const pickId = settlement['pick_id'] as string;
        if (!resultByPick.has(pickId) && settlement['result']) {
          resultByPick.set(pickId, settlement['result'] as string);
        }
      }

      const matchingIds = new Set(
        [...resultByPick.entries()]
          .filter(([, settlementResult]) => settlementResult === result)
          .map(([pickId]) => pickId),
      );

      picks = picks.filter((pick) => matchingIds.has(pick['id'] as string));
      total = picks.length;
    } else {
      picks = [];
      total = 0;
    }
  }

  writeJson(response, 200, {
    ok: true,
    data: { picks, total, limit, offset },
  });
}

function readMetadataString(pick: Record<string, unknown>, key: string): string | null {
  const metadata =
    typeof pick['metadata'] === 'object' &&
    pick['metadata'] !== null &&
    !Array.isArray(pick['metadata'])
      ? (pick['metadata'] as Record<string, unknown>)
      : null;
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readSubmittedBy(
  pick: Record<string, unknown>,
  submission: Record<string, unknown> | null,
): string | null {
  const submissionPayload =
    submission != null &&
    typeof submission['payload'] === 'object' &&
    submission['payload'] !== null &&
    !Array.isArray(submission['payload'])
      ? (submission['payload'] as Record<string, unknown>)
      : null;

  const candidates = [
    pick['submitted_by'],
    submission?.['submitted_by'],
    readMetadataString(pick, 'capper'),
    readMetadataString(pick, 'submittedBy'),
    submissionPayload?.['submittedBy'],
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return null;
}
