import type { OutboxRecord } from '@unit-talk/db';
import type { DeliveryAdapter } from './runner.js';
import type { DeliveryResult } from './distribution-worker.js';

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
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}): DeliveryAdapter {
  const dryRun = options?.dryRun ?? true;
  const botToken = options?.botToken ?? process.env.DISCORD_BOT_TOKEN;
  const targetMap = options?.targetMap ?? readDiscordTargetMap();
  const apiBaseUrl = options?.apiBaseUrl ?? 'https://discord.com/api/v10';
  const fetchImpl = options?.fetchImpl ?? fetch;

  return async (outbox: OutboxRecord) => {
    const resolvedChannelId = safelyResolveDiscordChannelId(outbox.target, targetMap);

    if (!dryRun) {
      const channelId = resolvedChannelId ?? resolveDiscordChannelId(outbox.target, targetMap);
      if (!botToken) {
        throw new Error('DISCORD_BOT_TOKEN is required for live Discord delivery.');
      }

      let response: Response;
      try {
        response = await fetchImpl(`${apiBaseUrl}/channels/${channelId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bot ${botToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(buildDiscordMessagePayload(outbox)),
        });
      } catch (networkError) {
        const reason = networkError instanceof Error ? networkError.message : 'network error';
        return {
          receiptType: 'discord.message',
          status: 'retryable-failure',
          channel: `discord:${channelId}`,
          reason,
          payload: {
            adapter: 'discord',
            dryRun: false,
            target: outbox.target,
            outboxId: outbox.id,
            channelId,
          },
        } satisfies DeliveryResult;
      }

      if (!response.ok) {
        const errorText = await response.text();
        const isTerminal = response.status >= 400 && response.status < 500 && response.status !== 429;
        return {
          receiptType: 'discord.message',
          status: isTerminal ? 'terminal-failure' : 'retryable-failure',
          channel: `discord:${channelId}`,
          reason: `HTTP ${response.status}: ${errorText}`,
          payload: {
            adapter: 'discord',
            dryRun: false,
            target: outbox.target,
            outboxId: outbox.id,
            channelId,
            httpStatus: response.status,
          },
        } satisfies DeliveryResult;
      }

      const body = (await response.json()) as { id: string };

      return {
        receiptType: 'discord.message',
        status: 'sent',
        channel: `discord:${channelId}`,
        externalId: body.id,
        idempotencyKey: `${outbox.id}:discord:${channelId}:receipt`,
        payload: {
          adapter: 'discord',
          dryRun: false,
          target: outbox.target,
          outboxId: outbox.id,
          channelId,
          messageId: body.id,
        },
      };
    }

    return {
      receiptType: 'discord.message',
      status: 'sent',
      channel: resolvedChannelId ? `discord:${resolvedChannelId}` : outbox.target,
      externalId: `discord-dry:${outbox.id}`,
      idempotencyKey: `${outbox.id}:discord:dry-receipt`,
      payload: {
        adapter: 'discord',
        dryRun: true,
        target: outbox.target,
        outboxId: outbox.id,
      },
    };
  };
}

function readDiscordTargetMap() {
  const raw = process.env.UNIT_TALK_DISCORD_TARGET_MAP?.trim();
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

function resolveDiscordChannelId(target: string, targetMap: Record<string, string>) {
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

function safelyResolveDiscordChannelId(target: string, targetMap: Record<string, string>) {
  try {
    return resolveDiscordChannelId(target, targetMap);
  } catch {
    return null;
  }
}

function buildDiscordMessagePayload(outbox: OutboxRecord) {
  const payload = isRecord(outbox.payload) ? outbox.payload : {};
  const market = typeof payload.market === 'string' ? payload.market : 'Unknown market';
  const selection =
    typeof payload.selection === 'string' ? payload.selection : 'Unknown selection';
  const line = formatLine(payload.line);
  const odds = formatOdds(payload.odds);
  const source = typeof payload.source === 'string' ? payload.source : 'Unit Talk';
  const lifecycleState =
    typeof payload.lifecycleState === 'string' ? payload.lifecycleState : 'queued';
  const metadata = isRecord(payload.metadata) ? payload.metadata : {};
  const sport = typeof metadata.sport === 'string' ? metadata.sport : null;
  const eventName = typeof metadata.eventName === 'string' ? metadata.eventName : null;
  const capper = typeof metadata.capper === 'string' ? metadata.capper : null;
  const description = [sport, eventName].filter((value): value is string => Boolean(value)).join(
    ' | ',
  );
  const presentation = buildTargetPresentation(outbox.target, {
    description,
    eventName,
    source,
    lifecycleState,
  });

  return {
    content: presentation.content,
    embeds: [
      {
        title: presentation.title,
        description: presentation.description,
        color: presentation.color,
        fields: [
          ...(presentation.leadField
            ? [
                {
                  name: presentation.leadField.name,
                  value: presentation.leadField.value,
                  inline: false,
                },
              ]
            : []),
          {
            name: 'Market',
            value: market,
            inline: true,
          },
          {
            name: 'Pick',
            value: `${selection}${line}${odds}`.trim(),
            inline: true,
          },
          {
            name: 'Capper',
            value: capper ?? 'Unit Talk',
            inline: true,
          },
          {
            name: 'Source',
            value: source,
            inline: true,
          },
          {
            name: 'State',
            value: lifecycleState,
            inline: true,
          },
          {
            name: 'Pick ID',
            value: `\`${outbox.pick_id}\``,
            inline: false,
          },
        ],
        footer: {
          text: presentation.footer,
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function buildTargetPresentation(
  target: string,
  input: {
    description: string;
    eventName: string | null;
    source: string;
    lifecycleState: string;
  },
) {
  if (target === 'discord:best-bets') {
    return {
      content: undefined,
      title: 'Unit Talk V2 Best Bet',
      description: input.description || 'Curated premium pick preview',
      color: 0xffd700,
      leadField: {
        name: 'Best Bets Purpose',
        value:
          'This lane is for the most presentation-ready curated picks. It should feel like a premium showcase, not a raw canary dump.',
      },
      footer: 'Target: discord:best-bets | Curated lane preview',
    };
  }

  if (target === 'discord:trader-insights') {
    return {
      content: undefined,
      title: 'Unit Talk V2 Trader Insight',
      description: input.description || 'VIP market-alerts lane preview',
      color: 0x4f8cff,
      leadField: {
        name: 'Trader Insights Purpose',
        value:
          'This lane is for sharper market-alerts signals: higher edge, higher trust, and cleaner timing than a general premium board.',
      },
      footer: 'Target: discord:trader-insights | Market-alerts lane preview',
    };
  }

  return {
    content: 'Canary delivery active. Validate formatting before expanding routing.',
    title: 'Unit Talk V2 Canary',
    description: input.description || 'Initial live delivery validation',
    color: 0xf5b041,
    leadField: null,
    footer: `Target: ${target}`,
  };
}

function formatLine(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '';
  }

  return ` @ ${value > 0 ? `+${value}` : value}`;
}

function formatOdds(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '';
  }

  return ` (${value > 0 ? `+${value}` : value})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
