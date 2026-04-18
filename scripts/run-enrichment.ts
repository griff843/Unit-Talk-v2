/**
 * One-shot enrichment runner — triggers player + team logo enrichment passes immediately.
 * Usage: npx tsx scripts/run-enrichment.ts
 */
import { loadEnvironment } from '@unit-talk/config';
import { createApiRuntimeDependencies } from '../apps/api/src/server.js';
import { runPlayerEnrichmentPass } from '../apps/api/src/player-enrichment-service.js';
import { runTeamLogoEnrichmentPass } from '../apps/api/src/team-logo-enrichment-service.js';

async function main() {
  const environment = loadEnvironment();
  const runtime = createApiRuntimeDependencies({ environment });
  const deps = {
    participants: runtime.repositories.participants,
    runs: runtime.repositories.runs,
  };

  console.log('Starting player enrichment pass...');
  const playerResult = await runPlayerEnrichmentPass(deps);
  console.log('Player enrichment result:', JSON.stringify(playerResult, null, 2));

  console.log('\nStarting team logo enrichment pass...');
  const logoResult = await runTeamLogoEnrichmentPass(deps);
  console.log('Team logo enrichment result:', JSON.stringify(logoResult, null, 2));
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
