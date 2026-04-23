import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseIngestorRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type GradeResultRecord,
} from '@unit-talk/db';

const DEFAULT_PROVIDER_EVENT_ID = 'jzLS2XhKeUhHuCyjcF5B';

type ProofArgs = {
  providerEventId: string;
};

type MarketSummary = {
  count: number;
  scored: number;
  participantLinked: number;
};

function parseArgs(argv: string[]): ProofArgs {
  let providerEventId = DEFAULT_PROVIDER_EVENT_ID;

  for (const arg of argv) {
    if (arg.startsWith('--event-id=')) {
      providerEventId = arg.slice('--event-id='.length).trim();
    }
  }

  return { providerEventId };
}

function summarizeMarkets(
  results: GradeResultRecord[],
): Record<string, MarketSummary> {
  const summary: Record<string, MarketSummary> = {};

  for (const result of results) {
    const market = result.market_key;
    const current = summary[market] ?? {
      count: 0,
      scored: 0,
      participantLinked: 0,
    };

    current.count += 1;
    current.scored += Number.isFinite(result.actual_value) ? 1 : 0;
    current.participantLinked += result.participant_id ? 1 : 0;
    summary[market] = current;
  }

  return Object.fromEntries(
    Object.entries(summary).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

async function main(): Promise<void> {
  const { providerEventId } = parseArgs(process.argv.slice(2));
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  const repositories = createDatabaseIngestorRepositoryBundle(connection);

  const event = await repositories.events.findByExternalId(providerEventId);

  if (!event) {
    console.log(
      JSON.stringify(
        {
          schema: 'sgo-finalized-settlement-proof/v1',
          providerEventId,
          verdict: 'failed',
          reason: 'event_not_found',
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const results = await repositories.gradeResults.listByEvent(event.id);
  const marketSummary = summarizeMarkets(results);
  const verdict =
    event.status === 'completed' && results.length > 0 ? 'passed' : 'failed';

  console.log(
    JSON.stringify(
      {
        schema: 'sgo-finalized-settlement-proof/v1',
        provider: 'sgo',
        providerEventId,
        localEvent: {
          id: event.id,
          name: event.event_name,
          date: event.event_date,
          status: event.status,
        },
        gameResults: {
          count: results.length,
          markets: marketSummary,
        },
        assertions: {
          eventPromotedToCompleted: event.status === 'completed',
          finalizedResultsPersisted: results.length > 0,
        },
        remainingBlocker:
          'UTV2-733 participant alias/canonical participant alignment can still block pick-specific settlement even after event/result repair.',
        verdict,
      },
      null,
      2,
    ),
  );

  if (verdict !== 'passed') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
