/**
 * Smart Form V1 — Market-aware validation engine.
 *
 * Pure function: takes parsed form body + market type, returns field errors.
 * No side effects, no I/O.
 */

export type MarketType = 'player-prop' | 'moneyline' | 'spread' | 'total' | 'team-total';

export type FieldSeverity = 'error' | 'warning';

export interface FieldError {
  field: string;
  message: string;
  severity: FieldSeverity;
}

export interface ParsedSmartFormBody {
  capper?: string;
  date?: string;
  sport?: string;
  sportsbook?: string;
  units?: string;
  oddsFormat?: string;
  odds?: string;
  confidence?: string;
  marketType?: string;
  // Player prop fields
  player?: string;
  matchup?: string;
  statType?: string;
  overUnder?: string;
  line?: string;
  // Game-line fields
  team?: string;
}

const VALID_MARKET_TYPES: ReadonlySet<string> = new Set([
  'player-prop',
  'moneyline',
  'spread',
  'total',
  'team-total',
]);

export function isValidMarketType(value: string | undefined): value is MarketType {
  return typeof value === 'string' && VALID_MARKET_TYPES.has(value);
}

export function validateSmartFormSubmission(
  form: ParsedSmartFormBody,
  marketType: MarketType | undefined,
): FieldError[] {
  const errors: FieldError[] = [];

  // --- Universal required fields ---

  if (!nonEmpty(form.capper)) {
    errors.push({ field: 'capper', message: 'Capper is required.', severity: 'error' });
  }

  if (!nonEmpty(form.date)) {
    errors.push({ field: 'date', message: 'Date is required.', severity: 'error' });
  } else if (!isValidDate(form.date)) {
    errors.push({ field: 'date', message: 'Date must be a valid date (YYYY-MM-DD).', severity: 'error' });
  }

  if (!nonEmpty(form.sport)) {
    errors.push({ field: 'sport', message: 'Sport is required.', severity: 'error' });
  }

  if (!marketType) {
    errors.push({ field: 'marketType', message: 'Market type is required.', severity: 'error' });
  }

  // Odds: required, must be non-zero finite number
  if (!nonEmpty(form.odds)) {
    errors.push({ field: 'odds', message: 'Odds are required.', severity: 'error' });
  } else {
    const oddsNum = Number(form.odds);
    if (!Number.isFinite(oddsNum) || oddsNum === 0) {
      errors.push({ field: 'odds', message: 'Odds must be a non-zero finite number.', severity: 'error' });
    }
  }

  // Units: required, 0.5 <= x <= 5.0
  if (!nonEmpty(form.units)) {
    errors.push({ field: 'units', message: 'Units are required.', severity: 'error' });
  } else {
    const unitsNum = Number(form.units);
    if (!Number.isFinite(unitsNum)) {
      errors.push({ field: 'units', message: 'Units must be a valid number.', severity: 'error' });
    } else if (unitsNum < 0.5 || unitsNum > 5.0) {
      errors.push({ field: 'units', message: 'Units must be between 0.5 and 5.0.', severity: 'error' });
    }
  }

  // Confidence: optional, but if provided must be 0 < x < 1
  if (nonEmpty(form.confidence)) {
    const confNum = Number(form.confidence);
    if (!Number.isFinite(confNum)) {
      errors.push({ field: 'confidence', message: 'Confidence must be a valid number.', severity: 'error' });
    } else if (confNum <= 0 || confNum >= 1) {
      errors.push({ field: 'confidence', message: 'Confidence must be between 0 and 1 (exclusive).', severity: 'error' });
    }
  }

  // --- Warn-only fields ---

  if (!nonEmpty(form.sportsbook)) {
    errors.push({ field: 'sportsbook', message: 'Sportsbook not provided.', severity: 'warning' });
  }

  // --- Market-type conditional required fields ---

  if (marketType) {
    validateMarketTypeFields(form, marketType, errors);
  }

  return errors;
}

function validateMarketTypeFields(
  form: ParsedSmartFormBody,
  marketType: MarketType,
  errors: FieldError[],
): void {
  switch (marketType) {
    case 'player-prop':
      requireField(form.player, 'player', 'Player is required for player prop markets.', errors);
      requireField(form.matchup, 'matchup', 'Matchup is required.', errors);
      requireField(form.statType, 'statType', 'Stat type is required for player prop markets.', errors);
      requireOverUnder(form.overUnder, errors);
      requireLine(form.line, errors);
      break;

    case 'moneyline':
      requireField(form.matchup, 'matchup', 'Matchup is required.', errors);
      requireField(form.team, 'team', 'Team / Side is required for moneyline markets.', errors);
      break;

    case 'spread':
      requireField(form.matchup, 'matchup', 'Matchup is required.', errors);
      requireField(form.team, 'team', 'Team / Side is required for spread markets.', errors);
      requireLine(form.line, errors);
      break;

    case 'total':
      requireField(form.matchup, 'matchup', 'Matchup is required.', errors);
      requireOverUnder(form.overUnder, errors);
      requireLine(form.line, errors);
      break;

    case 'team-total':
      requireField(form.matchup, 'matchup', 'Matchup is required.', errors);
      requireField(form.team, 'team', 'Team is required for team total markets.', errors);
      requireOverUnder(form.overUnder, errors);
      requireLine(form.line, errors);
      break;
  }
}

function requireField(
  value: string | undefined,
  field: string,
  message: string,
  errors: FieldError[],
): void {
  if (!nonEmpty(value)) {
    errors.push({ field, message, severity: 'error' });
  }
}

function requireOverUnder(value: string | undefined, errors: FieldError[]): void {
  if (!nonEmpty(value)) {
    errors.push({ field: 'overUnder', message: 'Over/Under selection is required.', severity: 'error' });
  } else if (value !== 'Over' && value !== 'Under') {
    errors.push({ field: 'overUnder', message: 'Over/Under must be "Over" or "Under".', severity: 'error' });
  }
}

function requireLine(value: string | undefined, errors: FieldError[]): void {
  if (!nonEmpty(value)) {
    errors.push({ field: 'line', message: 'Line is required.', severity: 'error' });
  } else {
    const lineNum = Number(value);
    if (!Number.isFinite(lineNum)) {
      errors.push({ field: 'line', message: 'Line must be a finite number.', severity: 'error' });
    }
  }
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidDate(value: string): boolean {
  // Accept YYYY-MM-DD format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parts = value.split('-').map(Number);
  const y = parts[0]!;
  const m = parts[1]!;
  const d = parts[2]!;
  const date = new Date(y, m - 1, d);
  // Verify the date components round-trip (catches Feb 30, etc.)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/**
 * Returns only blocking errors (severity === 'error').
 */
export function getBlockingErrors(errors: FieldError[]): FieldError[] {
  return errors.filter((e) => e.severity === 'error');
}

/**
 * Returns only warnings (severity === 'warning').
 */
export function getWarnings(errors: FieldError[]): FieldError[] {
  return errors.filter((e) => e.severity === 'warning');
}
