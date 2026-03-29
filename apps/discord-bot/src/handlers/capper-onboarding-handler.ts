import { EmbedBuilder } from 'discord.js';
import type { GuildMember, PartialGuildMember, Client, TextBasedChannel } from 'discord.js';
import type { BotConfig } from '../config.js';

/**
 * Builds the welcome embed posted to the capper channel when the capper role
 * is assigned to a member.
 */
export function buildCapperWelcomeEmbed(displayName: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`👋 Welcome to Unit Talk Cappers — ${displayName}`)
    .setColor(0x5865f2)
    .setDescription(
      "You've been added as a Unit Talk Capper. Here's what you need to know to get started.",
    )
    .addFields(
      {
        name: 'Submit a pick',
        value: 'Use /pick to submit picks through the canonical submission path.',
        inline: false,
      },
      {
        name: 'Your stats',
        value: 'Use /stats to view your settled pick performance.',
        inline: false,
      },
      {
        name: 'Your recap',
        value: 'Use /recap to review your last settled picks.',
        inline: false,
      },
      {
        name: 'Questions',
        value: 'Reach out to an operator in this channel.',
        inline: false,
      },
    )
    .setFooter({ text: `Unit Talk · Capper Onboarding · ${new Date().toISOString()}` });
}

/**
 * Returns a guildMemberUpdate event handler that detects when the capper role
 * is added to a member and posts a welcome embed to the capper channel.
 *
 * Handler errors are logged and swallowed — this must never crash the bot process.
 */
export function createCapperOnboardingHandler(
  config: Pick<BotConfig, 'capperRoleId' | 'capperChannelId'>,
  client: Client,
) {
  return async function handleGuildMemberUpdate(
    oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember,
  ): Promise<void> {
    try {
      const oldRoleIds = new Set(oldMember.roles.cache.keys());
      const addedRoleIds = [...newMember.roles.cache.keys()].filter(
        (id) => !oldRoleIds.has(id),
      );

      if (!addedRoleIds.includes(config.capperRoleId)) {
        return;
      }

      const { capperChannelId } = config;
      if (!capperChannelId) {
        console.warn('[capper-onboarding] capper onboarding channel not configured');
        return;
      }

      let channel: TextBasedChannel | null = null;
      try {
        const raw =
          client.channels.cache.get(capperChannelId) ??
          (await client.channels.fetch(capperChannelId));
        if (raw && raw.isTextBased()) {
          channel = raw as TextBasedChannel;
        }
      } catch (err) {
        console.warn(
          '[capper-onboarding] channel fetch failed:',
          err instanceof Error ? err.message : String(err),
        );
        return;
      }

      if (!channel) {
        console.warn('[capper-onboarding] channel not found or not text-based');
        return;
      }

      const displayName =
        newMember.displayName ?? (newMember as GuildMember).user?.username ?? 'New Capper';
      const embed = buildCapperWelcomeEmbed(displayName);

      try {
        await (channel as { send: (opts: { embeds: EmbedBuilder[] }) => Promise<unknown> }).send({
          embeds: [embed],
        });
      } catch (err) {
        console.warn(
          '[capper-onboarding] message send failed:',
          err instanceof Error ? err.message : String(err),
        );
      }
    } catch (err) {
      console.error('[capper-onboarding] unhandled handler error (swallowed):', err);
    }
  };
}
