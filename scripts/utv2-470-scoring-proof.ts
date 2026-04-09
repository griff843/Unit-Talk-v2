/**
 * UTV2-470 Scoring Proof Script
 *
 * Runs the candidate scoring service once against the live DB and reports results.
 * Usage (from repo root):
 *   npx tsx scripts/utv2-470-scoring-proof.ts
 */

import { loadEnvironment } from '@unit-talk/config';
import { createApiRuntimeDependencies } from '../apps/api/src/server.js';
import { runCandidateScoring } from '../apps/api/src/candidate-scoring-service.js';

const SEPARATOR = '─'.repeat(70);

async function main() {
  console.log(SEPARATOR);
  console.log('UTV2-470 Candidate Scoring Proof — ' + new Date().toISOString());
  console.log(SEPARATOR);

  const environment = loadEnvironment();
  const runtime = createApiRuntimeDependencies({ environment });
  const repos = runtime.repositories;

  console.log('\n[1/1] Running candidate scoring service...');
  const result = await runCandidateScoring(
    { pickCandidates: repos.pickCandidates, marketUniverse: repos.marketUniverse },
    { logger: { info: () => {}, warn: console.warn, error: console.error } },
  );

  console.log(`      scored=${result.scored}  skipped=${result.skipped}  errors=${result.errors}  durationMs=${result.durationMs}`);

  console.log('\n' + SEPARATOR);
  if (result.scored > 0) {
    console.log(`✓ PASS  model_score written: ${result.scored} candidates scored`);
    console.log('        Phase 3 scoring layer is live.');
  } else if (result.skipped > 0 && result.errors === 0) {
    console.log(`- INFO  No unscored qualified candidates (all already scored or skipped). skipped=${result.skipped}`);
  } else {
    console.error(`✗ FAIL  scored=0 errors=${result.errors} — check logs above`);
    process.exit(1);
  }
  console.log(SEPARATOR + '\n');
}

main().catch((err) => {
  console.error('Scoring proof error:', err);
  process.exit(1);
});
