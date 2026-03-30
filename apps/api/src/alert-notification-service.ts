import type {
  AlertDetectionRecord,
  AlertDetectionRepository,
  AlertDetectionTier,
  SystemRunRepository,
} from '@unit-talk/db';

// Cooldown windows per tier (minutes) — per T1_ALERTAGENT_LINE_MOVEMENT_CONTRACT §6.2
const COOLDOWN_MINUTES: Record<'notable' | 'alert-worthy', number> = {
  notable: 30,
  'alert-worthy': 15,
};

// Routing table — per contract §8.1
// watch → never notified
// notable → discord:canary
// alert-worthy → discord:canary + discord:trader-insights
function resolveChannels(tier: AlertDetectionTier): string[] {
  if (tier === 'notable') return ['discord:canary'];
  if (tier === 'alert-worthy') return ['discord:canary', 'discord:trader-insights'];
  return [];
}

export interface AlertNotificationPassResult {
  notified: number;
  skippedCooldown: number;
  skippedWatch: number;
  failed: number;
}

export interface AlertNotificationPassOptions {
  dryRun?: boolean;
  now?: Date;
  fetchImpl?: typeof fetch;
  runs?: SystemRunRepository;
}

/**
 * Builds a Discord embed for a line movement alert.
 *
 * Embed contract per T1_ALERTAGENT_LINE_MOVEMENT_CONTRACT §8.4:
 *   Title:       📈 LINE MOVEMENT — [EVENT LABEL]
 *   Description: [MARKET_KEY]: [OLD_LINE] → [NEW_LINE] (+/−X.X pts)
 *   Fields:      Direction, Tier, Book, Time Elapsed, Velocity (if elevated)
 *   Color:       0xff9900 amber for notable; 0xff6600 orange for alert-worthy
 *   Footer:      snapshot timestamp · channel name
 */
export function buildAlertEmbed(
  detection: AlertDetectionRecord,
  channelName: string,
): Record<string, unknown> {
  const tier = detection.tier as AlertDetectionTier;
  const color = tier === 'alert-worthy' ? 0xff6600 : 0xff9900;

  const metadata = asRecord(detection.metadata) ?? {};
  const eventLabel =
    typeof metadata.event_name === 'string'
      ? metadata.event_name
      : detection.event_id.slice(0, 8);

  const change = Number(detection.line_change);
  const changeSign = change >= 0 ? '+' : '';
  const marketType = detection.market_type;
  const unit = marketType === 'moneyline' ? ' juice' : ' pts';
  const changeLabel = `${changeSign}${change.toFixed(1)}${unit}`;

  const velocityElevated = metadata.velocityElevated === true;

  const fields: Array<{ name: string; value: string; inline: boolean }> = [
    {
      name: 'Direction',
      value: detection.direction === 'up' ? '⬆️ Up' : '⬇️ Down',
      inline: true,
    },
    { name: 'Tier', value: tier, inline: true },
    { name: 'Book', value: detection.bookmaker_key, inline: true },
    {
      name: 'Time Elapsed',
      value: `${Number(detection.time_elapsed_minutes).toFixed(1)} min`,
      inline: true,
    },
  ];

  if (detection.velocity !== null && detection.velocity !== undefined) {
    fields.push({
      name: velocityElevated ? '⚡ Velocity (elevated)' : 'Velocity',
      value: `${Number(detection.velocity).toFixed(3)} pts/min`,
      inline: true,
    });
  }

  return {
    title: `📈 LINE MOVEMENT — ${eventLabel.toUpperCase()}`,
    description: `**${detection.market_key}**: ${detection.old_line} → ${detection.new_line} (${changeLabel})`,
    color,
    fields,
    footer: { text: `${detection.current_snapshot_at} · ${channelName}` },
    timestamp: detection.current_snapshot_at,
  };
}

/**
 * Resolves a discord:target string to a numeric channel ID using
 * UNIT_TALK_DISCORD_TARGET_MAP. Returns null if target cannot be resolved.
 */
export function resolveDiscordChannelId(
  target: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const direct = target.replace(/^discord:/, '').trim();
  if (/^\d+$/.test(direct)) {
    return direct;
  }

  const raw = env.UNIT_TALK_DISCORD_TARGET_MAP?.trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const mapped = parsed[target];
    return mapped && /^\d+$/.test(mapped) ? mapped : null;
  } catch {
    return null;
  }
}

/**
 * Posts a single Discord embed to a channel using the bot token.
 * Returns true on success, false on failure.
 */
async function postToDiscord(
  channelId: string,
  embed: Record<string, unknown>,
  botToken: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ embeds: [embed] }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Runs the notification pass over a set of persisted alert detection records.
 *
 * For each record:
 *   - watch tier → always skip (never notified)
 *   - already notified → skip
 *   - active cooldown → skip
 *   - dry-run mode → log only, no Discord call, no cooldown write-back
 *   - otherwise: build embed, POST to channels, write cooldown on success
 */
export async function runAlertNotificationPass(
  persistedSignals: AlertDetectionRecord[],
  repository: AlertDetectionRepository,
  options: AlertNotificationPassOptions = {},
): Promise<AlertNotificationPassResult> {
  const result: AlertNotificationPassResult = {
    notified: 0,
    skippedCooldown: 0,
    skippedWatch: 0,
    failed: 0,
  };

  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const dryRun = options.dryRun ?? true;
  const fetchImpl = options.fetchImpl ?? fetch;
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  const run = options.runs
    ? await options.runs.startRun({
        runType: 'alert.notification',
        details: { signalCount: persistedSignals.length },
      })
    : null;

  for (const detection of persistedSignals) {
    const tier = detection.tier as AlertDetectionTier;

    if (tier === 'watch') {
      result.skippedWatch++;
      continue;
    }

    if (detection.notified) {
      result.skippedCooldown++;
      continue;
    }

    // Cooldown check
    const activeCooldown = await repository.findActiveCooldown({
      eventId: detection.event_id,
      participantId: detection.participant_id,
      marketKey: detection.market_key,
      bookmakerKey: detection.bookmaker_key,
      tier,
      now: nowIso,
    });

    if (activeCooldown) {
      result.skippedCooldown++;
      continue;
    }

    const channels = resolveChannels(tier);

    if (dryRun) {
      // In dry-run: record counts but do not post or write cooldown
      result.notified += channels.length > 0 ? 1 : 0;
      continue;
    }

    if (!botToken) {
      result.failed++;
      continue;
    }

    // Post to each channel
    const successChannels: string[] = [];
    for (const channel of channels) {
      const channelId = resolveDiscordChannelId(channel);
      if (!channelId) continue;

      const embed = buildAlertEmbed(detection, channel);
      const ok = await postToDiscord(channelId, embed, botToken, fetchImpl);
      if (ok) {
        successChannels.push(channel);
      }
    }

    if (successChannels.length === 0) {
      result.failed++;
      continue;
    }

    // Write cooldown only after at least one channel succeeds
    const cooldownMs = COOLDOWN_MINUTES[tier as 'notable' | 'alert-worthy'] * 60 * 1000;
    const cooldownExpiresAt = new Date(now.getTime() + cooldownMs).toISOString();

    await repository.updateNotified({
      id: detection.id,
      notifiedAt: nowIso,
      notifiedChannels: successChannels,
      cooldownExpiresAt,
    });

    result.notified++;
  }

  if (run && options.runs) {
    await options.runs.completeRun({
      runId: run.id,
      status: 'succeeded',
      details: {
        notified: result.notified,
        suppressed: result.skippedCooldown + result.skippedWatch,
      },
    });
  }

  return result;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
