import type { IngestorRepositoryBundle } from '@unit-talk/db';
import type { SGOEventResult } from './results-fetcher.js';

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
        summary.skippedResults += eventResult.playerStats.length;
        continue;
      }

      summary.completedEvents += 1;

      for (const playerStatRow of eventResult.playerStats) {
        const participant = await repositories.participants.findByExternalId(
          playerStatRow.providerParticipantId,
        );
        if (!participant) {
          summary.skippedResults += 1;
          continue;
        }

        for (const [marketKey, statFields] of Object.entries(SGO_MARKET_KEY_TO_STAT_FIELDS)) {
          const actualValue = sumStatFields(playerStatRow.stats, statFields);
          if (actualValue === null) {
            summary.skippedResults += 1;
            continue;
          }

          await repositories.gradeResults.insert({
            eventId: event.id,
            participantId: participant.id,
            marketKey,
            actualValue,
            source: 'sgo',
            sourcedAt: new Date().toISOString(),
          });
          summary.insertedResults += 1;
        }
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

function sumStatFields(stats: Record<string, number>, fields: string[]) {
  let total = 0;
  for (const field of fields) {
    const value = stats[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }
    total += value;
  }
  return total;
}
