import type { RepositoryBundle } from '@unit-talk/db';
import {
  readRecapDryRun,
  getRecapWindow,
  postRecapSummary,
  type RecapPeriod,
} from './recap-service.js';

const RECAP_INTERVAL_MS = 60_000;

/**
 * In-memory idempotency guard. Keyed by window `endsAt` ISO string.
 *
 * Fast-path optimization: avoids a DB query on every tick when the process has
 * already posted for the current window. The authoritative dedup guard is the
 * DB-backed check against system_runs (survives process restarts).
 */
const lastPostedAt: Partial<Record<RecapPeriod, string>> = {};
type RecapSchedulerLogger = Pick<Console, 'error'> & Partial<Pick<Console, 'info'>>;

type RecapRepositories = Pick<RepositoryBundle, 'settlements' | 'picks' | 'runs'>;

export function shouldPostRecap(now: Date): RecapPeriod | 'combined' | null {
  const collision = detectRecapTrigger(now);
  if (collision === 'none') {
    return null;
  }

  if (collision === 'combined') {
    return hasAlreadyPosted('weekly', now) || hasAlreadyPosted('monthly', now)
      ? null
      : 'combined';
  }

  return hasAlreadyPosted(collision, now) ? null : collision;
}

/**
 * Starts the recap scheduler loop. Fires once per minute; posts recap embeds
 * at the ratified UTC schedule:
 *
 *   Daily:          11:00 AM UTC every day
 *   Weekly:         11:00 AM UTC every Monday
 *   Monthly:        11:00 AM UTC on the first day of the month
 *   Combined:       11:00 AM UTC on the first Monday of the month
 *
 * Note: the original `discord_embed_system_spec.md` specified weekly/monthly at
 * 5:00 PM UTC. V2 ratifies 11:00 AM for all periods (simpler, consistent with
 * daily). The spec reference is intentionally superseded here.
 *
 * Returns a cleanup function that stops the interval (called on SIGINT/SIGTERM).
 */
export function startRecapScheduler(
  repositories: RecapRepositories,
  logger: RecapSchedulerLogger = console,
  clock: () => Date = () => new Date(),
) {
  const interval = setInterval(() => {
    checkAndPostRecaps(repositories, logger, clock).catch((err: unknown) => {
      logger.error(
        JSON.stringify({
          service: 'recap-scheduler',
          event: 'tick.unhandled_error',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    });
  }, RECAP_INTERVAL_MS);

  return () => {
    clearInterval(interval);
  };
}

export function resetRecapSchedulerStateForTests() {
  delete lastPostedAt.daily;
  delete lastPostedAt.weekly;
  delete lastPostedAt.monthly;
}

export function markRecapPostedForTests(period: RecapPeriod, now: Date) {
  markPosted(period, now);
}

export async function checkAndPostRecapsForTests(
  repositories: RecapRepositories,
  logger: RecapSchedulerLogger,
  clock: () => Date,
) {
  return checkAndPostRecaps(repositories, logger, clock);
}

async function checkAndPostRecaps(
  repositories: RecapRepositories,
  logger: RecapSchedulerLogger,
  clock: () => Date,
) {
  const now = clock();
  const due = shouldPostRecap(now);
  if (!due) {
    return;
  }

  const periods: RecapPeriod[] =
    due === 'combined' ? ['weekly', 'monthly'] : [due];

  for (const period of periods) {
    try {
      // DB-backed idempotency check (authoritative — survives process restarts)
      const alreadyPostedInDb = await hasAlreadyPostedInDb(repositories, period, now);
      if (alreadyPostedInDb) {
        // Sync in-memory guard so subsequent ticks skip the DB query
        markPosted(period, now);
        logger.info?.(
          JSON.stringify({
            service: 'recap-scheduler',
            event: 'tick.db_dedup_skip',
            period,
          }),
        );
        continue;
      }

      const result = await postRecapSummary(period, repositories, {
        now,
        dryRun: readRecapDryRun(),
      });
      if (result.ok && result.dryRun) {
        logger.info?.(
          JSON.stringify({
            service: 'recap-scheduler',
            event: 'tick.dry_run',
            period,
            summary: result.summary,
          }),
        );
        continue;
      }

      if (result.ok || result.reason === 'no settled picks in window') {
        markPosted(period, now);
        await recordRecapRun(repositories, period, now);
      } else {
        logger.error(
          JSON.stringify({
            service: 'recap-scheduler',
            event: 'tick.post_failed',
            period,
            reason: result.reason,
          }),
        );
      }
    } catch (err: unknown) {
      logger.error(
        JSON.stringify({
          service: 'recap-scheduler',
          event: 'tick.period_error',
          period,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
}

function detectRecapTrigger(now: Date): RecapPeriod | 'combined' | 'none' {
  if (now.getUTCHours() !== 11 || now.getUTCMinutes() !== 0) {
    return 'none';
  }

  if (now.getUTCDay() === 1 && now.getUTCDate() <= 7) {
    return 'combined';
  }

  if (now.getUTCDay() === 1) {
    return 'weekly';
  }

  if (now.getUTCDate() === 1) {
    return 'monthly';
  }

  return 'daily';
}

function hasAlreadyPosted(period: RecapPeriod, now: Date) {
  const lastPosted = lastPostedAt[period];
  if (!lastPosted) {
    return false;
  }

  const window = getRecapWindow(period, now);
  return lastPosted === window.endsAt;
}

function markPosted(period: RecapPeriod, now: Date) {
  lastPostedAt[period] = getRecapWindow(period, now).endsAt;
}

/**
 * DB-backed idempotency check. Queries system_runs for a completed recap.post
 * run matching this period + window. This is the authoritative guard that
 * survives process restarts.
 */
async function hasAlreadyPostedInDb(
  repositories: RecapRepositories,
  period: RecapPeriod,
  now: Date,
): Promise<boolean> {
  const window = getRecapWindow(period, now);
  const runs = await repositories.runs.listByType('recap.post', 50);
  return runs.some(
    (run) =>
      run.status === 'succeeded' &&
      isMatchingRecapRun(run.details, period, window.endsAt),
  );
}

function isMatchingRecapRun(
  details: unknown,
  period: RecapPeriod,
  windowEndsAt: string,
): boolean {
  if (details == null || typeof details !== 'object') {
    return false;
  }
  const d = details as Record<string, unknown>;
  return d['period'] === period && d['windowEndsAt'] === windowEndsAt;
}

/**
 * Records a successful recap posting in system_runs for DB-backed idempotency.
 */
async function recordRecapRun(
  repositories: RecapRepositories,
  period: RecapPeriod,
  now: Date,
): Promise<void> {
  const window = getRecapWindow(period, now);
  const run = await repositories.runs.startRun({
    runType: 'recap.post',
    actor: 'recap-scheduler',
    details: { period, windowEndsAt: window.endsAt },
  });
  await repositories.runs.completeRun({
    runId: run.id,
    status: 'succeeded',
    details: { period, windowEndsAt: window.endsAt },
  });
}
