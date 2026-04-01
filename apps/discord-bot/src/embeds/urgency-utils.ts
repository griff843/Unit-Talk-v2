export interface PickUrgencyDisplay {
  eventStartLabel: string;
  countdownLabel: string | null;
  statusLabel: string;
}

const HALF_HOUR_MS = 30 * 60 * 1000;

export function buildPickUrgencyDisplay(
  eventStartTime: string,
  now: Date = new Date(),
): PickUrgencyDisplay | null {
  const parsed = new Date(eventStartTime);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const diffMs = parsed.getTime() - now.getTime();
  return {
    eventStartLabel: formatUtcTimestamp(parsed),
    countdownLabel: diffMs > 0 ? formatCountdown(diffMs) : null,
    statusLabel:
      diffMs <= 0
        ? '🔒 Locked'
        : diffMs <= HALF_HOUR_MS
        ? '⚡ Closing soon'
        : 'Live window open',
  };
}

function formatUtcTimestamp(value: Date) {
  return value.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function formatCountdown(diffMs: number) {
  const totalMinutes = Math.max(1, Math.floor(diffMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `Starts in ${minutes}m`;
  }

  return `Starts in ${hours}h ${minutes}m`;
}
