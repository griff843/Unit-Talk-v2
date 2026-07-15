/**
 * Alert Builder types + validation. Pure module — no I/O.
 *
 * Saved definitions are deliberately browser-local. There is no database or
 * API persistence contract, and these definitions cannot dispatch alerts.
 */

export interface AlertDefinition {
  sport: string;
  league: string;
  market: string;
  book: string;
  /** American odds threshold — alert when a price crosses this */
  oddsThreshold: number | null;
  /** EV% threshold (internal consensus de-vig, uncertified) */
  evThreshold: number | null;
  /** Absolute line-move threshold in market units */
  lineMoveThreshold: number | null;
  playerOrTeam: string;
  /** Only consider events starting within this many hours (1..168) */
  startWindow: number | null;
  /** Locked: alerts are internal-only */
  destination: 'internal';
  /** Locked on */
  internalOnly: true;
  /** Locked on: no alert dispatches without operator approval */
  requiresApprovalBeforeDispatch: true;
}

export interface AlertValidationResult {
  valid: boolean;
  errors: string[];
}

export interface SavedAlertDefinition {
  id: string;
  savedAt: string;
  definition: AlertDefinition;
}

export function createEmptyAlertDefinition(): AlertDefinition {
  return {
    sport: '',
    league: '',
    market: '',
    book: '',
    oddsThreshold: null,
    evThreshold: null,
    lineMoveThreshold: null,
    playerOrTeam: '',
    startWindow: null,
    destination: 'internal',
    internalOnly: true,
    requiresApprovalBeforeDispatch: true,
  };
}

export function validateAlertDefinition(def: AlertDefinition): AlertValidationResult {
  const errors: string[] = [];

  if (!def.sport.trim()) errors.push('sport is required');
  if (!def.market.trim()) errors.push('market is required');

  const hasTrigger =
    def.oddsThreshold !== null || def.evThreshold !== null || def.lineMoveThreshold !== null;
  if (!hasTrigger) {
    errors.push('at least one trigger is required (odds, EV, or line-move threshold)');
  }

  if (def.oddsThreshold !== null) {
    if (!Number.isFinite(def.oddsThreshold) || def.oddsThreshold === 0) {
      errors.push('oddsThreshold must be a non-zero American odds value');
    } else if (Math.abs(def.oddsThreshold) < 100) {
      errors.push('oddsThreshold must be <= -100 or >= +100 (American odds)');
    }
  }

  if (def.evThreshold !== null) {
    if (!Number.isFinite(def.evThreshold) || def.evThreshold < 0 || def.evThreshold > 100) {
      errors.push('evThreshold must be between 0 and 100 (percent)');
    }
  }

  if (def.lineMoveThreshold !== null) {
    if (!Number.isFinite(def.lineMoveThreshold) || def.lineMoveThreshold <= 0) {
      errors.push('lineMoveThreshold must be a positive number');
    }
  }

  if (def.startWindow !== null) {
    if (
      !Number.isFinite(def.startWindow) ||
      !Number.isInteger(def.startWindow) ||
      def.startWindow < 1 ||
      def.startWindow > 168
    ) {
      errors.push('startWindow must be an integer between 1 and 168 hours');
    }
  }

  // Locked governance flags — fail closed if tampered with
  if (def.destination !== 'internal') errors.push('destination must be "internal"');
  if (def.internalOnly !== true) errors.push('internalOnly must be true');
  if (def.requiresApprovalBeforeDispatch !== true) {
    errors.push('requiresApprovalBeforeDispatch must be true');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Parses browser storage defensively. Invalid or governance-tampered entries
 * are discarded instead of becoming editable alert definitions.
 */
export function parseSavedAlertDefinitions(value: string | null): SavedAlertDefinition[] {
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((entry): SavedAlertDefinition[] => {
      if (!isSavedAlertDefinition(entry)) return [];
      return validateAlertDefinition(entry.definition).valid ? [entry] : [];
    });
  } catch {
    return [];
  }
}

function isSavedAlertDefinition(value: unknown): value is SavedAlertDefinition {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.savedAt !== 'string') {
    return false;
  }

  return isAlertDefinition(value.definition);
}

function isAlertDefinition(value: unknown): value is AlertDefinition {
  if (!isRecord(value)) return false;

  return (
    typeof value.sport === 'string' &&
    typeof value.league === 'string' &&
    typeof value.market === 'string' &&
    typeof value.book === 'string' &&
    isNullableNumber(value.oddsThreshold) &&
    isNullableNumber(value.evThreshold) &&
    isNullableNumber(value.lineMoveThreshold) &&
    typeof value.playerOrTeam === 'string' &&
    isNullableNumber(value.startWindow) &&
    value.destination === 'internal' &&
    value.internalOnly === true &&
    value.requiresApprovalBeforeDispatch === true
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}
