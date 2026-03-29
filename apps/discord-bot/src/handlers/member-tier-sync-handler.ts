import { EmbedBuilder } from 'discord.js';
import type { GuildMember, PartialGuildMember, Client, TextBasedChannel } from 'discord.js';
import type { MemberTier } from '@unit-talk/contracts';
import type { MemberTierRepository } from '@unit-talk/db';
import type { BotConfig } from '../config.js';

export { buildCapperWelcomeEmbed } from './capper-onboarding-handler.js';

/**
 * Returns a guildMemberUpdate event handler that:
 * 1. For every tier-relevant role add/remove, calls memberTierRepository.activateTier / deactivateTier
 * 2. For capper role additions, additionally posts a welcome embed to the capper channel
 *    (preserves existing capper-onboarding-handler behavior)
 *
 * Handler errors are logged and swallowed — this must never crash the bot process.
 */
export function createMemberTierSyncHandler(
  config: Pick<
    BotConfig,
    | 'capperRoleId'
    | 'vipRoleId'
    | 'vipPlusRoleId'
    | 'trialRoleId'
    | 'operatorRoleId'
    | 'capperChannelId'
  >,
  client: Client,
  memberTierRepository: MemberTierRepository,
) {
  // Build role→tier map from config, skipping any null/undefined/empty role IDs
  const roleToTier = new Map<string, MemberTier>();
  const roleEntries: Array<[string | null | undefined, MemberTier]> = [
    [config.vipRoleId, 'vip'],
    [config.vipPlusRoleId, 'vip-plus'],
    [config.trialRoleId, 'trial'],
    [config.capperRoleId, 'capper'],
    [config.operatorRoleId, 'operator'],
  ];

  for (const [roleId, tier] of roleEntries) {
    if (roleId) {
      roleToTier.set(roleId, tier);
    }
  }

  return async function handleGuildMemberUpdate(
    oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember,
  ): Promise<void> {
    try {
      const oldRoleIds = new Set(oldMember.roles.cache.keys());
      const newRoleIds = new Set(newMember.roles.cache.keys());

      const addedRoleIds = [...newRoleIds].filter((id) => !oldRoleIds.has(id));
      const removedRoleIds = [...oldRoleIds].filter((id) => !newRoleIds.has(id));

      const discordId = newMember.id;
      const discordUsername =
        newMember.user?.username ?? newMember.displayName ?? undefined;

      // Process role additions
      for (const roleId of addedRoleIds) {
        const tier = roleToTier.get(roleId);
        if (!tier) continue;

        try {
          await memberTierRepository.activateTier({
            discordId,
            discordUsername,
            tier,
            source: 'discord-role',
            changedBy: 'discord-bot',
            reason: `Role added: ${roleId}`,
          });
        } catch (err) {
          console.warn(
            `[member-tier-sync] activateTier failed for ${discordId} tier=${tier}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // Process role removals
      for (const roleId of removedRoleIds) {
        const tier = roleToTier.get(roleId);
        if (!tier) continue;

        try {
          await memberTierRepository.deactivateTier({
            discordId,
            tier,
            changedBy: 'discord-bot',
            reason: `Role removed: ${roleId}`,
          });
        } catch (err) {
          console.warn(
            `[member-tier-sync] deactivateTier failed for ${discordId} tier=${tier}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // Capper role add → post welcome embed (existing behavior preserved)
      if (addedRoleIds.includes(config.capperRoleId)) {
        const { capperChannelId } = config;
        if (!capperChannelId) {
          console.warn('[member-tier-sync] capper onboarding channel not configured');
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
            '[member-tier-sync] channel fetch failed:',
            err instanceof Error ? err.message : String(err),
          );
          return;
        }

        if (!channel) {
          console.warn('[member-tier-sync] channel not found or not text-based');
          return;
        }

        const displayName =
          newMember.displayName ?? (newMember as GuildMember).user?.username ?? 'New Capper';

        const embed = new EmbedBuilder()
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

        try {
          await (channel as { send: (opts: { embeds: EmbedBuilder[] }) => Promise<unknown> }).send({
            embeds: [embed],
          });
        } catch (err) {
          console.warn(
            '[member-tier-sync] capper welcome message send failed:',
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    } catch (err) {
      console.error('[member-tier-sync] unhandled handler error (swallowed):', err);
    }
  };
}
