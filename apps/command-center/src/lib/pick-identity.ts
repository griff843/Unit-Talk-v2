type JsonObject = Record<string, unknown>;

export interface PickIdentityInput {
  source?: string | null;
  market?: string | null;
  selection?: string | null;
  line?: number | null;
  odds?: number | null;
  metadata?: JsonObject | null;
  submissionPayload?: JsonObject | null;
  matchup?: string | null;
  eventName?: string | null;
  eventStartTime?: string | null;
  sport?: string | null;
  sportDisplayName?: string | null;
  submitter?: string | null;
  submittedBy?: string | null;
  capperDisplayName?: string | null;
  capperName?: string | null;
  marketTypeDisplayName?: string | null;
  marketTypeLabel?: string | null;
  settlementResult?: string | null;
  reviewDecision?: string | null;
}

export interface PickIdentityModel {
  wagerLabel: string;
  matchup: string | null;
  eventStartTime: string | null;
  eventStartLabel: string | null;
  sport: string | null;
  capper: string | null;
  marketType: string | null;
  sportsbook: string | null;
  team: string | null;
  player: string | null;
  source: string | null;
  market: string | null;
  selection: string | null;
  oddsLabel: string | null;
}

function readObject(value: unknown): JsonObject | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject;
  }

  return null;
}

function readString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function formatLine(line: number | null | undefined): string | null {
  if (typeof line !== 'number' || !Number.isFinite(line)) {
    return null;
  }

  return Number.isInteger(line) ? String(line) : line.toFixed(1);
}

function formatOdds(odds: number | null | undefined): string | null {
  if (typeof odds !== 'number' || !Number.isFinite(odds)) {
    return null;
  }

  return odds > 0 ? `+${odds}` : String(odds);
}

function titleCaseToken(token: string) {
  if (token.length <= 3 && token === token.toLowerCase()) {
    return token.toUpperCase();
  }
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

export function humanizeMarketType(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }

  const aliases: Record<string, string> = {
    points_all_game_ou: 'Game Total Points',
    'points-all-game-ou': 'Game Total Points',
    player_batting_hrr_ou: 'Player Hits + Runs + RBI',
    'batting_hits+runs+rbi-all-game-ou': 'Player Hits + Runs + RBI',
    player_points_ou: 'Player Points',
    player_rebounds_ou: 'Player Rebounds',
    player_assists_ou: 'Player Assists',
    player_blocks_ou: 'Player Blocks',
    player_steals_ou: 'Player Steals',
    player_threes_ou: 'Player Threes',
    player_points_rebounds_ou: 'Player Points + Rebounds',
    player_points_assists_ou: 'Player Points + Assists',
    player_rebounds_assists_ou: 'Player Rebounds + Assists',
    player_points_rebounds_assists_ou: 'Player Points + Rebounds + Assists',
    player_turnovers_ou: 'Player Turnovers',
    moneyline: 'Moneyline',
    spread: 'Spread',
    total: 'Game Total',
  };

  const alias = aliases[normalized] ?? aliases[normalized.replace(/-/g, '_')];
  if (alias) {
    return alias;
  }

  return normalized
    .replace(/[+]/g, ' + ')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(titleCaseToken)
    .join(' ');
}

function extractPlayerFromSelection(selection: string | null): string | null {
  if (!selection) {
    return null;
  }

  const beforeOverUnder = selection.match(/^(.*?)\s+(?:over|under)\b/i);
  if (!beforeOverUnder) {
    return null;
  }

  const candidate = beforeOverUnder[1]?.trim() ?? '';
  if (candidate.length < 3) {
    return null;
  }

  if (/^(player|team|points|rebounds|assists|moneyline|spread|total)\b/i.test(candidate)) {
    return null;
  }

  return candidate;
}

function replaceGenericSelectionSubject(
  selection: string | null,
  player: string | null,
  team: string | null,
): string | null {
  if (!selection) {
    return selection;
  }

  if (/^player\s+/i.test(selection) && player) {
    return selection.replace(/^player\b/i, player);
  }

  if (/^team\s+/i.test(selection) && team) {
    return selection.replace(/^team\b/i, team);
  }

  if (/^(over|under)\b/i.test(selection)) {
    if (player) {
      return `${player} ${selection}`;
    }
    if (team) {
      return `${team} ${selection}`;
    }
  }

  return selection;
}

function formatEventStart(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

export function buildPickIdentity(input: PickIdentityInput): PickIdentityModel {
  const metadata = readObject(input.metadata);
  const submissionPayload = readObject(input.submissionPayload);
  const submissionMetadata = readObject(submissionPayload?.['metadata']);

  const matchup = readString(
    input.matchup,
    input.eventName,
    metadata?.['eventName'],
    submissionMetadata?.['eventName'],
  );
  const eventStartTime = readString(
    input.eventStartTime,
    metadata?.['eventTime'],
    metadata?.['eventStartTime'],
    submissionMetadata?.['eventTime'],
    submissionMetadata?.['eventStartTime'],
  );
  const sport = readString(
    input.sportDisplayName,
    input.sport,
    metadata?.['sport'],
    metadata?.['league'],
    submissionMetadata?.['sport'],
    submissionMetadata?.['league'],
  );
  const capper = readString(
    input.capperName,
    input.capperDisplayName,
    input.submittedBy,
    input.submitter,
    metadata?.['capper'],
    metadata?.['submittedBy'],
    submissionPayload?.['submittedBy'],
  );
  const marketType = readString(
    input.marketTypeLabel,
    input.marketTypeDisplayName,
    metadata?.['marketType'],
    submissionMetadata?.['marketType'],
    input.market,
  );
  const sportsbook = readString(
    metadata?.['sportsbook'],
    submissionMetadata?.['sportsbook'],
  );
  const rawSelection = readString(input.selection, submissionPayload?.['selection']);
  const player = readString(
    metadata?.['player'],
    submissionMetadata?.['player'],
    extractPlayerFromSelection(rawSelection),
  );
  const team = readString(metadata?.['team'], submissionMetadata?.['team']);
  const selection = replaceGenericSelectionSubject(rawSelection, player, team);
  const market = readString(input.market, submissionPayload?.['market']);
  const lineLabel = formatLine(input.line);
  const oddsLabel = formatOdds(input.odds);

  let wagerLabel = selection ?? 'Unknown pick';
  if (
    selection &&
    lineLabel &&
    !selection.includes(lineLabel) &&
    !selection.toLowerCase().includes('moneyline')
  ) {
    wagerLabel = `${selection} ${lineLabel}`;
  }

  return {
    wagerLabel,
    matchup,
    eventStartTime,
    eventStartLabel: formatEventStart(eventStartTime),
    sport,
    capper,
    marketType: humanizeMarketType(marketType),
    sportsbook,
    team,
    player,
    source: readString(input.source),
    market,
    selection,
    oddsLabel,
  };
}
