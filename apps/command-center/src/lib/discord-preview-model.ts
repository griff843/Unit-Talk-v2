// Pure formatting helpers for the Discord-embed-style pick preview.
// Consumed by src/components/DiscordEmbedPreview.tsx and the pick-builder
// live preview. No I/O.

export interface DiscordPreviewFields {
  title: string;
  market: string | null;
  selection: string | null;
  line: number | null;
  odds: number | null;
  book: string | null;
  tierDestination: string | null;
  riskRating: string | null;
  reasoning: string | null;
  eventName: string | null;
  eventStartTime: string | null;
  sport: string | null;
  /** Field labels that are absent from the underlying record (Data Missing). */
  missing: string[];
  /** Hex-ish CSS color for the embed's left border, keyed off tier. */
  accentColor: string;
  footer: string;
}

export const RESPONSIBLE_FOOTER = '21+. Bet responsibly.';

const TIER_COLORS: Record<string, string> = {
  free: '#94a3b8',
  silver: '#cbd5e1',
  gold: '#eab308',
  platinum: '#38bdf8',
};

export function tierAccentColor(tier: string | null | undefined): string {
  if (!tier) return '#64748b';
  return TIER_COLORS[tier.toLowerCase()] ?? '#64748b';
}

/** e.g. Over 8.5 (-110) — omits pieces that are absent. */
export function formatSelectionLine(
  selection: string | null,
  line: number | null,
  odds: number | null,
): string {
  const parts: string[] = [];
  if (selection) parts.push(selection);
  if (line !== null) parts.push(String(line));
  const base = parts.join(' ');
  if (odds !== null) return `${base}${base ? ' ' : ''}(${formatAmericanOdds(odds)})`;
  return base;
}

export function formatAmericanOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : String(odds);
}

export interface DiscordPreviewSource {
  market?: string | null;
  selection?: string | null;
  line?: number | null;
  odds?: number | null;
  eventName?: string | null;
  eventStartTime?: string | null;
  sport?: string | null;
  metadata?: Record<string, unknown> | null;
}

function metaString(meta: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = meta?.[key];
  return typeof v === 'string' && v.trim() ? v : null;
}

export function buildDiscordPreview(src: DiscordPreviewSource): DiscordPreviewFields {
  const meta = src.metadata ?? null;
  const tierDestination = metaString(meta, 'tierDestination') ?? metaString(meta, 'tier');
  const book = metaString(meta, 'book');
  const riskRating = metaString(meta, 'riskRating') ?? metaString(meta, 'risk');
  const reasoning = metaString(meta, 'thesis') ?? metaString(meta, 'reasoning');

  const fields: DiscordPreviewFields = {
    title: src.eventName?.trim() || src.market?.trim() || 'Untitled pick',
    market: src.market ?? null,
    selection: src.selection ?? null,
    line: src.line ?? null,
    odds: src.odds ?? null,
    book,
    tierDestination,
    riskRating,
    reasoning,
    eventName: src.eventName ?? null,
    eventStartTime: src.eventStartTime ?? null,
    sport: src.sport ?? null,
    missing: [],
    accentColor: tierAccentColor(tierDestination),
    footer: RESPONSIBLE_FOOTER,
  };

  const checks: Array<[string, unknown]> = [
    ['Event', fields.eventName],
    ['Market', fields.market],
    ['Selection', fields.selection],
    ['Line', fields.line],
    ['Odds', fields.odds],
    ['Book', fields.book],
    ['Tier', fields.tierDestination],
    ['Risk', fields.riskRating],
    ['Reasoning', fields.reasoning],
  ];
  fields.missing = checks
    .filter(([, v]) => v === null || v === undefined || v === '')
    .map(([label]) => label);

  return fields;
}
