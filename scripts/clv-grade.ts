import { loadEnvironment } from '@unit-talk/config';
import { createServiceRoleDatabaseConnectionConfig, createDatabaseRepositoryBundle } from '@unit-talk/db';
import { runGradingPass } from '../apps/api/src/grading-service.js';

async function main() {
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  const repositories = createDatabaseRepositoryBundle(connection);

  console.log('Running grading pass...');
  const result = await runGradingPass(repositories, { logger: console });
  console.log('\nGrading result:');
  console.log(JSON.stringify(result, null, 2));
}

main().catch(e => { console.error(String(e)); process.exit(1); });
