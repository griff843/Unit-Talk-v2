import type { IngestorRepositoryBundle } from '@unit-talk/db';
import type { SGOEventResult } from './results-fetcher.js';

// SGO_MARKET_KEY_TO_STAT_FIELDS removed (UTV2-448).
// The stat-field accumulation approach was deprecated - SGO support confirmed
// that odds.<oddID>.score is the correct field for grading all market types.
// Grading uses scoredMarket.score directly in resolveAndInsertResults below.

/**
 * The normalized SGO market key a game moneyline arrives under.
 *
 * UTV2-1889: this is not a guess. `parseSgoOddId` builds
 * `normalizedMarketKey` as `${statId}-all-${periodId}-${betTypeId}`
 * (`sgo-request-contract.ts`), with the entity segment hardcoded to `all`
 * regardless of whether the raw oddID said `home`, `away` or a player id. So
 * `points-home-game-ml-home` and `points-away-game-ml-away` both normalize to
 * `points-all-game-ml`, and the side survives only on `SGOMarketScore.providerSide`.
 * Production agrees: 280 `points-all-game-ml` rows exist and zero `game_ml_*` rows do.
 */
export const SGO_MONEYLINE_BASE_MARKET_KEY = 'points-all-game-ml';

/**
 * The canonical market key a moneyline *result* is stored under.
 *
 * This is deliberately a different key from {@link SGO_MONEYLINE_BASE_MARKET_KEY}
 * because it carries different data: `points-all-game-ml` rows hold a raw team
 * score, and `game_moneyline_win` rows hold an outcome in `{1, 0, 0.5}`. The
 * grading service refuses to read a moneyline from any other key for exactly that
 * reason, so the two key spaces must never be merged.
 *
 * The literal is duplicated from `MONEYLINE_RESULT_MARKET_KEY` in
 * `apps/api/src/grading-service.ts` because an app may not import another app
 * (core invariant 8). The duplication is *enforced* rather than documented:
 * `scripts/ops/track-only/sgo-journey-proof.ts` imports both and asserts they are
 * equal, so a change to either copy alone fails the suite.
 */
export const SGO_MONEYLINE_RESULT_MARKET_KEY = 'game_moneyline_win';

/**
 * Maps normalized SGO game-line market keys to canonical market_type_ids
 * (the `providerParticipantId === null` path).
 *
 * These must be distinct from player-prop canonical IDs even when the baseMarketKey
 * is the same (e.g. both a player points O/U and a game total normalize to
 * 'points-all-game-ou' - the game-line version maps to 'game_total_ou').
 *
 * UTV2-1889: this table previously held sixteen entries keyed
 * `<league>-<bet>-all-game` (`nba-spread-all-game`, `mlb-ml-all-game`, ...). Not one
 * of them was reachable. `normalizeSgoProviderMarketKey` can only ever emit
 * `<statId>-all-<periodId>-<betTypeId>`, so no payload can produce a key of that
 * shape, and production carries zero rows under any of their canonical ids. They are
 * removed rather than corrected: a league-specific canonical id cannot be derived
 * from the market key alone, and the deferred-work note they carried (naming UTV2-450,
 * "verify the exact key format against live payloads") is answered by this change
 * rather than still outstanding.
 *
 * Only markets whose result semantics are actually implemented are listed. A
 * game-line market that is absent here still writes under its provider key with its
 * raw score, unchanged — which is correct, because a raw score is what it is.
 *
 * Related issues: UTV2-385 (game-line grading schema), UTV2-1889 (this repair)
 */
export const SGO_GAME_LINE_CANONICAL_ID: Record<string, string> = {
  'points-all-game-ou': 'game_total_ou',
  [SGO_MONEYLINE_BASE_MARKET_KEY]: SGO_MONEYLINE_RESULT_MARKET_KEY,
};

/**
 * Per-side moneyline outcomes for one event, derived by comparing the two sides'
 * scores against each other.
 *
 * UTV2-1889: a moneyline outcome does not exist on either row on its own. SGO emits
 * one scored market per side, each carrying that side's raw score, and the winner
 * lives only in the comparison. Writing `actual_value = score` — which is what this
 * resolver did before — stores 7 under a key grading reads as `1 | 0 | 0.5`, so the
 * row is either refused or, worse, silently misread.
 *
 * Returns `null` — never a guess — when the pair cannot be established:
 *  - either side is missing from the payload (a half-scored event)
 *  - a side appears twice with disagreeing scores (a contradictory payload)
 * The caller skips those rows rather than attributing an outcome nothing attested.
 */
export function computeMoneylineOutcomeBySide(
  scoredMarkets: SGOEventResult['scoredMarkets'],
): { home: number; away: number } | null {
  let home: number | null = null;
  let away: number | null = null;

  for (const scoredMarket of scoredMarkets) {
    if (scoredMarket.baseMarketKey !== SGO_MONEYLINE_BASE_MARKET_KEY) {
      continue;
    }
    if (!Number.isFinite(scoredMarket.score)) {
      continue;
    }
    if (scoredMarket.providerSide === 'home') {
      if (home !== null && home !== scoredMarket.score) {
        return null;
      }
      home = scoredMarket.score;
    } else if (scoredMarket.providerSide === 'away') {
      if (away !== null && away !== scoredMarket.score) {
        return null;
      }
      away = scoredMarket.score;
    }
  }

  if (home === null || away === null) {
    return null;
  }
  if (home === away) {
    return { home: 0.5, away: 0.5 };
  }
  return home > away ? { home: 1, away: 0 } : { home: 0, away: 1 };
}

/**
 * Maps SGO provider market keys to canonical market_type_ids for player-prop markets.
 *
 * This mirrors the `provider_market_aliases` table (provider='sgo') so that
 * game_results rows are stored with the same key that `pick.market` uses,
 * enabling the grading-service to match them without a provider-specific join.
 *
 * Key format: exact SGO baseMarketKey values as returned in the results feed
 * (verified against live provider_offers.provider_market_key).
 *
 * Keep in sync with: provider_market_aliases WHERE provider='sgo'
 * Related issue: UTV2-384 (auto-settle E2E proof), UTV2-385 (game-line grading schema)
 */
export const SGO_MARKET_KEY_TO_CANONICAL_ID: Record<string, string> = {
  // NBA / NCAAB — simple stats
  'points-all-game-ou': 'player_points_ou',
  'rebounds-all-game-ou': 'player_rebounds_ou',
  'assists-all-game-ou': 'player_assists_ou',
  'steals-all-game-ou': 'player_steals_ou',
  'blocks-all-game-ou': 'player_blocks_ou',
  'turnovers-all-game-ou': 'player_turnovers_ou',
  // NBA / NCAAB — combo and special (+ format, camelCase as in live feed)
  'threePointersMade-all-game-ou': 'player_3pm_ou',
  'threePointersMade-all-1h-ou': 'player_3pm_ou',
  'threePointersMade-all-1q-ou': 'player_3pm_ou',
  'points+rebounds+assists-all-game-ou': 'player_pra_ou',
  'points+rebounds+assists-all-1h-ou': 'player_pra_ou',
  'points+rebounds+assists-all-1q-ou': 'player_pra_ou',
  'points+rebounds-all-game-ou': 'player_pts_rebs_ou',
  'points+assists-all-game-ou': 'player_pts_asts_ou',
  'rebounds+assists-all-game-ou': 'player_rebs_asts_ou',
  'fantasyScore-all-game-ou': 'player_fantasy_score_ou',
  // MLB batting (camelCase/underscore as in live feed)
  'batting_hits-all-game-ou': 'player_batting_hits_ou',
  'batting_homeRuns-all-game-ou': 'player_batting_home_runs_ou',
  'batting_RBI-all-game-ou': 'player_batting_rbi_ou',
  'batting_totalBases-all-game-ou': 'player_batting_total_bases_ou',
  'batting_singles-all-game-ou': 'player_batting_singles_ou',
  'batting_doubles-all-game-ou': 'player_batting_doubles_ou',
  'batting_triples-all-game-ou': 'player_batting_triples_ou',
  'batting_basesOnBalls-all-game-ou': 'player_batting_walks_ou',
  'batting_hits+runs+rbi-all-game-ou': 'player_batting_hrr_ou',
  // MLB pitching
  'pitching_strikeouts-all-game-ou': 'player_pitching_strikeouts_ou',
  'pitching_outs-all-game-ou': 'player_pitching_outs_ou',
  'pitching_hits-all-game-ou': 'player_pitching_hits_allowed_ou',
  'pitching_earnedRuns-all-game-ou': 'player_pitching_earned_runs_ou',
  // NHL
  'goals+assists-all-game-ou': 'player_hockey_points_ou',
  'shots_onGoal-all-game-ou': 'player_shots_ou',
  'goalie_saves-all-game-ou': 'player_saves_ou',
  // NFL / NCAAF (underscore format as in live feed)
  'passing_yards-all-game-ou': 'player_passing_yards_ou',
  'passing_touchdowns-all-game-ou': 'player_passing_tds_ou',
  'rushing_yards-all-game-ou': 'player_rushing_yards_ou',
  'receiving_yards-all-game-ou': 'player_receiving_yards_ou',
  'receiving_receptions-all-game-ou': 'player_receptions_ou',
};

export interface ResultsResolutionSummary {
  /** Finalized event-results SGO returned (the input set — already filtered to status.finalized upstream). */
  processedEvents: number;
  /** Of those, how many matched an event row with status='completed' (the gate that lets results insert). */
  completedEvents: number;
  insertedResults: number;
  skippedResults: number;
  /**
   * UTV2-1287 diagnostic breakdown of skippedResults at the event gate — isolates
   * WHY a finalized SGO result did not produce game_results:
   *  - skippedEventNotFound: no events row matched providerEventId (external_id mapping miss)
   *  - skippedEventNotCompleted: event row found but status !== 'completed' (status-transition gap)
   * (Per-scored-market skips — invalid market / missing participant — are NOT counted here.)
   */
  skippedEventNotFound: number;
  skippedEventNotCompleted: number;
  /**
   * UTV2-1868: team-sided game-line markets (SGO stat entity `home`/`away`) whose
   * side could not be resolved to an `event_participants` row for the event. These
   * are skipped rather than written participant-less, because a participant-less
   * game-line row cannot say whose score it is and silently collides with the other
   * side under `game_results_game_line_unique_idx`. Counted separately from
   * `skippedResults` so an unresolved side is visible rather than folded into the
   * aggregate.
   */
  skippedTeamSideUnresolved: number;
  /**
   * UTV2-1889: moneyline scored markets skipped because no outcome could be derived
   * for the event — one side absent from the payload, the two sides disagreeing, or
   * the market arriving with no side at all. A moneyline row is only meaningful as
   * `1 | 0 | 0.5`, and there is no honest default, so these are skipped rather than
   * written with a raw score under an outcome key.
   */
  skippedMoneylineOutcomeUnresolved: number;
  errors: number;
  /**
   * UTV2-1297 per-step phase timing breakdown (ms) for the results-resolve path.
   * Accumulated across all candidates so a slow step is visible at the cycle level.
   *  - resultsEventLookup:       total time in events.findByExternalId across all candidates
   *  - resultsParticipantLookup: total time in participants.findByExternalId (cache misses only)
   *  - resultsInsertGameResults: total time in gradeResults.insert across all rows
   *  - resultsPerCandidateTotal: wall-clock time for the entire per-candidate loop
   */
  phaseTimings: {
    resultsEventLookup: number;
    resultsParticipantLookup: number;
    resultsInsertGameResults: number;
    resultsPerCandidateTotal: number;
  };
}

export async function resolveAndInsertResults(
  eventResults: SGOEventResult[],
  repositories: Pick<
    IngestorRepositoryBundle,
    'events' | 'participants' | 'gradeResults' | 'eventParticipants'
  >,
  logger?: Pick<Console, 'warn' | 'info'>,
): Promise<ResultsResolutionSummary> {
  // UTV2-1297: per-step timing accumulators for the results-resolve path.
  // Accumulated across all candidates so the phase timings log in ingest-league.ts
  // shows where the 240s per-league deadline is being consumed.
  const innerTimings = {
    resultsEventLookup: 0,
    resultsParticipantLookup: 0,
    resultsInsertGameResults: 0,
    resultsPerCandidateTotal: 0,
  };

  const summary: ResultsResolutionSummary = {
    processedEvents: eventResults.length,
    completedEvents: 0,
    insertedResults: 0,
    skippedResults: 0,
    skippedEventNotFound: 0,
    skippedEventNotCompleted: 0,
    skippedTeamSideUnresolved: 0,
    skippedMoneylineOutcomeUnresolved: 0,
    errors: 0,
    phaseTimings: innerTimings,
  };

  const participantByProviderId = new Map<
    string,
    Awaited<ReturnType<typeof repositories.participants.findByExternalId>>
  >();

  // UTV2-1868: per-event home/away participant ids, resolved lazily from
  // event_participants.role and reused across every scored market on that event.
  const sideParticipantsByEventId = new Map<
    string,
    { home: string | null; away: string | null }
  >();
  const resolveSideParticipantId = async (
    eventId: string,
    side: 'home' | 'away',
  ): Promise<string | null> => {
    let sides = sideParticipantsByEventId.get(eventId);
    if (sides === undefined) {
      const rows = await repositories.eventParticipants.listByEvent(eventId);
      sides = {
        home: rows.find((row) => row.role === 'home')?.participant_id ?? null,
        away: rows.find((row) => row.role === 'away')?.participant_id ?? null,
      };
      sideParticipantsByEventId.set(eventId, sides);
    }
    return sides[side];
  };

  const loopStartMs = Date.now();
  for (const eventResult of eventResults) {
    try {
      const eventLookupStartMs = Date.now();
      const event = await repositories.events.findByExternalId(
        eventResult.providerEventId,
      );
      innerTimings.resultsEventLookup += Date.now() - eventLookupStartMs;

      if (!event || event.status !== 'completed') {
        // UTV2-1287: attribute the skip so the funnel log can distinguish a
        // mapping miss (no events row) from a status-transition gap (row exists
        // but never reached 'completed'). Both still count toward skippedResults.
        summary.skippedResults += eventResult.scoredMarkets.length;
        if (!event) {
          summary.skippedEventNotFound += 1;
        } else {
          summary.skippedEventNotCompleted += 1;
        }
        continue;
      }

      summary.completedEvents += 1;
      const now = new Date().toISOString();
      // UTV2-1889: derived once per event — the outcome is a property of the pair of
      // sides, not of either scored market, so it cannot be computed inside the loop.
      const moneylineOutcomeBySide = computeMoneylineOutcomeBySide(
        eventResult.scoredMarkets,
      );

      for (const scoredMarket of eventResult.scoredMarkets) {
        if (
          !isValidScoredMarket(
            scoredMarket,
            eventResult.providerEventId,
            logger,
          )
        ) {
          summary.skippedResults += 1;
          continue;
        }

        if (scoredMarket.providerParticipantId === null) {
          const canonicalMarketKey =
            SGO_GAME_LINE_CANONICAL_ID[scoredMarket.baseMarketKey] ??
            scoredMarket.baseMarketKey;

          // UTV2-1868: a game-line market whose SGO stat entity is `home` or `away`
          // is one team's score, not the game's. Writing it with participant_id NULL
          // makes it indistinguishable from the other side and collides with it under
          // game_results_game_line_unique_idx — where the duplicate is swallowed and
          // the second team's score is lost. Resolve the side, or skip: an ambiguous
          // NULL row is worse than no row, because grading cannot detect it.
          let participantId: string | null = null;
          if (scoredMarket.providerSide) {
            participantId = await resolveSideParticipantId(
              event.id,
              scoredMarket.providerSide,
            );
            if (!participantId) {
              logger?.warn?.(
                `[results-resolver] unresolved ${scoredMarket.providerSide} participant ` +
                  `for event ${eventResult.providerEventId} market ${scoredMarket.oddId}; ` +
                  'skipping rather than writing a participant-less game-line row',
              );
              summary.skippedTeamSideUnresolved += 1;
              continue;
            }
          }

          // UTV2-1889: a moneyline is stored as an outcome, never as a score. Both
          // preconditions below are refusals rather than fallbacks — an unattributed
          // or unresolved moneyline row is exactly the shape grading cannot detect as
          // wrong, because 1 and 0 are also plausible scores.
          let actualValue = scoredMarket.score;
          if (canonicalMarketKey === SGO_MONEYLINE_RESULT_MARKET_KEY) {
            if (!scoredMarket.providerSide || !participantId) {
              logger?.warn?.(
                `[results-resolver] moneyline market ${scoredMarket.oddId} for event ` +
                  `${eventResult.providerEventId} carries no resolved side; skipping ` +
                  'rather than storing a raw score under an outcome key',
              );
              summary.skippedMoneylineOutcomeUnresolved += 1;
              continue;
            }
            if (!moneylineOutcomeBySide) {
              logger?.warn?.(
                `[results-resolver] no moneyline outcome derivable for event ` +
                  `${eventResult.providerEventId} (both sides' scores are required ` +
                  `and must agree); skipping ${scoredMarket.oddId}`,
              );
              summary.skippedMoneylineOutcomeUnresolved += 1;
              continue;
            }
            actualValue = moneylineOutcomeBySide[scoredMarket.providerSide];
          }

          const insertStartMs = Date.now();
          await repositories.gradeResults.insert({
            eventId: event.id,
            participantId,
            marketKey: canonicalMarketKey,
            actualValue,
            source: 'sgo',
            sourcedAt: now,
          });
          innerTimings.resultsInsertGameResults += Date.now() - insertStartMs;
          summary.insertedResults += 1;
          continue;
        }

        let participant = participantByProviderId.get(
          scoredMarket.providerParticipantId,
        );
        if (participant === undefined) {
          const participantLookupStartMs = Date.now();
          participant = await repositories.participants.findByExternalId(
            scoredMarket.providerParticipantId,
          );
          innerTimings.resultsParticipantLookup += Date.now() - participantLookupStartMs;
          participantByProviderId.set(
            scoredMarket.providerParticipantId,
            participant,
          );
        }
        if (!participant) {
          summary.skippedResults += 1;
          continue;
        }

        const canonicalMarketKey =
          SGO_MARKET_KEY_TO_CANONICAL_ID[scoredMarket.baseMarketKey] ??
          scoredMarket.baseMarketKey;

        const insertStartMs = Date.now();
        await repositories.gradeResults.insert({
          eventId: event.id,
          participantId: participant.id,
          marketKey: canonicalMarketKey,
          actualValue: scoredMarket.score,
          source: 'sgo',
          sourcedAt: now,
        });
        innerTimings.resultsInsertGameResults += Date.now() - insertStartMs;
        summary.insertedResults += 1;
      }
    } catch (error) {
      summary.errors += 1;
      logger?.warn?.(
        `Failed to resolve SGO results for event ${eventResult.providerEventId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
  innerTimings.resultsPerCandidateTotal = Date.now() - loopStartMs;

  // UTV2-1287 finalization/results funnel telemetry. Emitted once per
  // resolveAndInsertResults call so a prod log scan can localize where the
  // game_results pipeline breaks for a slate, without any behavior change:
  //   finalized_results_in  = SGO-finalized events handed to the resolver
  //   completed             = matched an events row with status='completed'
  //   inserted              = game_results rows written
  //   skipped_event_not_found / skipped_event_not_completed = the two gate misses
  //   errors                = per-event resolution failures (caught, non-fatal)
  // Correlate with the existing `[ingestor] finalized-repoll league=… candidates=N`
  // line: candidates(N) vs finalized_results_in(M) reveals SGO-not-finalized = N−M.
  logger?.info?.(
    `[results-telemetry] finalized_results_in=${summary.processedEvents} ` +
      `completed=${summary.completedEvents} inserted=${summary.insertedResults} ` +
      `skipped_event_not_found=${summary.skippedEventNotFound} ` +
      `skipped_event_not_completed=${summary.skippedEventNotCompleted} ` +
      `skipped_markets=${summary.skippedResults} ` +
      `skipped_team_side_unresolved=${summary.skippedTeamSideUnresolved} ` +
      `skipped_moneyline_outcome_unresolved=${summary.skippedMoneylineOutcomeUnresolved} ` +
      `errors=${summary.errors} ` +
      `phase_timings_ms=${JSON.stringify(innerTimings)}`,
  );

  return summary;
}

function isValidScoredMarket(
  scoredMarket: SGOEventResult['scoredMarkets'][number],
  providerEventId: string,
  logger?: Pick<Console, 'warn' | 'info'>,
) {
  if (
    typeof scoredMarket.baseMarketKey !== 'string' ||
    scoredMarket.baseMarketKey.length === 0
  ) {
    logger?.warn?.(
      `[sgo-results-parser] skipping malformed scored market for event ${providerEventId}: invalid baseMarketKey; payload=${safeExcerpt(scoredMarket)}`,
    );
    return false;
  }
  if (!Number.isFinite(scoredMarket.score)) {
    logger?.warn?.(
      `[sgo-results-parser] skipping malformed scored market for event ${providerEventId}: invalid score; payload=${safeExcerpt(scoredMarket)}`,
    );
    return false;
  }
  if (
    scoredMarket.providerParticipantId !== null &&
    (typeof scoredMarket.providerParticipantId !== 'string' ||
      scoredMarket.providerParticipantId.length === 0)
  ) {
    logger?.warn?.(
      `[sgo-results-parser] skipping malformed scored market for event ${providerEventId}: invalid providerParticipantId; payload=${safeExcerpt(scoredMarket)}`,
    );
    return false;
  }
  // UTV2-1868: an unrecognised or absent side is not treated as "game-scoped".
  // Defaulting it to null is exactly the discard this repair exists to remove, so
  // the market is skipped and the malformed payload is named instead.
  if (
    scoredMarket.providerSide !== null &&
    scoredMarket.providerSide !== 'home' &&
    scoredMarket.providerSide !== 'away'
  ) {
    logger?.warn?.(
      `[sgo-results-parser] skipping malformed scored market for event ${providerEventId}: invalid providerSide; payload=${safeExcerpt(scoredMarket)}`,
    );
    return false;
  }
  return true;
}

function safeExcerpt(value: unknown) {
  try {
    const json = JSON.stringify(value);
    if (!json) {
      return 'null';
    }
    return json.length > 500 ? `${json.slice(0, 500)}...` : json;
  } catch {
    return '[unserializable payload]';
  }
}
