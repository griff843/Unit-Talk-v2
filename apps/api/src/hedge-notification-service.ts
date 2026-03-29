import type {
  HedgeOpportunityPriority,
  HedgeOpportunityRecord,
  HedgeOpportunityRepository,
  HedgeOpportunityType,
} from '@unit-talk/db';
import { resolveDiscordChannelId } from './alert-notification-service.js';

const COOLDOWN_MINUTES: Record<Exclude<HedgeOpportunityPriority, 'low'>, number> = {
  medium: 30,
  high: 30,
  critical: 15,
};

export interface HedgeNotificationPassResult {
  notified: number;
  skippedCooldown: number;
  skippedLow: number;
  failed: number;
}

export interface HedgeNotificationPassOptions {
  dryRun?: boolean;
  now?: Date;
  fetchImpl?: typeof fetch;
}

export function buildHedgeEmbed(
  opportunity: HedgeOpportunityRecord,
  channelName: string,
): Record<string, unknown> {
  const color = opportunity.type === 'arbitrage' ? 0x00cc44 : 0x3366ff;
  const title =
    opportunity.type === 'arbitrage'
      ? '💰 ARBITRAGE'
      : opportunity.type === 'middle'
        ? `🔁 MIDDLE — ${opportunity.market_key.toUpperCase()}`
        : '🛡️ HEDGE OPP';

  const fields: Array<{ name: string; value: string; inline: boolean }> = [
    { name: 'Type', value: opportunity.type, inline: true },
    { name: 'Priority', value: opportunity.priority, inline: true },
    {
      name: 'Arb %',
      value: `${formatPercent(opportunity.arbitrage_percentage)}%`,
      inline: true,
    },
  ];

  if (opportunity.type === 'arbitrage') {
    fields.push({
      name: 'Guaranteed Profit',
      value: `${formatPercent(opportunity.guaranteed_profit ?? opportunity.arbitrage_percentage)}%`,
      inline: true,
    });
  }

  if (opportunity.type === 'middle') {
    fields.push({
      name: 'Win Prob',
      value: `${formatPercent((opportunity.win_probability ?? 0) * 100)}%`,
      inline: true,
    });
  }

  fields.push({
    name: 'Books',
    value: `${opportunity.bookmaker_a} over @ ${formatLineOdds(opportunity.over_odds_a)} | ${opportunity.bookmaker_b} under @ ${formatLineOdds(opportunity.under_odds_b)}`,
    inline: false,
  });

  return {
    title,
    description: `${opportunity.bookmaker_a.toUpperCase()} ${formatLine(opportunity.line_a)} vs ${opportunity.bookmaker_b.toUpperCase()} ${formatLine(opportunity.line_b)} (gap: ${formatLine(opportunity.line_discrepancy)})`,
    color,
    fields,
    footer: { text: `${opportunity.detected_at} · ${channelName}` },
    timestamp: opportunity.detected_at,
  };
}

export async function runHedgeNotificationPass(
  persistedOpportunities: HedgeOpportunityRecord[],
  repository: HedgeOpportunityRepository,
  options: HedgeNotificationPassOptions = {},
): Promise<HedgeNotificationPassResult> {
  const result: HedgeNotificationPassResult = {
    notified: 0,
    skippedCooldown: 0,
    skippedLow: 0,
    failed: 0,
  };

  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const dryRun = options.dryRun ?? true;
  const fetchImpl = options.fetchImpl ?? fetch;
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();

  for (const opportunity of persistedOpportunities) {
    if (opportunity.priority === 'low') {
      result.skippedLow++;
      continue;
    }

    if (opportunity.notified) {
      result.skippedCooldown++;
      continue;
    }

    const activeCooldown = await repository.findActiveCooldown({
      eventId: opportunity.event_id ?? null,
      marketKey: opportunity.market_key,
      type: opportunity.type as HedgeOpportunityType,
      now: nowIso,
    });

    if (activeCooldown) {
      result.skippedCooldown++;
      continue;
    }

    const channels = resolveChannels(opportunity.priority as Exclude<HedgeOpportunityPriority, 'low'>);

    if (dryRun) {
      result.notified += channels.length > 0 ? 1 : 0;
      continue;
    }

    if (!botToken) {
      result.failed++;
      continue;
    }

    const successChannels: string[] = [];
    for (const channel of channels) {
      const channelId = resolveDiscordChannelId(channel);
      if (!channelId) {
        continue;
      }

      const embed = buildHedgeEmbed(opportunity, channel);
      const ok = await postToDiscord(channelId, embed, botToken, fetchImpl);
      if (ok) {
        successChannels.push(channel);
      }
    }

    if (successChannels.length === 0) {
      result.failed++;
      continue;
    }

    const cooldownMs = COOLDOWN_MINUTES[opportunity.priority as Exclude<HedgeOpportunityPriority, 'low'>] * 60 * 1000;
    const cooldownExpiresAt = new Date(now.getTime() + cooldownMs).toISOString();

    await repository.updateNotified({
      id: opportunity.id,
      notifiedAt: nowIso,
      notifiedChannels: successChannels,
      cooldownExpiresAt,
    });

    result.notified++;
  }

  return result;
}

function resolveChannels(priority: Exclude<HedgeOpportunityPriority, 'low'>): string[] {
  if (priority === 'critical') {
    return ['discord:canary', 'discord:trader-insights'];
  }

  return ['discord:canary'];
}

async function postToDiscord(
  channelId: string,
  embed: Record<string, unknown>,
  botToken: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ embeds: [embed] }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

function formatLine(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatLineOdds(value: number | null) {
  return value === null ? '—' : `${value >= 0 ? '+' : ''}${value}`;
}

function formatPercent(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
