import type { IngestorRepositoryBundle } from '@unit-talk/db';
import type { SGOEventResult } from './results-fetcher.js';

// SGO_MARKET_KEY_TO_STAT_FIELDS removed (UTV2-448).
// The stat-field accumulation approach was deprecated — SGO support confirmed
// that odds.<oddID>.score is the correct field for grading all market types.
// Grading uses scoredMarket.score directly in resolveAndInsertResults below.

/**
 * Maps SGO provider market keys to canonical market_type_ids for game-line markets
 * (where providerParticipantId === null).
 *
 * These must be distinct from player-prop canonical IDs even when the baseMarketKey
 * is the same (e.g. both a player points O/U and a game total normalize to
 * 'points-all-game-ou' — the game-line version maps to 'game_total_ou').
 *
 * Related issue: UTV2-385 (game-line grading schema)
 */
export const SGO_GAME_LINE_CANONICAL_ID: Record<string, string> = {
  // Game totals — score = total combined points; grade with O/U logic
  'points-all-game-ou': 'game_total_ou',
  // Moneyline and spread — score format TBD (see PROVIDER_KNOWLEDGE_BASE.md §4)
  // Stored with raw SGO key until score format is confirmed for grading
  // 'points-all-game-ml': 'game_ml',
  // 'points-all-game-sp': 'game_spread',
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
        if (scoredMarket.providerParticipantId === null) {
          // Game-level market (ML, spread, game total) — no participant FK
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
