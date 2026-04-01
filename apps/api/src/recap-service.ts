import type { PickRecord, RepositoryBundle } from '@unit-talk/db';
import { recordDistributionReceipt } from './distribution-receipt-service.js';

export type RecapPeriod = 'daily' | 'weekly' | 'monthly';

export interface RecapWindow {
  startsAt: string;
  endsAt: string;
  label: string;
}

export interface RecapTopPlay {
  pickId: string;
  market: string;
  selection: string;
  submittedBy: string;
  stakeUnits: number | null;
  odds: number | null;
  result: 'win' | 'loss' | 'push';
  profitLossUnits: number;
}

export interface RecapSummary {
  period: RecapPeriod;
  window: RecapWindow;
  settledCount: number;
  wins: number;
  losses: number;
  pushes: number;
  record: string;
  netUnits: number;
  roiPercent: number;
  totalRiskedUnits: number;
  totalPicks: number;
  windowDescription: string;
  sampleContext: string;
  topPlay: RecapTopPlay;
}

export interface PostRecapOptions {
  channel?: string;
  now?: Date;
  fetchImpl?: typeof fetch;
  dryRun?: boolean;
}

type RecapDeliveryRepositories = Pick<
  RepositoryBundle,
  'settlements' | 'picks' | 'outbox' | 'receipts' | 'audit'
>;

export type PostRecapResult =
  | {
      ok: true;
      postsCount: number;
      channel: string;
      summary: RecapSummary;
      dryRun: boolean;
    }
  | {
      ok: false;
      reason:
        | 'no settled picks in window'
        | 'DISCORD_BOT_TOKEN not configured'
        | 'channel target could not be resolved'
        | 'discord post failed';
    };

const UTC_DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_SETTLEMENT_LIMIT = 5_000;

export function getRecapWindow(period: RecapPeriod, now: Date = new Date()): RecapWindow {
  const currentUtcMidnight = createUtcDate(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  if (period === 'daily') {
    const startsAt = new Date(currentUtcMidnight.getTime() - UTC_DAY_MS);
    return {
      startsAt: startsAt.toISOString(),
      endsAt: currentUtcMidnight.toISOString(),
      label: `Daily Recap - ${formatMonthDay(startsAt)}`,
    };
  }

  if (period === 'weekly') {
    const currentWeekStart = getUtcWeekStart(currentUtcMidnight);
    const startsAt = new Date(currentWeekStart.getTime() - 7 * UTC_DAY_MS);
    const endsAt = currentWeekStart;
    const lastIncludedDay = new Date(endsAt.getTime() - UTC_DAY_MS);

    return {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      label: `Weekly Recap - ${formatWeekRange(startsAt, lastIncludedDay)}`,
    };
  }

  const startsAt = createUtcDate(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
  const endsAt = createUtcDate(now.getUTCFullYear(), now.getUTCMonth(), 1);

  return {
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    label: `Monthly Recap - ${formatMonthYear(startsAt)}`,
  };
}

export function detectRecapCollision(
  now: Date,
): 'weekly' | 'monthly' | 'combined' | 'daily' | 'none' {
  if (now.getUTCHours() !== 11 || now.getUTCMinutes() !== 0) {
    return 'none';
  }

  if (isFirstMondayOfMonth(now)) {
    return 'combined';
  }

  if (now.getUTCDay() === 1) {
    return 'weekly';
  }

  if (now.getUTCDate() === 1) {
    return 'monthly';
  }

  return 'daily';
}

export async function computeRecapSummary(
  period: RecapPeriod,
  repositories: Pick<RepositoryBundle, 'settlements' | 'picks'>,
  now: Date = new Date(),
): Promise<RecapSummary | null> {
  const window = getRecapWindow(period, now);
  const settlements = await repositories.settlements.listRecent(RECENT_SETTLEMENT_LIMIT);
  const relevantSettlements = settlements.filter((settlement) => {
    if (settlement.status !== 'settled') {
      return false;
    }

    if (
      settlement.result !== 'win' &&
      settlement.result !== 'loss' &&
      settlement.result !== 'push'
    ) {
      return false;
    }

    return settlement.created_at >= window.startsAt && settlement.created_at < window.endsAt;
  });

  if (relevantSettlements.length === 0) {
    return null;
  }

  const pickIds = [...new Set(relevantSettlements.map((s) => s.pick_id))];
  const picksMap = await repositories.picks.findPicksByIds(pickIds);

  const joinedRows = relevantSettlements
    .map((settlement) => {
      const pick = picksMap.get(settlement.pick_id);
      if (!pick) {
        return null;
      }

      const result = settlement.result as 'win' | 'loss' | 'push';
      return {
        pick,
        result,
        profitLossUnits: computeProfitLossUnits(
          result,
          readStakeUnits(pick),
          pick.odds,
        ),
      };
    })
    .filter(
      (
        row,
      ): row is {
        pick: PickRecord;
        result: 'win' | 'loss' | 'push';
        profitLossUnits: number;
      } => row !== null,
    );

  if (joinedRows.length === 0) {
    return null;
  }

  const wins = joinedRows.filter((row) => row.result === 'win').length;
  const losses = joinedRows.filter((row) => row.result === 'loss').length;
  const pushes = joinedRows.filter((row) => row.result === 'push').length;
  const netUnits = roundToTwoDecimals(
    joinedRows.reduce((sum, row) => sum + row.profitLossUnits, 0),
  );
  const totalRiskedUnits = roundToTwoDecimals(
    joinedRows.reduce((sum, row) => sum + (readStakeUnits(row.pick) ?? 1), 0),
  );
  const roiPercent =
    totalRiskedUnits > 0
      ? roundToTwoDecimals((netUnits / totalRiskedUnits) * 100)
      : 0;
  const topPlayRow =
    [...joinedRows].sort((left, right) => {
      const profitCompare = right.profitLossUnits - left.profitLossUnits;
      if (profitCompare !== 0) {
        return profitCompare;
      }

      const stakeCompare =
        (readStakeUnits(right.pick) ?? 1) - (readStakeUnits(left.pick) ?? 1);
      if (stakeCompare !== 0) {
        return stakeCompare;
      }

      return right.pick.created_at.localeCompare(left.pick.created_at);
    })[0] ?? null;

  if (!topPlayRow) {
    return null;
  }

  const totalPicks = joinedRows.length;
  const windowDescription = buildWindowDescription(period, window);
  const sampleContext = buildSampleContext(totalPicks, period, window);

  return {
    period,
    window,
    settledCount: joinedRows.length,
    wins,
    losses,
    pushes,
    record: `${wins}-${losses}-${pushes}`,
    netUnits,
    roiPercent,
    totalRiskedUnits,
    totalPicks,
    windowDescription,
    sampleContext,
    topPlay: {
      pickId: topPlayRow.pick.id,
      market: topPlayRow.pick.market,
      selection: topPlayRow.pick.selection,
      submittedBy: readSubmittedBy(topPlayRow.pick),
      stakeUnits: readStakeUnits(topPlayRow.pick),
      odds: topPlayRow.pick.odds,
      result: topPlayRow.result,
      profitLossUnits: roundToTwoDecimals(topPlayRow.profitLossUnits),
    },
  };
}

export async function postRecapSummary(
  period: RecapPeriod,
  repositories: RecapDeliveryRepositories,
  options: PostRecapOptions = {},
): Promise<PostRecapResult> {
  const summary = await computeRecapSummary(period, repositories, options.now);
  if (!summary) {
    return { ok: false, reason: 'no settled picks in window' };
  }

  const dryRun = options.dryRun ?? readRecapDryRun();
  const channel = options.channel?.trim() || 'discord:recaps';
  const channelId = resolveDiscordChannelId(channel);
  if (!channelId) {
    return { ok: false, reason: 'channel target could not be resolved' };
  }

  const idempotencyKey = buildRecapIdempotencyKey(period, channel, summary.window.endsAt);
  const existingOutbox = await findRecapOutboxByIdempotencyKey(
    repositories.outbox,
    idempotencyKey,
  );

  if (dryRun) {
    return {
      ok: true,
      postsCount: 0,
      channel,
      summary,
      dryRun: true,
    };
  }

  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!botToken) {
    return { ok: false, reason: 'DISCORD_BOT_TOKEN not configured' };
  }

  if (existingOutbox?.status === 'sent') {
    return {
      ok: true,
      postsCount: 0,
      channel,
      summary,
      dryRun: false,
    };
  }

  const outbox =
    existingOutbox && (existingOutbox.status === 'pending' || existingOutbox.status === 'processing')
      ? existingOutbox
      : await repositories.outbox.enqueue({
          pickId: summary.topPlay.pickId,
          target: channel,
          idempotencyKey,
          payload: buildRecapOutboxPayload(summary, channel, channelId),
        });

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          embeds: [buildRecapEmbed(summary)],
        }),
      },
    );

    if (!response.ok) {
      const terminalFailure =
        response.status >= 400 && response.status < 500 && response.status !== 429;
      await recordRecapDeliveryFailure({
        repositories,
        outbox,
        summary,
        channel,
        channelId,
        errorMessage: `HTTP ${response.status}`,
        terminalFailure,
      });
      return { ok: false, reason: 'discord post failed' };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown delivery error';
    await recordRecapDeliveryFailure({
      repositories,
      outbox,
      summary,
      channel,
      channelId,
      errorMessage,
      terminalFailure: false,
    });
    return { ok: false, reason: 'discord post failed' };
  }

  const body = (await response.json().catch(() => null)) as { id?: string } | null;
  const receipt = await recordDistributionReceipt(repositories.receipts, {
    outboxId: outbox.id,
    receiptType: 'discord.message',
    status: 'sent',
    channel: `discord:${channelId}`,
    externalId: typeof body?.id === 'string' ? body.id : undefined,
    idempotencyKey: `${outbox.id}:discord:${channelId}:receipt`,
    payload: {
      target: channel,
      channelId,
      outboxId: outbox.id,
      recapPeriod: summary.period,
      windowEndsAt: summary.window.endsAt,
    },
  });
  await repositories.audit.record({
    entityType: 'distribution_outbox',
    entityId: outbox.id,
    entityRef: summary.topPlay.pickId,
    action: 'distribution.sent',
    actor: 'recap-service',
    payload: {
      outboxId: outbox.id,
      target: channel,
      pickId: summary.topPlay.pickId,
      receiptId: receipt.receipt.id,
      channelId,
    },
  });
  await repositories.outbox.markSent(outbox.id);

  return {
    ok: true,
    postsCount: 1,
    channel,
    summary,
    dryRun: false,
  };
}

export function buildRecapEmbed(summary: RecapSummary) {
  const sampleValue = summary.totalPicks < 20
    ? `${summary.sampleContext}\n_Small sample \u2014 interpret with caution_`
    : summary.sampleContext;

  return {
    title: summary.window.label,
    color: summary.netUnits >= 0 ? 0x2f855a : 0xc53030,
    fields: [
      {
        name: 'Record',
        value: summary.record,
        inline: true,
      },
      {
        name: 'Net Units',
        value: formatUnits(summary.netUnits),
        inline: true,
      },
      {
        name: 'ROI',
        value: formatPercent(summary.roiPercent),
        inline: true,
      },
      {
        name: 'Sample',
        value: sampleValue,
        inline: true,
      },
      {
        name: 'Top Play',
        value: [
          `${summary.topPlay.selection} (${summary.topPlay.market})`,
          `Result: ${capitalize(summary.topPlay.result)}`,
          `P/L: ${formatUnits(summary.topPlay.profitLossUnits)}`,
          `Capper: ${summary.topPlay.submittedBy}`,
        ].join('\n'),
        inline: false,
      },
    ],
  };
}

function buildRecapOutboxPayload(summary: RecapSummary, channel: string, channelId: string) {
  return {
    type: 'recap.post',
    channel,
    channelId,
    period: summary.period,
    window: summary.window,
    summary,
    embeds: [buildRecapEmbed(summary)],
  };
}

function buildWindowDescription(period: RecapPeriod, window: RecapWindow): string {
  const startsAt = new Date(window.startsAt);
  const endsAt = new Date(window.endsAt);

  if (period === 'daily') {
    return `Daily (last 24h)`;
  }

  if (period === 'weekly') {
    const startStr = formatMonthDay(startsAt);
    const endStr = formatMonthDay(new Date(endsAt.getTime() - UTC_DAY_MS));
    return `Weekly (${startStr}-${endStr})`;
  }

  return `Monthly (${formatMonthYear(startsAt)})`;
}

function buildSampleContext(totalPicks: number, period: RecapPeriod, window: RecapWindow): string {
  const startsAt = new Date(window.startsAt);
  const endsAt = new Date(window.endsAt);
  const daysSpan = Math.round((endsAt.getTime() - startsAt.getTime()) / UTC_DAY_MS);
  const pickLabel = totalPicks === 1 ? 'pick' : 'picks';
  const dayLabel = daysSpan === 1 ? 'day' : 'days';
  return `${totalPicks} ${pickLabel} over ${daysSpan} ${dayLabel}`;
}

function createUtcDate(year: number, month: number, date: number) {
  return new Date(Date.UTC(year, month, date, 0, 0, 0, 0));
}

function getUtcWeekStart(date: Date) {
  const day = date.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  return new Date(date.getTime() - offset * UTC_DAY_MS);
}

function isFirstMondayOfMonth(now: Date) {
  return now.getUTCDay() === 1 && now.getUTCDate() <= 7;
}

function formatMonthDay(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function formatWeekRange(startsAt: Date, endsAt: Date) {
  const sameMonth = startsAt.getUTCMonth() === endsAt.getUTCMonth();
  const start = sameMonth ? formatMonthDay(startsAt) : formatMonthDayWithYear(startsAt);
  const end = formatMonthDayWithYear(endsAt, sameMonth);
  return `${start}-${end}`;
}

function formatMonthDayWithYear(date: Date, omitYear = true) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(omitYear ? {} : { year: 'numeric' as const }),
    timeZone: 'UTC',
  }).format(date);
}

function formatMonthYear(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function resolveDiscordChannelId(value: string) {
  const direct = value.replace(/^discord:/, '').trim();
  if (/^\d+$/.test(direct)) {
    return direct;
  }

  const raw = process.env.UNIT_TALK_DISCORD_TARGET_MAP?.trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const mapped = parsed[value];
    return mapped && /^\d+$/.test(mapped) ? mapped : null;
  } catch {
    return null;
  }
}

export function readRecapDryRun() {
  return process.env.RECAP_DRY_RUN?.trim().toLowerCase() === 'true';
}

function readStakeUnits(pick: PickRecord) {
  return typeof pick.stake_units === 'number' && Number.isFinite(pick.stake_units)
    ? pick.stake_units
    : null;
}

function readSubmittedBy(pick: PickRecord) {
  const pickRecord = pick as PickRecord & { submitted_by?: string | null };
  const metadata = asRecord(pick.metadata);
  const rawSubmittedBy =
    typeof pickRecord.submitted_by === 'string'
      ? pickRecord.submitted_by
      : typeof metadata?.submittedBy === 'string'
      ? metadata.submittedBy
      : typeof metadata?.capper === 'string'
        ? metadata.capper
        : null;

  return rawSubmittedBy?.trim() || 'Unit Talk';
}

function computeProfitLossUnits(
  result: 'win' | 'loss' | 'push',
  stakeUnits: number | null,
  odds: number | null,
) {
  const stake = stakeUnits ?? 1;

  if (result === 'push') {
    return 0;
  }

  if (result === 'loss') {
    return -stake;
  }

  if (typeof odds !== 'number' || !Number.isFinite(odds) || odds === 0) {
    return stake;
  }

  return odds > 0 ? stake * (odds / 100) : stake * (100 / Math.abs(odds));
}

function formatUnits(value: number) {
  const rounded = roundToTwoDecimals(value);
  const normalized = Number.isInteger(rounded) ? rounded.toFixed(1) : rounded.toString();
  return `${rounded >= 0 ? '+' : ''}${normalized}u`;
}

function formatPercent(value: number) {
  const rounded = roundToTwoDecimals(value);
  const normalized = Number.isInteger(rounded) ? rounded.toFixed(1) : rounded.toString();
  return `${rounded >= 0 ? '+' : ''}${normalized}%`;
}

function roundToTwoDecimals(value: number) {
  return Math.round(value * 100) / 100;
}

function buildRecapIdempotencyKey(period: RecapPeriod, channel: string, windowEndsAt: string) {
  return `recap:${period}:${channel}:${windowEndsAt}`;
}

async function findRecapOutboxByIdempotencyKey(
  outboxRepository: RecapDeliveryRepositories['outbox'],
  idempotencyKey: string,
) {
  if (!outboxRepository.findByIdempotencyKey) {
    return null;
  }

  return outboxRepository.findByIdempotencyKey(idempotencyKey);
}

async function recordRecapDeliveryFailure(
  input: {
    repositories: RecapDeliveryRepositories;
    outbox: { id: string; attempt_count: number };
    summary: RecapSummary;
    channel: string;
    channelId: string;
    errorMessage: string;
    terminalFailure: boolean;
  },
) {
  if (input.terminalFailure) {
    await input.repositories.outbox.markDeadLetter(input.outbox.id, input.errorMessage);
    await input.repositories.audit.record({
      entityType: 'distribution_outbox',
      entityId: input.outbox.id,
      entityRef: input.summary.topPlay.pickId,
      action: 'distribution.dead_lettered',
      actor: 'recap-service',
      payload: {
        outboxId: input.outbox.id,
        target: input.channel,
        pickId: input.summary.topPlay.pickId,
        channelId: input.channelId,
        error: input.errorMessage,
        deadLettered: true,
      },
    });
    return;
  }

  const attemptCount = (input.outbox.attempt_count ?? 0) + 1;
  const nextAttemptAt = new Date(Date.now() + 5_000 * Math.pow(2, attemptCount)).toISOString();

  await input.repositories.outbox.markFailed(input.outbox.id, input.errorMessage, nextAttemptAt);
  await input.repositories.audit.record({
    entityType: 'distribution_outbox',
    entityId: input.outbox.id,
    entityRef: input.summary.topPlay.pickId,
    action: 'distribution.retry_scheduled',
    actor: 'recap-service',
    payload: {
      outboxId: input.outbox.id,
      target: input.channel,
      pickId: input.summary.topPlay.pickId,
      channelId: input.channelId,
      error: input.errorMessage,
      nextAttemptAt,
    },
  });
}

function capitalize(value: string) {
  return value.length > 0 ? `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}` : value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
