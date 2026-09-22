/**
 * Real Edge Service — model probability vs devigged market consensus
 *
 * This replaces the confidence delta ("fake edge") with a real edge
 * calculation that compares the model's win probability against the
 * devigged Pinnacle sharp line or multi-book consensus.
 *
 * Real edge = model_probability - devigged_market_probability
 *
 * Where:
 * - model_probability = pick.confidence (capper's estimated win probability)
 * - devigged_market_probability = Pinnacle or consensus devigged line
 *
 * If Pinnacle data is available, use Pinnacle (sharpest line).
 * If not, fall back to multi-book consensus.
 * If no market data, fall back to confidence delta (legacy behavior).
 *
 * Issue: UTV2-198 (Sprint D)
 */

import type { ProviderOfferRecord, ProviderOfferRepository } from '@unit-talk/db';
import { americanToImplied, proportionalDevig, roundTo, classifyContrarianism, type ContrarySignal } from '@unit-talk/domain';
import type { EdgeFallbackReason, EdgeMethod, ProviderCoverageState } from '@unit-talk/contracts';
import { classifyMarketFamilyForGrading } from './grading-service.js';

/**
 * Full diagnostic trace of how edge was computed and why each tier was skipped.
 * Persisted in pick metadata so operators can audit coverage without re-querying.
 * Added UTV2-985 (PM requirement: explicit edge provenance on every pick).
 */
export interface EdgeProvenance {
  /** Whether devigged market data was used (authoritative) or confidence-delta (fallback). */
  method: EdgeMethod;
  /** Which provider tier supplied market data, or 'none' when no market data found. */
  providerCoverageState: ProviderCoverageState;
  /** Why the confidence-delta fallback was reached, or null when market data was found. */
  fallbackReason: EdgeFallbackReason | null;
}

export interface RealEdgeResult {
  /** Real edge: model probability - market probability */
  realEdge: number;
  /** Model's estimated win probability (from confidence) */
  modelProbability: number;
  /** Market's devigged probability for this side */
  marketProbability: number;
  /** Source of market probability */
  marketSource: 'pinnacle' | 'consensus' | 'sgo' | 'single-book' | 'confidence-delta';
  /** Number of books in consensus (1 for single-book) */
  bookCount: number;
  /** Whether the model has positive edge vs market */
  hasRealEdge: boolean;
  /** Contrarian classification — present when model diverges from market */
  contrarySignal?: ContrarySignal;
  /** Full provenance trace — why each tier was attempted and what was found. */
  provenance: EdgeProvenance;
}

/**
 * UTV2-1898: how old a provider snapshot may be and still describe the market
 * a pick is being submitted into. Six hours spans a normal pre-game window
 * without admitting a line from a previous slate.
 */
export const PROVIDER_OFFER_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * UTV2-1898: the scope an offer must match to be allowed to back this pick.
 *
 * Every field is stated explicitly, including the ones that are unknown, so
 * that an unresolved dimension refuses the lookup instead of widening it. The
 * defect this replaces was not a wrong filter -- it was a filter that vanished
 * when its argument was `undefined`, letting an unrelated stale MLB moneyline
 * supply edge to an NFL pick.
 */
export interface RealEdgeMarketScope {
  /** Canonical sport of the pick, or null when it could not be resolved. */
  sportKey: string | null;
  /** Provider-native event id for the pick's event, or null when unresolved. */
  providerEventId: string | null;
  /**
   * Provider-native participant id for the pick's side; `null` only when the
   * market is genuinely game-level and its offers carry no participant.
   * `undefined` means "not resolved" and refuses the lookup.
   */
  providerParticipantId: string | null | undefined;
  /** Evaluation instant; offers older than PROVIDER_OFFER_MAX_AGE_MS are refused. */
  now: Date;
}

export interface RealEdgeOptions {
  /** Capper's confidence (0-1 win probability estimate) */
  confidence: number;
  /** Normalized market key for looking up offers */
  marketKey: string;
  /** The pick's selection side (for over/under resolution) */
  selection: string;
  /** Submitted American odds (for confidence delta fallback) */
  submittedOdds: number;
  /** Provider offers repository */
  providerOffers: ProviderOfferRepository;
  /** UTV2-1898: required scope. Without it no offer may be used. */
  scope: RealEdgeMarketScope;
}

/**
 * UTV2-1379: raised when a provider-offer row is found but its data cannot be
 * used (malformed odds, failed devig) or the lookup itself throws. Distinct
 * from "no offer found" — this signals a data/computation problem, not
 * absence of market coverage. Caught by computeRealEdge and classified as
 * 'computation-error', never allowed to propagate into a silent
 * confidence-delta fallback with the wrong provenance.
 */
class RealEdgeComputationError extends Error {}

/**
 * UTV2-1898: recover the scope a pick was submitted under from its own
 * persisted metadata, so promotion-time re-derivation runs under exactly the
 * scope submission used rather than re-resolving (or, as before, not scoping
 * at all).
 *
 * An absent or malformed block yields unresolved dimensions, which refuse the
 * lookup. That is deliberate: a pick whose scope was never recorded has no
 * basis for market-backed edge, and inventing one at promotion time is the
 * behaviour this repair exists to remove.
 */
export function readPersistedRealEdgeScope(
  metadata: Record<string, unknown> | null | undefined,
  now: Date = new Date(),
): RealEdgeMarketScope {
  const block =
    metadata && typeof metadata['edgeScope'] === 'object' && metadata['edgeScope'] !== null
      ? (metadata['edgeScope'] as Record<string, unknown>)
      : null;

  const text = (key: string): string | null => {
    const value = block?.[key];
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  };

  // `null` and "absent" are different here: a recorded null participant means
  // "this market is game-level", while an absent key means "never resolved".
  const participant = block && 'providerParticipantId' in block ? block['providerParticipantId'] : undefined;

  return {
    sportKey: text('sportKey'),
    providerEventId: text('providerEventId'),
    providerParticipantId:
      participant === null
        ? null
        : typeof participant === 'string' && participant.trim().length > 0
          ? participant
          : undefined,
    now,
  };
}

/**
 * Compute real edge against market consensus.
 *
 * Priority order:
 * 1. Pinnacle devigged line (sharpest available)
 * 2. Multi-book devigged consensus (DK + FD + MGM average)
 * 3. SGO devigged line (existing single-provider)
 * 4. Single non-SGO book devigged line
 * 5. Confidence delta fallback (confidence - implied from submitted odds)
 */
export async function computeRealEdge(
  options: RealEdgeOptions,
): Promise<RealEdgeResult> {
  const { confidence, marketKey, selection, submittedOdds, providerOffers, scope } = options;

  // UTV2-1379: classify only what the code can prove. A missing/empty market
  // key means no tier lookup is even possible — distinct from "we looked and
  // found nothing."
  if (!marketKey || marketKey.trim().length === 0) {
    return buildConfidenceDeltaFallback(confidence, submittedOdds, 'no-market-key');
  }

  // Moneyline lookups require a resolvable participant (selection) to scope
  // the provider-offer query. An empty selection on a moneyline pick means
  // the required participant scope is unavailable — distinguishable from a
  // provider-offer miss, which happens after a valid scope is established.
  if (marketKey === 'moneyline' && resolveSelectionParticipantKey(marketKey, selection) === null) {
    return buildConfidenceDeltaFallback(confidence, submittedOdds, 'no-participant-scope');
  }

  // UTV2-1898: refuse before querying when any discriminating dimension is
  // unresolved. Each reason names the dimension that was missing, so an
  // operator reading `edgeProvenance.fallbackReason` learns what to fix rather
  // than only that edge was unavailable. Order is deliberate: sport, then
  // event, then side — widest scope first, so the reported reason is the
  // outermost thing that is missing.
  if (scope.sportKey == null || scope.sportKey.trim().length === 0) {
    return buildConfidenceDeltaFallback(confidence, submittedOdds, 'no-sport-scope');
  }
  if (scope.providerEventId == null || scope.providerEventId.trim().length === 0) {
    return buildConfidenceDeltaFallback(confidence, submittedOdds, 'no-event-scope');
  }
  if (scope.providerParticipantId === undefined) {
    return buildConfidenceDeltaFallback(confidence, submittedOdds, 'no-participant-scope');
  }

  try {
    // Translate canonical market key to SGO provider-native format once. The DB
    // stores provider-format keys (e.g., 'player-points-game-ou'); canonical keys
    // (e.g., 'player.points-all-game-ou') miss every row. For InMemory test repos
    // that store canonical keys, resolveProviderMarketKey returns null and the
    // canonical key is used as-is (preserving existing test behaviour).
    const sgoProviderKey = await providerOffers.resolveProviderMarketKey(marketKey, 'sgo');
    const resolvedKey = sgoProviderKey ?? marketKey;

    // UTV2-1898: the participant and the side are resolved from the CANONICAL
    // key, never from `resolvedKey`. Deriving them after translation is what
    // silently dropped the participant scope: `resolveSelectionParticipantKey`
    // returns `undefined` for anything that is not literally 'moneyline', and
    // the translated key never is.
    const lookup: ScopedOfferLookupContext = {
      sportKey: scope.sportKey,
      providerEventId: scope.providerEventId,
      providerMarketKey: resolvedKey,
      providerParticipantId: scope.providerParticipantId,
      canonicalMarketKey: marketKey,
      notBefore: new Date(scope.now.getTime() - PROVIDER_OFFER_MAX_AGE_MS),
    };
    let sawStaleOffer = false;
    let sawUnattributedOffer = false;
    const noteStale = (): void => {
      sawStaleOffer = true;
    };
    const noteUnattributed = (): void => {
      sawUnattributedOffer = true;
    };

    // Try Pinnacle first (sharpest line)
    const pinnacleEdge = await tryProviderEdge(
      confidence, selection, 'odds-api:pinnacle', providerOffers, lookup, noteStale, noteUnattributed,
    );
    if (pinnacleEdge) {
      const marketSource = 'pinnacle' as const;
      const contrarySignal = classifyContrarianism(pinnacleEdge.modelProbability, pinnacleEdge.marketProbability, marketSource);
      return {
        ...pinnacleEdge, marketSource, contrarySignal,
        provenance: { method: 'market-devigged', providerCoverageState: 'pinnacle', fallbackReason: null },
      };
    }

    // Try multi-book consensus
    const consensusEdge = await tryConsensusEdge(
      confidence, selection, providerOffers, lookup, noteStale, noteUnattributed,
    );
    if (consensusEdge) {
      const contrarySignal = classifyContrarianism(consensusEdge.modelProbability, consensusEdge.marketProbability, consensusEdge.marketSource);
      return {
        ...consensusEdge, contrarySignal,
        provenance: { method: 'market-devigged', providerCoverageState: 'consensus', fallbackReason: null },
      };
    }

    // Try SGO (existing single provider)
    const sgoEdge = await tryProviderEdge(
      confidence, selection, 'sgo', providerOffers, lookup, noteStale, noteUnattributed,
    );
    if (sgoEdge) {
      const marketSource = 'sgo' as const;
      const contrarySignal = classifyContrarianism(sgoEdge.modelProbability, sgoEdge.marketProbability, marketSource);
      return {
        ...sgoEdge, marketSource, contrarySignal,
        provenance: { method: 'market-devigged', providerCoverageState: 'sgo', fallbackReason: null },
      };
    }

    // Root cause UTV2-571: a single fresh non-SGO book used to miss every
    // market-backed branch because consensus requires two books and provider
    // lookup only checked Pinnacle/SGO directly. Use that book before falling
    // back to self-reported confidence delta.
    const singleBookEdge = await tryProviderEdge(
      confidence, selection, undefined, providerOffers, lookup, noteStale, noteUnattributed,
    );
    if (singleBookEdge) {
      const marketSource = 'single-book' as const;
      const contrarySignal = classifyContrarianism(singleBookEdge.modelProbability, singleBookEdge.marketProbability, marketSource);
      return {
        ...singleBookEdge, marketSource, contrarySignal,
        provenance: { method: 'market-devigged', providerCoverageState: 'single-book', fallbackReason: null },
      };
    }
    if (sawUnattributedOffer) {
      // UTV2-1898: an in-scope, in-window offer exists but prices a side it
      // does not name. Refusing it is the whole point — reading it as the
      // "over" side is how a moneyline pick acquired a market probability
      // belonging to the other team.
      return buildConfidenceDeltaFallback(
        confidence, submittedOdds, 'offer-participant-unattributed',
      );
    }
    if (sawStaleOffer) {
      // UTV2-1898: an offer matched the pick's full scope but every snapshot
      // was outside the freshness window. That is a materially different
      // operator signal from "this market has no coverage at all".
      return buildConfidenceDeltaFallback(confidence, submittedOdds, 'no-fresh-offer');
    }
  } catch (error) {
    if (error instanceof RealEdgeComputationError) {
      return buildConfidenceDeltaFallback(confidence, submittedOdds, 'computation-error');
    }
    // Any other unexpected exception (e.g. a repository throw) is a
    // computation error too — UTV2-1379: fail closed to a labeled fallback
    // rather than letting the exception propagate into a silent
    // "success" branch further up the call stack.
    return buildConfidenceDeltaFallback(confidence, submittedOdds, 'computation-error');
  }

  // No tier found usable market data. UTV2-985: this must be explicitly
  // labeled; it cannot masquerade as market edge.
  return buildConfidenceDeltaFallback(confidence, submittedOdds, 'no-provider-offer');
}

/**
 * Fallback: confidence delta (not real edge — no market data available).
 * PM UTV2-985: must be explicitly labeled. PM UTV2-1379: fallbackReason must
 * reflect the most specific cause the code can prove.
 */
function buildConfidenceDeltaFallback(
  confidence: number,
  submittedOdds: number,
  fallbackReason: EdgeFallbackReason,
): RealEdgeResult {
  const impliedFromOdds = americanToImplied(submittedOdds);
  const confidenceDelta = roundTo(confidence - impliedFromOdds, 6);
  const contrarySignal = classifyContrarianism(confidence, impliedFromOdds, 'confidence-delta');

  return {
    realEdge: confidenceDelta,
    modelProbability: confidence,
    marketProbability: impliedFromOdds,
    marketSource: 'confidence-delta',
    bookCount: 0,
    // UTV2-985: confidence-delta must never contribute positive edge.
    hasRealEdge: false,
    contrarySignal,
    provenance: {
      method: 'confidence-delta',
      providerCoverageState: 'none',
      fallbackReason,
    },
  };
}

/**
 * UTV2-1898: the resolved scope a lookup runs under, carried as one value so a
 * tier helper cannot construct a partial one.
 */
interface ScopedOfferLookupContext {
  sportKey: string;
  providerEventId: string;
  /** Provider-native key, already translated. Used ONLY for the query. */
  providerMarketKey: string;
  providerParticipantId: string | null;
  /** Canonical key. Used for participant and side semantics. */
  canonicalMarketKey: string;
  /** Offers with `snapshot_at` before this instant are refused. */
  notBefore: Date;
}

/**
 * UTV2-1898: markets whose price belongs to one participant, so a provider row
 * that carries no participant cannot be attributed to the pick's selection. For
 * these, an unattributed offer is refused rather than read as the "over" side.
 *
 * The set is taken from `classifyMarketFamilyForGrading` rather than re-derived
 * here. That classifier is already the repository's single definition of which
 * markets name a participant, and grading depends on it being right; keeping a
 * second private copy is how the submission and edge paths drifted apart in the
 * first place.
 *
 * An unrecognised key counts as participant-scoped. Refusing an unknown market
 * costs an edge; classifying it game-level matches a NULL-participant row and
 * fabricates one, which is the failure this lane exists to close.
 */
function requiresAttributedParticipant(canonicalMarketKey: string): boolean {
  const rule = classifyMarketFamilyForGrading(canonicalMarketKey);
  if (rule.family === 'unsupported') return true;
  return rule.participantRequirement === 'required';
}

/**
 * Markets with no over/under axis, where the devigged "over" price IS the named
 * participant's price.
 *
 * Deliberately NOT the same set as `requiresAttributedParticipant`, and the two
 * must not be folded together: a player prop and a team total are both
 * participant-scoped *and* carry a real over/under, so treating them as
 * side-bearing would read every "Under" selection as its "Over".
 *
 * `spread` is participant-scoped and plausibly belongs here too, but no spread
 * offer exists in production to verify the provider's over/under orientation
 * against, so it is left out rather than assumed. It still reaches the
 * over/under heuristic below, where a spread selection ("Lions -3.5") contains
 * no "under" and resolves to `overFair` anyway — the same answer, reached by a
 * rule that has been checked rather than by one that has not.
 */
function namedSideIsOverSide(canonicalMarketKey: string): boolean {
  return canonicalMarketKey === 'moneyline';
}

/**
 * Applies freshness and side-attribution to a scoped offer.
 * Returns the usable row, or null with the reason flagged for the caller.
 */
function admitOffer(
  matching: ProviderOfferRecord | null,
  lookup: ScopedOfferLookupContext,
  noteStale: () => void,
  noteUnattributed: () => void,
): ProviderOfferRecord | null {
  if (!matching) return null;

  const snapshotAt = matching.snapshot_at ? Date.parse(matching.snapshot_at) : Number.NaN;
  if (!Number.isFinite(snapshotAt) || snapshotAt < lookup.notBefore.getTime()) {
    noteStale();
    return null;
  }

  if (
    requiresAttributedParticipant(lookup.canonicalMarketKey) &&
    matching.provider_participant_id == null
  ) {
    // The row prices one side of the game but says which side nowhere. Reading
    // `overFair` here would pick an arbitrary team; every game-moneyline row in
    // production carries a NULL participant, so this is the common case, not
    // an edge case.
    noteUnattributed();
    return null;
  }

  return matching;
}

/**
 * Try to compute edge against a single provider's devigged line.
 */
async function tryProviderEdge(
  confidence: number,
  selection: string,
  providerKey: string | undefined,
  providerOffers: ProviderOfferRepository,
  lookup: ScopedOfferLookupContext,
  noteStale: () => void,
  noteUnattributed: () => void,
): Promise<Omit<RealEdgeResult, 'marketSource' | 'provenance'> | null> {
  const matching = admitOffer(
    await providerOffers.findLatestScopedOffer({
      sportKey: lookup.sportKey,
      providerEventId: lookup.providerEventId,
      providerMarketKey: lookup.providerMarketKey,
      providerParticipantId: lookup.providerParticipantId,
      ...(providerKey ? { providerKey } : {}),
    }),
    lookup,
    noteStale,
    noteUnattributed,
  );

  if (!matching) return null;
  if (!Number.isFinite(matching.over_odds) || !Number.isFinite(matching.under_odds)) return null;

  const overImplied = americanToImplied(matching.over_odds as number);
  const underImplied = americanToImplied(matching.under_odds as number);
  const devigged = proportionalDevig(overImplied, underImplied);
  if (!devigged) return null;

  const marketProbability = resolveSelectionFairProbability(
    lookup.canonicalMarketKey, selection, devigged,
  );

  const realEdge = roundTo(confidence - marketProbability, 6);

  return {
    realEdge,
    modelProbability: confidence,
    marketProbability,
    bookCount: 1,
    hasRealEdge: realEdge > 0,
  };
}

/**
 * Compute edge against multi-book consensus (average devigged probability).
 */
async function tryConsensusEdge(
  confidence: number,
  selection: string,
  providerOffers: ProviderOfferRepository,
  lookup: ScopedOfferLookupContext,
  noteStale: () => void,
  noteUnattributed: () => void,
): Promise<Omit<RealEdgeResult, 'provenance'> | null> {
  const consensusProviders = [
    'odds-api:pinnacle',
    'odds-api:draftkings',
    'odds-api:fanduel',
    'odds-api:betmgm',
  ];

  let totalProb = 0;
  let bookCount = 0;

  for (const providerKey of consensusProviders) {
    const matching = admitOffer(
      await providerOffers.findLatestScopedOffer({
        sportKey: lookup.sportKey,
        providerEventId: lookup.providerEventId,
        providerMarketKey: lookup.providerMarketKey,
        providerParticipantId: lookup.providerParticipantId,
        providerKey,
      }),
      lookup,
      noteStale,
      noteUnattributed,
    );

    if (!matching) continue;
    if (!Number.isFinite(matching.over_odds) || !Number.isFinite(matching.under_odds)) continue;

    const overImplied = americanToImplied(matching.over_odds as number);
    const underImplied = americanToImplied(matching.under_odds as number);
    const devigged = proportionalDevig(overImplied, underImplied);
    if (!devigged) continue;

    totalProb += resolveSelectionFairProbability(lookup.canonicalMarketKey, selection, devigged);
    bookCount++;
  }

  if (bookCount < 2) return null; // Need at least 2 books for consensus

  const consensusProb = totalProb / bookCount;
  const realEdge = roundTo(confidence - consensusProb, 6);

  return {
    realEdge,
    modelProbability: confidence,
    marketProbability: consensusProb,
    marketSource: 'consensus',
    bookCount,
    hasRealEdge: realEdge > 0,
  };
}

function resolveSelectionParticipantKey(marketKey: string, selection: string): string | null | undefined {
  if (marketKey !== 'moneyline') {
    return undefined;
  }

  const normalized = selection.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveSelectionFairProbability(
  canonicalMarketKey: string,
  selection: string,
  devigged: { overFair: number; underFair: number },
): number {
  // UTV2-1898: `canonicalMarketKey` is the canonical key, never the translated
  // provider key. Passing the provider key here made the moneyline branch
  // unreachable, so a moneyline fell through to the over/under heuristic and
  // matched `overFair` by accident rather than by rule.
  //
  // A side-bearing market only reaches this function once `admitOffer` has
  // established that the offer names its participant, so `overFair` is the
  // fair price of the named side rather than an arbitrary one.
  if (namedSideIsOverSide(canonicalMarketKey)) {
    return devigged.overFair;
  }

  return /\bunder\b/i.test(selection) ? devigged.underFair : devigged.overFair;
}
