import type { PlayerAvailability } from '@unit-talk/domain';
import { STALENESS_THRESHOLD_HOURS } from '@unit-talk/domain';

export interface StalenessGuardResult {
  suppressed: boolean;
  reason?: 'missing_timestamp' | 'stale_data';
  dataAgeHours?: number;
}

export function evaluateStalenessGuard(
  availability: PlayerAvailability,
  now?: string,
): StalenessGuardResult {
  if (!availability.lastUpdatedAt) {
    return {
      suppressed: true,
      reason: 'missing_timestamp',
    };
  }

  const nowMs = new Date(now ?? new Date().toISOString()).getTime();
  const age =
    (nowMs - new Date(availability.lastUpdatedAt).getTime()) / 3_600_000;

  if (age >= STALENESS_THRESHOLD_HOURS) {
    return {
      suppressed: true,
      reason: 'stale_data',
      dataAgeHours: age,
    };
  }

  return {
    suppressed: false,
    dataAgeHours: age,
  };
}
