export type OddsFormat = 'AMERICAN' | 'DECIMAL' | 'FRACTIONAL';
export interface TicketLeg {
  id: string;
  odds?: string;
  [key: string]: unknown;
}

export function convertOdds(odds: string | number, from: OddsFormat, to: OddsFormat): string {
  const americanOdds = typeof odds === 'string' ? parseInt(odds) : odds;

  switch (to) {
    case 'DECIMAL':
      if (americanOdds > 0) {
        return (americanOdds / 100 + 1).toFixed(2);
      } else {
        return (1 - 100 / americanOdds).toFixed(2);
      }
    case 'FRACTIONAL':
      if (americanOdds > 0) {
        return `${americanOdds}/100`;
      } else {
        return `100/${Math.abs(americanOdds)}`;
      }
    default:
      return americanOdds.toString();
  }
}

export function calculatePotentialPayout(
  riskAmount: number,
  legs: TicketLeg[],
  ticketType: string
): number {
  if (legs.length === 0) return 0;

  switch (ticketType.toLowerCase()) {
    case 'single':
      return calculateSinglePayout(riskAmount, legs[0].odds || '');
    case 'parlay':
      return calculateParlayPayout(riskAmount, legs);
    case 'teaser':
      return calculateTeaserPayout(riskAmount, legs);
    case 'round_robin':
      return calculateRoundRobinPayout(riskAmount, legs);
    default:
      return 0;
  }
}

function calculateSinglePayout(risk: number, odds: string): number {
  const americanOdds = parseInt(odds);
  if (americanOdds > 0) {
    return risk * (americanOdds / 100);
  } else {
    return risk * (100 / Math.abs(americanOdds));
  }
}

function calculateParlayPayout(risk: number, legs: TicketLeg[]): number {
  const decimalOdds = legs.map(leg => {
    const americanOdds = parseInt(leg.odds || '0');
    return americanOdds > 0 ? americanOdds / 100 + 1 : 1 - 100 / americanOdds;
  });

  const totalDecimalOdds = decimalOdds.reduce((acc, curr) => acc * curr, 1);
  return risk * (totalDecimalOdds - 1);
}

function calculateTeaserPayout(risk: number, legs: TicketLeg[]): number {
  // Standard 6-point teaser odds
  const teaserOdds = {
    2: -120,
    3: +180,
    4: +300,
    5: +500,
    6: +800,
  };

  const numLegs = legs.length;
  const odds = teaserOdds[numLegs as keyof typeof teaserOdds];
  // SMARTFORM-ODDS-FIELD-INTEGRITY-007: No silent -110 fallback for unsupported leg counts
  // Valid teaser leg counts are 2-6; return 0 for invalid configurations
  if (odds === undefined) {
    return 0;
  }
  return calculateSinglePayout(risk, odds.toString());
}

function calculateRoundRobinPayout(risk: number, legs: TicketLeg[]): number {
  if (legs.length < 3) return 0;

  // Calculate 2-team parlays from all possible combinations
  const combinations = getCombinations(legs, 2);
  const riskPerCombo = risk / combinations.length;

  return combinations.reduce((total, combo) => {
    return total + calculateParlayPayout(riskPerCombo, combo);
  }, 0);
}

function getCombinations<T>(arr: T[], r: number): T[][] {
  const result: T[][] = [];

  function combine(start: number, combo: T[]) {
    if (combo.length === r) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      combine(i + 1, combo);
      combo.pop();
    }
  }

  combine(0, []);
  return result;
}

export function validateBetLimits(
  riskAmount: number,
  potentialPayout: number,
  minBet?: number,
  maxBet?: number,
  maxPayout?: number
): { valid: boolean; message?: string } {
  if (minBet && riskAmount < minBet) {
    return {
      valid: false,
      message: `Minimum bet amount is $${minBet}`,
    };
  }

  if (maxBet && riskAmount > maxBet) {
    return {
      valid: false,
      message: `Maximum bet amount is $${maxBet}`,
    };
  }

  if (maxPayout && potentialPayout > maxPayout) {
    return {
      valid: false,
      message: `Maximum payout amount is $${maxPayout}`,
    };
  }

  return { valid: true };
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function getTimezoneOffset(): string {
  const offset = new Date().getTimezoneOffset();
  const hours = Math.abs(Math.floor(offset / 60));
  const minutes = Math.abs(offset % 60);
  const sign = offset < 0 ? '+' : '-';
  return `UTC${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

export function formatTimeInEST(date: Date | string | null): string {
  if (!date) return 'TBD';

  const gameTime = typeof date === 'string' ? new Date(date) : date;

  if (!gameTime || isNaN(gameTime.getTime())) {
    return 'TBD';
  }

  return gameTime.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatTimeInESTWithDate(date: Date | string): string {
  const gameTime = typeof date === 'string' ? new Date(date) : date;

  if (isNaN(gameTime.getTime())) {
    return 'TBD';
  }

  return gameTime.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
