/**
 * Smart Form V1 — Form-to-SubmissionPayload mapping.
 *
 * Pure functions: construct market, selection, and full payload
 * from the rich smart form fields. No side effects, no I/O.
 */

import type { MarketType, ParsedSmartFormBody } from './validation.js';

export interface SubmissionPayload {
  source: 'smart-form';
  submittedBy?: string;
  market: string;
  selection: string;
  line?: number;
  odds?: number;
  stakeUnits?: number;
  confidence?: number;
  eventName?: string;
  metadata: Record<string, unknown>;
}

/**
 * Constructs the `market` string from sport + market type + optional stat type.
 *
 * Examples:
 *   player-prop + NBA + Points → "NBA Points"
 *   moneyline + NFL            → "NFL Moneyline"
 *   spread + NBA               → "NBA Spread"
 *   total + NHL                → "NHL Total"
 *   team-total + NBA           → "NBA Team Total"
 */
export function constructMarket(
  sport: string,
  marketType: MarketType,
  statType?: string,
): string {
  switch (marketType) {
    case 'player-prop':
      return `${sport} ${statType ?? 'Prop'}`;
    case 'moneyline':
      return `${sport} Moneyline`;
    case 'spread':
      return `${sport} Spread`;
    case 'total':
      return `${sport} Total`;
    case 'team-total':
      return `${sport} Team Total`;
  }
}

/**
 * Constructs the `selection` string from market-type-specific fields.
 *
 * Examples:
 *   player-prop: "Jalen Brunson Over 24.5"
 *   moneyline:   "Knicks"
 *   spread:      "Knicks -3.5"
 *   total:       "Over 215.5"
 *   team-total:  "Knicks Over 108.5"
 */
export function constructSelection(
  marketType: MarketType,
  form: ParsedSmartFormBody,
): string {
  switch (marketType) {
    case 'player-prop':
      return `${form.player ?? ''} ${form.overUnder ?? ''} ${form.line ?? ''}`.trim();
    case 'moneyline':
      return form.team ?? '';
    case 'spread':
      return `${form.team ?? ''} ${formatSpreadLine(form.line)}`.trim();
    case 'total':
      return `${form.overUnder ?? ''} ${form.line ?? ''}`.trim();
    case 'team-total':
      return `${form.team ?? ''} ${form.overUnder ?? ''} ${form.line ?? ''}`.trim();
  }
}

function formatSpreadLine(line: string | undefined): string {
  if (!line) return '';
  const num = Number(line);
  if (!Number.isFinite(num)) return line;
  return num > 0 ? `+${num}` : String(num);
}

/**
 * Converts decimal odds to American odds.
 *
 * decimal >= 2.0 → American = (decimal - 1) * 100
 * decimal < 2.0  → American = -100 / (decimal - 1)
 */
export function decimalToAmerican(decimal: number): number {
  if (decimal >= 2.0) {
    return Math.round((decimal - 1) * 100);
  }
  return Math.round(-100 / (decimal - 1));
}

/**
 * Normalizes odds to American format.
 * If format is 'decimal', converts to American. Otherwise passes through.
 */
export function normalizeOdds(odds: string | undefined, format: string | undefined): number | undefined {
  if (!odds || odds.trim().length === 0) return undefined;
  const num = Number(odds);
  if (!Number.isFinite(num)) return undefined;

  if (format === 'decimal') {
    return decimalToAmerican(num);
  }
  return num;
}

/**
 * Maps the full smart form body to a SubmissionPayload for the API.
 */
export function mapSmartFormToSubmissionPayload(
  form: ParsedSmartFormBody,
  marketType: MarketType,
): SubmissionPayload {
  const market = constructMarket(form.sport ?? '', marketType, form.statType);
  const selection = constructSelection(marketType, form);
  const odds = normalizeOdds(form.odds, form.oddsFormat);
  const line = form.line ? Number(form.line) : undefined;
  const stakeUnits = form.units ? Number(form.units) : undefined;
  const confidence = form.confidence ? Number(form.confidence) : undefined;

  const metadata: Record<string, unknown> = {
    capper: form.capper,
    sport: form.sport,
    date: form.date,
    marketType,
    eventName: form.matchup,
  };

  if (form.sportsbook) metadata['sportsbook'] = form.sportsbook;
  if (form.player) metadata['player'] = form.player;
  if (form.statType) metadata['statType'] = form.statType;
  if (form.overUnder) metadata['overUnder'] = form.overUnder;
  if (form.team) metadata['team'] = form.team;

  const result: SubmissionPayload = {
    source: 'smart-form',
    market,
    selection,
    metadata,
  };

  if (form.capper) result.submittedBy = form.capper;
  if (typeof line === 'number' && Number.isFinite(line)) result.line = line;
  if (typeof odds === 'number' && Number.isFinite(odds)) result.odds = odds;
  if (typeof stakeUnits === 'number' && Number.isFinite(stakeUnits)) result.stakeUnits = stakeUnits;
  if (typeof confidence === 'number' && Number.isFinite(confidence)) result.confidence = confidence;
  if (form.matchup) result.eventName = form.matchup;

  return result;
}
