/**
 * Pure domain logic for building recap embed data.
 *
 * This module produces a plain object describing a recap embed.
 * It has no dependency on discord.js — apps that need a Discord
 * EmbedBuilder can construct one from the returned data.
 */

export interface RecapEmbedInput {
  market: string;
  selection: string;
  result: 'win' | 'loss' | 'push';
  stakeUnits: number | null;
  profitLossUnits: number;
  clvPercent: number | null;
  submittedBy: string;
  confidence?: number | null | undefined;
  sport?: string | null | undefined;
  odds?: number | null | undefined;
  thumbnailUrl?: string | null | undefined;
}

export interface RecapEmbedField {
  name: string;
  value: string;
  inline: boolean;
}

export interface RecapEmbedData {
  title: string;
  color: number;
  fields: RecapEmbedField[];
  timestamp: string;
  thumbnail?: { url: string } | undefined;
}

export function buildRecapEmbedData(input: RecapEmbedInput): RecapEmbedData {
  const sportIcon = input.sport ? RECAP_SPORT_ICONS[input.sport] ?? '' : '';
  const title = sportIcon ? `${sportIcon} Pick Recap` : 'Pick Recap';
  const thumbnail = typeof input.thumbnailUrl === 'string' && input.thumbnailUrl.length > 0
    ? { url: input.thumbnailUrl }
    : undefined;

  const fields: RecapEmbedField[] = [
    {
      name: 'Market',
      value: input.market.trim() || 'Unknown market',
      inline: false,
    },
    {
      name: 'Selection',
      value: input.selection.trim() || 'Unknown selection',
      inline: false,
    },
    {
      name: 'Result',
      value: formatResult(input.result),
      inline: true,
    },
    {
      name: 'P/L',
      value: formatProfitLossUnits(input.profitLossUnits),
      inline: true,
    },
  ];

  if (input.odds != null && Number.isFinite(input.odds)) {
    fields.push({
      name: 'Odds',
      value: formatAmericanOdds(input.odds),
      inline: true,
    });
  }

  if (input.confidence != null && Number.isFinite(input.confidence)) {
    const confPct = Math.round(input.confidence * 100);
    const descriptor = confPct >= 75 ? 'High' : confPct >= 50 ? 'Medium' : 'Low';
    fields.push({
      name: 'Confidence',
      value: `${confPct}% (${descriptor})`,
      inline: true,
    });
  }

  fields.push(
    {
      name: 'CLV% (vs SGO close)',
      value: formatSignedPercent(input.clvPercent),
      inline: true,
    },
    {
      name: 'Capper',
      value: input.submittedBy.trim() || 'Unknown',
      inline: true,
    },
    {
      name: 'Stake',
      value: formatStakeUnits(input.stakeUnits),
      inline: true,
    },
  );

  return {
    title,
    color: resolveEmbedColor(input.result),
    fields,
    timestamp: new Date().toISOString(),
    thumbnail,
  };
}

function formatResult(result: RecapEmbedInput['result']) {
  if (result === 'win') {
    return 'Win';
  }
  if (result === 'loss') {
    return 'Loss';
  }
  return 'Push';
}

function formatProfitLossUnits(value: number) {
  const normalized = Math.abs(value).toFixed(1);
  if (value > 0) {
    return `+${normalized}u`;
  }
  if (value < 0) {
    return `-${normalized}u`;
  }
  return '0.0u';
}

function formatStakeUnits(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '—';
  }

  return `${value.toFixed(1)}u`;
}

function formatSignedPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '—';
  }

  const normalized = value.toFixed(1);
  return value > 0 ? `+${normalized}%` : `${normalized}%`;
}

function formatAmericanOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : String(odds);
}

const RECAP_SPORT_ICONS: Record<string, string> = {
  MLB: '\u26be',
  NBA: '\ud83c\udfc0',
  NFL: '\ud83c\udfc8',
  NHL: '\ud83c\udfd2',
  Soccer: '\u26bd',
  soccer: '\u26bd',
  MLS: '\u26bd',
  EPL: '\u26bd',
};

function resolveEmbedColor(result: RecapEmbedInput['result']) {
  if (result === 'win') {
    return 0x22c55e;
  }
  if (result === 'loss') {
    return 0xef4444;
  }
  return 0x9ca3af;
}
