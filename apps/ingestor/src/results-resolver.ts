import type { IngestorRepositoryBundle } from '@unit-talk/db';
import type { SGOEventResult } from './results-fetcher.js';

// SGO_MARKET_KEY_TO_STAT_FIELDS removed (UTV2-448).
// The stat-field accumulation approach was deprecated - SGO support confirmed
// that odds.<oddID>.score is the correct field for grading all market types.
// Grading uses scoredMarket.score directly in resolveAndInsertResults below.

/**
 * Maps SGO provider market keys to canonical market_type_ids for game-line markets
 * (where providerParticipantId === null).
 *
 * These must be distinct from player-prop canonical IDs even when the baseMarketKey
 * is the same (e.g. both a player points O/U and a game total normalize to
 * 'points-all-game-ou' - the game-line version maps to 'game_total_ou').
 *
 * Related issue: UTV2-385 (game-line grading schema)
 */
export const SGO_GAME_LINE_CANONICAL_ID: Record<string, string> = {
  'points-all-game-ou': 'game_total_ou',
  // TODO(UTV2-450): verify exact SGO key format for game-line aliases against live payloads.
  'nba-spread-all-game': 'game_spread_nba',
  'nfl-spread-all-game': 'game_spread_nfl',
  'mlb-spread-all-game': 'game_spread_mlb',
  'nhl-spread-all-game': 'game_spread_nhl',
  'ncaab-spread-all-game': 'game_spread_ncaab',
  'ncaaf-spread-all-game': 'game_spread_ncaaf',
  'nba-ml-all-game': 'game_ml_nba',
  'nfl-ml-all-game': 'game_ml_nfl',
  'mlb-ml-all-game': 'game_ml_mlb',
  'nhl-ml-all-game': 'game_ml_nhl',
  'ncaab-ml-all-game': 'game_ml_ncaab',
  'ncaaf-ml-all-game': 'game_ml_ncaaf',
  'nfl-total-all-game': 'game_total_nfl',
  'mlb-total-all-game': 'game_total_mlb',
  'nhl-total-all-game': 'game_total_nhl',
};

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
  processedEvents: number;
  completedEvents: number;
  insertedResults: number;
  skippedResults: number;
  errors: number;
}

export async function resolveAndInsertResults(
  eventResults: SGOEventResult[],
  repositories: Pick<
    IngestorRepositoryBundle,
    'events' | 'participants' | 'gradeResults'
  >,
  logger?: Pick<Console, 'warn' | 'info'>,
): Promise<ResultsResolutionSummary> {
  const summary: ResultsResolutionSummary = {
    processedEvents: eventResults.length,
    completedEvents: 0,
    insertedResults: 0,
    skippedResults: 0,
    errors: 0,
  };

  const participantByProviderId = new Map<
    string,
    Awaited<ReturnType<typeof repositories.participants.findByExternalId>>
  >();

  for (const eventResult of eventResults) {
    try {
      const event = await repositories.events.findByExternalId(
        eventResult.providerEventId,
      );
      if (!event || event.status !== 'completed') {
        summary.skippedResults += eventResult.scoredMarkets.length;
        continue;
      }

      summary.completedEvents += 1;
      const now = new Date().toISOString();

      for (const scoredMarket of eventResult.scoredMarkets) {
        if (scoredMarket.providerParticipantId === null) {
          const canonicalMarketKey =
            SGO_GAME_LINE_CANONICAL_ID[scoredMarket.baseMarketKey] ??
            scoredMarket.baseMarketKey;

          await repositories.gradeResults.insert({
            eventId: event.id,
            participantId: null,
            marketKey: canonicalMarketKey,
            actualValue: scoredMarket.score,
            source: 'sgo',
            sourcedAt: now,
          });
          summary.insertedResults += 1;
          continue;
        }

        let participant = participantByProviderId.get(
          scoredMarket.providerParticipantId,
        );
        if (participant === undefined) {
          participant = await repositories.participants.findByExternalId(
            scoredMarket.providerParticipantId,
          );
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

        await repositories.gradeResults.insert({
          eventId: event.id,
          participantId: participant.id,
          marketKey: canonicalMarketKey,
          actualValue: scoredMarket.score,
          source: 'sgo',
          sourcedAt: now,
        });
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

  return summary;
}
