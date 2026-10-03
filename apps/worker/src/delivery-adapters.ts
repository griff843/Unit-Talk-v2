import {
  buildPickPresentation,
  finiteMetric,
  knownText,
} from '@unit-talk/domain';
import { loadEnvironment } from '@unit-talk/config';
import type { OutboxRecord } from '@unit-talk/db';
import {
  discordMessageNonce,
  isHumanDeliveryTarget,
  parseGovernedTargetFromDeliveryTarget,
  readPinnedDeliveryDestination,
} from '@unit-talk/contracts';
import { createLogger, serializeError } from '@unit-talk/observability';
import type { DeliveryAdapter } from './runner.js';

const logger = createLogger({
  service: 'worker',
});

export interface DeliveryAdapterSelectionOptions {
  kind: 'stub' | 'discord';
  dryRun: boolean;
}

export function createDeliveryAdapter(
  options: DeliveryAdapterSelectionOptions,
): DeliveryAdapter {
  if (options.kind === 'discord') {
    return createDiscordDeliveryAdapter({
      dryRun: options.dryRun,
    });
  }

  return createStubDeliveryAdapter({
    dryRun: options.dryRun,
  });
}

export function createSimulationDeliveryAdapter(): DeliveryAdapter {
  return async (outbox) => ({
    receiptType: 'worker.simulation',
    status: 'sent',
    channel: `simulated:${outbox.target}`,
    externalId: `sim:${outbox.id}`,
    payload: {
      adapter: 'simulation',
      simulated: true,
      target: outbox.target,
      outboxId: outbox.id,
    },
  });
}

export function createStubDeliveryAdapter(options?: {
  channelPrefix?: string;
  dryRun?: boolean;
}): DeliveryAdapter {
  const channelPrefix = options?.channelPrefix ?? 'stub';
  const dryRun = options?.dryRun ?? true;

  return async (outbox) => ({
    receiptType: dryRun ? 'worker.dry-run' : 'worker.stub',
    status: 'sent',
    channel: `${channelPrefix}:${outbox.target}`,
    externalId: `${dryRun ? 'dry' : 'stub'}:${outbox.id}`,
    payload: {
      adapter: 'stub',
      dryRun,
      target: outbox.target,
      outboxId: outbox.id,
    },
  });
}

export function createDiscordDeliveryAdapter(options?: {
  dryRun?: boolean;
  botToken?: string;
  targetMap?: Record<string, string>;
  gameThreadMap?: Record<string, string>;
  strategyRoomRecipientMap?: Record<string, string>;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Abort fetch after this many ms (default 25000). Set 0 to disable. */
  fetchTimeoutMs?: number;
}): DeliveryAdapter {
  const dryRun = options?.dryRun ?? true;
  const environment = loadDeliveryEnvironment();
  const botToken =
    options?.botToken ??
    environment?.DISCORD_BOT_TOKEN ??
    process.env.DISCORD_BOT_TOKEN;
  const targetMap =
    options?.targetMap ??
    readDiscordTargetMap(
      environment?.UNIT_TALK_DISCORD_TARGET_MAP ??
        process.env.UNIT_TALK_DISCORD_TARGET_MAP,
    );
  const gameThreadMap =
    options?.gameThreadMap ??
    readDiscordTargetMap(
      readEnvironmentValue(environment, 'UNIT_TALK_DISCORD_GAME_THREAD_MAP') ??
        process.env.UNIT_TALK_DISCORD_GAME_THREAD_MAP,
    );
  const strategyRoomRecipientMap =
    options?.strategyRoomRecipientMap ??
    readDiscordTargetMap(
      readEnvironmentValue(
        environment,
        'UNIT_TALK_DISCORD_STRATEGY_ROOM_RECIPIENT_MAP',
      ) ?? process.env.UNIT_TALK_DISCORD_STRATEGY_ROOM_RECIPIENT_MAP,
    );
  const apiBaseUrl = options?.apiBaseUrl ?? 'https://discord.com/api/v10';
  const fetchImpl = options?.fetchImpl ?? fetch;
  const fetchTimeoutMs = options?.fetchTimeoutMs ?? 25000;

  return async (outbox: OutboxRecord) => {
    if (!dryRun) {
      if (!botToken) {
        throw new Error(
          'DISCORD_BOT_TOKEN is required for live Discord delivery.',
        );
      }

      if (
        outbox.target !== 'discord:game-threads' &&
        outbox.target !== 'discord:strategy-room' &&
        readPinnedDeliveryDestination(outbox.payload) === null
      ) {
        resolveDiscordChannelId(outbox.target, targetMap);
      }

      // WORK-2026092901: whether the message POST was ever issued. Before it,
      // a failure is `not-sent`; after it, a failure without a definitive
      // Discord answer is `ambiguous` -- the message may exist.
      let requestIssued = false;
      try {
        const route = await resolveDiscordDeliveryRoute(outbox, {
          targetMap,
          gameThreadMap,
          strategyRoomRecipientMap,
          apiBaseUrl,
          botToken,
          fetchImpl,
        });
        const controller = fetchTimeoutMs > 0 ? new AbortController() : null;
        const fetchTimer = controller
          ? setTimeout(() => controller.abort(), fetchTimeoutMs)
          : null;

        let response: Response;
        try {
          requestIssued = true;
          response = await fetchImpl(
            `${apiBaseUrl}/channels/${route.channelId}/messages`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bot ${botToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(buildDiscordMessagePayload(outbox)),
              ...(controller ? { signal: controller.signal } : {}),
            },
          );
        } finally {
          if (fetchTimer) clearTimeout(fetchTimer);
        }

        if (!response.ok) {
          const errorText = await response.text();
          const isTerminal =
            response.status >= 400 &&
            response.status < 500 &&
            response.status !== 429;

          return {
            receiptType: 'discord.message',
            status: isTerminal ? 'terminal-failure' : 'retryable-failure',
            // A 4xx (including 429) is Discord refusing the request: no message
            // was created. A 5xx says nothing about whether one was.
            dispatch:
              response.status >= 400 && response.status < 500
                ? 'rejected'
                : 'ambiguous',
            // UTV2-1929: the channel a receipt records is where the message
            // actually went, not the logical target that was asked for. See
            // the success receipt below for why that distinction is
            // load-bearing.
            channel: route.channelId,
            reason: `HTTP ${response.status}: ${errorText}`,
            payload: {
              adapter: 'discord',
              dryRun: false,
              target: outbox.target,
              outboxId: outbox.id,
              ...route.payload,
              httpStatus: response.status,
            },
          };
        }

        const body = (await response.json()) as { id?: unknown };
        if (typeof body?.id !== 'string' || body.id.length === 0) {
          // Discord answered 2xx: the message was created, but its id is
          // unreadable. Not a failure to retry -- a delivery to reconcile.
          return {
            receiptType: 'discord.message',
            status: 'retryable-failure',
            dispatch: 'ambiguous',
            channel: route.channelId,
            reason: 'Discord accepted the message but returned no message id',
            payload: {
              adapter: 'discord',
              dryRun: false,
              target: outbox.target,
              outboxId: outbox.id,
              ...route.payload,
              httpStatus: response.status,
            },
          };
        }

        return {
          receiptType: 'discord.message',
          status: 'sent',
          dispatch: 'delivered',
          // UTV2-1929 RECEIPT_CHANNEL_IS_THE_RESOLVED_DESTINATION.
          //
          // This used to record `outbox.target` -- the logical target name,
          // e.g. `discord:official-picks`. That made the receipt a restatement
          // of the request rather than a record of the delivery, and it broke
          // the one consumer that needs to know where a pick actually landed:
          // `resolveRecapChannel` in apps/api/src/grading-service.ts resolves
          // the settlement recap's channel from this field, and it requires a
          // numeric Discord id (or the shared target map, which UTV2-1923
          // deliberately exempts human capper targets from). A human capper
          // pick could therefore be delivered and then never receive its
          // settlement recap -- measured in production on 2026-09-18 against
          // outbox 684ba33f-45c4-4a80-adf0-db8286c90815.
          //
          // `route.channelId` is the destination this request was actually
          // POSTed to, including the pinned per-capper channel and a DM
          // channel. The logical target is still recorded, in `payload.target`.
          channel: route.channelId,
          externalId: body.id,
          idempotencyKey: `${outbox.id}:${outbox.target}:receipt`,
          payload: {
            adapter: 'discord',
            dryRun: false,
            target: outbox.target,
            outboxId: outbox.id,
            ...route.payload,
            messageId: body.id,
          },
        };
      } catch (error) {
        return {
          receiptType: 'discord.message',
          status: 'retryable-failure',
          dispatch: requestIssued ? 'ambiguous' : 'not-sent',
          channel: outbox.target,
          reason: error instanceof Error ? error.message : 'network error',
          payload: {
            adapter: 'discord',
            dryRun: false,
            target: outbox.target,
            outboxId: outbox.id,
          },
        };
      }
    }

    return {
      receiptType: 'discord.message',
      status: 'sent',
      channel: outbox.target,
      externalId: `discord-dry:${outbox.id}`,
      idempotencyKey: `${outbox.id}:${outbox.target}:dry-receipt`,
      payload: {
        adapter: 'discord',
        dryRun: true,
        target: outbox.target,
        outboxId: outbox.id,
      },
    };
  };
}

interface DiscordRouteResolutionOptions {
  targetMap: Record<string, string>;
  gameThreadMap: Record<string, string>;
  strategyRoomRecipientMap: Record<string, string>;
  apiBaseUrl: string;
  botToken: string;
  fetchImpl: typeof fetch;
}

interface DiscordDeliveryRoute {
  channelId: string;
  payload: Record<string, unknown>;
}

async function resolveDiscordDeliveryRoute(
  outbox: OutboxRecord,
  options: DiscordRouteResolutionOptions,
): Promise<DiscordDeliveryRoute> {
  if (outbox.target === 'discord:game-threads') {
    return resolveDiscordGameThreadRoute(outbox, options);
  }

  if (outbox.target === 'discord:strategy-room') {
    return resolveDiscordStrategyRoomRoute(outbox, options);
  }

  // UTV2-1923 WORKER_PINNED_DESTINATION_GUARD_START
  // A human capper's official pick goes to THAT capper's picks-only
  // destination, pinned onto the row by the server at enqueue time. The shared
  // `UNIT_TALK_DISCORD_TARGET_MAP` entry is not a fallback for it: falling back
  // would send every capper's picks to one channel, which is precisely the
  // behaviour this routing replaced. So for the human delivery target a missing
  // or malformed pin is a REFUSAL, not a reason to use the map.
  const pinned = readPinnedDeliveryDestination(outbox.payload);
  if (pinned) {
    return {
      channelId: pinned.channelId,
      payload: {
        channelId: pinned.channelId,
        route: 'capper-pinned',
        capperId: pinned.capperId,
        guildId: pinned.guildId,
        destinationSource: pinned.source,
      },
    };
  }

  const governedTarget = parseGovernedTargetFromDeliveryTarget(outbox.target);
  if (governedTarget !== null && isHumanDeliveryTarget(governedTarget)) {
    throw new Error(
      `Human capper delivery for outbox ${outbox.id} carries no pinned destination; refusing to fall back to a shared channel mapping.`,
    );
  }
  // UTV2-1923 WORKER_PINNED_DESTINATION_GUARD_END

  const channelId = resolveDiscordChannelId(outbox.target, options.targetMap);
  return {
    channelId,
    payload: {
      channelId,
      route: 'channel',
    },
  };
}

function resolveDiscordGameThreadRoute(
  outbox: OutboxRecord,
  options: DiscordRouteResolutionOptions,
): DiscordDeliveryRoute {
  const fallbackChannelId = resolveDiscordChannelId(
    outbox.target,
    options.targetMap,
  );
  const eventKey = readOutboxEventKey(outbox);
  const threadId = eventKey ? options.gameThreadMap[eventKey] : undefined;

  if (!threadId) {
    logger.warn(
      'Discord game-thread route missing; falling back to channel delivery',
      {
        outboxId: outbox.id,
        target: outbox.target,
        eventKey,
        fallbackChannelId,
      },
    );

    return {
      channelId: fallbackChannelId,
      payload: {
        channelId: fallbackChannelId,
        route: 'game-thread-fallback',
        eventKey,
        fallback: true,
      },
    };
  }

  return {
    channelId: threadId,
    payload: {
      channelId: threadId,
      parentChannelId: fallbackChannelId,
      route: 'game-thread',
      eventKey,
      fallback: false,
    },
  };
}

async function resolveDiscordStrategyRoomRoute(
  outbox: OutboxRecord,
  options: DiscordRouteResolutionOptions,
): Promise<DiscordDeliveryRoute> {
  const recipientId = resolveStrategyRoomRecipientId(
    outbox,
    options.strategyRoomRecipientMap,
  );
  const response = await options.fetchImpl(
    `${options.apiBaseUrl}/users/@me/channels`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bot ${options.botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient_id: recipientId,
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to create Discord DM channel: HTTP ${response.status}: ${errorText}`,
    );
  }

  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== 'string' || body.id.length === 0) {
    throw new Error(
      'Discord DM channel response did not include a channel id.',
    );
  }

  return {
    channelId: body.id,
    payload: {
      channelId: body.id,
      route: 'strategy-room-dm',
      recipientId,
    },
  };
}

function resolveStrategyRoomRecipientId(
  outbox: OutboxRecord,
  strategyRoomRecipientMap: Record<string, string>,
) {
  const payload = isRecord(outbox.payload) ? outbox.payload : {};
  const metadata = isRecord(payload.metadata) ? payload.metadata : {};
  const metadataRecipientId =
    typeof metadata.strategyRoomRecipientId === 'string'
      ? metadata.strategyRoomRecipientId.trim()
      : '';
  const mappedRecipientId =
    strategyRoomRecipientMap[outbox.target]?.trim() ?? '';
  const recipientId = metadataRecipientId || mappedRecipientId;

  if (!recipientId) {
    throw new Error(
      'No Discord strategy-room recipient mapping found. Set UNIT_TALK_DISCORD_STRATEGY_ROOM_RECIPIENT_MAP or metadata.strategyRoomRecipientId.',
    );
  }

  return recipientId;
}

function readOutboxEventKey(outbox: OutboxRecord) {
  const payload = isRecord(outbox.payload) ? outbox.payload : {};
  const metadata = isRecord(payload.metadata) ? payload.metadata : {};
  const eventId =
    typeof metadata.eventId === 'string' ? metadata.eventId.trim() : '';
  const eventName =
    typeof metadata.eventName === 'string' ? metadata.eventName.trim() : '';

  return eventId || eventName || null;
}

function loadDeliveryEnvironment() {
  try {
    return loadEnvironment();
  } catch (err) {
    logger.warn(
      'Failed to load delivery environment — delivery will be skipped',
      {
        err: serializeError(err),
      },
    );
    return undefined;
  }
}

function readDiscordTargetMap(rawValue?: string) {
  const raw = rawValue?.trim();
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed;
  } catch {
    throw new Error('UNIT_TALK_DISCORD_TARGET_MAP must be valid JSON.');
  }
}

function readEnvironmentValue(
  environment: ReturnType<typeof loadDeliveryEnvironment>,
  key: string,
) {
  if (!environment) {
    return undefined;
  }

  return (environment as unknown as Record<string, string | undefined>)[key];
}

function resolveDiscordChannelId(
  target: string,
  targetMap: Record<string, string>,
) {
  const mapped = targetMap[target];
  if (mapped) {
    return mapped;
  }

  const direct = target.replace(/^discord:/, '');
  if (/^\d+$/.test(direct)) {
    return direct;
  }

  throw new Error(
    `No Discord channel mapping found for target "${target}". Set UNIT_TALK_DISCORD_TARGET_MAP or use a discord:<channelId> target.`,
  );
}

export function buildDiscordMessagePayload(outbox: OutboxRecord) {
  const payload = isRecord(outbox.payload) ? outbox.payload : {};
  const metadata = isRecord(payload.metadata) ? payload.metadata : {};
  const target = parseGovernedTargetFromDeliveryTarget(outbox.target);
  const family =
    target !== null && isHumanDeliveryTarget(target)
      ? 'official-pick'
      : 'pick-posted';
  const embed = buildPickPresentation(family, {
    selection: knownText(payload.selection),
    market: knownText(payload.market),
    line: finiteMetric(payload.line) ? payload.line : undefined,
    odds: finiteMetric(payload.odds) ? payload.odds : undefined,
    stakeUnits: readStakeUnits(payload.stakeUnits),
    capper: knownText(metadata.capper),
    sport: knownText(metadata.sport),
    eventName: knownText(metadata.eventName),
    eventTime: knownText(metadata.eventTime) ?? knownText(metadata.gameTime),
    notes: knownText(metadata.thesis),
    thumbnailUrl: knownText(metadata.thumbnailUrl),
  });
  return {
    content: undefined,
    nonce: discordMessageNonce(outbox.id),
    enforce_nonce: true,
    embeds: [embed],
  };
}

function readStakeUnits(value: unknown): number | null {
  if (finiteMetric(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
