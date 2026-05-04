/**
 * /ops-restart — Operator-only slash command to restart a named service.
 *
 * Safety controls (all enforced by ops-restart-guard):
 *   - Restartable service allowlist: api, worker, ingestor, discord-bot only
 *   - Per-service cooldown: 5-minute minimum between restarts
 *   - Global rate limit: max 3 restarts per rolling 60-minute window
 *   - Audit log: every attempt written to .out/ops/restart-audit.jsonl
 *
 * HUMAN-APPROVAL BOUNDARY
 * ========================
 * The following actions must NEVER be triggered via this command and always
 * require a human operator working directly on the host / cloud console:
 *   - postgres, supabase, redis — database-layer restarts
 *   - migrations — any migration run (up / down / rollback)
 *   - firewall — network / security-group changes
 *   - SSL certificate rotation
 *   - Infra-level deploys (Terraform, Pulumi, etc.)
 *
 * Bot-restartable services: api, worker, ingestor, discord-bot
 */

import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { CommandHandler } from '../command-registry.js';
import { loadBotConfig } from '../config.js';
import { requireOperatorRole } from '../role-guard.js';
import {
  processRestartRequest,
  RESTARTABLE_SERVICES,
} from '../ops-restart-guard.js';

// ---------------------------------------------------------------------------
// Embed builders
// ---------------------------------------------------------------------------

function buildAllowedEmbed(service: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Service Restart Initiated')
    .setColor(0x22c55e)
    .addFields(
      { name: 'Service', value: service, inline: true },
      { name: 'Status', value: 'Restart request accepted', inline: true },
    )
    .setFooter({ text: 'Restart audit entry written to .out/ops/restart-audit.jsonl' })
    .setTimestamp();
}

function buildDeniedEmbed(service: string, reason: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Restart Denied')
    .setColor(0xef4444)
    .addFields(
      { name: 'Service', value: service, inline: true },
      { name: 'Reason', value: reason, inline: false },
    )
    .setFooter({ text: 'Denial recorded in .out/ops/restart-audit.jsonl' })
    .setTimestamp();
}

// ---------------------------------------------------------------------------
// Command factory
// ---------------------------------------------------------------------------

export function createOpsRestartCommand(requiredRoles: string[]): CommandHandler {
  return {
    data: new SlashCommandBuilder()
      .setName('ops-restart')
      .setDescription('Restart a named service (operator only)')
      .addStringOption((option) =>
        option
          .setName('service')
          .setDescription(
            `Service to restart. Restartable: ${[...RESTARTABLE_SERVICES].join(', ')}`,
          )
          .setRequired(true)
          .setMaxLength(64),
      )
      .addStringOption((option) =>
        option
          .setName('reason')
          .setDescription('Optional reason for the restart (for the audit log)')
          .setRequired(false)
          .setMaxLength(256),
      ),

    requiredRoles,
    responseVisibility: 'private',

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      const service = interaction.options.getString('service', true).trim().toLowerCase();
      const requestedBy = interaction.user.username;

      const decision = await processRestartRequest(service, requestedBy);

      if (decision.action === 'allowed') {
        await interaction.editReply({
          content: '',
          embeds: [buildAllowedEmbed(service)],
        });
      } else {
        await interaction.editReply({
          content: '',
          embeds: [buildDeniedEmbed(service, decision.message ?? 'Request denied.')],
        });
      }
    },
  };
}

/** Auto-loaded by loadCommandRegistry — requires BotConfig for role resolution. */
export function createDefaultCommand(rootDir?: string): CommandHandler {
  const config = loadBotConfig(rootDir);
  return createOpsRestartCommand(requireOperatorRole(config));
}
