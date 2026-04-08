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
 * Keep in sync with: provider_market_aliases WHERE provider='sgo'
 * Related issue: UTV2-384 (auto-settle E2E proof), UTV2-385 (game-line grading schema)
 */
export const SGO_MARKET_KEY_TO_CANONICAL_ID: Record<string, string> = {
  // NBA / NCAAB
  'points-all-game-ou': 'player_points_ou',
  'rebounds-all-game-ou': 'player_rebounds_ou',
  'assists-all-game-ou': 'player_assists_ou',
  'steals-all-game-ou': 'player_steals_ou',
  'blocks-all-game-ou': 'player_blocks_ou',
  'turnovers-all-game-ou': 'player_turnovers_ou',
  'threes-all-game-ou': 'player_3pm_ou',
  'pra-all-game-ou': 'player_pra_ou',
  'pts-rebs-all-game-ou': 'player_pts_rebs_ou',
  'pts-asts-all-game-ou': 'player_pts_asts_ou',
  'rebs-asts-all-game-ou': 'player_rebs_asts_ou',
  // MLB batting
  'batting-hits-all-game-ou': 'player_batting_hits_ou',
  'batting-home-runs-all-game-ou': 'player_batting_home_runs_ou',
  'batting-rbi-all-game-ou': 'player_batting_rbi_ou',
  'batting-walks-all-game-ou': 'player_batting_walks_ou',
  'batting-total-bases-all-game-ou': 'player_batting_total_bases_ou',
  'batting-strikeouts-all-game-ou': 'player_batting_strikeouts_ou',
  'batting-runs-all-game-ou': 'player_batting_runs_ou',
  // MLB pitching
  'pitching-strikeouts-all-game-ou': 'player_pitching_strikeouts_ou',
  'pitching-innings-pitched-all-game-ou': 'player_pitching_innings_pitched_ou',
  // NHL
  'goals-all-game-ou': 'player_goals_ou',
  'shots-on-goal-all-game-ou': 'player_shots_on_goal_ou',
  // NFL / NCAAF
  'passing-yards-all-game-ou': 'player_passing_yards_ou',
  'passing-tds-all-game-ou': 'player_passing_tds_ou',
  'rushing-yards-all-game-ou': 'player_rushing_yards_ou',
  'receiving-yards-all-game-ou': 'player_receiving_yards_ou',
  'receiving-targets-all-game-ou': 'player_receiving_targets_ou',
  'receptions-all-game-ou': 'player_receptions_ou',
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
  repositories: Pick<IngestorRepositoryBundle, 'events' | 'participants' | 'gradeResults'>,
  logger?: Pick<Console, 'warn' | 'info'>,
): Promise<ResultsResolutionSummary> {
  const summary: ResultsResolutionSummary = {
    processedEvents: eventResults.length,
    completedEvents: 0,
    insertedResults: 0,
    skippedResults: 0,
    errors: 0,
  };

  for (const eventResult of eventResults) {
    try {
      const event = await repositories.events.findByExternalId(eventResult.providerEventId);
      if (!event || event.status !== 'completed') {
        summary.skippedResults += eventResult.scoredMarkets.length;
        continue;
      }

      summary.completedEvents += 1;
      const now = new Date().toISOString();

      for (const scoredMarket of eventResult.scoredMarkets) {
        if (scoredMarket.providerParticipantId === null) {
          const canonicalMarketKey =
            SGO_GAME_LINE_CANONICAL_ID[scoredMarket.baseMarketKey] ?? scoredMarket.baseMarketKey;

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

        const participant = await repositories.participants.findByExternalId(
          scoredMarket.providerParticipantId,
        );
        if (!participant) {
          summary.skippedResults += 1;
          continue;
        }

        const canonicalMarketKey =
          SGO_MARKET_KEY_TO_CANONICAL_ID[scoredMarket.baseMarketKey] ?? scoredMarket.baseMarketKey;

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
