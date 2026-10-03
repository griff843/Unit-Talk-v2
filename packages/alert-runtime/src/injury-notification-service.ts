import { buildPresentationEmbed } from '@unit-talk/domain';
import type { InjuryChange, InjuryStatus } from './injury-types.js';
import { resolveDiscordChannelId } from './alert-notification-service.js';

export type { InjuryChange } from './injury-types.js';

export function buildInjuryEmbed(
  change: InjuryChange,
  recommendation: string,
  thumbnailUrl?: string | null,
): Record<string, unknown> {
  const currentLabel = formatStatus(change.currentStatus);
  const sourceLabel = change.source ?? change.sourceTier;

  const fields: Array<{ name: string; value: string; inline: boolean }> = [
    { name: 'Status', value: currentLabel, inline: true },
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
    fields.push({
      name: 'Note',
      value: change.injuryNote.slice(0, 200),
      inline: false,
    });
  }

  return {
    ...buildPresentationEmbed('service-alert', {
      title: `Injury Update · ${change.playerName}`,
      fields,
      thumbnailUrl,
      timestamp: change.reportedAt,
    }),
  };
}

export function resolveInjuryChannelId(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const direct = env['DISCORD_INJURIES_CHANNEL_ID']?.trim();
  if (direct) return direct;
  const canary = env['DISCORD_CANARY_CHANNEL_ID']?.trim();
  if (canary) return canary;
  return (
    resolveDiscordChannelId('injuries', env) ??
    resolveDiscordChannelId('canary', env)
  );
}

function formatStatus(status: InjuryStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
