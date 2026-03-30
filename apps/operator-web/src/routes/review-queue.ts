import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

/**
 * GET /api/operator/review-queue
 *
 * Returns picks awaiting operator review:
 *   approval_status = 'pending' AND NOT held (latest review decision != 'hold')
 *
 * Query params:
 *   limit (default 25, max 100)
 */
export async function handleReviewQueueRequest(
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
      select: (cols: string, opts?: { count?: string }) => {
        eq: (col: string, val: string) => {
          order: (col: string, opts?: { ascending?: boolean }) => {
            limit: (n: number) => Promise<{ data: unknown[]; error: unknown; count?: number }>;
          };
          not: (col: string, op: string, val: string) => {
            order: (col: string, opts?: { ascending?: boolean }) => {
              limit: (n: number) => Promise<{ data: unknown[]; error: unknown; count?: number }>;
            };
          };
        };
      };
    };
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
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

  // For each pending pick, check if it's held (latest review = 'hold')
  // Fetch all reviews for pending pick IDs in one query
  const pickIds = picks.map((p) => p['id'] as string);

  let heldPickIds: Set<string> = new Set();
  if (pickIds.length > 0) {
    const { data: reviews } = await (client as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          in: (col: string, vals: string[]) => {
            order: (col: string, opts?: { ascending?: boolean }) => Promise<{ data: unknown[]; error: unknown }>;
          };
        };
      };
    })
      .from('pick_reviews')
      .select('pick_id, decision, decided_at')
      .in('pick_id', pickIds)
      .order('decided_at', { ascending: false });

    // Group by pick_id, take latest decision
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

  // Review queue = pending picks that are NOT held
  const reviewQueuePicks = picks.filter((p) => !heldPickIds.has(p['id'] as string));

  writeJson(response, 200, {
    ok: true,
    data: {
      picks: reviewQueuePicks,
      total: reviewQueuePicks.length,
    },
  });
}
