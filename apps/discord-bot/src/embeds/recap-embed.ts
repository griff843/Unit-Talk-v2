import { EmbedBuilder, type APIEmbed } from 'discord.js';

export interface RecapEmbedInput {
  market: string;
  selection: string;
  result: 'win' | 'loss' | 'push';
  stakeUnits: number | null;
  profitLossUnits: number;
  clvPercent: number | null;
  submittedBy: string;
}

export function buildRecapEmbed(input: RecapEmbedInput) {
  return EmbedBuilder.from(buildRecapEmbedData(input));
}

export function buildRecapEmbedData(input: RecapEmbedInput): APIEmbed {
  return {
    title: 'Pick Recap',
    color: resolveEmbedColor(input.result),
    fields: [
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
      {
        name: 'CLV%',
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
    ],
    timestamp: new Date().toISOString(),
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

function resolveEmbedColor(result: RecapEmbedInput['result']) {
  if (result === 'win') {
    return 0x22c55e;
  }
  if (result === 'loss') {
    return 0xef4444;
  }
  return 0x9ca3af;
}
