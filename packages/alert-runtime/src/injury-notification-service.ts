import type { InjuryChange, InjuryStatus } from './injury-types.js';
import { resolveDiscordChannelId } from './alert-notification-service.js';

export type { InjuryChange } from './injury-types.js';

const STATUS_COLORS: Record<InjuryStatus, number> = {
  out: 0xff0000,
  doubtful: 0xffff00,
  questionable: 0xff8c00,
  probable: 0xffbf00,
  confirmed: 0x00cc44,
  available: 0x00cc44,
  unknown: 0x808080,
};

const STATUS_EMOJI: Record<InjuryStatus, string> = {
  out: '🔴',
  doubtful: '🟡',
  questionable: '🟠',
  probable: '🟢',
  confirmed: '✅',
  available: '✅',
  unknown: '⬜',
};

export function buildInjuryEmbed(
  change: InjuryChange,
  recommendation: string,
  thumbnailUrl?: string | null,
): Record<string, unknown> {
  const emoji = STATUS_EMOJI[change.currentStatus];
  const currentLabel = formatStatus(change.currentStatus);
  const sourceLabel = change.source ?? change.sourceTier;

  const fields: Array<{ name: string; value: string; inline: boolean }> = [
    { name: 'Status', value: `${emoji} ${currentLabel}`, inline: true },
    {
      name: 'Change',
      value: change.previousStatus
        ? `${formatStatus(change.previousStatus)} → ${currentLabel}`
        : `New status: ${currentLabel}`,
      inline: true,
    },
    { name: 'Sport', value: change.sport.toUpperCase(), inline: true },
    { name: 'Recommendation', value: recommendation, inline: true },
    { name: 'Source', value: sourceLabel, inline: true },
    { name: 'Updated', value: change.reportedAt, inline: true },
  ];

  if (change.injuryNote) {
    fields.push({ name: 'Note', value: change.injuryNote.slice(0, 200), inline: false });
  }

  return {
    title: `${emoji} INJURY UPDATE — ${change.playerName}`,
    color: STATUS_COLORS[change.currentStatus],
    fields,
    thumbnail: thumbnailUrl ? { url: thumbnailUrl } : undefined,
    footer: { text: 'Unit Talk Intelligence' },
    timestamp: change.reportedAt,
  };
}

export function resolveInjuryChannelId(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const direct = env['DISCORD_INJURIES_CHANNEL_ID']?.trim();
  if (direct) return direct;
  const canary = env['DISCORD_CANARY_CHANNEL_ID']?.trim();
  if (canary) return canary;
  return resolveDiscordChannelId('injuries', env) ?? resolveDiscordChannelId('canary', env);
}

function formatStatus(status: InjuryStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
