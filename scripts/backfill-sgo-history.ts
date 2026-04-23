import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseIngestorRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { ingestLeague } from '../apps/ingestor/src/ingest-league.js';
import { runHistoricalBackfill } from '../apps/ingestor/src/historical-backfill.js';
import { parseConfiguredLeagues } from '../apps/ingestor/src/ingestor-runner.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  const repositories = createDatabaseIngestorRepositoryBundle(connection);

  const summary = args.window
    ? await runWindowBackfill({
        repositories,
        apiKey: env.SGO_API_KEY,
        leagues: args.leagues,
        startsAfter: args.window.startsAfter,
        startsBefore: args.window.startsBefore,
        skipResults: args.skipResults,
        resultsOnly: args.resultsOnly,
        providerEventIds: args.providerEventIds,
      })
    : await runHistoricalBackfill({
        repositories,
        apiKey: env.SGO_API_KEY,
        leagues: args.leagues,
        startDate: args.startDate,
        endDate: args.endDate,
        skipResults: args.skipResults,
        resultsOnly: args.resultsOnly,
        providerEventIds: args.providerEventIds,
        logger: console,
      });

  console.log(JSON.stringify(summary, null, 2));
}

function parseArgs(argv: string[]) {
  const map = new Map<string, string>();
  let skipResults = false;
  let resultsOnly = false;

  for (const arg of argv) {
    if (arg === '--skip-results') {
      skipResults = true;
      continue;
    }
    if (arg === '--results-only') {
      resultsOnly = true;
      continue;
    }

    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match) {
      throw new Error(`Unsupported argument: ${arg}`);
    }

    map.set(match[1], match[2]);
  }

  const easternDate = map.get('eastern-date');
  const startsAfter = map.get('starts-after');
  const startsBefore = map.get('starts-before');
  const explicitWindow = startsAfter || startsBefore;
  if (easternDate && explicitWindow) {
    throw new Error(
      'Use either --eastern-date or --starts-after/--starts-before, not both',
    );
  }
  if (explicitWindow && (!startsAfter || !startsBefore)) {
    throw new Error(
      'Both --starts-after and --starts-before are required for explicit windows',
    );
  }

  const window = easternDate
    ? toEasternDayUtcWindow(easternDate)
    : startsAfter && startsBefore
      ? { startsAfter, startsBefore }
      : null;

  const startDate = map.get('start');
  const endDate = map.get('end');
  if ((!startDate || !endDate) && !window) {
    throw new Error(
      'Usage: pnpm backfill:sgo-history --start=YYYY-MM-DD --end=YYYY-MM-DD [--leagues=NBA,NFL] [--skip-results] [--results-only]',
    );
  }
  if ((startDate || endDate) && window) {
    throw new Error('Use either --start/--end or a window option, not both');
  }

  return {
    startDate: startDate ?? '',
    endDate: endDate ?? '',
    leagues: parseConfiguredLeagues(map.get('leagues')),
    skipResults,
    resultsOnly,
    providerEventIds: parseList(map.get('event-id')),
    window,
  };
}

async function runWindowBackfill(input: {
  repositories: ReturnType<typeof createDatabaseIngestorRepositoryBundle>;
  apiKey?: string;
  leagues: string[];
  startsAfter: string;
  startsBefore: string;
  skipResults: boolean;
  resultsOnly: boolean;
  providerEventIds: string[];
}) {
  const runs = [];
  for (const league of input.leagues) {
    const summary = await ingestLeague(
      league,
      input.apiKey,
      input.repositories,
      {
        snapshotAt: input.startsBefore,
        startsAfter: input.startsAfter,
        startsBefore: input.startsBefore,
        resultsStartsAfter: input.startsAfter,
        resultsStartsBefore: input.startsBefore,
        historical: true,
        skipResults: input.skipResults,
        resultsOnly: input.resultsOnly,
        ...(input.providerEventIds.length > 0
          ? { providerEventIds: input.providerEventIds }
          : {}),
        logger: console,
      },
    );
    runs.push({ date: input.startsAfter, league, summary });
  }

  return {
    startDate: input.startsAfter,
    endDate: input.startsBefore,
    days: 1,
    runs,
  };
}

function parseList(value: string | undefined) {
  return value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    : [];
}

function toEasternDayUtcWindow(easternDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(easternDate)) {
    throw new Error('--eastern-date must be formatted as YYYY-MM-DD');
  }

  const startsAfter = `${easternDate}T04:00:00.000Z`;
  const next = new Date(startsAfter);
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    startsAfter,
    startsBefore: next.toISOString(),
  };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
