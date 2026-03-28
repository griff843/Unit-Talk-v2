import type { RepositoryBundle } from '@unit-talk/db';
import {
  getRecapWindow,
  postRecapSummary,
  type RecapPeriod,
} from './recap-service.js';

const RECAP_INTERVAL_MS = 60_000;

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

export function startRecapScheduler(
  repositories: Pick<RepositoryBundle, 'settlements' | 'picks'>,
) {
  const interval = setInterval(() => {
    void checkAndPostRecaps(repositories);
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

async function checkAndPostRecaps(
  repositories: Pick<RepositoryBundle, 'settlements' | 'picks'>,
) {
  const now = new Date();
  const due = shouldPostRecap(now);
  if (!due) {
    return;
  }

  const periods: RecapPeriod[] =
    due === 'combined' ? ['weekly', 'monthly'] : [due];

  for (const period of periods) {
    const result = await postRecapSummary(period, repositories, { now });
    if (result.ok || result.reason === 'no settled picks in window') {
      markPosted(period, now);
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
