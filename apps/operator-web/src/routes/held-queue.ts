import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

/**
 * GET /api/operator/held-queue
 *
 * Returns picks in held state:
 *   approval_status = 'pending' AND latest pick_reviews decision = 'hold'
 *
 * Each row includes the hold decision metadata (held_by, held_at, hold_reason, age).
 */
export async function handleHeldQueueRequest(
  _request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const provider = deps.provider as unknown as { _supabaseClient?: unknown };
  if (!provider._supabaseClient) {
    writeJson(response, 200, { ok: true, data: { picks: [], total: 0 } });
    return;
  }

  const client = provider._supabaseClient as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          order: (col: string, opts?: { ascending?: boolean }) => {
            limit: (n: number) => Promise<{ data: unknown[]; error: unknown }>;
          };
        };
        in: (col: string, vals: string[]) => {
          order: (col: string, opts?: { ascending?: boolean }) => Promise<{ data: unknown[]; error: unknown }>;
        };
      };
    };
  };

  // Get all pending picks
  const { data: pendingPicks, error: picksError } = await client
    .from('picks')
    .select('*')
    .eq('approval_status', 'pending')
    .order('created_at', { ascending: false })
    .limit(100);

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

  // Fetch all reviews for these picks
  const { data: reviews } = await client
    .from('pick_reviews')
    .select('*')
    .in('pick_id', pickIds)
    .order('decided_at', { ascending: false });

  // Group by pick_id, take latest decision
  const latestReviewByPick = new Map<string, Record<string, unknown>>();
  for (const r of (reviews ?? []) as Array<Record<string, unknown>>) {
    const pid = r['pick_id'] as string;
    if (!latestReviewByPick.has(pid)) {
      latestReviewByPick.set(pid, r);
    }
  }

  // Held = latest decision is 'hold'
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
