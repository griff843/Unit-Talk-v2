import { loadEnvironment } from '@unit-talk/config';
import { createApiRuntimeDependencies } from '../apps/api/src/server.js';
import { runCandidateScoring } from '../apps/api/src/candidate-scoring-service.js';

interface CliOptions {
  statuses: string[];
  batchSize: number;
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const environment = loadEnvironment();
  const runtime = createApiRuntimeDependencies({ environment });
  const repos = runtime.repositories;

  const result = await runCandidateScoring(
    {
      pickCandidates: repos.pickCandidates,
      marketUniverse: repos.marketUniverse,
      marketFamilyTrust: repos.marketFamilyTrust,
      ...(repos.modelRegistry ? { modelRegistry: repos.modelRegistry } : {}),
      ...(repos.experimentLedger ? { experimentLedger: repos.experimentLedger } : {}),
    },
    {
      batchSize: options.batchSize,
      statuses: options.statuses,
      logger: { info: () => {}, warn: console.warn, error: console.error },
    },
  );

  console.log('=== SGO Shadow Scoring Proof ===');
  console.log(`Statuses: ${options.statuses.join(',')}`);
  console.log(`Batch size: ${options.batchSize}`);
  console.log(`Scored: ${result.scored}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log(`Errors: ${result.errors}`);
  console.log(`Champion resolved: ${result.championResolved}`);
  console.log(`No champion skipped: ${result.noChampionSkipped}`);
  console.log(`Shadow recorded: ${result.shadowRecorded}`);
  console.log(`Trust adjusted: ${result.trustAdjusted}`);
  console.log(`Duration ms: ${result.durationMs}`);
  if (result.calibration) {
    console.log(`Avg model score: ${result.calibration.avgModelScore}`);
    console.log(`Trust families available: ${result.calibration.trustFamiliesAvailable}`);
    console.log(`Trust sample size: ${result.calibration.totalTrustSampleSize}`);
  }

  if (result.errors > 0) {
    process.exitCode = 1;
  }
}

function parseCliOptions(args: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg?.startsWith('--')) continue;
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      values.set(arg.slice(2), next);
      index += 1;
    }
  }

  const statuses = (values.get('statuses') ?? 'qualified,rejected')
    .split(',')
    .map((status) => status.trim())
    .filter(Boolean);
  if (statuses.length === 0) {
    throw new Error('--statuses must include at least one candidate status');
  }

  const batchSize = Number.parseInt(values.get('batch-size') ?? '1000', 10);
  if (!Number.isFinite(batchSize) || batchSize < 1) {
    throw new Error('--batch-size must be a positive integer');
  }

  return { statuses, batchSize };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
