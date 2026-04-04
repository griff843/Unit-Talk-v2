import type { IngestorRepositoryBundle } from '@unit-talk/db';
import type { SGOEventResult } from './results-fetcher.js';

// @deprecated — stat-field accumulation approach replaced by odds.<oddId>.score grading.
// This map will be removed once the score-based approach is proven stable.
export const SGO_MARKET_KEY_TO_STAT_FIELDS: Record<string, string[]> = {
  'points-all-game-ou': ['points'],
  'assists-all-game-ou': ['assists'],
  'rebounds-all-game-ou': ['rebounds'],
  'steals-all-game-ou': ['steals'],
  'blocks-all-game-ou': ['blocks'],
  'turnovers-all-game-ou': ['turnovers'],
  'pra-all-game-ou': ['points', 'rebounds', 'assists'],
  'pts-rebs-all-game-ou': ['points', 'rebounds'],
  'pts-asts-all-game-ou': ['points', 'assists'],
  'rebs-asts-all-game-ou': ['rebounds', 'assists'],
  'batting-hits-all-game-ou': ['batting_hits'],
  'batting-home-runs-all-game-ou': ['batting_homeRuns'],
  'batting-rbi-all-game-ou': ['batting_RBI'],
  'batting-strikeouts-all-game-ou': ['batting_strikeouts'],
  'batting-total-bases-all-game-ou': ['batting_totalBases'],
  'pitching-strikeouts-all-game-ou': ['pitching_strikeouts'],
  'pitching-innings-pitched-all-game-ou': ['pitching_inningsPitched'],
};

/**
 * Maps SGO provider market keys to canonical market_type_ids.
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
  // MLB pitching
  'pitching-strikeouts-all-game-ou': 'player_pitching_strikeouts_ou',
  'pitching-innings-pitched-all-game-ou': 'player_pitching_innings_pitched_ou',
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
        // Game-level markets (null providerParticipantId) require schema work tracked separately
        if (scoredMarket.providerParticipantId === null) {
          summary.skippedResults += 1;
          continue;
        }

        const participant = await repositories.participants.findByExternalId(
          scoredMarket.providerParticipantId,
        );
        if (!participant) {
          summary.skippedResults += 1;
          continue;
        }

        // Resolve to canonical market_type_id so pick.market matches game_results.market_key.
        // Falls back to the SGO key if no alias is registered (new markets won't block grading data).
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
