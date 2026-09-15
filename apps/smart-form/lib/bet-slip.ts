/**
 * Multi-leg bet slip state (UTV2-1915).
 *
 * This module owns the *shape* of a multi-leg slip and nothing else. It is
 * deliberately pure — no React, no I/O — so every rule below is unit-testable
 * without a browser.
 *
 * What this module deliberately does NOT do, and why:
 *
 *  - **No pricing.** A parlay's combined price is defined once, in
 *    `@unit-talk/contracts` (`priceParlay` / `priceSettledParlay`, UTV2-1906).
 *    Recomputing it here would put a second copy of the rule in the UI, and a
 *    second copy is how the displayed price and the persisted price drift.
 *    `assertNoCombinedPrice` below exists so that drift is a test failure
 *    rather than a discovery.
 *  - **No duplicate-market-identity refusal.** Whether two legs collide is
 *    ticket identity (`deriveParlayTicketIdentity`), which is contract and API
 *    territory. This module keeps both legs and renders whatever refusal the
 *    server returns; it never silently dedupes, because a silent dedupe is a
 *    leg the operator believes they placed and did not.
 *  - **No submission.** There is no multi-leg ticket endpoint yet
 *    (UTV2-1912's API third). A slip carrying more than one leg is therefore
 *    explicitly unsubmittable, which is fail-closed rather than optimistic.
 */

import { betFormSchema, type BetFormValues } from './form-schema';
import { buildSelectionString } from './form-utils';
import { getMarketTypeLabel, type MarketTypeId } from './market-types';

/** Ticket-level ceiling. Beyond this the slip is refused rather than truncated. */
export const MAX_SLIP_LEGS = 12;

export interface SlipLeg {
  /** Stable within a session; used as a React key and as the remove/move handle. */
  readonly id: string;
  readonly values: BetFormValues;
}

export interface LegSummary {
  readonly id: string;
  readonly sport: string;
  readonly marketLabel: string;
  readonly eventName: string;
  readonly selection: string;
  readonly odds: number;
  readonly units: number;
  readonly sportsbook: string | null;
}

export type SlipRefusal =
  | { readonly code: 'leg_incomplete'; readonly fields: readonly string[]; readonly message: string }
  | { readonly code: 'slip_full'; readonly message: string };

export type AddLegResult =
  | { readonly ok: true; readonly legs: readonly SlipLeg[]; readonly added: SlipLeg }
  | { readonly ok: false; readonly legs: readonly SlipLeg[]; readonly refusal: SlipRefusal };

/**
 * Operator-facing field names, keyed by the schema path zod reports. Kept next
 * to the refusal that uses them so a renamed field cannot silently degrade to
 * the generic fallback in one place while staying correct in another.
 */
const FIELD_LABELS: Record<string, string> = {
  sport: 'Sport',
  marketType: 'Market',
  eventName: 'Matchup or event',
  odds: 'Odds',
  units: 'Units',
  capperConviction: 'Conviction',
  team: 'Team',
  playerName: 'Player',
  statType: 'Stat',
  line: 'Line',
  direction: 'Over or under',
  gameDate: 'Date',
};

function labelFor(path: PropertyKey | undefined): string {
  return FIELD_LABELS[String(path)] ?? 'Selection';
}

/**
 * The fields a candidate leg is still missing, in schema order and de-duplicated.
 * Empty means the leg is complete enough to enter the slip.
 */
export function describeIncompleteLeg(values: Partial<BetFormValues>): readonly string[] {
  const parsed = betFormSchema.safeParse(values);
  if (parsed.success) return [];
  return [...new Set(parsed.error.issues.map((issue) => labelFor(issue.path[0])))];
}

/**
 * Add a candidate leg. Refuses an incomplete leg and a full slip; never
 * partially applies. The caller keeps the operator's entries on refusal —
 * `legs` is returned unchanged precisely so a refusal cannot be mistaken for a
 * mutation.
 */
export function addLeg(
  legs: readonly SlipLeg[],
  values: Partial<BetFormValues>,
  makeId: () => string,
): AddLegResult {
  if (legs.length >= MAX_SLIP_LEGS) {
    return {
      ok: false,
      legs,
      refusal: {
        code: 'slip_full',
        message: `A slip holds at most ${MAX_SLIP_LEGS} legs. Remove a leg before adding another.`,
      },
    };
  }

  const parsed = betFormSchema.safeParse(values);
  if (!parsed.success) {
    const fields = describeIncompleteLeg(values);
    return {
      ok: false,
      legs,
      refusal: {
        code: 'leg_incomplete',
        fields,
        message: `This leg is not complete. Add or check: ${fields.join(', ')}.`,
      },
    };
  }

  const added: SlipLeg = { id: makeId(), values: parsed.data };
  return { ok: true, legs: [...legs, added], added };
}

/** Remove one leg by id. An unknown id returns the list unchanged. */
export function removeLeg(legs: readonly SlipLeg[], id: string): readonly SlipLeg[] {
  const index = legs.findIndex((leg) => leg.id === id);
  if (index === -1) return legs;
  return [...legs.slice(0, index), ...legs.slice(index + 1)];
}

/**
 * Move one leg by one position. Moving the first leg up, or the last leg down,
 * returns the list unchanged rather than wrapping — wrapping would silently
 * reorder a slip the operator was only nudging.
 */
export function moveLeg(
  legs: readonly SlipLeg[],
  id: string,
  direction: 'up' | 'down',
): readonly SlipLeg[] {
  const from = legs.findIndex((leg) => leg.id === id);
  if (from === -1) return legs;
  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= legs.length) return legs;
  const next = [...legs];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Display-only projection of a leg. Carries no derived price of any kind. */
export function summarizeLeg(leg: SlipLeg): LegSummary {
  const { values } = leg;
  return {
    id: leg.id,
    sport: values.sport,
    marketLabel: getMarketTypeLabel(values.marketType as MarketTypeId),
    eventName: values.eventName,
    selection: buildSelectionString(values),
    odds: values.odds,
    units: values.units,
    sportsbook: values.sportsbook?.trim() ? values.sportsbook : null,
  };
}

export function summarizeSlip(legs: readonly SlipLeg[]): readonly LegSummary[] {
  return legs.map(summarizeLeg);
}

/** A slip is a multi-leg ticket once it carries more than one leg. */
export function isMultiLegSlip(legs: readonly SlipLeg[]): boolean {
  return legs.length > 1;
}

/**
 * Why a multi-leg slip cannot be submitted today. Returned as a value rather
 * than thrown so the UI renders the reason instead of the absence of a button.
 */
export function multiLegSubmissionRefusal(legs: readonly SlipLeg[]): string | null {
  if (!isMultiLegSlip(legs)) return null;
  return (
    'Multi-leg tickets cannot be submitted yet. This slip can be built and reviewed; ' +
    'ticket submission arrives with the parlay ticket API. Remove legs until one remains to submit a single pick.'
  );
}

/**
 * Control for the "the UI never prices a parlay" rule. Returns every key on a
 * summary whose name suggests a combined price. The test asserts it is empty;
 * adding a `combinedOdds` field to `LegSummary` turns that assertion red.
 */
export function findCombinedPriceKeys(summaries: readonly LegSummary[]): readonly string[] {
  const suspicious = /combined|parlay|total(?:odds|price)|payout|decimal/i;
  const keys = new Set<string>();
  for (const summary of summaries) {
    for (const key of Object.keys(summary)) {
      if (suspicious.test(key)) keys.add(key);
    }
  }
  return [...keys];
}
