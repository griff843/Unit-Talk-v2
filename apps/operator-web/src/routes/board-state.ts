import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

// ---------------------------------------------------------------------------
// Board-state route
// GET /api/operator/board-state
//
// Powers the Command Center Decision workspace overlays:
//   - Capacity / board-fit gauge (slate / sport / game utilization)
//   - Score breakdown bars (edge / trust / readiness / uniqueness / boardFit)
//   - Conflict cards (picks that scored above threshold but were not promoted)
//
// Data source: pick_promotion_history (live, no market-feed dependency).
// Board caps sourced from the promotion policy embedded in the payload.
// ---------------------------------------------------------------------------

// Best-bets policy defaults (from packages/contracts/src/promotion.ts)
const DEFAULT_CAPS = { perSlate: 15, perSport: 10, perGame: 2 } as const;
const DEFAULT_THRESHOLD = 70;
const DEFAULT_WEIGHTS = {
  edge: 0.4,
  trust: 0.2,
  readiness: 0.2,
  uniqueness: 0.1,
  boardFit: 0.1,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function toStatus(utilization: number): 'open' | 'near-cap' | 'at-cap' {
  if (utilization >= 1.0) return 'at-cap';
  if (utilization >= 0.75) return 'near-cap';
  return 'open';
}

function roundPct(n: number, d: number): number {
  if (d === 0) return 0;
  return Math.round((n / d) * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Empty response (no DB available)
// ---------------------------------------------------------------------------

function emptyBoardState(target: string) {
  return {
    window: '24h',
    computedAt: new Date().toISOString(),
    target,
    caps: DEFAULT_CAPS,
    slate: { current: 0, cap: DEFAULT_CAPS.perSlate, utilization: 0, status: 'open' },
    bySport: [] as unknown[],
    byGame: [] as unknown[],
    scoreBreakdowns: [] as unknown[],
    conflictCards: [] as unknown[],
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function handleBoardStateRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const target = url.searchParams.get('target') ?? 'best-bets';

  const provider = deps.provider as unknown as { _supabaseClient?: unknown };

  if (!provider._supabaseClient) {
    writeJson(response, 200, { ok: true, data: emptyBoardState(target) });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = provider._supabaseClient as any;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await client
    .from('pick_promotion_history')
    .select('id, pick_id, target, status, score, reason, payload, decided_at')
    .eq('target', target)
    .gte('decided_at', cutoff)
    .order('decided_at', { ascending: false })
    .limit(200);

  if (error) {
    writeJson(response, 500, {
      ok: false,
      error: { code: 'DB_ERROR', message: String(error.message ?? error) },
    });
    return;
  }

  const historyRows = (rows ?? []) as Array<Record<string, unknown>>;

  // ── Compute board caps from first row's payload, fall back to defaults ──
  const firstPayload = asRecord(historyRows[0]?.['payload']);
  const payloadCaps = asRecord(firstPayload['boardCaps']);
  const caps = {
    perSlate: asNumber(payloadCaps['perSlate'], DEFAULT_CAPS.perSlate),
    perSport: asNumber(payloadCaps['perSport'], DEFAULT_CAPS.perSport),
    perGame: asNumber(payloadCaps['perGame'], DEFAULT_CAPS.perGame),
  };

  // ── Separate qualified (on-board) from blocked ──
  const qualified = historyRows.filter((r) => asString(r['status']) === 'qualified');
  const blocked = historyRows.filter((r) => asString(r['status']) !== 'qualified');

  // ── Slate utilization (qualified picks on board) ──
  const slateCount = qualified.length;

  // ── Per-sport utilization ──
  const sportCounts = new Map<string, number>();
  for (const row of qualified) {
    const payload = asRecord(row['payload']);
    const scoreInputs = asRecord(payload['scoreInputs']);
    const sport = asString(scoreInputs['sport'] ?? payload['sport'] ?? row['sport']);
    if (sport) {
      sportCounts.set(sport, (sportCounts.get(sport) ?? 0) + 1);
    }
  }

  // ── Per-game utilization ──
  const gameCounts = new Map<string, number>();
  for (const row of qualified) {
    const payload = asRecord(row['payload']);
    const gameId =
      asString(payload['eventName'] ?? payload['gameId'] ?? payload['providerEventId']);
    if (gameId) {
      gameCounts.set(gameId, (gameCounts.get(gameId) ?? 0) + 1);
    }
  }

  // ── Score breakdowns (all rows — qualified and blocked) ──
  const scoreBreakdowns = historyRows.map((row) => {
    const payload = asRecord(row['payload']);
    const scoreInputs = asRecord(payload['scoreInputs']);
    const policyWeights = asRecord(asRecord(payload['policy'])['weights']);

    // Fall back to default weights if payload doesn't carry them
    const weights = {
      edge: asNumber(policyWeights['edge'], DEFAULT_WEIGHTS.edge),
      trust: asNumber(policyWeights['trust'], DEFAULT_WEIGHTS.trust),
      readiness: asNumber(policyWeights['readiness'], DEFAULT_WEIGHTS.readiness),
      uniqueness: asNumber(policyWeights['uniqueness'], DEFAULT_WEIGHTS.uniqueness),
      boardFit: asNumber(policyWeights['boardFit'], DEFAULT_WEIGHTS.boardFit),
    };

    const components = {
      edge: asNumber(scoreInputs['edge'], 0),
      trust: asNumber(scoreInputs['trust'], 0),
      readiness: asNumber(scoreInputs['readiness'], 0),
      uniqueness: asNumber(scoreInputs['uniqueness'], 50),
      boardFit: asNumber(scoreInputs['boardFit'], 0),
    };

    const threshold = asNumber(payload['minimumScore'] ?? asRecord(payload['policy'])['minimumScore'], DEFAULT_THRESHOLD);
    const totalScore = asNumber(row['score'], 0);

    return {
      pickId: asString(row['pick_id']),
      target: asString(row['target']),
      status: asString(row['status']),
      totalScore,
      threshold,
      qualifiedOnScore: totalScore >= threshold,
      components,
      weights,
      componentsWeighted: {
        edge: Math.round(components.edge * weights.edge * 10) / 10,
        trust: Math.round(components.trust * weights.trust * 10) / 10,
        readiness: Math.round(components.readiness * weights.readiness * 10) / 10,
        uniqueness: Math.round(components.uniqueness * weights.uniqueness * 10) / 10,
        boardFit: Math.round(components.boardFit * weights.boardFit * 10) / 10,
      },
      thresholdDelta: Math.round((totalScore - threshold) * 10) / 10,
      decidedAt: asString(row['decided_at']),
    };
  });

  // ── Conflict cards: scored >= threshold but not promoted ──
  const conflictCards = blocked
    .filter((row) => asNumber(row['score'], 0) >= DEFAULT_THRESHOLD)
    .map((row) => {
      const payload = asRecord(row['payload']);
      const reason = asString(row['reason']);

      // Classify the conflict reason from the stored reason text
      let conflictReason: 'slate-cap' | 'sport-cap' | 'game-cap' | 'duplicate' | 'other' = 'other';
      const reasonLower = reason.toLowerCase();
      if (reasonLower.includes('slate') || reasonLower.includes('board count') || reasonLower.includes('perslate')) {
        conflictReason = 'slate-cap';
      } else if (reasonLower.includes('sport') || reasonLower.includes('persport')) {
        conflictReason = 'sport-cap';
      } else if (reasonLower.includes('game') || reasonLower.includes('pergame')) {
        conflictReason = 'game-cap';
      } else if (reasonLower.includes('duplicate') || reasonLower.includes('unique')) {
        conflictReason = 'duplicate';
      }

      const scoreInputs = asRecord(asRecord(payload['scoreInputs']));

      return {
        pickId: asString(row['pick_id']),
        status: asString(row['status']),
        totalScore: asNumber(row['score'], 0),
        threshold: DEFAULT_THRESHOLD,
        thresholdDelta: Math.round((asNumber(row['score'], 0) - DEFAULT_THRESHOLD) * 10) / 10,
        conflictReason,
        rawReason: reason,
        sport: asString(scoreInputs['sport'] ?? payload['sport'] ?? ''),
        decidedAt: asString(row['decided_at']),
      };
    });

  const bySport = Array.from(sportCounts.entries()).map(([sportKey, current]) => ({
    sportKey,
    current,
    cap: caps.perSport,
    utilization: roundPct(current, caps.perSport),
    status: toStatus(roundPct(current, caps.perSport)),
  }));

  const byGame = Array.from(gameCounts.entries()).map(([gameId, current]) => ({
    gameId,
    current,
    cap: caps.perGame,
    utilization: roundPct(current, caps.perGame),
    status: toStatus(roundPct(current, caps.perGame)),
  }));

  writeJson(response, 200, {
    ok: true,
    data: {
      window: '24h',
      computedAt: new Date().toISOString(),
      target,
      caps,
      slate: {
        current: slateCount,
        cap: caps.perSlate,
        utilization: roundPct(slateCount, caps.perSlate),
        status: toStatus(roundPct(slateCount, caps.perSlate)),
      },
      bySport,
      byGame,
      scoreBreakdowns,
      conflictCards,
    },
  });
}
