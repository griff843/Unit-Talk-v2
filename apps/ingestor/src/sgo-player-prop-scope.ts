/**
 * Event-scoping helpers for the dedicated SGO player-prop fetch (UTV2-1281).
 *
 * The league-wide PLAYER_ID-wildcard player-prop query over a full slate (e.g. an
 * in-season MLB day) expands to every player on every game and returns a payload
 * large enough to exhaust the per-league wall-clock bound — so the MLB cycle never
 * completes and MLB never produces offers. Instead of one league-wide request, the
 * prop fetch is scoped to the specific event IDs of the imminent slate (already
 * enumerated by the game-line fetch) in small batches, so each request stays small
 * and fast — the same shape that already completes in seconds for NBA/NFL.
 */

export interface PropScopeEvent {
  providerEventId: string;
  startsAt: string | null;
}

export interface SelectPropEventWindowOptions {
  /** Hours before the snapshot to still include (covers in-progress / just-started games). */
  lookbackHours?: number;
  /** Hours after the snapshot to include (the imminent, actionable slate). */
  lookaheadHours?: number;
}

/**
 * Lookback / lookahead bounds for the imminent player-prop window. These mirror the
 * window the league-wide prop fetch used (LIVE_ODDS_LOOKBACK_HOURS /
 * PLAYER_PROP_STARTS_BEFORE_HOURS in sgo-request-contract.ts) so event-scoping does
 * not change which games get props — only how the request is shaped.
 */
export const DEFAULT_PROP_EVENT_LOOKBACK_HOURS = 12;
export const DEFAULT_PROP_EVENT_LOOKAHEAD_HOURS = 36;

/**
 * Max event IDs per scoped prop request. Small enough that a single batch over a
 * full MLB game (every player × prop pattern) stays well within the per-page and
 * per-league time budgets.
 */
export const DEFAULT_PLAYER_PROP_EVENT_BATCH_SIZE = 5;

/**
 * Select the provider event IDs whose start time falls within the imminent
 * player-prop window [snapshot - lookback, snapshot + lookahead]. Events with a
 * missing/unparseable startsAt are EXCLUDED: props are only actionable for events
 * with a known imminent start, and including unknowns would re-expand the request
 * back toward the league-wide payload this scoping exists to avoid. Returns a
 * de-duplicated, order-preserving list.
 */
export function selectPlayerPropEventIds(
  events: readonly PropScopeEvent[],
  snapshotAt: string,
  options: SelectPropEventWindowOptions = {},
): string[] {
  const snapshotMs = Date.parse(snapshotAt);
  if (!Number.isFinite(snapshotMs)) {
    return [];
  }
  const lookbackMs =
    (options.lookbackHours ?? DEFAULT_PROP_EVENT_LOOKBACK_HOURS) * 3_600_000;
  const lookaheadMs =
    (options.lookaheadHours ?? DEFAULT_PROP_EVENT_LOOKAHEAD_HOURS) * 3_600_000;
  const windowStart = snapshotMs - lookbackMs;
  const windowEnd = snapshotMs + lookaheadMs;

  const seen = new Set<string>();
  const selected: string[] = [];
  for (const event of events) {
    const id = event.providerEventId;
    if (!id || seen.has(id) || !event.startsAt) {
      continue;
    }
    const startMs = Date.parse(event.startsAt);
    if (!Number.isFinite(startMs) || startMs < windowStart || startMs > windowEnd) {
      continue;
    }
    seen.add(id);
    selected.push(id);
  }
  return selected;
}

/** Split a list of event IDs into batches of at most `size` (size coerced to >= 1). */
export function chunkEventIds(
  ids: readonly string[],
  size: number = DEFAULT_PLAYER_PROP_EVENT_BATCH_SIZE,
): string[][] {
  const batchSize =
    Number.isFinite(size) && size >= 1
      ? Math.floor(size)
      : DEFAULT_PLAYER_PROP_EVENT_BATCH_SIZE;
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += batchSize) {
    batches.push(ids.slice(index, index + batchSize));
  }
  return batches;
}
