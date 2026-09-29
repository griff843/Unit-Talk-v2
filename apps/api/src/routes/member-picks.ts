import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies } from '../server.js';
import { writeJson, readOptionalInteger } from '../http-utils.js';
import {
  isMemberVisibleOfficialPickStatus,
  type MemberVisibleOfficialPickStatus,
} from '@unit-talk/contracts';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** The metadata keys a member-facing surface may render. Nothing else leaves. */
const MEMBER_METADATA_KEYS = ['capper', 'sport', 'eventName', 'eventTime', 'thesis'] as const;

/**
 * GET /api/member/picks?status=posted,settled&limit=50
 *
 * WORK-2026092901: the member-facing pick list. Returns only picks that are
 * member-visible under the membership product contract -- delivery-eligible,
 * server-authorized official picks that were posted to members or have since
 * settled (`isMemberVisibleOfficialPick`). Track Only picks, fixtures,
 * scanner/board output and picks held behind the kill switch (`queued`) can
 * never appear, whatever the caller asks for: the filter is server-side and
 * is not a parameter. Discord role gating decides WHO may ask; this route
 * decides WHAT any asker can see.
 *
 * Fails closed: a runtime whose pick repository cannot answer the question
 * returns 503, never a broader list.
 */
export async function handleMemberPicksQuery(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const statusParam = url.searchParams.get('status');

  if (!statusParam) {
    return writeJson(response, 400, {
      ok: false,
      error: { code: 'MISSING_STATUS', message: 'Query parameter "status" is required (posted and/or settled)' },
    });
  }

  const requested = [...new Set(statusParam.split(',').map((value) => value.trim()))];
  const invalid = requested.filter((value) => !isMemberVisibleOfficialPickStatus(value));
  if (invalid.length > 0) {
    return writeJson(response, 400, {
      ok: false,
      error: {
        code: 'INVALID_STATUS',
        message: `Invalid member pick status: ${invalid.join(', ')}. Valid: posted, settled`,
      },
    });
  }

  const reader = runtime.repositories.picks.listMemberVisibleOfficialPicks;
  if (!reader) {
    return writeJson(response, 503, {
      ok: false,
      error: { code: 'MEMBER_PICKS_UNAVAILABLE', message: 'Member pick visibility cannot be established' },
    });
  }

  const rawLimit = readOptionalInteger(url.searchParams.get('limit'));
  const limit = Math.max(1, Math.min(rawLimit ?? DEFAULT_LIMIT, MAX_LIMIT));

  const rows = await reader.call(
    runtime.repositories.picks,
    requested as MemberVisibleOfficialPickStatus[],
    limit,
  );

  const picks = rows.map((pick) => ({
    id: pick.id,
    market: pick.market,
    selection: pick.selection,
    line: pick.line,
    odds: pick.odds,
    stake_units: pick.stake_units === null ? null : Number(pick.stake_units),
    status: pick.status,
    source: pick.source,
    created_at: pick.created_at,
    posted_at: pick.posted_at,
    settled_at: pick.settled_at,
    promotion_status: pick.promotion_status,
    promotion_target: pick.promotion_target,
    metadata: projectMemberMetadata(pick.metadata),
  }));

  writeJson(response, 200, { ok: true, picks, count: picks.length });
}

function projectMemberMetadata(value: unknown): Record<string, unknown> {
  const metadata =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const projected: Record<string, unknown> = {};
  for (const key of MEMBER_METADATA_KEYS) {
    if (typeof metadata[key] === 'string') {
      projected[key] = metadata[key];
    }
  }
  return projected;
}
