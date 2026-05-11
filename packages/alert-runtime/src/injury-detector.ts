import { STALENESS_THRESHOLD_HOURS } from '@unit-talk/domain';

import type {
  InjuryChange,
  InjuryDetectionResult,
  InjurySourceTier,
  InjuryStatus,
  NormalizedInjuryReport,
} from './injury-types.js';

const SOURCE_TIER_PRIORITY: Record<InjurySourceTier, number> = {
  official: 0,
  espn: 1,
  underdog: 2,
  sdio: 3,
  fantasydata: 4,
  rapidapi: 5,
};

export interface InjuryDetectorInput {
  reports: NormalizedInjuryReport[];
  previousStatuses: Map<string, InjuryStatus>;
  activePickParticipants: Set<string>;
  nowIso: string;
}

export function detectInjuryChanges(
  input: InjuryDetectorInput,
): InjuryDetectionResult {
  const nowMs = Date.parse(input.nowIso);
  const changes: InjuryChange[] = [];
  const participantsChecked = new Set<string>();
  let staleReportsSkipped = 0;

  for (const report of input.reports) {
    const fetchedAtMs = Date.parse(report.fetchedAt);
    const ageHours = (nowMs - fetchedAtMs) / 3600000;

    if (ageHours > STALENESS_THRESHOLD_HOURS) {
      staleReportsSkipped += 1;
      continue;
    }

    participantsChecked.add(report.participantId);

    const previousStatus = input.previousStatuses.get(report.participantId) ?? null;
    const hasChanged = report.status !== previousStatus;
    if (!hasChanged) {
      continue;
    }

    if (!input.activePickParticipants.has(report.participantId)) {
      continue;
    }

    if (
      previousStatus === null &&
      (report.status === 'available' || report.status === 'unknown')
    ) {
      continue;
    }

    changes.push({
      participantId: report.participantId,
      playerName: report.playerName,
      sport: report.sport,
      previousStatus,
      currentStatus: report.status,
      sourceTier: report.sourceTier,
      reportedAt: report.reportedAt,
      fetchedAt: report.fetchedAt,
      affectedPickIds: [],
    });
  }

  changes.sort((left, right) => {
    return SOURCE_TIER_PRIORITY[left.sourceTier] - SOURCE_TIER_PRIORITY[right.sourceTier];
  });

  return {
    changes,
    reportsEvaluated: input.reports.length,
    participantsChecked: participantsChecked.size,
    staleReportsSkipped,
    fetchedAt: input.nowIso,
  };
}
