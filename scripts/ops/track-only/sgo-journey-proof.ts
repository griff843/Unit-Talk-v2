// UTV2-1889 -- submission-to-result journey proof, driven end to end through the
// REAL normalization, the REAL persistence path, the REAL grading pass and the REAL
// statistics computation.
//
// Why this file exists. The operator-attestation route was deferred and then removed
// from this release (it is preserved in history at 4701685541); the intended route is
// SGO-backed. Before paid data is activated, the question worth answering is
// not "does the grading code work?" but "does an SGO-written result actually settle a
// Track Only pick, and does the settled row then count?" -- and that is the whole
// journey, not one seam of it.
//
// What is real here and what is not. Everything that normalizes, canonicalizes,
// classifies, persists, grades or counts is the shipped code, imported directly:
//
//   * apps/ingestor/src/sgo-fetcher.ts        -- the real payload parse and the real
//                                                extractScoredMarkets / normalizeMarketKey
//   * apps/ingestor/src/results-resolver.ts   -- the real canonicalization, the real
//                                                moneyline outcome derivation, the real
//                                                side attribution and the real write
//   * apps/api/src/submission-service.ts      -- the real submission -> canonical pick
//   * apps/api/src/grading-service.ts         -- the real grading pass, end to end
//   * scripts/ops/track-only/stats.ts         -- the real Track Only statistics
//   * @unit-talk/domain normalizeMarketKey    -- the real pick-side normalization
//
// ONE substitution is permanent, and one is now the caller's choice:
//
//   1. The HTTP transport. `fetchImpl` is injected so the fixture is served from
//      memory. SGO activation is unapproved, so the proof must not reach the provider.
//      This substitution is not optional and does not go away.
//   2. The database. `input.repositories` decides it. Absent, an in-memory bundle
//      stands in for Supabase, which is what keeps the unit suite credential-free.
//      Supplied with a bundle backed by the staging database, the substitution is
//      WITHDRAWN and every stage reads and writes real rows. Nothing else about the
//      journey differs between the two, which is what makes the staging run evidence
//      about this code rather than about a second code path written to mirror it.
//
// Nothing that decides a market key, a participant, an outcome, a settlement or a
// statistic is mocked. In particular the rows grading reads are the rows the resolver
// actually inserted, read back out of the repository rather than predicted.
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
import {
  SGO_GAME_LINE_CANONICAL_ID,
  SGO_MONEYLINE_RESULT_MARKET_KEY,
  resolveAndInsertResults,
} from '../../../apps/ingestor/src/results-resolver.js';
import type { ResultsResolutionSummary } from '../../../apps/ingestor/src/results-resolver.js';
import {
  classifyMarketFamilyForGrading,
  COMMON_GRADING_MARKET_ALIASES,
  MONEYLINE_RESULT_MARKET_KEY,
  runGradingPass,
} from '../../../apps/api/src/grading-service.js';
import type { MarketFamilyRule } from '../../../apps/api/src/grading-service.js';
import { processSubmission } from '../../../apps/api/src/submission-service.js';
import { createInMemoryRepositoryBundle } from '../../../apps/api/src/persistence.js';
import { outboxStatuses } from '@unit-talk/db';
import type { RepositoryBundle } from '@unit-talk/db';
import { computeTrackOnlyStats } from './stats.js';
import type { StatsInputPick, TrackOnlyStats } from './stats.js';

/**
 * The moneyline result market key is duplicated across the app boundary on purpose:
 * `apps/ingestor` may not import from `apps/api` (core invariant 8). The duplication
 * is ENFORCED rather than documented -- this module imports both copies and refuses to
 * load when they disagree, so changing either one alone fails the suite. A `file:line`
 * comment would document the coupling; this fails on it.
 */
if (SGO_MONEYLINE_RESULT_MARKET_KEY !== MONEYLINE_RESULT_MARKET_KEY) {
  throw new Error(
    `moneyline result market key drift: apps/ingestor says ${JSON.stringify(
      SGO_MONEYLINE_RESULT_MARKET_KEY,
    )}, apps/api says ${JSON.stringify(MONEYLINE_RESULT_MARKET_KEY)}. ` +
      'These are two copies of one literal and must be changed together.',
  );
}

/**
 * Every fixture this module builds carries this in its provider event id. It is
 * asserted rather than assumed: see `assertFixtureIsIdentifiable`.
 */
export const STAGING_FIXTURE_PREFIX = 'UTV2-1889-STAGING-FIXTURE';

const FIXTURE_EVENT_NAME = 'Fixture Away Nine @ Fixture Home Nine';

/**
 * The event *name* carries the namespace too, and that is load-bearing rather than
 * tidy -- but not for the reason the first version of this comment gave. The name is
 * one of the six inputs to `computeSubmissionIdempotencyKey` in the submission
 * service (source | market | selection | line | odds | eventName); metadata is not.
 * So two fixtures that differ only in their participant ids and provider event id
 * hash to the SAME idempotency key, and `processSubmission` hands the second run the
 * first run's existing pick instead of creating one. That is exactly what happened
 * the first time this proof ran against staging: the half-scored fixture correctly
 * wrote no moneyline result, but its "pick" was the fully-scored run's pick, carrying
 * that run's genuine settlement. Grading resolved nothing wrongly -- `resolvePickEvent`
 * does filter candidate events by the pick's participant -- there was simply no
 * second pick. Namespacing the id alone was not isolation; the name is what makes the
 * submission distinct.
 */
function fixtureEventName(namespace?: string): string {
  return `${FIXTURE_EVENT_NAME}${fixtureNamespaceSuffix(namespace)}`;
}
const FIXTURE_EVENT_DATE = '2026-09-11';
const FIXTURE_EVENT_STARTS_AT = '2026-09-11T23:05:00.000Z';
const FIXTURE_INGESTION_RUN_ID = 'run-utv2-1889-journey-fixture';

/**
 * A fixture namespace scopes every external identifier this module mints.
 *
 * In memory it is unnecessary and defaults to empty, which reproduces the original
 * identifiers byte for byte. Against a SHARED staging database it is what keeps one
 * run's rows from being read as another's: `upsertByExternalId` is idempotent on the
 * external id, so two runs sharing one would silently resolve to a single event and
 * the second run's assertions would be made about the first run's rows.
 *
 * Restricted to characters that cannot change the shape of an identifier, so a
 * namespace can never smuggle in a separator or escape the prefix.
 */
export function fixtureNamespaceSuffix(namespace?: string): string {
  if (namespace === undefined || namespace === '') return '';
  if (!/^[A-Za-z0-9-]{1,64}$/.test(namespace)) {
    throw new Error(
      `fixture namespace ${JSON.stringify(namespace)} must match /^[A-Za-z0-9-]{1,64}$/`,
    );
  }
  return `-${namespace.toUpperCase()}`;
}

export function fixtureEventExternalId(namespace?: string): string {
  return `${STAGING_FIXTURE_PREFIX}${fixtureNamespaceSuffix(namespace)}-MLB-0001`;
}

function fixtureTeamExternalId(side: 'HOME' | 'AWAY', namespace?: string): string {
  return `${STAGING_FIXTURE_PREFIX}${fixtureNamespaceSuffix(namespace)}-${side}`;
}

export interface JourneyStageParse {
  /** Events the real parser accepted from the fixture payload. */
  events: SGOEventResult[];
  /** Scored markets the real `extractScoredMarkets` produced, flattened. */
  scoredMarkets: SGOMarketScore[];
}

export interface JourneyStageResolve {
  /**
   * The market_key the REAL resolver canonicalizes to, per scored market, computed
   * with the resolver's own table and its own `??` fallback rather than re-derived.
   */
  writes: Array<{
    oddId: string;
    baseMarketKey: string;
    /** What `SGO_GAME_LINE_CANONICAL_ID[base] ?? base` yields. */
    writtenMarketKey: string;
    /** True when the canonical table actually matched. False means the raw key fell through. */
    canonicalTableMatched: boolean;
    providerSide: 'home' | 'away' | null;
    providerParticipantId: string | null;
  }>;
  /**
   * The rows the resolver ACTUALLY inserted, read back out of the repository. This is
   * deliberately not the `writes` prediction above: the value written for a moneyline
   * is derived by comparing both sides, so predicting it here would re-implement the
   * thing under proof.
   */
  inserted: Array<{
    marketKey: string;
    participantId: string | null;
    actualValue: number;
    source: string;
  }>;
  summary: ResultsResolutionSummary;
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

export interface JourneyStageSettle {
  pickId: string;
  /** The lifecycle state the pick holds AFTER the grading pass ran. */
  pickStatus: string;
  attempted: number;
  graded: number;
  skipped: number;
  errors: number;
  /** `win` | `loss` | `push` | ... as recorded on the settlement row, or null. */
  settlementResult: string | null;
  /** True when the settlement was recorded on the evidence plane (no lifecycle move). */
  evidencePlane: boolean;
  profitLossUnits: number | null;
  /**
   * Delivery rows addressed to this pick, counted AFTER the grading pass. Track Only
   * must produce none. Counted rather than asserted here so the caller sees the
   * number that was read, and so zero is a measurement rather than an absence of one.
   */
  deliveryRowCount: number;
}

export interface JourneyGap {
  id: string;
  stage: 'parse' | 'resolve' | 'grade' | 'join' | 'settle' | 'stats';
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
  settle: JourneyStageSettle;
  stats: TrackOnlyStats;
  /** Market keys written by the resolver that grading would actually find. */
  joinedMarketKeys: string[];
  /**
   * True only when the pick actually settled with a decided outcome AND that
   * settlement is countable by the Track Only statistics. A market-key join alone is
   * no longer sufficient -- the earlier version of this proof stopped there, and a key
   * that joins but never settles is exactly the state this file exists to detect.
   */
  journeyCompletes: boolean;
  gaps: JourneyGap[];
}

/**
 * A faithful slice of an SGO results payload for a finalized MLB game.
 *
 * The `oddID` shapes are the real provider shapes -- `points-home-game-ml-home`
 * carries stat entity `home`, which is the case UTV2-1868 exists for. The real
 * normalizer erases that entity from the key (`points-all-game-ml` for BOTH sides),
 * so the side survives only on `providerSide`, and proving the journey against that
 * is most of the value of this fixture.
 */
export function buildStagingResultsPayload(options?: {
  homeScore?: number;
  awayScore?: number;
  fixtureNamespace?: string;
}): unknown {
  const homeScore = options?.homeScore ?? 3;
  const awayScore = options?.awayScore ?? 5;
  const namespace = options?.fixtureNamespace;

  return {
    data: [
      {
        eventID: fixtureEventExternalId(namespace),
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
          home: {
            teamID: fixtureTeamExternalId('HOME', namespace),
            names: { long: 'Fixture Home Nine' },
          },
          away: {
            teamID: fixtureTeamExternalId('AWAY', namespace),
            names: { long: 'Fixture Away Nine' },
          },
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
 * The event provenance grading requires. Written out rather than imported because the
 * shape lives in a test file; every field here is read by
 * `validateEventProvenanceForGrading`, and omitting any one of them fails the pass
 * closed, which is the point of seeding it explicitly.
 */
function trustedSgoEventMetadata(): Record<string, unknown> {
  return {
    starts_at: FIXTURE_EVENT_STARTS_AT,
    source: 'sgo',
    providerKey: 'sgo',
    ingestionSource: 'ingestor.cycle',
    ingestionCycleRunId: FIXTURE_INGESTION_RUN_ID,
  };
}

export interface SgoJourneyProofInput {
  /** The pick's `market` as persisted. Milestone 1's pick carries `moneyline`. */
  pickMarket: string;
  /** The pick's selection text. Defaults to the away team, which wins the fixture. */
  pickSelection?: string;
  /** The pick's line. A moneyline has none; a total must have one. */
  pickLine?: number | null;
  /**
   * Which seeded team the pick is on, when the market needs one. `null` is the correct
   * value for a game total, which belongs to the game rather than a side.
   */
  pickTeamSide?: 'home' | 'away' | null;
  payload?: unknown;
  /**
   * The repository bundle every stage writes through and reads back. Absent, an
   * in-memory bundle is created, which is what the unit suite uses and what keeps
   * this proof credential-free by default.
   *
   * Supplying a bundle backed by the staging database is what turns this from an
   * in-memory composition into a real persistence proof. Nothing else about the
   * journey changes -- which is the point: the same code path is exercised, and the
   * only substitution named in this file's header is withdrawn.
   */
  repositories?: RepositoryBundle;
  /**
   * Scopes every external identifier this run mints. Required in practice against a
   * shared database; see `fixtureNamespaceSuffix`.
   */
  fixtureNamespace?: string;
}

/**
 * Runs the fixture through the real parse, the real resolver (writing into a real
 * repository), the real grading pass and the real statistics computation.
 *
 * No credential and no database are required, and nothing outside this process is
 * written. What IS required is that every row grading reads was produced by the
 * resolver rather than by this function.
 */
export async function runSgoJourneyProof(
  input: SgoJourneyProofInput,
): Promise<SgoJourneyProofReport> {
  const namespace = input.fixtureNamespace;
  const payload =
    input.payload ?? buildStagingResultsPayload({ fixtureNamespace: namespace });
  assertFixtureIsIdentifiable(payload);

  const fixtureEventId = fixtureEventExternalId(namespace);
  const repositories = input.repositories ?? createInMemoryRepositoryBundle();

  // --- Stage 1: the real parser -------------------------------------------------
  const events = await fetchSGOResults({
    apiKey: 'fixture-key-not-a-credential',
    league: 'MLB',
    snapshotAt: new Date(0).toISOString(),
    fetchImpl: fixtureFetchImpl(payload),
  });
  const scoredMarkets = events.flatMap((event) => event.scoredMarkets);

  // --- Stage 2a: seed the canonical rows the resolver resolves against ----------
  // The external id MUST equal the provider event id: `resolveAndInsertResults` finds
  // the event by `findByExternalId(providerEventId)` and skips everything under an
  // event it cannot find.
  const homeParticipant = await repositories.participants.upsertByExternalId({
    externalId: fixtureTeamExternalId('HOME', namespace),
    displayName: 'Fixture Home Nine',
    participantType: 'team',
    sport: 'MLB',
    league: 'MLB',
    metadata: {},
  });
  const awayParticipant = await repositories.participants.upsertByExternalId({
    externalId: fixtureTeamExternalId('AWAY', namespace),
    displayName: 'Fixture Away Nine',
    participantType: 'team',
    sport: 'MLB',
    league: 'MLB',
    metadata: {},
  });
  const event = await repositories.events.upsertByExternalId({
    sportId: 'MLB',
    eventName: fixtureEventName(namespace),
    eventDate: FIXTURE_EVENT_DATE,
    externalId: fixtureEventId,
    status: 'completed',
    metadata: trustedSgoEventMetadata(),
  });
  await repositories.eventParticipants.upsert({
    eventId: event.id,
    participantId: homeParticipant.id,
    role: 'home',
  });
  await repositories.eventParticipants.upsert({
    eventId: event.id,
    participantId: awayParticipant.id,
    role: 'away',
  });

  // --- Stage 2b: the real resolver, writing real rows ---------------------------
  const writes = scoredMarkets.map((market) => {
    const canonical = SGO_GAME_LINE_CANONICAL_ID[market.baseMarketKey];
    return {
      oddId: market.oddId,
      baseMarketKey: market.baseMarketKey,
      writtenMarketKey: canonical ?? market.baseMarketKey,
      canonicalTableMatched: canonical !== undefined,
      providerSide: market.providerSide,
      providerParticipantId: market.providerParticipantId,
    };
  });

  const resolveSummary = await resolveAndInsertResults(events, repositories, {
    warn: () => {},
    info: () => {},
  });

  // Read the rows back rather than restating what was predicted.
  const insertedRows = await repositories.gradeResults.listByEvent(event.id);
  const inserted = insertedRows.map((row) => ({
    marketKey: row.market_key,
    participantId: row.participant_id,
    actualValue: Number(row.actual_value),
    source: row.source,
  }));

  // --- Stage 3: the real submission path ----------------------------------------
  const teamSide =
    input.pickTeamSide === undefined ? 'away' : input.pickTeamSide;
  const pickParticipant =
    teamSide === 'home' ? homeParticipant : teamSide === 'away' ? awayParticipant : null;

  const submissionMetadata: Record<string, unknown> = {
    // Track Only is what makes this pick admissible to grading at `validated` and
    // routes it down the evidence plane (UTV2-1861) instead of a lifecycle move.
    distributionMode: 'track-only',
    sport: 'MLB',
    eventName: fixtureEventName(namespace),
  };
  if (pickParticipant) {
    submissionMetadata['teamId'] = pickParticipant.id;
    submissionMetadata['team'] = pickParticipant.display_name;
  }

  const submissionResult = await processSubmission(
    {
      // `api` is a human-ingress source: it bypasses neither validation nor the
      // automated-write boundary, it simply is not an automated producer. Using
      // `smart-form` here would add the event-existence gate, which is a Smart Form
      // concern and not part of what this proof is measuring.
      source: 'api',
      market: input.pickMarket,
      selection: input.pickSelection ?? 'Fixture Away Nine',
      ...(input.pickLine === undefined || input.pickLine === null
        ? {}
        : { line: input.pickLine }),
      odds: -110,
      stakeUnits: 1,
      eventName: fixtureEventName(namespace),
      metadata: submissionMetadata,
    },
    repositories,
  );
  const pickId = submissionResult.pick.id;

  // --- Stage 4: the real grading classification (reported, not re-implemented) ---
  const normalizedPickMarketKey = normalizePickMarketKey(input.pickMarket);
  const rule = classifyMarketFamilyForGrading(normalizedPickMarketKey);
  const staticCandidates = new Set<string>([normalizedPickMarketKey]);
  const staticAlias = COMMON_GRADING_MARKET_ALIASES[normalizedPickMarketKey];
  if (staticAlias) {
    staticCandidates.add(staticAlias);
  }
  const staticCandidateMarketKeys = [...staticCandidates];

  const writtenKeys = new Set(inserted.map((row) => row.marketKey));
  const joinedMarketKeys = staticCandidateMarketKeys.filter((key) =>
    writtenKeys.has(key),
  );

  // --- Stage 5: the real grading pass -------------------------------------------
  // Restricted to this run's own pick. In memory the population is this pick alone and
  // the restriction changes nothing; against a shared staging database it is what keeps
  // the pass from sweeping and settling an unrelated backlog, and what makes the
  // counters below a statement about this fixture rather than about that backlog.
  const gradingResult = await runGradingPass(repositories, {
    restrictToPickIds: new Set([pickId]),
  });

  const settlement = await repositories.settlements.findLatestForPick(pickId);
  const settlementPayload =
    settlement && settlement.payload && typeof settlement.payload === 'object'
      ? (settlement.payload as Record<string, unknown>)
      : {};
  const gradedPick = await repositories.picks.findPickById(pickId);

  // Track Only must not be able to create a delivery. Read AFTER the grading pass,
  // because a settlement is exactly the event that would plausibly enqueue one.
  //
  // Every status the schema defines is passed explicitly rather than taking the
  // repository's `['sent']` default. A pick that got as far as a `pending` or
  // `failed` outbox row has already breached Track Only, and the default would have
  // reported that breach as clean. Sourcing the list from `outboxStatuses` means a
  // status added later is covered without this call being revisited.
  const deliveryRow = await repositories.outbox.findLatestByPick(pickId, [
    ...outboxStatuses,
  ]);

  const settle: JourneyStageSettle = {
    pickId,
    pickStatus: gradedPick?.status ?? 'unknown',
    attempted: gradingResult.attempted,
    graded: gradingResult.graded,
    skipped: gradingResult.skipped,
    errors: gradingResult.errors,
    settlementResult: settlement?.result ?? null,
    evidencePlane: settlementPayload['evidencePlane'] === true,
    profitLossUnits:
      typeof settlementPayload['profitLossUnits'] === 'number'
        ? (settlementPayload['profitLossUnits'] as number)
        : null,
    deliveryRowCount: deliveryRow ? 1 : 0,
  };

  // --- Stage 6: the real Track Only statistics ----------------------------------
  const statsInput: StatsInputPick[] = [
    {
      pickId,
      odds: gradedPick?.odds ?? null,
      stakeUnits: gradedPick?.stake_units ?? null,
      latestSettlement: settlement
        ? { result: settlement.result, stakeUnits: settlement.stake_units }
        : null,
    },
  ];
  const stats = computeTrackOnlyStats(statsInput);

  const gaps = collectJourneyGaps({
    rule,
    inserted,
    staticCandidateMarketKeys,
    joinedMarketKeys,
    resolveSummary,
    settle,
    stats,
  });

  return {
    fixtureEventId,
    parse: { events, scoredMarkets },
    resolve: { writes, inserted, summary: resolveSummary },
    grade: {
      normalizedPickMarketKey,
      rule,
      staticCandidateMarketKeys,
      unresolvedDynamicAliases: [
        `provider_market_aliases(provider='sgo', provider_market_key='${normalizedPickMarketKey}')`,
      ],
    },
    settle,
    stats,
    joinedMarketKeys,
    journeyCompletes:
      settle.graded === 1 &&
      settle.settlementResult !== null &&
      stats.record.decided === 1,
    gaps,
  };
}

/**
 * Reports what is still broken, stage by stage. Every entry here is a genuine
 * failure of the journey -- the three defects this lane repaired (the unreachable
 * canonical table, the raw score written under an outcome key, and the unattributed
 * side) each produce one, so a regression of any of them reappears as a gap rather
 * than as a silently weaker pass.
 */
function collectJourneyGaps(input: {
  rule: MarketFamilyRule;
  inserted: JourneyStageResolve['inserted'];
  staticCandidateMarketKeys: string[];
  joinedMarketKeys: string[];
  resolveSummary: ResultsResolutionSummary;
  settle: JourneyStageSettle;
  stats: TrackOnlyStats;
}): JourneyGap[] {
  const gaps: JourneyGap[] = [];

  if (input.inserted.length === 0) {
    gaps.push({
      id: 'A-resolver-wrote-nothing',
      stage: 'resolve',
      summary:
        'The resolver inserted no rows for the fixture event, so nothing downstream can join.',
      evidence: `summary: inserted=${input.resolveSummary.insertedResults}, skippedEventNotFound=${input.resolveSummary.skippedEventNotFound}, skippedEventNotCompleted=${input.resolveSummary.skippedEventNotCompleted}, skippedTeamSideUnresolved=${input.resolveSummary.skippedTeamSideUnresolved}, skippedMoneylineOutcomeUnresolved=${input.resolveSummary.skippedMoneylineOutcomeUnresolved}.`,
      owningPath: 'apps/ingestor/src/results-resolver.ts',
    });
  }

  // A moneyline row must be an outcome attributed to a side. Either half missing is
  // the defect, not a partial success.
  const moneylineRows = input.inserted.filter(
    (row) => row.marketKey === MONEYLINE_RESULT_MARKET_KEY,
  );
  const unattributed = moneylineRows.filter((row) => row.participantId === null);
  if (unattributed.length > 0) {
    gaps.push({
      id: 'B-moneyline-row-has-no-side',
      stage: 'resolve',
      summary:
        'A moneyline result row carries no participant_id, so no side owns the outcome and grading (participantRequirement=required) can never read it.',
      evidence: `${unattributed.length} of ${moneylineRows.length} ${MONEYLINE_RESULT_MARKET_KEY} rows have participant_id = null.`,
      owningPath: 'apps/ingestor/src/results-resolver.ts',
    });
  }
  const nonOutcome = moneylineRows.filter(
    (row) => ![1, 0, 0.5].includes(row.actualValue),
  );
  if (nonOutcome.length > 0) {
    gaps.push({
      id: 'C-moneyline-value-is-not-an-outcome',
      stage: 'resolve',
      summary:
        'A moneyline result row carries a value outside {1, 0, 0.5}, which grading refuses as moneyline_result_value_invalid. A raw team score is the usual cause.',
      evidence: `offending values: ${nonOutcome.map((row) => row.actualValue).join(', ')}.`,
      owningPath: 'apps/ingestor/src/results-resolver.ts',
    });
  }

  if (input.joinedMarketKeys.length === 0) {
    gaps.push({
      id: 'D-no-market-key-join',
      stage: 'join',
      summary:
        'No market_key the resolver wrote is one the grading pass looks for, so the result and the pick never meet.',
      evidence: `resolver wrote [${input.inserted
        .map((row) => row.marketKey)
        .join(', ')}]; grading looks for [${input.staticCandidateMarketKeys.join(', ')}].`,
      owningPath: 'apps/api/src/grading-service.ts',
    });
  }

  if (input.settle.graded !== 1 || input.settle.settlementResult === null) {
    gaps.push({
      id: 'E-pick-did-not-settle',
      stage: 'settle',
      summary:
        'The grading pass did not settle the pick, so the journey stops before it produces any record at all.',
      evidence: `attempted=${input.settle.attempted}, graded=${input.settle.graded}, skipped=${input.settle.skipped}, errors=${input.settle.errors}, settlementResult=${String(input.settle.settlementResult)}.`,
      owningPath: 'apps/api/src/grading-service.ts',
    });
  }

  if (input.stats.record.decided !== 1) {
    gaps.push({
      id: 'F-settlement-is-not-countable',
      stage: 'stats',
      summary:
        'A settlement exists but the Track Only statistics refuse to count it, so the pick settles without producing a record.',
      evidence: `decided=${input.stats.record.decided}, pending=${input.stats.pending}, excluded=${JSON.stringify(input.stats.excluded)}.`,
      owningPath: 'scripts/ops/track-only/stats.ts',
    });
  }

  return gaps;
}
