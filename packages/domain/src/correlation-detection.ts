import type { CanonicalPick } from '@unit-talk/contracts';

/**
 * Correlation types that indicate how two picks on the same game relate.
 *
 * - same-side: both picks back the same outcome direction (e.g. both over, both team-A ML)
 * - opposite-side: picks are on opposite sides of the same market (natural hedge — no penalty)
 * - same-game-different-market: different markets on the same event (partial correlation)
 */
export type CorrelationType = 'same-side' | 'opposite-side' | 'same-game-different-market';

export interface CorrelationMatch {
  existingPickId: string;
  correlationType: CorrelationType;
  /** Normalized event key shared by both picks */
  eventKey: string;
  /** Strength of the correlation, 0–1. Higher = more correlated outcomes. */
  strength: number;
}

export interface CorrelationInfo {
  hasCorrelation: boolean;
  matches: CorrelationMatch[];
  /** Maximum strength across all matches */
  maxStrength: number;
  /** Total number of correlated open picks on the same event */
  correlatedCount: number;
}

/**
 * Detect picks on the open board that are correlated with a new pick.
 *
 * Two picks are correlated when they share the same event (game). Within the
 * same event, correlation strength depends on how closely related the markets
 * and selections are:
 *
 * - same market + same selection direction → same-side (strength 1.0)
 * - same market + opposite selection direction → opposite-side (strength 0.0 — no penalty)
 * - different market on same event → same-game-different-market (strength 0.4)
 *
 * Only picks from the same submitter are considered (correlation is a per-submitter
 * board concentration concern, not a global board concern).
 */
export function detectCorrelatedPicks(
  newPick: CanonicalPick,
  openPicks: readonly CanonicalPick[],
): CorrelationInfo {
  const newEventKey = extractEventKey(newPick);
  const newSource = newPick.source;

  if (!newEventKey) {
    return { hasCorrelation: false, matches: [], maxStrength: 0, correlatedCount: 0 };
  }

  const matches: CorrelationMatch[] = [];

  for (const existing of openPicks) {
    // Skip self
    if (existing.id === newPick.id) {
      continue;
    }

    // Only same submitter
    if (existing.source !== newSource) {
      continue;
    }

    const existingEventKey = extractEventKey(existing);
    if (!existingEventKey || existingEventKey !== newEventKey) {
      continue;
    }

    const correlationType = classifyCorrelation(newPick, existing);
    const strength = correlationStrength(correlationType);

    matches.push({
      existingPickId: existing.id,
      correlationType,
      eventKey: newEventKey,
      strength,
    });
  }

  const maxStrength = matches.length > 0
    ? Math.max(...matches.map((m) => m.strength))
    : 0;

  return {
    hasCorrelation: matches.length > 0 && maxStrength > 0,
    matches,
    maxStrength,
    correlatedCount: matches.filter((m) => m.strength > 0).length,
  };
}

/**
 * Compute the boardFit penalty based on detected correlation info.
 *
 * Penalty ranges from 0 (no penalty) to -20 (maximum penalty).
 *
 * Penalty = min(20, maxStrength * 15 + additionalCorrelatedCount * 3)
 *
 * - A single same-side pick: -15
 * - Two same-side picks: -18
 * - A single same-game-different-market pick: -6
 * - Two same-game-different-market picks: -9
 * - Opposite-side picks contribute 0
 */
export function computeCorrelationPenalty(info: CorrelationInfo): number {
  if (!info.hasCorrelation) {
    return 0;
  }

  const basePenalty = info.maxStrength * 15;
  // Additional correlated picks beyond the first add incremental penalty
  const additionalCount = Math.max(0, info.correlatedCount - 1);
  const additionalPenalty = additionalCount * 3;

  return -Math.min(20, basePenalty + additionalPenalty);
}

/**
 * Extract a normalized event key from pick metadata.
 *
 * The event key represents the game/event. It is read from metadata.eventName
 * (the canonical field set during submission enrichment). Falls back to
 * metadata.event or metadata.gameId if present.
 */
export function extractEventKey(pick: CanonicalPick): string | null {
  const eventName = readString(pick.metadata, 'eventName');
  if (eventName) {
    return normalizeEventKey(eventName);
  }

  const event = readString(pick.metadata, 'event');
  if (event) {
    return normalizeEventKey(event);
  }

  const gameId = readString(pick.metadata, 'gameId');
  if (gameId) {
    return normalizeEventKey(gameId);
  }

  return null;
}

function normalizeEventKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Classify the correlation between two picks on the same event.
 */
function classifyCorrelation(
  pickA: CanonicalPick,
  pickB: CanonicalPick,
): CorrelationType {
  const marketA = pickA.market.trim().toLowerCase();
  const marketB = pickB.market.trim().toLowerCase();

  if (marketA !== marketB) {
    return 'same-game-different-market';
  }

  // Same market — check if selections point the same direction
  const selA = pickA.selection.trim().toLowerCase();
  const selB = pickB.selection.trim().toLowerCase();

  if (selA === selB) {
    return 'same-side';
  }

  // Check known opposite pairs
  if (areOppositeSides(selA, selB)) {
    return 'opposite-side';
  }

  // Different selection on same market but not a known opposite → treat as same-side
  // (e.g. two different player props on the same market type where outcomes correlate)
  return 'same-side';
}

function areOppositeSides(selA: string, selB: string): boolean {
  const oppositePairs: Array<[string, string]> = [
    ['over', 'under'],
    ['yes', 'no'],
    ['home', 'away'],
    ['win', 'lose'],
    ['pass', 'fail'],
  ];

  for (const [left, right] of oppositePairs) {
    if ((selA === left && selB === right) || (selA === right && selB === left)) {
      return true;
    }
  }

  return false;
}

function correlationStrength(type: CorrelationType): number {
  switch (type) {
    case 'same-side':
      return 1.0;
    case 'opposite-side':
      return 0.0;
    case 'same-game-different-market':
      return 0.4;
  }
}

function readString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
