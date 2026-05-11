import type {
  AvailabilityStatus,
  PlayerAvailability,
} from '@unit-talk/domain';

import {
  checkInjuryCooldown,
  type InjuryCooldownRepo,
  type InjuryCooldownStatus,
} from './injury-cooldown.js';
import { detectInjuryChanges } from './injury-detector.js';
import {
  buildInjuryEmbed,
  resolveInjuryChannelId,
} from './injury-notification-service.js';
import { evaluateStalenessGuard } from './injury-staleness-guard.js';
import type {
  InjuryStatus,
  NormalizedInjuryReport,
} from './injury-types.js';

interface ActivePickParticipant {
  pickId: string;
  participantId: string;
}

export interface InjuryNotificationPassOptions {
  dryRun?: boolean;
  now?: Date;
}

export interface InjuryNotificationPassResult {
  changesDetected: number;
  notificationsSent: number;
  suppressedStaleness: number;
  suppressedCooldown: number;
  queued: number;
  errors: string[];
}

export interface InjuryNotificationRepo {
  cooldown: InjuryCooldownRepo;
  getPreviousStatuses(participantIds: string[]): Promise<Map<string, InjuryStatus>>;
  getActivePicks(): Promise<ActivePickParticipant[]>;
  fetchInjuryReports(sport: string): Promise<NormalizedInjuryReport[]>;
  postToDiscord(channelId: string, embed: Record<string, unknown>): Promise<boolean>;
  getParticipantHeadshot(participantId: string): Promise<string | null>;
}

export async function runInjuryNotificationPass(
  sports: string[],
  repo: InjuryNotificationRepo,
  options: InjuryNotificationPassOptions = {},
): Promise<InjuryNotificationPassResult> {
  const result: InjuryNotificationPassResult = {
    changesDetected: 0,
    notificationsSent: 0,
    suppressedStaleness: 0,
    suppressedCooldown: 0,
    queued: 0,
    errors: [],
  };

  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const channelId = resolveInjuryChannelId(process.env);

  for (const sport of sports) {
    try {
      const reports = await repo.fetchInjuryReports(sport);
      const activePicks = await repo.getActivePicks();
      const participantIds = [...new Set(activePicks.map((pick) => pick.participantId))];
      const previousStatuses = await repo.getPreviousStatuses(participantIds);
      const pickIdsByParticipant = buildPickIdsByParticipant(activePicks);
      const detection = detectInjuryChanges({
        reports,
        previousStatuses,
        activePickParticipants: new Set(participantIds),
        nowIso,
      });

      for (const rawChange of detection.changes) {
        const affectedPickIds = pickIdsByParticipant.get(rawChange.participantId) ?? [];
        const change = {
          ...rawChange,
          affectedPickIds,
        };
        result.changesDetected += 1;

        const availabilityForGuard: PlayerAvailability = {
          participantId: change.participantId,
          status: normalizeAvailabilityStatus(change.currentStatus),
          lastUpdatedAt: change.reportedAt,
        };
        const staleness = evaluateStalenessGuard(availabilityForGuard, nowIso);
        if (staleness.suppressed) {
          result.suppressedStaleness += 1;
          continue;
        }

        for (const pickId of change.affectedPickIds) {
          const cooldown = await checkInjuryCooldown({
            participantId: change.participantId,
            pickId,
            newStatus: change.currentStatus as InjuryCooldownStatus,
            repo: repo.cooldown,
            now,
          });

          if (cooldown.outcome === 'suppressed') {
            result.suppressedCooldown += 1;
            continue;
          }

          if (cooldown.outcome === 'queued') {
            result.queued += 1;
            continue;
          }

          const thumbnailUrl = await repo.getParticipantHeadshot(change.participantId);
          const embed = buildInjuryEmbed(
            change,
            'See embed for details',
            thumbnailUrl,
          );

          if (options.dryRun) {
            result.notificationsSent += 1;
            continue;
          }

          if (!channelId) {
            continue;
          }

          const ok = await repo.postToDiscord(channelId, embed);
          if (ok) {
            result.notificationsSent += 1;
          } else {
            result.errors.push(
              `Failed to post injury notification for participant ${change.participantId} pick ${pickId}`,
            );
          }
        }
      }
    } catch (error) {
      result.errors.push(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return result;
}

function normalizeAvailabilityStatus(status: InjuryStatus): AvailabilityStatus {
  return status === 'available' ? 'confirmed' : status;
}

function buildPickIdsByParticipant(
  activePicks: ActivePickParticipant[],
): Map<string, string[]> {
  const pickIdsByParticipant = new Map<string, string[]>();

  for (const activePick of activePicks) {
    const pickIds = pickIdsByParticipant.get(activePick.participantId);
    if (pickIds) {
      pickIds.push(activePick.pickId);
      continue;
    }

    pickIdsByParticipant.set(activePick.participantId, [activePick.pickId]);
  }

  return pickIdsByParticipant;
}
