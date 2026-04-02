import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseClientFromConnection,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';

async function main() {
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  const client = createDatabaseClientFromConnection(connection);

  const { error } = await client.rpc('bootstrap_canonical_reference_data');
  if (error) {
    throw new Error(`Failed to run canonical reference bootstrap: ${error.message}`);
  }

  const { data: summaryRows, error: summaryError } = await client
    .from('canonical_reference_bootstrap_summary')
    .select('league_id,sport_id,teams_count,players_count,assigned_players_count,unassigned_players_count')
    .order('league_id');
  if (summaryError) {
    throw new Error(`Failed to load canonical bootstrap summary: ${summaryError.message}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: summaryRows ?? [],
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Failed to run canonical reference bootstrap',
  );
  process.exitCode = 1;
});
