import type { Page } from 'playwright';
import { unitTalkConfig } from './config.js';
import { commandCenterSkills } from './surfaces/command-center/index.js';
import { smartFormSkills } from './surfaces/smart-form/index.js';
import { discordSkills } from './surfaces/discord/index.js';
import type { ProductAdapter, QASkill, Persona, Environment } from '../../core/types.js';

const allSkills: QASkill[] = [
  ...commandCenterSkills,
  ...smartFormSkills,
  ...discordSkills,
];

export const unitTalkAdapter: ProductAdapter = {
  config: unitTalkConfig,

  getSkill(surface: string, flow: string): QASkill | undefined {
    return allSkills.find((s) => s.surface === surface && s.flow === flow);
  },

  async authenticate(_page: Page, _persona: Persona, _env: Environment): Promise<void> {
    // Command Center: internal operator tool; auth is at API key level (env var), no browser login.
    // Smart Form: uses next-auth; for authenticated flows, set persona.credentials.storageStatePath.
    // Discord: handled per-skill via DISCORD_QA_* env vars.
  },
};
