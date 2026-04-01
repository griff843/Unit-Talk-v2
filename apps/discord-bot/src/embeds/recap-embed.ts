import { EmbedBuilder } from 'discord.js';
import {
  buildRecapEmbedData,
  type RecapEmbedInput,
} from '@unit-talk/domain';

export type { RecapEmbedInput, RecapEmbedData } from '@unit-talk/domain';
export { buildRecapEmbedData } from '@unit-talk/domain';

export function buildRecapEmbed(input: RecapEmbedInput) {
  return EmbedBuilder.from(buildRecapEmbedData(input));
}
