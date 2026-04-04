/**
 * SGO historical backfill — last 90 days, all 4 sports.
 * Run: npx tsx scripts/run-historical-backfill.ts
 */
import { loadEnvironment } from '@unit-talk/config';
import {
  createServiceRoleDatabaseConnectionConfig,
  createDatabaseIngestorRepositoryBundle,
} from '@unit-talk/db';
import { runHistoricalBackfill } from '../apps/ingestor/src/historical-backfill.js';
import type { IngestLeagueSummary } from '../apps/ingestor/src/ingest-league.js';

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  const repositories = createDatabaseIngestorRepositoryBundle(connection);

  // today = 2026-04-04 per session context; calculate dynamically
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  const startDay = new Date(today);
  startDay.setUTCDate(startDay.getUTCDate() - 90);

  const startDate = toIsoDate(startDay);
  const endDate = toIsoDate(yesterday);

  const leagues = ['NBA', 'NFL', 'MLB', 'NHL'];

  console.log('=== SGO Historical Backfill ===');
  console.log(`Start date : ${startDate}`);
  console.log(`End date   : ${endDate}`);
  console.log(`Leagues    : ${leagues.join(', ')}`);
  console.log(`API key    : ${env.SGO_API_KEY ? '[set]' : '[MISSING]'}`);
  console.log('');

  if (!env.SGO_API_KEY) {
    console.error('ERROR: SGO_API_KEY is not set in environment. Aborting.');
    process.exit(1);
  }

  let totalInsertedOffers = 0;
  let totalResultsEvents = 0;
  let totalRuns = 0;
  let totalErrors = 0;

  // Wrap ingestLeague to add per-run logging and delay between days.
  // runHistoricalBackfill iterates date × league internally, so we intercept
  // via a custom ingestLeagueImpl that logs each completed run then sleeps.
  const { ingestLeague } = await import(
    '../apps/ingestor/src/ingest-league.js'
  );

  async function loggingIngestLeague(
    ...args: Parameters<typeof ingestLeague>
  ): ReturnType<typeof ingestLeague> {
    const [league, , , options] = args;
    // Extract date from startsAfter option (format: YYYY-MM-DDT...)
    const date = (options?.startsAfter as string | undefined)?.slice(0, 10) ?? '?';

    try {
      const summary = await ingestLeague(...args);
      const inserted = summary.insertedCount ?? 0;
      const results = summary.resultsEventsCount ?? 0;
      totalInsertedOffers += inserted;
      totalResultsEvents += results;
      totalRuns++;
      console.log(
        `[OK] ${date} ${league.padEnd(4)} | offers=${inserted} results=${results}`,
      );
      return summary;
    } catch (err) {
      totalErrors++;
      totalRuns++;
      console.error(
        `[ERR] ${date} ${league.padEnd(4)} | ${err instanceof Error ? err.message : String(err)}`,
      );
      // Return a zero-count summary so runHistoricalBackfill can continue
      const zeroSummary: IngestLeagueSummary = {
        league,
        status: 'skipped',
        eventsCount: 0,
        pairedCount: 0,
        normalizedCount: 0,
        insertedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        resolvedEventsCount: 0,
        resolvedParticipantsCount: 0,
        resultsEventsCount: 0,
        insertedResultsCount: 0,
        skippedResultsCount: 0,
        runId: null,
        quota: {
          provider: 'sgo',
          requestCount: 0,
          successfulRequests: 0,
          creditsUsed: 0,
          limit: null,
          remaining: null,
          resetAt: null,
          lastStatus: null,
          rateLimitHitCount: 0,
          backoffCount: 0,
          backoffMs: 0,
          retryAfterMs: null,
          throttled: false,
          headersSeen: false,
        },
      };
      return zeroSummary;
    }
  }

  // Enumerate days manually
  function enumerateDates(start: string, end: string): string[] {
    const dates: string[] = [];
    let cursor = start;
    while (cursor <= end) {
      dates.push(cursor);
      const next = new Date(`${cursor}T00:00:00.000Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      cursor = next.toISOString().slice(0, 10);
    }
    return dates;
  }

  const dates = enumerateDates(startDate, endDate);
  console.log(`Processing ${dates.length} days × ${leagues.length} leagues = ${dates.length * leagues.length} runs\n`);

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    try {
      await runHistoricalBackfill({
        repositories,
        leagues,
        apiKey: env.SGO_API_KEY,
        startDate: date,
        endDate: date,
        skipResults: false,
        ingestLeagueImpl: loggingIngestLeague,
      });
    } catch (err) {
      console.error(
        `[ERR] Day ${date} top-level error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 500ms delay between days (not after the last day)
    if (i < dates.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  console.log('\n=== Backfill Complete ===');
  console.log(`Total days          : ${dates.length}`);
  console.log(`Total runs          : ${totalRuns}`);
  console.log(`Total errors        : ${totalErrors}`);
  console.log(`Total offers inserted: ${totalInsertedOffers}`);
  console.log(`Total results events : ${totalResultsEvents}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
