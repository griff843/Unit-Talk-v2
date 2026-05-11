import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkInjuryCooldown,
  type InjuryCooldownAuditLogEntry,
  type InjuryCooldownRepo,
  type InjuryCooldownStatus,
} from './injury-cooldown.js';

class InMemoryCooldownRepo implements InjuryCooldownRepo {
  readonly auditLogs: InjuryCooldownAuditLogEntry[] = [];

  clearQueuedStatusCalls = 0;

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
    this.clearQueuedStatusCalls += 1;
    this.queuedStatuses.delete(this.buildKey(participantId, pickId));
  }

  async writeAuditLog(
    entry: InjuryCooldownAuditLogEntry,
  ): Promise<void> {
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

  seedQueuedStatus(
    participantId: string,
    pickId: string,
    status: InjuryCooldownStatus,
  ): void {
    this.queuedStatuses.set(this.buildKey(participantId, pickId), status);
  }

  private buildKey(participantId: string, pickId: string): string {
    return `${participantId}:${pickId}`;
  }
}

const PARTICIPANT_ID = 'participant-1';
const PICK_ID = 'pick-1';
const NOW = new Date('2026-05-11T12:00:00.000Z');

test('first alert fires (outcome=send, audit log written)', async () => {
  const repo = new InMemoryCooldownRepo();

  const result = await checkInjuryCooldown({
    participantId: PARTICIPANT_ID,
    pickId: PICK_ID,
    newStatus: 'out',
    repo,
    now: NOW,
  });

  assert.equal(result.outcome, 'send');
  assert.equal(result.queuedStatus, 'out');
  assert.equal(repo.auditLogs.length, 1);
  assert.equal(repo.auditLogs[0]?.action, 'injury_alert_sent');
});

test('second alert within 30 min, same status -> suppressed', async () => {
  const repo = new InMemoryCooldownRepo();
  repo.seedNotification(
    PARTICIPANT_ID,
    PICK_ID,
    'doubtful',
    new Date(NOW.getTime() - 10 * 60000),
  );

  const result = await checkInjuryCooldown({
    participantId: PARTICIPANT_ID,
    pickId: PICK_ID,
    newStatus: 'doubtful',
    repo,
    now: NOW,
  });

  assert.equal(result.outcome, 'suppressed');
  assert.equal(result.queuedStatus, null);
  assert.equal(repo.auditLogs.length, 1);
  assert.equal(repo.auditLogs[0]?.action, 'injury_alert_suppressed');
});

test('second alert within 30 min, status escalation -> queued', async () => {
  const repo = new InMemoryCooldownRepo();
  repo.seedNotification(
    PARTICIPANT_ID,
    PICK_ID,
    'doubtful',
    new Date(NOW.getTime() - 10 * 60000),
  );

  const result = await checkInjuryCooldown({
    participantId: PARTICIPANT_ID,
    pickId: PICK_ID,
    newStatus: 'out',
    repo,
    now: NOW,
  });

  assert.equal(result.outcome, 'queued');
  assert.equal(result.queuedStatus, 'out');
  assert.equal(await repo.getQueuedStatus(PARTICIPANT_ID, PICK_ID), 'out');
  assert.equal(repo.auditLogs.length, 1);
  assert.equal(repo.auditLogs[0]?.action, 'injury_alert_queued');
});

test('alert after 30 min with queued status -> send queued', async () => {
  const repo = new InMemoryCooldownRepo();
  repo.seedNotification(
    PARTICIPANT_ID,
    PICK_ID,
    'questionable',
    new Date(NOW.getTime() - 35 * 60000),
  );
  repo.seedQueuedStatus(PARTICIPANT_ID, PICK_ID, 'out');

  const result = await checkInjuryCooldown({
    participantId: PARTICIPANT_ID,
    pickId: PICK_ID,
    newStatus: 'doubtful',
    repo,
    now: NOW,
  });

  assert.equal(result.outcome, 'send');
  assert.equal(result.queuedStatus, 'out');
  assert.equal(repo.clearQueuedStatusCalls, 1);
  assert.equal(await repo.getQueuedStatus(PARTICIPANT_ID, PICK_ID), null);
  assert.equal(repo.auditLogs[0]?.action, 'injury_alert_sent');
});

test('alert after 30 min, no queued status -> send new', async () => {
  const repo = new InMemoryCooldownRepo();
  repo.seedNotification(
    PARTICIPANT_ID,
    PICK_ID,
    'questionable',
    new Date(NOW.getTime() - 35 * 60000),
  );

  const result = await checkInjuryCooldown({
    participantId: PARTICIPANT_ID,
    pickId: PICK_ID,
    newStatus: 'probable',
    repo,
    now: NOW,
  });

  assert.equal(result.outcome, 'send');
  assert.equal(result.queuedStatus, 'probable');
  assert.equal(repo.clearQueuedStatusCalls, 1);
  assert.equal(repo.auditLogs[0]?.action, 'injury_alert_sent');
});
