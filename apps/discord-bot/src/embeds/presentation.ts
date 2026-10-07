import { EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import {
  buildPresentationEmbed,
  buildPresentationPages,
  buildPrivatePresentation,
  type DiscordFamily,
  type PresentationInput,
  type PresentationEmbed,
} from '@unit-talk/domain';

export function createMemberEmbed(
  family: DiscordFamily = 'service-alert',
): EmbedBuilder {
  return EmbedBuilder.from(buildPresentationEmbed(family));
}
export function memberPages(
  family: DiscordFamily,
  input: PresentationInput,
): EmbedBuilder[] {
  return buildPresentationPages(family, input).map((embed) =>
    EmbedBuilder.from(embed),
  );
}
/** Preserve board rows, including unusually long selections, within API limits. */
export function memberTextPages(title: string, text: string): EmbedBuilder[] {
  const pages: EmbedBuilder[] = [];
  let description = '';
  for (const char of text) {
    if (description.length + char.length > 3900) {
      pages.push(
        createMemberEmbed().setTitle(title).setDescription(description),
      );
      description = '';
    }
    description += char;
  }
  if (description)
    pages.push(createMemberEmbed().setTitle(title).setDescription(description));
  return pages;
}
export async function replyWithPages(
  interaction: ChatInputCommandInteraction,
  embeds: Array<EmbedBuilder | PresentationEmbed>,
): Promise<void> {
  const [first, ...remaining] = embeds;
  if (!first) return;
  await interaction.editReply({ content: '', embeds: [first] });
  for (const embed of remaining)
    await interaction.followUp({
      embeds: [embed],
      ephemeral: interaction.ephemeral !== false,
    });
}
export async function replyWithPrivateError(
  interaction: ChatInputCommandInteraction,
  description: string,
  publicReply = false,
): Promise<void> {
  const reply = buildPrivatePresentation('bot-error', description);
  if (publicReply || interaction.ephemeral === false) {
    await interaction.deleteReply();
    await interaction.followUp(reply);
  } else {
    await interaction.editReply({ content: '', embeds: reply.embeds });
  }
}
