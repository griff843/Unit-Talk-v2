import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { processSubmission } from './submission-service.js';
import {
  computeRecapSummary,
  detectRecapCollision,
  getRecapWindow,
  postRecapSummary,
} from './recap-service.js';
import {
  checkAndPostRecapsForTests,
  markRecapPostedForTests,
  resetRecapSchedulerStateForTests,
  shouldPostRecap,
  startRecapScheduler,
} from './recap-scheduler.js';

test('getRecapWindow returns the prior UTC day for daily recaps', () => {
  const window = getRecapWindow('daily', new Date('2026-03-28T11:00:00.000Z'));

  assert.deepEqual(window, {
    startsAt: '2026-03-27T00:00:00.000Z',
    endsAt: '2026-03-28T00:00:00.000Z',
    label: 'Daily Recap - Mar 27',
  });
});

test('getRecapWindow returns the prior Monday-through-Sunday week for weekly recaps', () => {
  const window = getRecapWindow('weekly', new Date('2026-03-30T11:00:00.000Z'));

  assert.deepEqual(window, {
    startsAt: '2026-03-23T00:00:00.000Z',
    endsAt: '2026-03-30T00:00:00.000Z',
    label: 'Weekly Recap - Mar 23-Mar 29',
  });
});

test('detectRecapCollision returns combined on the first Monday of a month', () => {
  assert.equal(
    detectRecapCollision(new Date('2026-06-01T11:00:00.000Z')),
    'combined',
  );
});

test('detectRecapCollision returns weekly on later Mondays and daily on non-Mondays', () => {
  assert.equal(
    detectRecapCollision(new Date('2026-06-08T11:00:00.000Z')),
    'weekly',
  );
  assert.equal(
    detectRecapCollision(new Date('2026-06-09T11:00:00.000Z')),
    'daily',
  );
  assert.equal(
    detectRecapCollision(new Date('2026-06-09T10:59:00.000Z')),
    'none',
  );
});

test('computeRecapSummary returns record, net units, ROI, and top play for settled picks in the window', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await createSettledPick(repositories, {
    selection: 'Over 24.5',
    market: 'points-all-game-ou',
    odds: 150,
    stakeUnits: 1,
    submittedBy: 'griff843',
    result: 'win',
    settledAt: '2026-03-27T04:00:00.000Z',
  });
  await createSettledPick(repositories, {
    selection: 'Under 8.5',
    market: 'assists-all-game-ou',
    odds: -110,
    stakeUnits: 2,
    submittedBy: 'dalton',
    result: 'loss',
    settledAt: '2026-03-27T10:00:00.000Z',
  });
  await createSettledPick(repositories, {
    selection: 'Over 4.5',
    market: 'rebounds-all-game-ou',
    odds: -105,
    stakeUnits: 1,
    submittedBy: 'locke',
    result: 'push',
    settledAt: '2026-03-27T18:00:00.000Z',
  });

  const summary = await computeRecapSummary(
    'daily',
    repositories,
    new Date('2026-03-28T11:00:00.000Z'),
  );

  assert.ok(summary);
  assert.equal(summary?.record, '1-1-1');
  assert.equal(summary?.settledCount, 3);
  assert.equal(summary?.netUnits, -0.5);
  assert.equal(summary?.totalRiskedUnits, 4);
  assert.equal(summary?.roiPercent, -12.5);
  assert.equal(summary?.topPlay.selection, 'Over 24.5');
  assert.equal(summary?.topPlay.profitLossUnits, 1.5);
  assert.equal(summary?.topPlay.submittedBy, 'griff843');
});

test('computeRecapSummary returns null when no settlements land inside the requested window', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await createSettledPick(repositories, {
    selection: 'Over 24.5',
    market: 'points-all-game-ou',
    odds: -110,
    stakeUnits: 1,
    submittedBy: 'griff843',
    result: 'win',
    settledAt: '2026-03-26T22:00:00.000Z',
  });

  const summary = await computeRecapSummary(
    'daily',
    repositories,
    new Date('2026-03-28T11:00:00.000Z'),
  );

  assert.equal(summary, null);
});

test('postRecapSummary defaults recap posts to discord:recaps', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await createSettledPick(repositories, {
    selection: 'Over 24.5',
    market: 'points-all-game-ou',
    odds: 150,
    stakeUnits: 1,
    submittedBy: 'griff843',
    result: 'win',
    settledAt: '2026-03-27T04:00:00.000Z',
  });

  const previousToken = process.env.DISCORD_BOT_TOKEN;
  const previousTargetMap = process.env.UNIT_TALK_DISCORD_TARGET_MAP;
  const previousDryRun = process.env.RECAP_DRY_RUN;
  let capturedUrl = '';

  process.env.DISCORD_BOT_TOKEN = 'test-token';
  process.env.RECAP_DRY_RUN = 'false';
  process.env.UNIT_TALK_DISCORD_TARGET_MAP = JSON.stringify({
    'discord:recaps': '1300411261854547968',
  });

  try {
    const result = await postRecapSummary('daily', repositories, {
      now: new Date('2026-03-28T11:00:00.000Z'),
      fetchImpl: async (input) => {
        capturedUrl = String(input);
        return new Response(JSON.stringify({ id: 'message-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.channel : null, 'discord:recaps');
    assert.equal(result.ok ? result.dryRun : null, false);
    assert.equal(
      capturedUrl,
      'https://discord.com/api/v10/channels/1300411261854547968/messages',
    );
  } finally {
    if (previousToken === undefined) {
      delete process.env.DISCORD_BOT_TOKEN;
    } else {
      process.env.DISCORD_BOT_TOKEN = previousToken;
    }
    if (previousTargetMap === undefined) {
      delete process.env.UNIT_TALK_DISCORD_TARGET_MAP;
    } else {
      process.env.UNIT_TALK_DISCORD_TARGET_MAP = previousTargetMap;
    }
    if (previousDryRun === undefined) {
      delete process.env.RECAP_DRY_RUN;
    } else {
      process.env.RECAP_DRY_RUN = previousDryRun;
    }
  }
});

test('postRecapSummary dry run computes recap without posting to Discord', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await createSettledPick(repositories, {
    selection: 'Over 24.5',
    market: 'points-all-game-ou',
    odds: 150,
    stakeUnits: 1,
    submittedBy: 'griff843',
    result: 'win',
    settledAt: '2026-03-27T04:00:00.000Z',
  });

  const previousDryRun = process.env.RECAP_DRY_RUN;
  const previousTargetMap = process.env.UNIT_TALK_DISCORD_TARGET_MAP;
  let fetchCalled = false;

  process.env.RECAP_DRY_RUN = 'true';
  process.env.UNIT_TALK_DISCORD_TARGET_MAP = JSON.stringify({
    'discord:recaps': '1300411261854547968',
  });

  try {
    const result = await postRecapSummary('daily', repositories, {
      now: new Date('2026-03-28T11:00:00.000Z'),
      fetchImpl: async () => {
        fetchCalled = true;
        throw new Error('dry run must not call fetch');
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.channel : null, 'discord:recaps');
    assert.equal(result.ok ? result.postsCount : null, 0);
    assert.equal(result.ok ? result.dryRun : null, true);
    assert.equal(fetchCalled, false);
  } finally {
    if (previousDryRun === undefined) {
      delete process.env.RECAP_DRY_RUN;
    } else {
      process.env.RECAP_DRY_RUN = previousDryRun;
    }
    if (previousTargetMap === undefined) {
      delete process.env.UNIT_TALK_DISCORD_TARGET_MAP;
    } else {
      process.env.UNIT_TALK_DISCORD_TARGET_MAP = previousTargetMap;
    }
  }
});

test('shouldPostRecap suppresses reposts after the current window is marked as posted', () => {
  resetRecapSchedulerStateForTests();
  const now = new Date('2026-06-09T11:00:00.000Z');

  const first = shouldPostRecap(now);
  markRecapPostedForTests('daily', now);
  const second = shouldPostRecap(now);

  assert.equal(first, 'daily');
  assert.equal(second, null);
});

test('checkAndPostRecaps logs structured error when postRecapSummary throws, does not propagate', async () => {
  resetRecapSchedulerStateForTests();

  const errorLogs: string[] = [];
  const logger = { error: (msg: string) => { errorLogs.push(msg); } };

  const brokenRepositories = {
    settlements: {
      listRecent: () => Promise.reject(new Error('db connection lost')),
    },
    picks: { findPickById: () => Promise.resolve(null) },
  } as unknown as ReturnType<typeof createInMemoryRepositoryBundle>;

  // Use a time that triggers daily recap so shouldPostRecap returns 'daily'
  const postingTime = new Date('2026-06-09T11:00:00.000Z');

  // Must not throw
  await checkAndPostRecapsForTests(brokenRepositories, logger, () => postingTime);

  assert.ok(
    errorLogs.length > 0,
    'expected at least one error log entry',
  );
  const parsed = JSON.parse(errorLogs[0] as string) as Record<string, unknown>;
  assert.equal(parsed['service'], 'recap-scheduler');
  assert.ok(
    String(parsed['event']).startsWith('tick.'),
    `expected tick.* event, got: ${parsed['event']}`,
  );
});

test('checkAndPostRecaps dry run logs summary and does not set the idempotency mark', async () => {
  resetRecapSchedulerStateForTests();

  const repositories = createInMemoryRepositoryBundle();
  await createSettledPick(repositories, {
    selection: 'Over 24.5',
    market: 'points-all-game-ou',
    odds: 150,
    stakeUnits: 1,
    submittedBy: 'griff843',
    result: 'win',
    settledAt: '2026-06-08T04:00:00.000Z',
  });

  const previousDryRun = process.env.RECAP_DRY_RUN;
  const previousTargetMap = process.env.UNIT_TALK_DISCORD_TARGET_MAP;
  const infoLogs: string[] = [];
  const logger = {
    error: (_msg: string) => {},
    info: (msg: string) => {
      infoLogs.push(msg);
    },
  };
  const postingTime = new Date('2026-06-09T11:00:00.000Z');

  process.env.RECAP_DRY_RUN = 'true';
  process.env.UNIT_TALK_DISCORD_TARGET_MAP = JSON.stringify({
    'discord:recaps': '1300411261854547968',
  });

  try {
    await checkAndPostRecapsForTests(repositories, logger, () => postingTime);

    assert.equal(infoLogs.length, 1);
    const parsed = JSON.parse(infoLogs[0] as string) as Record<string, unknown>;
    assert.equal(parsed['service'], 'recap-scheduler');
    assert.equal(parsed['event'], 'tick.dry_run');
    assert.equal(parsed['period'], 'daily');
    assert.equal(shouldPostRecap(postingTime), 'daily');
  } finally {
    if (previousDryRun === undefined) {
      delete process.env.RECAP_DRY_RUN;
    } else {
      process.env.RECAP_DRY_RUN = previousDryRun;
    }
    if (previousTargetMap === undefined) {
      delete process.env.UNIT_TALK_DISCORD_TARGET_MAP;
    } else {
      process.env.UNIT_TALK_DISCORD_TARGET_MAP = previousTargetMap;
    }
  }
});

test('startRecapScheduler registers a 60 second polling interval and cleanup clears it', () => {
  const repositories = createInMemoryRepositoryBundle();
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let capturedDelay = 0;
  let clearedHandle: ReturnType<typeof setInterval> | null = null;
  const fakeHandle = { id: 'recap-interval' } as unknown as ReturnType<typeof setInterval>;

  globalThis.setInterval = ((callback: () => void, delay?: number) => {
    void callback;
    capturedDelay = delay ?? 0;
    return fakeHandle;
  }) as typeof setInterval;
  globalThis.clearInterval = ((handle?: ReturnType<typeof setInterval>) => {
    clearedHandle = handle ?? null;
  }) as typeof clearInterval;

  try {
    const cleanup = startRecapScheduler(repositories);
    cleanup();

    assert.equal(capturedDelay, 60_000);
    assert.equal(clearedHandle, fakeHandle);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

async function createSettledPick(
  repositories: ReturnType<typeof createInMemoryRepositoryBundle>,
  input: {
    selection: string;
    market: string;
    odds: number;
    stakeUnits: number;
    submittedBy: string;
    result: 'win' | 'loss' | 'push';
    settledAt: string;
  },
) {
  const created = await processSubmission(
    {
      source: 'recap-test',
      market: input.market,
      selection: input.selection,
      odds: input.odds,
      stakeUnits: input.stakeUnits,
      submittedBy: input.submittedBy,
      metadata: {
        submittedBy: input.submittedBy,
      },
    },
    repositories,
  );

  await repositories.settlements.record({
    pickId: created.pick.id,
    status: 'settled',
    result: input.result,
    source: 'operator',
    confidence: 'confirmed',
    evidenceRef: `test://${created.pick.id}`,
    settledBy: 'recap-test',
    settledAt: input.settledAt,
    payload: {},
  });

  return created.pick.id;
}
