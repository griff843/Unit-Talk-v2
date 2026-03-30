import type { IncomingMessage, ServerResponse } from 'node:http';
import { memberTiers, type MemberTier } from '@unit-talk/contracts';
import type { ApiRuntimeDependencies } from '../server.js';
import { readJsonBody } from '../server.js';
import { writeJson } from '../http-utils.js';

export async function handleMemberTiers(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const body = await readJsonBody(request, runtime.bodyLimitBytes);
  const discordId = typeof body.discord_id === 'string' ? body.discord_id : null;
  const tier = typeof body.tier === 'string' ? body.tier : null;
  const action = typeof body.action === 'string' ? body.action : null;
  const source = typeof body.source === 'string' ? body.source : 'manual';

  if (!discordId) {
    writeJson(response, 400, { error: 'discord_id is required' });
    return;
  }
  if (!tier || !(memberTiers as readonly string[]).includes(tier)) {
    writeJson(response, 400, { error: `tier must be one of: ${memberTiers.join(', ')}` });
    return;
  }
  if (action !== 'activate' && action !== 'deactivate') {
    writeJson(response, 400, { error: 'action must be activate or deactivate' });
    return;
  }

  const validSource =
    source === 'discord-role' || source === 'manual' || source === 'system'
      ? (source as 'discord-role' | 'manual' | 'system')
      : 'manual';

  if (action === 'activate') {
    await runtime.repositories.tiers.activateTier({
      discordId,
      tier: tier as MemberTier,
      source: validSource,
      changedBy: validSource,
    });
  } else {
    await runtime.repositories.tiers.deactivateTier({
      discordId,
      tier: tier as MemberTier,
      changedBy: validSource,
    });
  }

  writeJson(response, 200, { ok: true, tier, action });
}
