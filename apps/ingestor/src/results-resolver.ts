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

        await repositories.gradeResults.insert({
          eventId: event.id,
          participantId: participant.id,
          marketKey: scoredMarket.baseMarketKey,
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
