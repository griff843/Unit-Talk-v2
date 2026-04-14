import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';
import { enrichPickRowsWithIdentity, isFixtureLikePick } from './pick-identity-enrichment.js';

/**
 * GET /api/operator/pick-search
 *
 * Full-featured pick search with filters:
 *   q           - text search (pick ID prefix, market, selection)
 *   source      - exact match on picks.source
 *   capper      - ilike match on canonical capper identity
 *   sport       - substring match on canonical sport identity
 *   status      - lifecycle status (validated, queued, posted, settled, voided)
 *   approval    - approval_status (pending, approved, rejected)
 *   result      - settlement result (win, loss, push, void) - filters settled picks only
 *   dateFrom    - created_at >= (ISO date)
 *   dateTo      - created_at <= (ISO date)
 *   sort        - newest (default), oldest, score
 *   limit       - max results (default 25, max 100)
 *   offset      - pagination offset (default 0)
 *
 * Uses picks_current_state view: settlement result and promotion state are available
 * inline without a second query.
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
  const includeFixtures = url.searchParams.get('includeFixtures') === 'true';
  const rawLimit = url.searchParams.get('limit');
  const rawOffset = url.searchParams.get('offset');

  const limit = Math.min(Math.max(1, Number(rawLimit) || 25), 100);
  const offset = Math.max(0, Number(rawOffset) || 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = provider._supabaseClient as any;

  // picks_current_state view provides settlement_result, promotion_status_current,
  // sport_display_name, and capper_display_name inline — no secondary queries needed.
  let query = client.from('picks_current_state').select('*', { count: 'exact' });

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

  const { data, error, count } = await query;

  if (error) {
    writeJson(response, 500, { ok: false, error: { code: 'DB_ERROR', message: String(error.message ?? error) } });
    return;
  }

  let picks = await enrichPickRowsWithIdentity(client, (data ?? []) as Array<Record<string, unknown>>);
  let total = count ?? 0;

  picks = picks
    .filter((pick) => includeFixtures || !isFixtureLikePick(pick))
    .map((pick) => {
      const metadata =
        typeof pick['metadata'] === 'object' &&
        pick['metadata'] !== null &&
        !Array.isArray(pick['metadata'])
          ? (pick['metadata'] as Record<string, unknown>)
          : null;

      const matchup =
        typeof metadata?.['eventName'] === 'string' && metadata['eventName'].trim().length > 0
          ? metadata['eventName'].trim()
          : null;

      const eventStartTime =
        typeof metadata?.['eventTime'] === 'string'
          ? metadata['eventTime']
          : typeof metadata?.['eventStartTime'] === 'string'
            ? metadata['eventStartTime']
            : null;

      return {
        ...pick,
        submitter: readSubmittedBy(pick),
        matchup,
        eventStartTime,
        sport:
          readStringField(pick, 'sport_id') ??
          readStringField(pick, 'sport_display_name') ??
          readMetadataString(pick, 'sport'),
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

  if (result && picks.length > 0) {
    // settlement_result is available inline from picks_current_state view —
    // no secondary settlement_records query needed.
    picks = picks.filter((pick) => pick['settlement_result'] === result);
  }

  total = picks.length;
  picks = picks.slice(offset, offset + limit);

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

function readStringField(pick: Record<string, unknown>, key: string): string | null {
  const value = pick[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readSubmittedBy(pick: Record<string, unknown>): string | null {
  const candidates = [
    pick['capper_display_name'],
    pick['capper_id'],
    pick['submitted_by'],
    readMetadataString(pick, 'capper'),
    readMetadataString(pick, 'submittedBy'),
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return null;
}
