/**
 * Pure Discord presentation. Callers supply canonical data and retain all
 * authorization, routing, settlement and activation decisions.
 */
export const DISCORD_PRESENTATION = {
  gold: 0xc7a34b,
  white: 0xffffff,
  black: 0x111111,
  footer: 'Unit Talk',
  limits: {
    title: 256,
    description: 4096,
    fieldName: 256,
    fieldValue: 1024,
    fields: 25,
    messageCharacters: 6000,
    embeds: 10,
  },
} as const;

export const DISCORD_FAMILIES = {
  'official-pick': 'Official Pick',
  'pick-posted': 'Pick Posted',
  win: 'Win',
  loss: 'Loss',
  push: 'Push',
  void: 'Void',
  correction: 'Correction',
  'daily-recap': 'Daily Recap',
  'weekly-recap': 'Weekly Recap',
  'monthly-recap': 'Monthly Recap',
  'capper-record': 'Capper Record',
  'capper-profile': 'Capper Profile',
  leaderboard: 'Leaderboard',
  welcome: 'Welcome to Unit Talk',
  'trial-started': 'Trial Started',
  'trial-expiring': 'Trial Expiring',
  upgrade: 'Upgrade',
  'service-alert': 'Service Alert',
  'access-denied': 'Access Denied',
  'bot-error': 'Bot Error',
  'capper-onboarding': 'Capper Onboarding',
  'system-maintenance': 'System Maintenance',
} as const;
export type DiscordFamily = keyof typeof DISCORD_FAMILIES;
export type SettledPresentationState =
  | 'win'
  | 'loss'
  | 'push'
  | 'void'
  | 'correction';
export const SETTLED_COLORS: Record<SettledPresentationState, number> = {
  win: 0x22c55e,
  loss: 0xef4444,
  push: 0x9ca3af,
  void: 0x64748b,
  correction: 0x8b5cf6,
};
export interface PresentationField {
  name: string;
  value: string;
  inline: boolean;
}
export interface PresentationEmbed {
  title: string;
  color: number;
  fields: PresentationField[];
  footer: { text: string };
  description?: string;
  timestamp?: string;
  thumbnail?: { url: string };
}
export interface PresentationInput {
  title?: string | null | undefined;
  description?: string | null | undefined;
  fields?:
    | ReadonlyArray<{
        name: string;
        value?: string | null | undefined;
        inline?: boolean;
      }>
    | undefined;
  timestamp?: string | null | undefined;
  thumbnailUrl?: string | null | undefined;
}
export function knownText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
export function finiteMetric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
export function signedPercent(value: unknown): string | undefined {
  return finiteMetric(value)
    ? `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
    : undefined;
}
export function unitsLabel(value: unknown): string | undefined {
  return finiteMetric(value)
    ? `${value > 0 ? '+' : ''}${value.toFixed(1)}u`
    : undefined;
}
export function sourceTimestamp(value: unknown): string | undefined {
  const text = knownText(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}T/u.test(text)) return undefined;
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}
function mediaUrl(value: unknown): string | undefined {
  const text = knownText(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && !url.username && !url.password
      ? text
      : undefined;
  } catch {
    return undefined;
  }
}
/** Public builders deliberately whitelist display fields, never spread source metadata. */
export function buildPresentationEmbed(
  family: DiscordFamily,
  input: PresentationInput = {},
): PresentationEmbed {
  const description = knownText(input.description);
  const timestamp = sourceTimestamp(input.timestamp);
  const thumbnailUrl = mediaUrl(input.thumbnailUrl);
  const fields = (input.fields ?? [])
    .flatMap((field) => {
      const name = knownText(field.name);
      const value =
        typeof field.value === 'string' && field.value.trim()
          ? field.value
          : undefined;
      // Defense in depth for technical scoring fields passed by an older caller.
      if (
        !name ||
        !value ||
        /confidence/iu.test(name) ||
        /^(?:—|-|n\/a|unknown|tbd)$/iu.test(value)
      )
        return [];
      return [
        {
          name: name.slice(0, 256),
          value: value.slice(0, 1024),
          inline: field.inline ?? false,
        },
      ];
    })
    .slice(0, 25);
  const embed: PresentationEmbed = {
    title: (knownText(input.title) ?? DISCORD_FAMILIES[family]).slice(0, 256),
    color:
      family in SETTLED_COLORS
        ? SETTLED_COLORS[family as SettledPresentationState]
        : DISCORD_PRESENTATION.gold,
    fields,
    footer: { text: DISCORD_PRESENTATION.footer },
    ...(description ? { description: description.slice(0, 4096) } : {}),
    ...(timestamp ? { timestamp } : {}),
    ...(thumbnailUrl ? { thumbnail: { url: thumbnailUrl } } : {}),
  };
  // A single message still has a combined 6000-character limit.
  if (embedCharacterCount(embed) > 6000)
    throw new RangeError('Use buildPresentationPages for long content');
  return embed;
}
export interface PickPresentationInput {
  selection?: string | null | undefined;
  market?: string | null | undefined;
  line?: number | null | undefined;
  odds?: number | null | undefined;
  stakeUnits?: number | null | undefined;
  capper?: string | null | undefined;
  sport?: string | null | undefined;
  eventName?: string | null | undefined;
  eventTime?: string | null | undefined;
  notes?: string | null | undefined;
  timestamp?: string | null | undefined;
  thumbnailUrl?: string | null | undefined;
}
export function buildPickPresentation(
  family: 'official-pick' | 'pick-posted',
  input: PickPresentationInput,
): PresentationEmbed {
  const selection = knownText(input.selection);
  const line = finiteMetric(input.line)
    ? ` @ ${input.line > 0 ? '+' : ''}${input.line}`
    : '';
  const eventTime = sourceTimestamp(input.eventTime);
  return buildPresentationEmbed(family, {
    title: selection
      ? `${DISCORD_FAMILIES[family]} · ${selection}${line}`
      : DISCORD_FAMILIES[family],
    description: [knownText(input.sport), knownText(input.eventName)]
      .filter(Boolean)
      .join(' | '),
    fields: [
      { name: 'Market', value: knownText(input.market), inline: true },
      {
        name: 'Odds',
        value:
          finiteMetric(input.odds) && input.odds !== 0
            ? `${input.odds > 0 ? '+' : ''}${input.odds}`
            : undefined,
        inline: true,
      },
      {
        name: 'Units',
        value: finiteMetric(input.stakeUnits)
          ? `${input.stakeUnits}u`
          : undefined,
        inline: true,
      },
      { name: 'Capper', value: knownText(input.capper), inline: true },
      {
        name: 'Game Time',
        value: eventTime
          ? `<t:${Math.floor(Date.parse(eventTime) / 1000)}:f>`
          : undefined,
        inline: true,
      },
      { name: 'Thesis', value: knownText(input.notes), inline: false },
    ],
    timestamp: input.timestamp,
    thumbnailUrl: input.thumbnailUrl,
  });
}
export interface ResultPresentationInput extends PickPresentationInput {
  result: SettledPresentationState;
  profitLossUnits?: number | null | undefined;
  /** Only a canonical settlement/API measured value, never arbitrary pick metadata. */
  clvPercent?: number | null | undefined;
  correctedResult?: 'win' | 'loss' | 'push' | 'void' | null | undefined;
  previousResult?: string | null | undefined;
}
export function buildResultPresentation(
  input: ResultPresentationInput,
): PresentationEmbed {
  return buildPresentationEmbed(input.result, {
    title: `${DISCORD_FAMILIES[input.result]}${knownText(input.selection) ? ` · ${input.selection}` : ''}`,
    description: [knownText(input.sport), knownText(input.eventName)]
      .filter(Boolean)
      .join(' | '),
    fields: [
      { name: 'Market', value: knownText(input.market) },
      { name: 'Selection', value: knownText(input.selection) },
      { name: 'Result', value: DISCORD_FAMILIES[input.result], inline: true },
      { name: 'P/L', value: unitsLabel(input.profitLossUnits), inline: true },
      {
        name: 'Odds',
        value:
          finiteMetric(input.odds) && input.odds !== 0
            ? `${input.odds > 0 ? '+' : ''}${input.odds}`
            : undefined,
        inline: true,
      },
      {
        name: 'CLV% (vs SGO close)',
        value: signedPercent(input.clvPercent),
        inline: true,
      },
      { name: 'Capper', value: knownText(input.capper), inline: true },
      {
        name: 'Stake',
        value: finiteMetric(input.stakeUnits)
          ? `${input.stakeUnits.toFixed(1)}u`
          : undefined,
        inline: true,
      },
      {
        name: 'Previous result',
        value:
          input.result === 'correction'
            ? knownText(input.previousResult)
            : undefined,
      },
      {
        name: 'Corrected result',
        value:
          input.result === 'correction' && input.correctedResult
            ? DISCORD_FAMILIES[input.correctedResult]
            : undefined,
      },
    ],
    timestamp: input.timestamp,
    thumbnailUrl: input.thumbnailUrl,
  });
}
export function embedCharacterCount(embed: PresentationEmbed): number {
  return (
    embed.title.length +
    (embed.description?.length ?? 0) +
    embed.footer.text.length +
    embed.fields.reduce(
      (sum, field) => sum + field.name.length + field.value.length,
      0,
    )
  );
}
/** One embed per message page, <=6 fields. Splits ALL content; never takes a top-N subset. */
export function buildPresentationPages(
  family: DiscordFamily,
  input: PresentationInput,
): PresentationEmbed[] {
  const chunks = (input.fields ?? []).flatMap((field) => {
    const value = knownText(field.value);
    if (!value || /confidence/iu.test(field.name)) return [];
    const parts: string[] = [];
    let current = '';
    // Code-point iteration avoids splitting surrogate pairs at the field boundary.
    for (const char of value) {
      if (current.length + char.length > 1024) {
        const newline = current.lastIndexOf('\n');
        const boundary = newline >= 0 ? newline + 1 : current.length;
        parts.push(current.slice(0, boundary));
        current = current.slice(boundary);
      }
      current += char;
    }
    if (current) parts.push(current);
    return parts.map((part, index) => ({
      name: index ? `${field.name} (continued)` : field.name,
      value: part,
      inline: field.inline ?? false,
    }));
  });
  const pages: PresentationEmbed[] = [];
  let fields: typeof chunks = [];
  const flush = () => {
    pages.push(
      buildPresentationEmbed(family, {
        ...input,
        description: pages.length ? undefined : input.description,
        fields,
      }),
    );
    fields = [];
  };
  for (const field of chunks) {
    const overhead =
      256 +
      64 +
      (pages.length ? 0 : Math.min(input.description?.length ?? 0, 4096));
    const fieldSize = (items: typeof chunks) =>
      items.reduce(
        (sum, item) =>
          sum + Math.min(item.name.length, 256) + item.value.length,
        0,
      );
    if (
      fields.length &&
      (fields.length >= 6 || overhead + fieldSize([...fields, field]) > 5800)
    )
      flush();
    fields.push(field);
  }
  if (fields.length || !pages.length) flush();
  if (pages.length > 1)
    for (const [index, page] of pages.entries()) {
      const suffix = ` · ${index + 1}/${pages.length}`;
      page.title = page.title.slice(0, 256 - suffix.length) + suffix;
    }
  return pages;
}
/** Denial/error specs carry privacy with their data; transport must honor it. */
export function buildPrivatePresentation(
  family: 'access-denied' | 'bot-error',
  description: string,
) {
  return {
    ephemeral: true as const,
    embeds: [buildPresentationEmbed(family, { description })],
  };
}
export function buildUpgradePresentation(
  tier: 'free' | 'trial' | 'vip' | 'vip-plus' | 'black-label',
): PresentationEmbed {
  const description =
    tier === 'black-label'
      ? 'Black Label is unavailable for purchase or activation.'
      : tier === 'vip-plus'
        ? "You're already on our highest active tier."
        : tier === 'vip'
          ? 'VIP+ includes VIP. Its market-intelligence features are not live yet. Contact support for approved availability and terms.'
          : 'VIP provides active official capper picks and VIP community access. Settled results and recaps are available to all members.';
  return buildPresentationEmbed('upgrade', {
    description,
    fields: [
      {
        name: 'Next step',
        value: 'Contact an operator in #support for approved membership terms.',
      },
    ],
  });
}
export function buildTrialPresentation(
  family: 'trial-started' | 'trial-expiring',
  input: { expiresAt?: string | null; timestamp?: string | null } = {},
) {
  const expiresAt = sourceTimestamp(input.expiresAt);
  return buildPresentationEmbed(family, {
    description:
      family === 'trial-started'
        ? 'Your trial provides VIP access while active.'
        : 'Keep VIP access through the approved membership path. Your settled history remains available.',
    fields: [
      {
        name: 'Expires',
        value: expiresAt
          ? `<t:${Math.floor(Date.parse(expiresAt) / 1000)}:F>`
          : undefined,
      },
    ],
    timestamp: input.timestamp,
  });
}
export function buildCapperPresentation(
  family: 'capper-record' | 'capper-profile',
  input: {
    capper: string;
    record?: string | null;
    sample?: string | null;
    roiPercent?: number | null;
    clvPercent?: number | null;
    clvSample?: string | null;
  },
) {
  return buildPresentationEmbed(family, {
    title: `${DISCORD_FAMILIES[family]} · ${input.capper}`,
    fields: [
      { name: 'Record', value: knownText(input.record), inline: true },
      { name: 'Sample', value: knownText(input.sample) },
      { name: 'ROI', value: signedPercent(input.roiPercent), inline: true },
      {
        name: 'Avg CLV',
        value:
          knownText(input.clvSample) && signedPercent(input.clvPercent)
            ? `${signedPercent(input.clvPercent)} · ${input.clvSample}`
            : undefined,
      },
    ],
  });
}
export function buildWelcomePresentation(
  input: { memberName?: string | null; nextStep?: string | null } = {},
) {
  return buildPresentationEmbed('welcome', {
    description: input.memberName
      ? `Welcome, ${input.memberName}.`
      : 'Welcome to Unit Talk.',
    fields: [{ name: 'Start here', value: knownText(input.nextStep) }],
  });
}
export function buildCapperOnboardingPresentation(displayName: string) {
  return buildPresentationEmbed('capper-onboarding', {
    title: knownText(displayName)
      ? `Capper Onboarding · ${displayName}`
      : 'Capper Onboarding',
    description:
      "You've been added as a Unit Talk Capper. Here's how to get started.",
    fields: [
      {
        name: 'Submit a pick',
        value:
          'Use /pick to submit picks through the canonical submission path.',
      },
      {
        name: 'Your stats',
        value: 'Use /stats to view your settled pick performance.',
      },
      {
        name: 'Your recap',
        value: 'Use /recap to review your last settled picks.',
      },
      { name: 'Questions', value: 'Reach out to an operator in this channel.' },
    ],
  });
}
export function buildServicePresentation(
  family: 'service-alert' | 'system-maintenance',
  input: {
    message: string;
    impact?: string | null;
    nextStep?: string | null;
    timestamp?: string | null;
  },
) {
  return buildPresentationEmbed(family, {
    description: input.message,
    timestamp: input.timestamp,
    fields: [
      { name: 'Impact', value: knownText(input.impact) },
      { name: 'Next step', value: knownText(input.nextStep) },
    ],
  });
}
