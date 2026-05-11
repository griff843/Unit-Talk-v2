export const COOLDOWN_MINUTES = 30;

export type InjuryCooldownStatus =
  | 'out'
  | 'doubtful'
  | 'questionable'
  | 'probable'
  | 'confirmed'
  | 'available'
  | 'unknown';

export type InjuryCooldownOutcome = 'send' | 'queued' | 'suppressed';

export interface InjuryCooldownAuditLogEntry {
  action: 'injury_alert_sent' | 'injury_alert_queued' | 'injury_alert_suppressed';
  entity_type: 'injury_notification';
  entity_id: string;
  entity_ref: string;
  metadata: {
    newStatus: InjuryCooldownStatus;
  };
  created_at: string;
}

export interface InjuryCooldownRepo {
  getLastNotifiedAt(
    participantId: string,
    pickId: string,
  ): Promise<Date | null> | Date | null;
  getLastNotifiedStatus(
    participantId: string,
    pickId: string,
  ): Promise<InjuryCooldownStatus | null> | InjuryCooldownStatus | null;
  recordNotification(
    participantId: string,
    pickId: string,
    status: InjuryCooldownStatus,
    notifiedAt: Date,
  ): Promise<void> | void;
  getQueuedStatus(
    participantId: string,
    pickId: string,
  ): Promise<InjuryCooldownStatus | null> | InjuryCooldownStatus | null;
  setQueuedStatus(
    participantId: string,
    pickId: string,
    status: InjuryCooldownStatus,
  ): Promise<void> | void;
  clearQueuedStatus(
    participantId: string,
    pickId: string,
  ): Promise<void> | void;
  writeAuditLog(
    entry: InjuryCooldownAuditLogEntry,
  ): Promise<void> | void;
}

export interface CheckInjuryCooldownInput {
  participantId: string;
  pickId: string;
  newStatus: InjuryCooldownStatus;
  repo: InjuryCooldownRepo;
  now?: Date;
}

export interface CheckInjuryCooldownResult {
  outcome: InjuryCooldownOutcome;
  queuedStatus: InjuryCooldownStatus | null;
}

const STATUS_SEVERITY: Record<InjuryCooldownStatus, number> = {
  out: 6,
  doubtful: 5,
  questionable: 4,
  probable: 3,
  confirmed: 2,
  available: 2,
  unknown: 1,
};

function getStatusSeverity(status: InjuryCooldownStatus): number {
  return STATUS_SEVERITY[status];
}

export function isEscalation(
  from: InjuryCooldownStatus,
  to: InjuryCooldownStatus,
): boolean {
  return getStatusSeverity(to) > getStatusSeverity(from);
}

function resolveMoreSevereStatus(
  left: InjuryCooldownStatus,
  right: InjuryCooldownStatus,
): InjuryCooldownStatus {
  return getStatusSeverity(left) >= getStatusSeverity(right) ? left : right;
}

function buildAuditLogEntry(
  action: InjuryCooldownAuditLogEntry['action'],
  participantId: string,
  pickId: string,
  newStatus: InjuryCooldownStatus,
  now: Date,
): InjuryCooldownAuditLogEntry {
  return {
    action,
    entity_type: 'injury_notification',
    entity_id: participantId,
    entity_ref: pickId,
    metadata: { newStatus },
    created_at: now.toISOString(),
  };
}

export async function checkInjuryCooldown(
  input: CheckInjuryCooldownInput,
): Promise<CheckInjuryCooldownResult> {
  const now = input.now ?? new Date();
  const lastNotifiedAt = await input.repo.getLastNotifiedAt(
    input.participantId,
    input.pickId,
  );

  if (lastNotifiedAt === null) {
    await input.repo.recordNotification(
      input.participantId,
      input.pickId,
      input.newStatus,
      now,
    );
    await input.repo.writeAuditLog(
      buildAuditLogEntry(
        'injury_alert_sent',
        input.participantId,
        input.pickId,
        input.newStatus,
        now,
      ),
    );

    return {
      outcome: 'send',
      queuedStatus: input.newStatus,
    };
  }

  const elapsedMinutes = (now.getTime() - lastNotifiedAt.getTime()) / 60000;
  if (elapsedMinutes < COOLDOWN_MINUTES) {
    const lastStatus =
      (await input.repo.getLastNotifiedStatus(input.participantId, input.pickId)) ??
      input.newStatus;

    if (isEscalation(lastStatus, input.newStatus)) {
      await input.repo.setQueuedStatus(
        input.participantId,
        input.pickId,
        input.newStatus,
      );
      await input.repo.writeAuditLog(
        buildAuditLogEntry(
          'injury_alert_queued',
          input.participantId,
          input.pickId,
          input.newStatus,
          now,
        ),
      );

      return {
        outcome: 'queued',
        queuedStatus: input.newStatus,
      };
    }

    await input.repo.writeAuditLog(
      buildAuditLogEntry(
        'injury_alert_suppressed',
        input.participantId,
        input.pickId,
        input.newStatus,
        now,
      ),
    );

    return {
      outcome: 'suppressed',
      queuedStatus: null,
    };
  }

  const queuedStatus = await input.repo.getQueuedStatus(
    input.participantId,
    input.pickId,
  );
  const statusToSend = queuedStatus === null
    ? input.newStatus
    : resolveMoreSevereStatus(queuedStatus, input.newStatus);

  await input.repo.clearQueuedStatus(input.participantId, input.pickId);
  await input.repo.recordNotification(
    input.participantId,
    input.pickId,
    statusToSend,
    now,
  );
  await input.repo.writeAuditLog(
    buildAuditLogEntry(
      'injury_alert_sent',
      input.participantId,
      input.pickId,
      statusToSend,
      now,
    ),
  );

  return {
    outcome: 'send',
    queuedStatus: statusToSend,
  };
}
