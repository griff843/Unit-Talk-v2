export type SettlementScoreOutcome = 'win' | 'loss' | 'push';

export type SettlementScoreCheck =
  | { result: SettlementScoreOutcome }
  | { result: 'unsupported'; reason: string };

export function canSubmitSettlementScoreCheck(
  selected: 'win' | 'loss' | 'push' | 'void' | null,
  check: SettlementScoreCheck | null,
  overrideReason: string,
): boolean {
  if (selected === null || selected === 'void' || check === null || check.result === 'unsupported') return true;
  return check.result === selected || overrideReason.trim() !== '';
}

export interface SettlementScoreCheckInput {
  eventName?: string | null;
  market: string;
  selection: string;
  line: number | null;
  side?: 'away' | 'home' | string | null;
  awayScore: number;
  homeScore: number;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
}

function marketKind(market: string): 'moneyline' | 'spread' | 'game-total' | 'team-total' | null {
  const value = normalize(market).replace(/[_-]+/g, ' ');
  if (/^(moneyline|money line|ml)$/.test(value)) return 'moneyline';
  if (/^(spread|point spread|puck line|run line)$/.test(value)) return 'spread';
  if (/^(total|game total|game totals|game total points|over under|over\/under)$/.test(value)) return 'game-total';
  if (/^(team total|team totals|team total points)$/.test(value)) return 'team-total';
  return null;
}

export function supportsSettlementScoreMarket(market: string | null | undefined): boolean {
  return marketKind(market ?? '') !== null;
}

function outcome(value: number, line: number, side: 'over' | 'under'): SettlementScoreOutcome {
  if (value === line) return 'push';
  return side === 'over' ? (value > line ? 'win' : 'loss') : value < line ? 'win' : 'loss';
}

function splitTeams(eventName: string): [string, string] | null {
  const match = eventName.trim().match(/^(.+?)\s+(?:@|at|vs\.?|v\.)\s+(.+)$/i);
  return match ? [match[1].trim(), match[2].trim()] : null;
}

function resolveSide(input: SettlementScoreCheckInput): 'away' | 'home' | null {
  const explicit = normalize(input.side);
  if (explicit === 'away' || explicit === 'home') return explicit;

  const teams = input.eventName ? splitTeams(input.eventName) : null;
  if (!teams) return null;
  const selection = normalize(input.selection);
  const matchesAway = selection.includes(normalize(teams[0]));
  const matchesHome = selection.includes(normalize(teams[1]));
  if (matchesAway === matchesHome) return null;
  return matchesAway ? 'away' : 'home';
}

function selectionSide(selection: string): 'over' | 'under' | null {
  const value = normalize(selection);
  const over = /\bover\b|\b o\b/.test(value);
  const under = /\bunder\b|\b u\b/.test(value);
  return over === under ? null : over ? 'over' : 'under';
}

export function checkSettlementScore(input: SettlementScoreCheckInput): SettlementScoreCheck {
  if (!Number.isFinite(input.awayScore) || !Number.isFinite(input.homeScore) || input.awayScore < 0 || input.homeScore < 0) {
    return { result: 'unsupported', reason: 'Scores must be non-negative numbers.' };
  }

  const kind = marketKind(input.market);
  if (!kind) return { result: 'unsupported', reason: `Unsupported market: ${input.market || 'missing market'}.` };

  if (kind === 'moneyline' || kind === 'spread' || kind === 'team-total') {
    const side = resolveSide(input);
    if (!side) return { result: 'unsupported', reason: 'Could not resolve the pick to the away or home team.' };
    const line = input.line;
    if (kind !== 'moneyline' && (line === null || !Number.isFinite(line))) {
      return { result: 'unsupported', reason: 'This market requires a numeric line.' };
    }

    const score = side === 'away' ? input.awayScore : input.homeScore;
    if (kind === 'moneyline') {
      const opponent = side === 'away' ? input.homeScore : input.awayScore;
      return { result: score === opponent ? 'push' : score > opponent ? 'win' : 'loss' };
    }
    if (kind === 'team-total') {
      const totalSide = selectionSide(input.selection);
      if (!totalSide) return { result: 'unsupported', reason: 'Could not resolve team-total over/under.' };
      return { result: outcome(score, line as number, totalSide) };
    }
    return { result: outcome(score - (side === 'away' ? input.homeScore : input.awayScore), -(line as number), 'over') };
  }

  if (input.line === null || !Number.isFinite(input.line)) {
    return { result: 'unsupported', reason: 'This market requires a numeric line.' };
  }
  const totalSide = selectionSide(input.selection);
  if (!totalSide) return { result: 'unsupported', reason: 'Could not resolve game-total over/under.' };
  return { result: outcome(input.awayScore + input.homeScore, input.line, totalSide) };
}

export const resolveSettlementScore = checkSettlementScore;
