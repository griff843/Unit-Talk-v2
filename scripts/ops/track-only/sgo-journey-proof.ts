// UTV2-1889 -- submission-to-result journey proof, driven through the REAL SGO
// normalization and the REAL grading classification.
//
// Why this file exists. The operator-attestation route is deferred, and the intended
// route is SGO-backed. Before paid data is activated, the question worth answering is
// not "does the grading code work?" but "does an SGO-written result actually JOIN to a
// Smart Form pick?" -- and that join is where every gap below lives.
//
// What is real here and what is not. Everything that normalizes, canonicalizes or
// classifies is the shipped code, imported directly:
//
//   * apps/ingestor/src/sgo-fetcher.ts        -- the real payload parse and the real
//                                                extractScoredMarkets / normalizeMarketKey
//   * apps/ingestor/src/results-resolver.ts   -- the real SGO_GAME_LINE_CANONICAL_ID
//                                                and the real write path
//   * apps/api/src/grading-service.ts         -- the real classifier and the real
//                                                market-key candidate aliases
//   * @unit-talk/domain normalizeMarketKey    -- the real pick-side normalization
//
// The ONLY substitution is the HTTP transport: `fetchImpl` is injected so the fixture
// is served from memory. That substitution is deliberate and is the point -- SGO
// activation is unapproved, so the proof must not reach the provider. Nothing that
// decides a market key, a participant or an outcome is mocked.
//
// The fixture is clearly identified as a fixture. Its provider event id carries the
// STAGING_FIXTURE_PREFIX below and its teams are named so no real slate can collide
// with it. `assertFixtureIsIdentifiable` refuses a payload that does not, because a
// journey proof that quietly used a real event would prove the wrong thing.

import { normalizeMarketKey as normalizePickMarketKey } from '@unit-talk/domain';

import { fetchSGOResults } from '../../../apps/ingestor/src/sgo-fetcher.js';
import type {
  SGOEventResult,
  SGOMarketScore,
} from '../../../apps/ingestor/src/sgo-fetcher.js';
import { SGO_GAME_LINE_CANONICAL_ID } from '../../../apps/ingestor/src/results-resolver.js';
import {
  classifyMarketFamilyForGrading,
  COMMON_GRADING_MARKET_ALIASES,
  MONEYLINE_RESULT_MARKET_KEY,
} from '../../../apps/api/src/grading-service.js';
import type { MarketFamilyRule } from '../../../apps/api/src/grading-service.js';

/**
 * Every fixture this module builds carries this in its provider event id. It is
 * asserted rather than assumed: see `assertFixtureIsIdentifiable`.
 */
export const STAGING_FIXTURE_PREFIX = 'UTV2-1889-STAGING-FIXTURE';

export interface JourneyStageParse {
  /** Events the real parser accepted from the fixture payload. */
  events: SGOEventResult[];
  /** Scored markets the real `extractScoredMarkets` produced, flattened. */
  scoredMarkets: SGOMarketScore[];
}

export interface JourneyStageResolve {
  /**
   * The market_key the REAL resolver would write, per scored market, computed with
   * the resolver's own table and its own `??` fallback rather than re-derived.
   */
  writes: Array<{
    oddId: string;
    baseMarketKey: string;
    /** What `SGO_GAME_LINE_CANONICAL_ID[base] ?? base` yields. */
    writtenMarketKey: string;
    /** True when the canonical table actually matched. False means the raw key fell through. */
    canonicalTableMatched: boolean;
    /** The value the resolver writes into `actual_value`. */
    writtenActualValue: number;
    providerSide: 'home' | 'away' | null;
    providerParticipantId: string | null;
  }>;
}

export interface JourneyStageGrade {
  /** `normalizeMarketKey(pick.market)` -- the real domain normalization. */
  normalizedPickMarketKey: string;
  rule: MarketFamilyRule;
  /**
   * The market keys grading would look for. Computed from the real static alias table.
   * The live `provider_market_aliases` lookups are named in `unresolvedDynamicAliases`
   * rather than guessed, because they need a database.
   */
  staticCandidateMarketKeys: string[];
  unresolvedDynamicAliases: string[];
}

export interface JourneyGap {
  id: string;
  stage: 'parse' | 'resolve' | 'grade' | 'join';
  summary: string;
  evidence: string;
  /** Where the repair has to land. Recorded because it decides lane scope. */
  owningPath: string;
}

export interface SgoJourneyProofReport {
  fixtureEventId: string;
  parse: JourneyStageParse;
  resolve: JourneyStageResolve;
  grade: JourneyStageGrade;
  /** Market keys written by the resolver that grading would actually find. */
  joinedMarketKeys: string[];
  /** True only when at least one written key is one grading looks for. */
  journeyCompletes: boolean;
  gaps: JourneyGap[];
}

/**
 * A faithful slice of an SGO results payload for a finalized MLB game.
 *
 * The `oddID` shapes are the real provider shapes -- `points-home-game-ml-home`
 * carries stat entity `home`, which is the case UTV2-1868 exists for. They are NOT
 * the shapes `SGO_GAME_LINE_CANONICAL_ID` is keyed on, and proving that mismatch
 * against the real normalizer is most of the value of this fixture.
 */
export function buildStagingResultsPayload(options?: {
  homeScore?: number;
  awayScore?: number;
}): unknown {
  const homeScore = options?.homeScore ?? 3;
  const awayScore = options?.awayScore ?? 5;

  return {
    data: [
      {
        eventID: `${STAGING_FIXTURE_PREFIX}-MLB-0001`,
        status: {
          started: true,
          completed: true,
          cancelled: false,
          ended: true,
          live: false,
          delayed: false,
          finalized: true,
          oddsAvailable: false,
        },
        teams: {
          home: { teamID: `${STAGING_FIXTURE_PREFIX}-HOME`, names: { long: 'Fixture Home Nine' } },
          away: { teamID: `${STAGING_FIXTURE_PREFIX}-AWAY`, names: { long: 'Fixture Away Nine' } },
        },
        results: {},
        odds: {
          // Full-game moneyline, home side. Stat entity `home`.
          'points-home-game-ml-home': {
            oddID: 'points-home-game-ml-home',
            statEntityID: 'home',
            scoringSupported: true,
            score: homeScore,
          },
          // Full-game moneyline, away side.
          'points-away-game-ml-away': {
            oddID: 'points-away-game-ml-away',
            statEntityID: 'away',
            scoringSupported: true,
            score: awayScore,
          },
          // Game total, genuinely game-scoped (stat entity `all`).
          'points-all-game-ou-over': {
            oddID: 'points-all-game-ou-over',
            statEntityID: 'all',
            scoringSupported: true,
            score: homeScore + awayScore,
          },
        },
      },
    ],
  };
}

/**
 * Refuses a payload whose events are not obviously fixtures. A journey proof that
 * silently ran against a real slate would read as evidence and be worthless, so this
 * fails closed rather than warning.
 */
export function assertFixtureIsIdentifiable(payload: unknown): void {
  const data = (payload as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('journey fixture is empty -- refusing to report a vacuous pass');
  }
  for (const event of data) {
    const id = (event as { eventID?: unknown }).eventID;
    if (typeof id !== 'string' || !id.startsWith(STAGING_FIXTURE_PREFIX)) {
      throw new Error(
        `journey fixture event id ${JSON.stringify(id)} does not carry ${STAGING_FIXTURE_PREFIX} -- refusing to run the proof against data that could be real`,
      );
    }
  }
}

/** Serves the fixture in place of the provider. No network, no API key, no paid call. */
function fixtureFetchImpl(payload: unknown): typeof fetch {
  let served = false;
  return (async () => {
    // The real pager follows `nextCursor`; serving the page once and then an empty
    // page terminates it exactly as a real single-page response would.
    const body = served ? { data: [] } : payload;
    served = true;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

/**
 * Runs the fixture through the real parse, then computes -- using the resolver's and
 * the grader's own tables -- whether the written result would join to the pick.
 *
 * No database is required. The join is a pure comparison of market keys and values,
 * which is precisely where the journey breaks, so proving it needs no rows.
 */
export async function runSgoJourneyProof(input: {
  /** The pick's `market` as persisted. Milestone 1's pick carries `moneyline`. */
  pickMarket: string;
  payload?: unknown;
}): Promise<SgoJourneyProofReport> {
  const payload = input.payload ?? buildStagingResultsPayload();
  assertFixtureIsIdentifiable(payload);

  // --- Stage 1: the real parser -------------------------------------------------
  const events = await fetchSGOResults({
    apiKey: 'fixture-key-not-a-credential',
    league: 'MLB',
    snapshotAt: new Date(0).toISOString(),
    fetchImpl: fixtureFetchImpl(payload),
  });
  const scoredMarkets = events.flatMap((event) => event.scoredMarkets);

  // --- Stage 2: the real resolver's canonicalization ----------------------------
  const writes = scoredMarkets.map((market) => {
    const canonical = SGO_GAME_LINE_CANONICAL_ID[market.baseMarketKey];
    return {
      oddId: market.oddId,
      baseMarketKey: market.baseMarketKey,
      writtenMarketKey: canonical ?? market.baseMarketKey,
      canonicalTableMatched: canonical !== undefined,
      writtenActualValue: market.score,
      providerSide: market.providerSide,
      providerParticipantId: market.providerParticipantId,
    };
  });

  // --- Stage 3: the real grading classification ---------------------------------
  const normalizedPickMarketKey = normalizePickMarketKey(input.pickMarket);
  const rule = classifyMarketFamilyForGrading(normalizedPickMarketKey);
  const staticCandidates = new Set<string>([normalizedPickMarketKey]);
  const staticAlias = COMMON_GRADING_MARKET_ALIASES[normalizedPickMarketKey];
  if (staticAlias) {
    staticCandidates.add(staticAlias);
  }
  const staticCandidateMarketKeys = [...staticCandidates];

  // --- The join -----------------------------------------------------------------
  const writtenKeys = new Set(writes.map((write) => write.writtenMarketKey));
  const joinedMarketKeys = staticCandidateMarketKeys.filter((key) =>
    writtenKeys.has(key),
  );

  const gaps = collectJourneyGaps({
    rule,
    writes,
    staticCandidateMarketKeys,
    joinedMarketKeys,
  });

  return {
    fixtureEventId: `${STAGING_FIXTURE_PREFIX}-MLB-0001`,
    parse: { events, scoredMarkets },
    resolve: { writes },
    grade: {
      normalizedPickMarketKey,
      rule,
      staticCandidateMarketKeys,
      unresolvedDynamicAliases: [
        `provider_market_aliases(provider='sgo', provider_market_key='${normalizedPickMarketKey}')`,
      ],
    },
    joinedMarketKeys,
    journeyCompletes: joinedMarketKeys.length > 0,
    gaps,
  };
}

function collectJourneyGaps(input: {
  rule: MarketFamilyRule;
  writes: JourneyStageResolve['writes'];
  staticCandidateMarketKeys: string[];
  joinedMarketKeys: string[];
}): JourneyGap[] {
  const gaps: JourneyGap[] = [];

  // Gap A -- the canonical table is keyed on a shape the normalizer cannot emit.
  const unmatched = input.writes.filter(
    (write) => !write.canonicalTableMatched && write.providerParticipantId === null,
  );
  if (unmatched.length > 0) {
    gaps.push({
      id: 'A-canonical-table-unreachable',
      stage: 'resolve',
      summary:
        'SGO_GAME_LINE_CANONICAL_ID is keyed on market strings the SGO normalizer cannot produce, so the raw provider key falls through the `??` instead.',
      evidence: `normalizer emitted ${unmatched
        .map((write) => write.baseMarketKey)
        .join(', ')}; the table is keyed on e.g. 'mlb-ml-all-game'. normalizeSgoProviderMarketKey builds '<statId>-all-<period>-<betType>', so a '<league>-<bet>-all-game' key is structurally unreachable.`,
      owningPath: 'apps/ingestor/src/results-resolver.ts',
    });
  }

  // Gap B -- value semantics. A raw team score is not a win/loss/push indicator.
  const rawScoreWrites = input.writes.filter(
    (write) => write.providerSide !== null,
  );
  if (input.rule.family === 'game_moneyline' && rawScoreWrites.length > 0) {
    gaps.push({
      id: 'B-raw-score-is-not-an-outcome',
      stage: 'join',
      summary:
        "resolveAndInsertResults writes `actual_value: scoredMarket.score` -- the team's raw score. Moneyline grading reads a single value as an outcome, which a score cannot express.",
      evidence: `fixture writes ${rawScoreWrites
        .map((write) => `${write.providerSide}=${write.writtenActualValue}`)
        .join(', ')}; grading accepts only 1 | 0 | 0.5 under ${MONEYLINE_RESULT_MARKET_KEY}. Settling a moneyline from SGO requires COMPARING the two sides' rows, not reading one.`,
      owningPath: 'apps/api/src/grading-service.ts + apps/ingestor/src/results-resolver.ts',
    });
  }

  // Gap C -- the join itself.
  if (input.joinedMarketKeys.length === 0) {
    gaps.push({
      id: 'C-no-market-key-join',
      stage: 'join',
      summary:
        'No market_key the resolver writes is one the grading pass looks for, so the result and the pick never meet.',
      evidence: `resolver writes [${input.writes
        .map((write) => write.writtenMarketKey)
        .join(', ')}]; grading looks for [${input.staticCandidateMarketKeys.join(', ')}].`,
      owningPath: 'apps/api/src/grading-service.ts',
    });
  }

  // Gap D -- side attribution exists in code but not in any stored row.
  if (rawScoreWrites.length > 0) {
    gaps.push({
      id: 'D-side-attribution-unproven-in-data',
      stage: 'resolve',
      summary:
        'The per-side write path (UTV2-1868) fires only when providerSide resolves AND event_participants already carries home/away roles. It cannot repair rows already stored.',
      evidence:
        'Measured read-only in production: every game-line market_key (points-all-game-ml 280 rows, points-all-game-sp 280, points-all-reg-ml3way 280, points-all-1h-sp 258, points-all-1h-ml 257) has 0 rows with a participant_id. Grading classifies a moneyline participantRequirement=required, so none of them can settle one.',
      owningPath: 'apps/ingestor/src/results-resolver.ts',
    });
  }

  return gaps;
}
