import type { IncomingMessage, ServerResponse } from 'node:http';
import { memberTiers, type MemberTier } from '@unit-talk/contracts';
import type { ApiRuntimeDependencies } from '../server.js';
import { readJsonBody } from '../server.js';
import type { AuthContext } from '../auth.js';
import { writeJson } from '../http-utils.js';

/**
 * The Discord bot's service key authenticates as `submitter` with this
 * identity prefix (`UNIT_TALK_BOT_API_KEY` in auth.ts `loadAuthConfig`).
 * Deliberately local: it is an authorization input of this route and must not
 * be coupled to another route's module.
 */
const DISCORD_BOT_IDENTITY_PREFIX = 'submitter:discord-bot:';

/** A Discord snowflake: digits only, 17-20 long. */
const DISCORD_SNOWFLAKE = /^\d{17,20}$/u;

/**
 * WORK-2026101104: who may write member tiers. An operator, or the Discord
 * bot's own service key (a `submitter` whose identity carries the bot prefix).
 * A generic submitter key, a capper JWT or any other role is refused;
 * `ROUTE_ROLES` in auth.ts is deliberately unchanged, so the generic
 * `authorizeRoute` answer for `/api/member-tiers` stays operator-only.
 */
export function canSyncMemberTiers(auth: AuthContext): boolean {
  if (auth.role === 'operator') {
    return true;
  }
  return isDiscordBotCaller(auth);
}

function isDiscordBotCaller(auth: AuthContext): boolean {
  return auth.role === 'submitter' && auth.identity.startsWith(DISCORD_BOT_IDENTITY_PREFIX);
}

/**
 * The member-facing tiers the bot may sync from Discord roles. `capper` and
 * `operator` are authority-bearing classifications and stay operator-only: the
 * bot's sync of those roles is refused (and logged by the bot as a structured
 * `member_tier_sync.failed`). `free` is not a role the bot maps.
 */
const BOT_SYNCABLE_TIERS: readonly MemberTier[] = ['trial', 'vip', 'vip-plus'];

export async function handleMemberTiers(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  // The gate in server.ts attaches the authenticated context to POSTs. Fail
  // closed if it is somehow absent or not permitted: this handler writes
  // entitlement state and must not rely on the gate alone.
  const auth = (request as IncomingMessage & { auth?: AuthContext }).auth;
  if (!auth || !canSyncMemberTiers(auth)) {
    writeJson(response, 403, {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Not authorized to sync member tiers' },
    });
    return;
  }
  const botCaller = auth.role !== 'operator' && isDiscordBotCaller(auth);

  const body = await readJsonBody(request, runtime.bodyLimitBytes);
  const discordId = typeof body.discord_id === 'string' ? body.discord_id : null;
  const tier = typeof body.tier === 'string' ? body.tier : null;
  const action = typeof body.action === 'string' ? body.action : null;
  const requestedSource = typeof body.source === 'string' ? body.source : 'manual';

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
  if (botCaller && !DISCORD_SNOWFLAKE.test(discordId)) {
    writeJson(response, 400, { error: 'discord_id must be a numeric Discord id' });
    return;
  }
  if (botCaller && !BOT_SYNCABLE_TIERS.includes(tier as MemberTier)) {
    writeJson(response, 403, {
      ok: false,
      error: {
        code: 'TIER_NOT_BOT_SYNCABLE',
        message: `The Discord bot may sync only: ${BOT_SYNCABLE_TIERS.join(', ')}`,
      },
    });
    return;
  }

  // The bot can only ever record a Discord-role sync. Whatever source it sends
  // is ignored; an operator keeps the existing source handling.
  const validSource: 'discord-role' | 'manual' | 'system' = botCaller
    ? 'discord-role'
    : requestedSource === 'discord-role' || requestedSource === 'manual' || requestedSource === 'system'
      ? requestedSource
      : 'manual';

  let entityId: string | null = null;
  if (action === 'activate') {
    const row = await runtime.repositories.tiers.activateTier({
      discordId,
      tier: tier as MemberTier,
      source: validSource,
      changedBy: auth.identity,
    });
    entityId = row.id;
  } else {
    await runtime.repositories.tiers.deactivateTier({
      discordId,
      tier: tier as MemberTier,
      changedBy: auth.identity,
    });
  }

  // Server-side observability of every sync. A missing audit row for a role
  // change is itself the signal that the bot's sync is not arriving.
  await runtime.repositories.audit.record({
    entityType: 'member_tiers',
    entityId,
    entityRef: discordId,
    action: 'member_tier.synced',
    actor: auth.identity,
    payload: {
      discordId,
      tier,
      action,
      source: validSource,
      callerRole: auth.role,
    },
  });

  writeJson(response, 200, { ok: true, tier, action });
}
