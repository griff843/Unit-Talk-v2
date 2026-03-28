import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseIngestorRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { runHistoricalBackfill } from '../apps/ingestor/src/historical-backfill.js';
import { parseConfiguredLeagues } from '../apps/ingestor/src/ingestor-runner.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  const repositories = createDatabaseIngestorRepositoryBundle(connection);

  const summary = await runHistoricalBackfill({
    repositories,
    apiKey: env.SGO_API_KEY,
    leagues: args.leagues,
    startDate: args.startDate,
    endDate: args.endDate,
    skipResults: args.skipResults,
    logger: console,
  });

  console.log(JSON.stringify(summary, null, 2));
}

function parseArgs(argv: string[]) {
  const map = new Map<string, string>();
  let skipResults = false;

  for (const arg of argv) {
    if (arg === '--skip-results') {
      skipResults = true;
      continue;
    }

    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match) {
      throw new Error(`Unsupported argument: ${arg}`);
    }

    map.set(match[1], match[2]);
  }

  const startDate = map.get('start');
  const endDate = map.get('end');
  if (!startDate || !endDate) {
    throw new Error(
      'Usage: pnpm backfill:sgo-history --start=YYYY-MM-DD --end=YYYY-MM-DD [--leagues=NBA,NFL] [--skip-results]',
    );
  }

  return {
    startDate,
    endDate,
    leagues: parseConfiguredLeagues(map.get('leagues')),
    skipResults,
  };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
