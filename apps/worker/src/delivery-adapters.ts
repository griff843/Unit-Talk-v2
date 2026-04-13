import { loadEnvironment } from '@unit-talk/config';
import type { OutboxRecord } from '@unit-talk/db';
import type { DeliveryAdapter } from './runner.js';

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
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}): DeliveryAdapter {
  const dryRun = options?.dryRun ?? true;
  const environment = loadDeliveryEnvironment();
  const botToken = options?.botToken ?? environment?.DISCORD_BOT_TOKEN ?? process.env.DISCORD_BOT_TOKEN;
  const targetMap =
    options?.targetMap ??
    readDiscordTargetMap(
      environment?.UNIT_TALK_DISCORD_TARGET_MAP ?? process.env.UNIT_TALK_DISCORD_TARGET_MAP,
    );
  const apiBaseUrl = options?.apiBaseUrl ?? 'https://discord.com/api/v10';
  const fetchImpl = options?.fetchImpl ?? fetch;

  return async (outbox: OutboxRecord) => {
    const resolvedChannelId = safelyResolveDiscordChannelId(outbox.target, targetMap);

    if (!dryRun) {
      const channelId = resolvedChannelId ?? resolveDiscordChannelId(outbox.target, targetMap);
      if (!botToken) {
        throw new Error('DISCORD_BOT_TOKEN is required for live Discord delivery.');
      }

      try {
        const response = await fetchImpl(`${apiBaseUrl}/channels/${channelId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bot ${botToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(buildDiscordMessagePayload(outbox)),
        });

        if (!response.ok) {
          const errorText = await response.text();
          const isTerminal =
            response.status >= 400 && response.status < 500 && response.status !== 429;

          return {
            receiptType: 'discord.message',
            status: isTerminal ? 'terminal-failure' : 'retryable-failure',
            channel: outbox.target,
            reason: `HTTP ${response.status}: ${errorText}`,
            payload: {
              adapter: 'discord',
              dryRun: false,
              target: outbox.target,
              outboxId: outbox.id,
              channelId,
              httpStatus: response.status,
            },
          };
        }

        const body = (await response.json()) as { id: string };

        return {
          receiptType: 'discord.message',
          status: 'sent',
          channel: outbox.target,
          externalId: body.id,
          idempotencyKey: `${outbox.id}:${outbox.target}:receipt`,
          payload: {
            adapter: 'discord',
            dryRun: false,
            target: outbox.target,
            outboxId: outbox.id,
            channelId,
            messageId: body.id,
          },
        };
      } catch (error) {
        return {
          receiptType: 'discord.message',
          status: 'retryable-failure',
          channel: outbox.target,
          reason: error instanceof Error ? error.message : 'network error',
          payload: {
            adapter: 'discord',
            dryRun: false,
            target: outbox.target,
            outboxId: outbox.id,
            channelId,
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

function loadDeliveryEnvironment() {
  try {
    return loadEnvironment();
  } catch {
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
  const _market = typeof payload.market === 'string' ? payload.market : 'Unknown market';
  const selection =
    typeof payload.selection === 'string' ? payload.selection : 'Unknown selection';
  const line = formatLine(payload.line);
  const odds = formatOdds(payload.odds);
  const source = typeof payload.source === 'string' ? payload.source : 'Unit Talk';
  const lifecycleState =
    typeof payload.lifecycleState === 'string' ? payload.lifecycleState : 'queued';
  const metadata = isRecord(payload.metadata) ? payload.metadata : {};
  const thumbnailUrl = typeof metadata.thumbnailUrl === 'string' ? metadata.thumbnailUrl : null;
  const sport = typeof metadata.sport === 'string' ? metadata.sport : null;
  const eventName = typeof metadata.eventName === 'string' ? metadata.eventName : null;
  const capper = typeof metadata.capper === 'string' ? metadata.capper : null;
  const stakeUnits = typeof payload.stakeUnits === 'number' ? payload.stakeUnits : null;

  // Sport icon prefix (UTV2-559)
  const sportIcon = sport ? getSportIcon(sport) : null;
  const descriptionParts = [
    sportIcon ? `${sportIcon} ${sport}` : sport,
    eventName,
  ].filter((value): value is string => Boolean(value));
  const description = descriptionParts.join(' | ');

  const presentation = buildTargetPresentation(outbox.target, {
    description,
    eventName,
    source,
    lifecycleState,
  });

  // Enhanced embed (UTV2-194): Pick + context fields for member decision support.
  // Shows: pick, odds, units, confidence, implied probability, capper, timing.
  // Does NOT show fake edge — confidence delta is not market edge (Sprint D).
  const confidence = typeof payload.confidence === 'number' ? payload.confidence : null;
  const domainAnalysis = isRecord(metadata.domainAnalysis) ? metadata.domainAnalysis : null;
  const impliedProb = typeof domainAnalysis?.impliedProbability === 'number'
    ? domainAnalysis.impliedProbability
    : null;
  const capperRecord = typeof metadata.capperRecord === 'string' ? metadata.capperRecord : null;
  const capperClv = typeof metadata.capperClvPct === 'number' ? metadata.capperClvPct : null;

  // UTV2-559: Real edge from domain analysis
  const hasRealEdge = domainAnalysis?.hasRealEdge === true;
  const realEdge = typeof domainAnalysis?.realEdge === 'number' ? domainAnalysis.realEdge : null;
  const realEdgeSource = typeof domainAnalysis?.realEdgeSource === 'string'
    ? domainAnalysis.realEdgeSource
    : null;

  // UTV2-561: Thesis from metadata
  const thesis = typeof metadata.thesis === 'string' ? metadata.thesis : null;

  // UTV2-559: Game time from metadata
  const eventTime = typeof metadata.eventTime === 'string'
    ? metadata.eventTime
    : typeof metadata.gameTime === 'string'
      ? metadata.gameTime
      : null;

  const fields: Array<{ name: string; value: string; inline: boolean }> = [];

  if (presentation.leadField) {
    fields.push({ name: presentation.leadField.name, value: presentation.leadField.value, inline: false });
  }

  fields.push({ name: 'Pick', value: `${selection}${line}`, inline: true });
  fields.push({ name: 'Odds', value: odds || '—', inline: true });

  if (stakeUnits != null) {
    fields.push({ name: 'Units', value: String(stakeUnits), inline: true });
  }

  // UTV2-559: Prominent confidence with descriptor
  if (confidence != null) {
    const confPct = Math.round(confidence * 100);
    const descriptor = confPct >= 75 ? 'High' : confPct >= 50 ? 'Medium' : 'Low';
    fields.push({ name: 'Confidence', value: `${confPct}% (${descriptor})`, inline: true });
  }

  // UTV2-559: Real edge (only when hasRealEdge is true)
  if (hasRealEdge && realEdge != null) {
    const edgePct = `+${(realEdge * 100).toFixed(1)}%`;
    const edgeLabel = realEdgeSource ? `Edge (${realEdgeSource})` : 'Edge';
    fields.push({ name: edgeLabel, value: edgePct, inline: true });
  }

  if (impliedProb != null) {
    const implPct = (impliedProb * 100).toFixed(1);
    fields.push({ name: 'Implied Prob', value: `${implPct}%`, inline: true });
  }

  // Capper context: name + recent record + CLV if available
  let capperValue = capper ?? 'Unit Talk';
  if (capperRecord) {
    capperValue += ` (${capperRecord})`;
  }
  if (capperClv != null) {
    const clvSign = capperClv >= 0 ? '+' : '';
    capperValue += ` | CLV: ${clvSign}${capperClv.toFixed(1)}%`;
  }
  fields.push({ name: 'Capper', value: capperValue, inline: true });

  // UTV2-559: Game time when available
  if (eventTime) {
    const formatted = formatGameTime(eventTime);
    if (formatted) {
      fields.push({ name: 'Game Time', value: formatted, inline: true });
    }
  }

  // Timestamp for urgency context
  fields.push({
    name: 'Posted',
    value: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }),
    inline: true,
  });

  // UTV2-561: Thesis as standalone field (not inline) — only when present
  if (thesis) {
    fields.push({ name: 'Thesis', value: thesis, inline: false });
  }

  return {
    content: presentation.content,
    embeds: [
      {
        title: presentation.title,
        description: presentation.description,
        color: presentation.color,
        fields,
        footer: {
          text: 'Unit Talk',
        },
        timestamp: new Date().toISOString(),
        // Thumbnail: player headshot or team logo (per asset spec fallback chain)
        // Never block delivery — absent = no thumbnail, not an error
        ...(thumbnailUrl ? { thumbnail: { url: thumbnailUrl } } : {}),
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

const SPORT_ICONS: Record<string, string> = {
  MLB: '\u26be',
  NBA: '\ud83c\udfc0',
  NFL: '\ud83c\udfc8',
  NHL: '\ud83c\udfd2',
  Soccer: '\u26bd',
  soccer: '\u26bd',
  MLS: '\u26bd',
  EPL: '\u26bd',
};

function getSportIcon(sport: string): string | null {
  return SPORT_ICONS[sport] ?? null;
}

function formatGameTime(isoString: string): string | null {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return null;
  }
}
