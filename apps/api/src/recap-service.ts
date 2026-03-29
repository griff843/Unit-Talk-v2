import type { PickRecord, RepositoryBundle, SystemRunRepository } from '@unit-talk/db';

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
  topPlay: RecapTopPlay;
}

export interface PostRecapOptions {
  channel?: string;
  now?: Date;
  fetchImpl?: typeof fetch;
  dryRun?: boolean;
}

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

  const joinedRows = (
    await Promise.all(
      relevantSettlements.map(async (settlement) => {
        const pick = await repositories.picks.findPickById(settlement.pick_id);
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
      }),
    )
  ).filter(
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
  repositories: Pick<RepositoryBundle, 'settlements' | 'picks' | 'runs'>,
  options: PostRecapOptions = {},
): Promise<PostRecapResult> {
  const idempotencyKey = `recap.post:${period}:${roundToMinute(new Date().toISOString())}`;
  let run: Awaited<ReturnType<SystemRunRepository['startRun']>> | undefined;
  try {
    run = await repositories.runs.startRun({
      runType: 'recap.post',
      actor: 'recap-agent',
      details: { period },
      idempotencyKey,
    });
  } catch {
    // Idempotency key collision — continue without instrumentation
  }

  const summary = await computeRecapSummary(period, repositories, options.now);
  if (!summary) {
    if (run) {
      await repositories.runs
        .completeRun({
          runId: run.id,
          status: 'succeeded',
          details: { skipped: true, reason: 'no settled picks in window', period },
        })
        .catch(() => undefined);
    }
    return { ok: false, reason: 'no settled picks in window' };
  }

  const dryRun = options.dryRun ?? readRecapDryRun();
  const channel = options.channel?.trim() || 'discord:recaps';
  const channelId = resolveDiscordChannelId(channel);
  if (!channelId) {
    if (run) {
      await repositories.runs
        .completeRun({
          runId: run.id,
          status: 'failed',
          details: { reason: 'channel target could not be resolved', period },
        })
        .catch(() => undefined);
    }
    return { ok: false, reason: 'channel target could not be resolved' };
  }

  if (dryRun) {
    if (run) {
      await repositories.runs
        .completeRun({
          runId: run.id,
          status: 'succeeded',
          details: { channel, pickCount: summary.settledCount, dryRun: true, period },
        })
        .catch(() => undefined);
    }
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
    if (run) {
      await repositories.runs
        .completeRun({
          runId: run.id,
          status: 'failed',
          details: { reason: 'DISCORD_BOT_TOKEN not configured', period },
        })
        .catch(() => undefined);
    }
    return { ok: false, reason: 'DISCORD_BOT_TOKEN not configured' };
  }

  const response = await (options.fetchImpl ?? fetch)(
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
    if (run) {
      await repositories.runs
        .completeRun({
          runId: run.id,
          status: 'failed',
          details: { reason: 'discord post failed', period },
        })
        .catch(() => undefined);
    }
    return { ok: false, reason: 'discord post failed' };
  }

  if (run) {
    await repositories.runs
      .completeRun({
        runId: run.id,
        status: 'succeeded',
        details: { channel, pickCount: summary.settledCount, dryRun: false, period },
      })
      .catch(() => undefined);
  }

  return {
    ok: true,
    postsCount: 1,
    channel,
    summary,
    dryRun: false,
  };
}

export function buildRecapEmbed(summary: RecapSummary) {
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

function capitalize(value: string) {
  return value.length > 0 ? `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}` : value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function roundToMinute(isoString: string): string {
  const d = new Date(isoString);
  d.setSeconds(0, 0);
  return d.toISOString();
}
