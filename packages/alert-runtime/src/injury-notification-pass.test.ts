import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  InjuryCooldownAuditLogEntry,
  InjuryCooldownRepo,
  InjuryCooldownStatus,
} from './injury-cooldown.js';
import {
  runInjuryNotificationPass,
  type InjuryNotificationRepo,
} from './injury-notification-pass.js';
import type {
  InjuryStatus,
  NormalizedInjuryReport,
} from './injury-types.js';

class InMemoryCooldownRepo implements InjuryCooldownRepo {
  readonly auditLogs: InjuryCooldownAuditLogEntry[] = [];

  private readonly lastNotifiedAt = new Map<string, Date>();

  private readonly lastNotifiedStatus = new Map<string, InjuryCooldownStatus>();

  private readonly queuedStatuses = new Map<string, InjuryCooldownStatus>();

  async getLastNotifiedAt(
    participantId: string,
    pickId: string,
  ): Promise<Date | null> {
    return this.lastNotifiedAt.get(this.buildKey(participantId, pickId)) ?? null;
  }

  async getLastNotifiedStatus(
    participantId: string,
    pickId: string,
  ): Promise<InjuryCooldownStatus | null> {
    return this.lastNotifiedStatus.get(this.buildKey(participantId, pickId)) ?? null;
  }

  async recordNotification(
    participantId: string,
    pickId: string,
    status: InjuryCooldownStatus,
    notifiedAt: Date,
  ): Promise<void> {
    const key = this.buildKey(participantId, pickId);
    this.lastNotifiedAt.set(key, notifiedAt);
    this.lastNotifiedStatus.set(key, status);
  }

  async getQueuedStatus(
    participantId: string,
    pickId: string,
  ): Promise<InjuryCooldownStatus | null> {
    return this.queuedStatuses.get(this.buildKey(participantId, pickId)) ?? null;
  }

  async setQueuedStatus(
    participantId: string,
    pickId: string,
    status: InjuryCooldownStatus,
  ): Promise<void> {
    this.queuedStatuses.set(this.buildKey(participantId, pickId), status);
  }

  async clearQueuedStatus(
    participantId: string,
    pickId: string,
  ): Promise<void> {
    this.queuedStatuses.delete(this.buildKey(participantId, pickId));
  }

  async writeAuditLog(entry: InjuryCooldownAuditLogEntry): Promise<void> {
    this.auditLogs.push(entry);
  }

  seedNotification(
    participantId: string,
    pickId: string,
    status: InjuryCooldownStatus,
    notifiedAt: Date,
  ): void {
    const key = this.buildKey(participantId, pickId);
    this.lastNotifiedAt.set(key, notifiedAt);
    this.lastNotifiedStatus.set(key, status);
  }

  private buildKey(participantId: string, pickId: string): string {
    return `${participantId}:${pickId}`;
  }
}

class InMemoryInjuryNotificationRepo implements InjuryNotificationRepo {
  readonly cooldown = new InMemoryCooldownRepo();

  readonly postCalls: Array<{ channelId: string; embed: Record<string, unknown> }> = [];

  reportsBySport = new Map<string, NormalizedInjuryReport[]>();

  activePicks: Array<{ pickId: string; participantId: string }> = [];

  previousStatuses = new Map<string, InjuryStatus>();

  headshots = new Map<string, string | null>();

  async getPreviousStatuses(participantIds: string[]): Promise<Map<string, InjuryStatus>> {
    const statuses = new Map<string, InjuryStatus>();
    for (const participantId of participantIds) {
      const status = this.previousStatuses.get(participantId);
      if (status) {
        statuses.set(participantId, status);
      }
    }
    return statuses;
  }

  async getActivePicks(): Promise<Array<{ pickId: string; participantId: string }>> {
    return this.activePicks;
  }

  async fetchInjuryReports(sport: string): Promise<NormalizedInjuryReport[]> {
    return this.reportsBySport.get(sport) ?? [];
  }

  async postToDiscord(
    channelId: string,
    embed: Record<string, unknown>,
  ): Promise<boolean> {
    this.postCalls.push({ channelId, embed });
    return true;
  }

  async getParticipantHeadshot(participantId: string): Promise<string | null> {
    return this.headshots.get(participantId) ?? null;
  }
}

const NOW = new Date('2026-05-11T12:00:00.000Z');
const NOW_ISO = NOW.toISOString();
const ORIGINAL_DISCORD_INJURIES_CHANNEL_ID = process.env.DISCORD_INJURIES_CHANNEL_ID;

function buildRepo(): InMemoryInjuryNotificationRepo {
  const repo = new InMemoryInjuryNotificationRepo();
  repo.activePicks = [{ pickId: 'pick-1', participantId: 'player-1' }];
  repo.previousStatuses.set('player-1', 'questionable');
  repo.reportsBySport.set('nba', [buildReport()]);
  repo.headshots.set('player-1', 'https://example.com/player-1.png');
  return repo;
}

function buildReport(
  overrides: Partial<NormalizedInjuryReport> = {},
): NormalizedInjuryReport {
  return {
    participantId: 'player-1',
    playerName: 'Player One',
    sport: 'nba',
    status: 'out',
    sourceTier: 'official',
    reportedAt: NOW_ISO,
    fetchedAt: NOW_ISO,
    ...overrides,
  };
}

test.afterEach(() => {
  if (ORIGINAL_DISCORD_INJURIES_CHANNEL_ID === undefined) {
    delete process.env.DISCORD_INJURIES_CHANNEL_ID;
    return;
  }

  process.env.DISCORD_INJURIES_CHANNEL_ID = ORIGINAL_DISCORD_INJURIES_CHANNEL_ID;
});

test('dryRun counts notification intent without posting to Discord', async () => {
  const repo = buildRepo();
  process.env.DISCORD_INJURIES_CHANNEL_ID = 'injuries-channel';

  const result = await runInjuryNotificationPass(['nba'], repo, {
    dryRun: true,
    now: NOW,
  });

  assert.equal(result.changesDetected, 1);
  assert.equal(result.notificationsSent, 1);
  assert.equal(repo.postCalls.length, 0);
});

test('stale report is suppressed by the staleness guard', async () => {
  const repo = buildRepo();
  process.env.DISCORD_INJURIES_CHANNEL_ID = 'injuries-channel';
  repo.reportsBySport.set('nba', [
    buildReport({
      reportedAt: '2026-05-11T07:00:00.000Z',
      fetchedAt: '2026-05-11T11:59:00.000Z',
    }),
  ]);

  const result = await runInjuryNotificationPass(['nba'], repo, {
    now: NOW,
  });

  assert.equal(result.changesDetected, 1);
  assert.equal(result.suppressedStaleness, 1);
  assert.equal(result.notificationsSent, 0);
  assert.equal(repo.postCalls.length, 0);
});

test('second pass within cooldown suppresses the duplicate notification', async () => {
  const repo = buildRepo();
  process.env.DISCORD_INJURIES_CHANNEL_ID = 'injuries-channel';

  const first = await runInjuryNotificationPass(['nba'], repo, {
    now: new Date('2026-05-11T12:00:00.000Z'),
  });
  const second = await runInjuryNotificationPass(['nba'], repo, {
    now: new Date('2026-05-11T12:10:00.000Z'),
  });

  assert.equal(first.notificationsSent, 1);
  assert.equal(second.suppressedCooldown, 1);
  assert.equal(second.notificationsSent, 0);
  assert.equal(repo.postCalls.length, 1);
});

test('clean path sends one Discord notification', async () => {
  const repo = buildRepo();
  process.env.DISCORD_INJURIES_CHANNEL_ID = 'injuries-channel';

  const result = await runInjuryNotificationPass(['nba'], repo, {
    now: NOW,
  });

  assert.equal(result.changesDetected, 1);
  assert.equal(result.notificationsSent, 1);
  assert.equal(result.suppressedStaleness, 0);
  assert.equal(result.suppressedCooldown, 0);
  assert.equal(result.queued, 0);
  assert.deepEqual(result.errors, []);
  assert.equal(repo.postCalls.length, 1);
  assert.equal(repo.postCalls[0]?.channelId, 'injuries-channel');
});

test('no matching active picks yields zeroed results', async () => {
  const repo = buildRepo();
  process.env.DISCORD_INJURIES_CHANNEL_ID = 'injuries-channel';
  repo.activePicks = [{ pickId: 'pick-2', participantId: 'player-2' }];
  repo.previousStatuses = new Map<string, InjuryStatus>([['player-2', 'questionable']]);

  const result = await runInjuryNotificationPass(['nba'], repo, {
    now: NOW,
  });

  assert.deepEqual(result, {
    changesDetected: 0,
    notificationsSent: 0,
    suppressedStaleness: 0,
    suppressedCooldown: 0,
    queued: 0,
    errors: [],
  });
  assert.equal(repo.postCalls.length, 0);
});
