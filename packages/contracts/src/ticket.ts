/**
 * UTV2-1906 (A1) — the parlay ticket contract.
 *
 * A parlay is one wager whose outcome is a function of several legs. The
 * pipeline today models a pick as a single selection, so nothing in
 * `CanonicalPick` can express "these three selections settle together". This
 * module defines that shape, its pricing, its validation, and its settlement
 * resolution as pure functions, with no persistence and no I/O.
 *
 * **Parlay only.** Teasers and round robins are separate features and are
 * deliberately not modelled here — a teaser re-prices its legs by moving their
 * lines, and a round robin is a set of tickets rather than one. Folding either
 * into this file would make the outcome rule below wrong for two of the three.
 *
 * **Leg membership does not belong in `picks.metadata`.** A leg's relationship
 * to its ticket is relational identity, and putting it in a JSON blob is the
 * defect the capper-attribution work exists to undo. The tables that carry it
 * are a separate lane (A2); `reference-data.ts` therefore keeps
 * `ticketTypes.parlay.enabled = false` until that persistence exists, and this
 * contract is not reachable from the Smart Form until it flips.
 */

/** Inclusive bounds on how many legs a parlay may carry. */
export const PARLAY_MIN_LEGS = 2;
export const PARLAY_MAX_LEGS = 12;

/**
 * One leg of a parlay, as submitted.
 *
 * `eventName`, `market` and `selection` together identify what was bet, and are
 * what duplicate detection keys on: the same side of the same market in the
 * same game cannot appear twice in one ticket, because the legs would not be
 * independent and most books refuse it outright.
 */
export interface ParlayLegInput {
  /** Stable id within the ticket. Unique across the ticket's legs. */
  id: string;
  eventName: string;
  market: string;
  selection: string;
  /** Absent for a moneyline, which genuinely has no line. */
  line?: number | undefined;
  /** American odds for this leg at the time of submission. */
  odds: number;
}

export interface ParlayTicketPayload {
  ticketType: 'parlay';
  legs: readonly ParlayLegInput[];
  /** Units risked on the ticket as a whole, not per leg. */
  stakeUnits: number;
  /**
   * The combined American price the operator was shown, when the book quoted
   * one. Absent means "price it from the legs"; present means the quote is
   * authoritative and {@link validateParlayTicket} checks it is a legal price,
   * not that it matches the computed one — books apply their own parlay pricing
   * and a mismatch is normal, not an error.
   */
  quotedOdds?: number | undefined;
}

export interface ParlayValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * American odds are undefined between -99 and +99: a price of `+50` or `-1`
 * cannot be expressed in that notation, so accepting one would mean inventing a
 * probability. Zero is likewise not a price.
 */
export function isValidAmericanOdds(odds: unknown): odds is number {
  return (
    typeof odds === 'number' &&
    Number.isFinite(odds) &&
    Number.isInteger(odds) &&
    Math.abs(odds) >= 100
  );
}

/** Convert American odds to their decimal equivalent. Refuses an illegal price. */
export function americanToDecimal(odds: number): number {
  if (!isValidAmericanOdds(odds)) {
    throw new RangeError(`not a valid American price: ${String(odds)}`);
  }
  return odds > 0 ? odds / 100 + 1 : 1 + 100 / Math.abs(odds);
}

/**
 * Convert a decimal price back to American, rounded to the nearest integer.
 *
 * Decimal 2.0 is the boundary and maps to +100 rather than -100: at even money
 * the positive form is the conventional one, and picking a side deterministically
 * is what keeps the round trip stable.
 */
export function decimalToAmerican(decimal: number): number {
  if (!Number.isFinite(decimal) || decimal <= 1) {
    throw new RangeError(`not a valid decimal price: ${String(decimal)}`);
  }
  return decimal >= 2
    ? Math.round((decimal - 1) * 100)
    : -Math.round(100 / (decimal - 1));
}

export interface ParlayPricing {
  /** Exact product of the legs' decimal prices. */
  decimalOdds: number;
  /** {@link decimalOdds} expressed in American notation, rounded. */
  americanOdds: number;
  /** Profit on a winning ticket, in units. Excludes the returned stake. */
  payoutUnits: number;
}

/**
 * Price a parlay from its legs: the decimal prices multiply.
 *
 * The rounding happens once, on the combined decimal price, rather than per leg —
 * rounding each leg to American first and multiplying compounds the error.
 */
export function priceParlay(
  legs: readonly ParlayLegInput[],
  stakeUnits: number,
): ParlayPricing {
  if (legs.length === 0) {
    throw new RangeError('cannot price a parlay with no legs');
  }
  if (!Number.isFinite(stakeUnits) || stakeUnits <= 0) {
    throw new RangeError(`not a valid stake: ${String(stakeUnits)}`);
  }
  const decimalOdds = legs.reduce((acc, leg) => acc * americanToDecimal(leg.odds), 1);
  return {
    decimalOdds,
    americanOdds: decimalToAmerican(decimalOdds),
    payoutUnits: stakeUnits * (decimalOdds - 1),
  };
}

/** Identity used for duplicate-leg detection. Case- and whitespace-insensitive. */
function legMarketIdentity(leg: ParlayLegInput): string {
  const normalize = (value: string) => value.trim().toLowerCase();
  return [normalize(leg.eventName), normalize(leg.market), normalize(leg.selection)].join('|');
}

/**
 * Validate a submitted parlay. Returns every error rather than the first, so an
 * operator fixing a ticket sees the whole list in one pass.
 */
export function validateParlayTicket(payload: ParlayTicketPayload): ParlayValidationResult {
  const errors: string[] = [];

  if (payload.ticketType !== 'parlay') {
    errors.push(`ticketType must be 'parlay', got '${String(payload.ticketType)}'`);
  }

  const legs = payload.legs ?? [];
  if (legs.length < PARLAY_MIN_LEGS) {
    errors.push(`a parlay needs at least ${PARLAY_MIN_LEGS} legs, got ${legs.length}`);
  }
  if (legs.length > PARLAY_MAX_LEGS) {
    errors.push(`a parlay may carry at most ${PARLAY_MAX_LEGS} legs, got ${legs.length}`);
  }

  if (!Number.isFinite(payload.stakeUnits) || payload.stakeUnits <= 0) {
    errors.push(`stakeUnits must be a positive finite number, got ${String(payload.stakeUnits)}`);
  }

  if (payload.quotedOdds !== undefined && !isValidAmericanOdds(payload.quotedOdds)) {
    errors.push(`quotedOdds is not a valid American price: ${String(payload.quotedOdds)}`);
  }

  const seenIds = new Set<string>();
  const seenMarkets = new Set<string>();
  for (const [index, leg] of legs.entries()) {
    const where = `leg ${index}`;
    if (typeof leg.id !== 'string' || leg.id.trim().length === 0) {
      errors.push(`${where}: id is required`);
    } else if (seenIds.has(leg.id)) {
      errors.push(`${where}: duplicate leg id '${leg.id}'`);
    } else {
      seenIds.add(leg.id);
    }

    for (const field of ['eventName', 'market', 'selection'] as const) {
      const value = leg[field];
      if (typeof value !== 'string' || value.trim().length === 0) {
        errors.push(`${where}: ${field} is required`);
      }
    }

    if (!isValidAmericanOdds(leg.odds)) {
      errors.push(`${where}: odds is not a valid American price: ${String(leg.odds)}`);
    }

    if (leg.line !== undefined && !Number.isFinite(leg.line)) {
      errors.push(`${where}: line must be a finite number when present`);
    }

    const identity = legMarketIdentity(leg);
    if (
      typeof leg.eventName === 'string' &&
      typeof leg.market === 'string' &&
      typeof leg.selection === 'string'
    ) {
      if (seenMarkets.has(identity)) {
        errors.push(`${where}: duplicates an earlier leg on the same event, market and selection`);
      } else {
        seenMarkets.add(identity);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** What a single leg's grading produced. `pending` means not yet graded. */
export type ParlayLegOutcome = 'win' | 'loss' | 'push' | 'void' | 'pending';

export interface ParlayLegResult {
  legId: string;
  outcome: ParlayLegOutcome;
}

/**
 * `null` means the ticket is not settleable yet — deliberately distinct from
 * every settleable outcome, so a caller cannot treat "unknown" as a push.
 */
export type ParlayTicketOutcome = 'win' | 'loss' | 'push' | null;

export interface ParlayOutcomeResolution {
  outcome: ParlayTicketOutcome;
  /** Legs that still price the ticket: pushed and voided legs drop out. */
  survivingLegIds: string[];
  /** Why this outcome, in terms a settlement record can carry verbatim. */
  reason: string;
}

/**
 * Resolve a parlay's outcome from its legs, failing closed.
 *
 * The rules, and why each is what it is:
 *
 * - **Any lost leg loses the ticket**, even with other legs ungraded. That is
 *   determinative rather than optimistic, so it is not deferred.
 * - **Otherwise any ungraded leg leaves the ticket unresolved** (`null`). A
 *   parlay is never declared a winner on partial information.
 * - **Pushed and voided legs drop out** and the ticket re-prices on the rest,
 *   which is how every book settles them.
 * - **All legs pushed or voided is a push**: nothing was risked on an outcome.
 * - A leg result that names no leg of the ticket, or a leg with no result, is
 *   refused rather than assumed — a missing result is exactly the case where
 *   guessing produces a fabricated settlement.
 */
export function resolveParlayTicketOutcome(
  legs: readonly ParlayLegInput[],
  results: readonly ParlayLegResult[],
): ParlayOutcomeResolution {
  const refuse = (reason: string): ParlayOutcomeResolution => ({
    outcome: null,
    survivingLegIds: [],
    reason,
  });

  if (legs.length === 0) {
    return refuse('ticket has no legs');
  }

  const byLegId = new Map<string, ParlayLegOutcome>();
  for (const result of results) {
    if (!legs.some((leg) => leg.id === result.legId)) {
      return refuse(`result names leg '${result.legId}', which is not on this ticket`);
    }
    if (byLegId.has(result.legId)) {
      return refuse(`leg '${result.legId}' has more than one result`);
    }
    byLegId.set(result.legId, result.outcome);
  }

  const missing = legs.filter((leg) => !byLegId.has(leg.id)).map((leg) => leg.id);
  if (missing.length > 0) {
    return refuse(`no result for leg(s): ${missing.join(', ')}`);
  }

  const lost = legs.filter((leg) => byLegId.get(leg.id) === 'loss');
  if (lost.length > 0) {
    return {
      outcome: 'loss',
      survivingLegIds: [],
      reason: `leg(s) lost: ${lost.map((leg) => leg.id).join(', ')}`,
    };
  }

  const pending = legs.filter((leg) => byLegId.get(leg.id) === 'pending');
  if (pending.length > 0) {
    return refuse(`leg(s) not yet graded: ${pending.map((leg) => leg.id).join(', ')}`);
  }

  const surviving = legs.filter((leg) => byLegId.get(leg.id) === 'win');
  if (surviving.length === 0) {
    return {
      outcome: 'push',
      survivingLegIds: [],
      reason: 'every leg pushed or voided',
    };
  }

  return {
    outcome: 'win',
    survivingLegIds: surviving.map((leg) => leg.id),
    reason:
      surviving.length === legs.length
        ? 'every leg won'
        : `every graded leg won; ${legs.length - surviving.length} leg(s) pushed or voided and dropped out`,
  };
}

/**
 * Price a settled parlay on the legs that survived, so a ticket with a pushed
 * leg pays the smaller parlay rather than the one that was quoted.
 *
 * Returns `null` for any outcome that is not a win, because only a win has a
 * payout to compute — a loss pays nothing and a push returns the stake, and
 * neither is a parlay price.
 */
export function priceSettledParlay(
  legs: readonly ParlayLegInput[],
  resolution: ParlayOutcomeResolution,
  stakeUnits: number,
): ParlayPricing | null {
  if (resolution.outcome !== 'win') {
    return null;
  }
  const surviving = legs.filter((leg) => resolution.survivingLegIds.includes(leg.id));
  return priceParlay(surviving, stakeUnits);
}
