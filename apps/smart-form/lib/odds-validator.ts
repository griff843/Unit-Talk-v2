/**
 * SMARTFORM-ODDS-FIELD-INTEGRITY-007
 * Odds Validation Utility
 *
 * Canonical American odds validation and normalization.
 * Contract: docs/contracts/SMARTFORM-ODDS-FIELD-INTEGRITY-007.md
 */

export type OddsValidationErrorCode =
  | 'ODDS_NOT_INTEGER'
  | 'ODDS_OUT_OF_RANGE'
  | 'ODDS_INVALID_ZERO'
  | 'ODDS_DECIMAL_REQUIRES_CONVERSION'
  | 'ODDS_EMPTY'
  | 'ODDS_PARSE_FAILED';

export interface OddsValidationResult {
  valid: boolean;
  value?: number;
  errorCode?: OddsValidationErrorCode;
  errorMessage?: string;
}

/**
 * Validates and normalizes American odds input.
 *
 * Rules (from contract):
 * - Must be an integer (no decimals)
 * - Cannot be 0
 * - abs(odds) >= 100
 * - Accepts: "-110", "+150", "100", " +110 "
 * - Rejects: "1.91", "0", "50", "", "abc"
 */
export function validateAmericanOdds(
  input: string | number | null | undefined
): OddsValidationResult {
  // Handle empty/null/undefined
  if (input === null || input === undefined || input === '') {
    return {
      valid: false,
      errorCode: 'ODDS_EMPTY',
      errorMessage: 'Odds is required',
    };
  }

  // Convert to string for processing
  const rawString = String(input).trim();

  // Check for empty after trim
  if (rawString === '') {
    return {
      valid: false,
      errorCode: 'ODDS_EMPTY',
      errorMessage: 'Odds is required',
    };
  }

  // Check for decimal point (indicates decimal odds format)
  if (rawString.includes('.')) {
    // Determine if this looks like decimal odds (1.xx - 99.xx range)
    const numericValue = parseFloat(rawString);
    if (!isNaN(numericValue) && numericValue > 0 && numericValue < 100) {
      return {
        valid: false,
        errorCode: 'ODDS_DECIMAL_REQUIRES_CONVERSION',
        errorMessage: 'Decimal odds detected. Please enter American odds (e.g., -110 or +150)',
      };
    }
    // Otherwise, it's an integer with decimal (e.g., "-110.5")
    return {
      valid: false,
      errorCode: 'ODDS_NOT_INTEGER',
      errorMessage: 'Odds must be a whole number (no decimals)',
    };
  }

  // Normalize: remove leading '+' and whitespace
  const normalized = rawString.replace(/^\+/, '').trim();

  // Attempt to parse as integer
  const parsed = parseInt(normalized, 10);

  // Check parse success
  if (isNaN(parsed)) {
    return {
      valid: false,
      errorCode: 'ODDS_PARSE_FAILED',
      errorMessage: 'Unable to parse odds. Enter a valid number (e.g., -110 or +150)',
    };
  }

  // Check for zero
  if (parsed === 0) {
    return {
      valid: false,
      errorCode: 'ODDS_INVALID_ZERO',
      errorMessage: 'Odds cannot be 0',
    };
  }

  // Check absolute value range
  if (Math.abs(parsed) < 100) {
    return {
      valid: false,
      errorCode: 'ODDS_OUT_OF_RANGE',
      errorMessage: `Odds must be at least -100 or +100. Got: ${parsed}`,
    };
  }

  // Valid!
  return {
    valid: true,
    value: parsed,
  };
}

/**
 * Strict integer-only validation (for API layer).
 * Rejects any non-integer input.
 */
export function validateOddsInteger(input: number): OddsValidationResult {
  // Check if it's actually an integer
  if (!Number.isInteger(input)) {
    return {
      valid: false,
      errorCode: 'ODDS_NOT_INTEGER',
      errorMessage: 'Odds must be an integer',
    };
  }

  // Check for zero
  if (input === 0) {
    return {
      valid: false,
      errorCode: 'ODDS_INVALID_ZERO',
      errorMessage: 'Odds cannot be 0',
    };
  }

  // Check absolute value range
  if (Math.abs(input) < 100) {
    return {
      valid: false,
      errorCode: 'ODDS_OUT_OF_RANGE',
      errorMessage: `Odds must be at least -100 or +100. Got: ${input}`,
    };
  }

  return {
    valid: true,
    value: input,
  };
}

/**
 * Converts American odds to decimal odds.
 */
export function americanToDecimal(americanOdds: number): number {
  if (americanOdds > 0) {
    return americanOdds / 100 + 1;
  } else {
    return 1 - 100 / americanOdds;
  }
}

/**
 * Converts decimal odds to American odds.
 * Rounds to nearest integer (rounding happens once at end).
 */
export function decimalToAmerican(decimalOdds: number): number {
  if (decimalOdds >= 2.0) {
    return Math.round((decimalOdds - 1) * 100);
  } else {
    return Math.round(-100 / (decimalOdds - 1));
  }
}

/**
 * Calculates combined parlay odds from leg odds.
 *
 * Process (from contract):
 * 1. Convert each leg to decimal
 * 2. Multiply all decimals
 * 3. Convert final decimal to American (round once)
 */
export function calculateParlayOdds(
  legOdds: number[]
): OddsValidationResult & { combinedOdds?: number } {
  if (legOdds.length < 2) {
    return {
      valid: false,
      errorCode: 'ODDS_OUT_OF_RANGE',
      errorMessage: 'Parlay requires at least 2 legs',
    };
  }

  // Validate each leg
  for (let i = 0; i < legOdds.length; i++) {
    const validation = validateOddsInteger(legOdds[i]);
    if (!validation.valid) {
      return {
        ...validation,
        errorMessage: `Leg ${i + 1}: ${validation.errorMessage}`,
      };
    }
  }

  // Convert to decimal and multiply
  const decimalOdds = legOdds.map(americanToDecimal);
  const combinedDecimal = decimalOdds.reduce((acc, curr) => acc * curr, 1);

  // Convert back to American (single round at end)
  const combinedAmerican = decimalToAmerican(combinedDecimal);

  return {
    valid: true,
    value: combinedAmerican,
    combinedOdds: combinedAmerican,
  };
}

/**
 * Calculates implied probability from American odds.
 */
export function calculateImpliedProbability(americanOdds: number): number {
  if (americanOdds > 0) {
    return 100 / (americanOdds + 100);
  } else {
    return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
  }
}
