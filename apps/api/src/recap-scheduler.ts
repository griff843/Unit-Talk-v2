import type { RepositoryBundle } from '@unit-talk/db';
import {
  getRecapWindow,
  postRecapSummary,
  type RecapPeriod,
} from './recap-service.js';

const RECAP_INTERVAL_MS = 60_000;

/**
 * In-memory idempotency guard. Keyed by window `endsAt` ISO string.
 *
 * Boundary: guards against duplicate posts within a single API process lifetime.
 * If the process restarts while a posting window is open (11:00–11:01 UTC), a
 * second post is possible. This is an accepted low-frequency risk for a single-
 * instance deployment. Multi-instance deployments require a DB-backed lock.
 */
const lastPostedAt: Partial<Record<RecapPeriod, string>> = {};

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
  repositories: Pick<RepositoryBundle, 'settlements' | 'picks'>,
  logger: Pick<Console, 'error'> = console,
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
  repositories: Pick<RepositoryBundle, 'settlements' | 'picks'>,
  logger: Pick<Console, 'error'>,
  clock: () => Date,
) {
  return checkAndPostRecaps(repositories, logger, clock);
}

async function checkAndPostRecaps(
  repositories: Pick<RepositoryBundle, 'settlements' | 'picks'>,
  logger: Pick<Console, 'error'>,
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
      const result = await postRecapSummary(period, repositories, { now });
      if (result.ok || result.reason === 'no settled picks in window') {
        markPosted(period, now);
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
