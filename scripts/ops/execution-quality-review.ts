#!/usr/bin/env tsx
/**
 * Execution quality review — per-provider and per-market-family trust summary.
 *
 * Queries provider_offers via ExecutionQualityRepository, computes trust
 * scores, and surfaces degraded providers so model routing can be adjusted.
 *
 * Usage:
 *   pnpm ops:execution-quality-review
 *   pnpm ops:execution-quality-review --sport NFL
 *   pnpm ops:execution-quality-review --json
 */

import {
  createDatabaseClient,
  createModelOpsRepositories,
} from '@unit-talk/db';
import {
  buildProviderTrustContext,
  summarizeProviderTrust,
} from '@unit-talk/domain';
import type { ProviderQualityInput } from '@unit-talk/domain';

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const sportIdx = args.indexOf('--sport');
const sportArg = sportIdx !== -1 ? args[sportIdx + 1] : undefined;

async function main(): Promise<void> {
  const client = createDatabaseClient();
  const { executionQuality } = createModelOpsRepositories(client);

  const byProvider = await executionQuality.summarizeByProvider(sportArg);

  const inputs: ProviderQualityInput[] = byProvider.map((r) => ({
    providerKey: r.providerKey,
    sportKey: r.sportKey,
    marketFamily: r.marketFamily,
    sampleSize: r.sampleSize,
    avgLineDelta: r.avgLineDelta,
    winRate: r.winRate,
    roi: r.roi,
  }));

  const trustContext = buildProviderTrustContext(inputs);
  const summary = summarizeProviderTrust(inputs);

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          sport: sportArg ?? null,
          provider_count: summary.length,
          degraded: summary
            .filter((s) => s.alertLevel === 'degraded')
            .map((s) => s.providerKey),
          warning: summary
            .filter((s) => s.alertLevel === 'warning')
            .map((s) => s.providerKey),
          trust_context: trustContext,
          summary,
          raw_reports: byProvider,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`\nExecution Quality Review${sportArg ? ` — ${sportArg}` : ''}`);
  console.log('='.repeat(60));
  console.log(`Reports: ${byProvider.length} rows, ${summary.length} providers`);
  console.log('');

  if (summary.length === 0) {
    console.log('No provider data. Check that provider_offers table is populated.');
    return;
  }

  console.log('Provider Trust Scores (worst first):');
  console.log('-'.repeat(60));
  for (const s of summary) {
    const icon = s.alertLevel === 'green' ? 'OK ' : s.alertLevel === 'warning' ? '!  ' : 'ERR';
    console.log(
      `  [${icon}] ${s.providerKey.padEnd(16)} [${s.alertLevel.padEnd(8)}]  x${s.trustMultiplier.toFixed(2)}  — ${s.reason}`,
    );
  }

  const degraded = summary.filter((s) => s.alertLevel === 'degraded');
  if (degraded.length > 0) {
    console.log(
      '\nDegraded providers have consensus weight reduced to 0.70x:',
    );
    for (const d of degraded) {
      console.log(`  • ${d.providerKey}`);
    }
  }

  console.log('');
}

main().catch((err) => {
  console.error('[execution-quality-review] Error:', err);
  process.exit(1);
});
