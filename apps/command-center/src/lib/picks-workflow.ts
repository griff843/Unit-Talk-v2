export interface OperatorPickRow {
  id: string;
  source: string;
  market: string;
  selection: string;
  line: number | null;
  odds: number | null;
  promotionScore: number | null;
  createdAt: string;
  status: string;
  approvalStatus: string;
  reviewDecision: string | null;
  metadata: Record<string, unknown>;
  matchup: string | null;
  eventStartTime: string | null;
  sport: string | null;
  submitter: string | null;
  capperDisplayName: string | null;
  marketTypeDisplayName: string | null;
  tier: string | null;
  confidence: number | null;
  ev: number | null;
  playerSearchText: string;
  statusLabel: 'Pending' | 'Approved' | 'Rejected';
}

export interface PicksWorkflowFilters {
  sport: string;
  tiers: string[];
  status: 'all' | 'Pending' | 'Approved' | 'Rejected';
  dateFrom: string;
  dateTo: string;
  search: string;
}

export type PicksSortKey =
  | 'tier'
  | 'player'
  | 'sport'
  | 'market'
  | 'odds'
  | 'ev'
  | 'confidence'
  | 'status'
  | 'submitted';

type SortDirection = 'asc' | 'desc';

function readObject(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function readString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function readNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function deriveTier(metadata: Record<string, unknown>) {
  const promotionScores = readObject(metadata['promotionScores']);
  const domainAnalysis = readObject(metadata['domainAnalysis']);
  const tier = readString(
    metadata['tier'],
    metadata['boardTier'],
    metadata['modelTier'],
    metadata['band'],
    metadata['finalBand'],
    promotionScores?.['tier'],
    domainAnalysis?.['tier'],
  );

  if (!tier) {
    return null;
  }

  return tier.replace('_TIER', '').replace('+', '').toUpperCase();
}

function deriveStatusLabel(status: string, approvalStatus: string, reviewDecision: string | null) {
  if (approvalStatus === 'rejected' || reviewDecision === 'deny' || status === 'voided') {
    return 'Rejected';
  }

  if (status === 'awaiting_approval' || approvalStatus === 'pending') {
    return 'Pending';
  }

  return 'Approved';
}

function toIsoDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

export function normalizeOperatorPick(row: Record<string, unknown>): OperatorPickRow {
  const metadata = readObject(row['metadata']) ?? {};
  const player = readString(metadata['player']);
  const team = readString(metadata['team']);
  const submitter = readString(row['submitter'], row['capper_display_name'], metadata['submittedBy'], metadata['capper']);
  const sport = readString(row['sport'], row['sport_display_name'], metadata['sport'], metadata['league']);
  const eventStartTime = readString(row['eventStartTime'], row['event_start_time'], metadata['eventStartTime'], metadata['eventTime']);
  const matchup = readString(row['matchup'], row['event_name'], metadata['eventName']);
  const confidence = readNumber(metadata['confidence'], metadata['modelConfidence'], metadata['confidenceScore']);
  const ev = readNumber(metadata['ev'], metadata['expectedValue'], metadata['edgePercent'], metadata['edge']);
  const tier = deriveTier(metadata);
  const reviewDecision = readString(row['review_decision']);
  const status = String(row['status'] ?? '');
  const approvalStatus = String(row['approval_status'] ?? '');

  return {
    id: String(row['id'] ?? ''),
    source: String(row['source'] ?? ''),
    market: String(row['market'] ?? ''),
    selection: String(row['selection'] ?? ''),
    line: typeof row['line'] === 'number' ? row['line'] : null,
    odds: typeof row['odds'] === 'number' ? row['odds'] : null,
    promotionScore: typeof row['promotion_score'] === 'number' ? row['promotion_score'] : null,
    createdAt: String(row['created_at'] ?? ''),
    status,
    approvalStatus,
    reviewDecision,
    metadata,
    matchup,
    eventStartTime,
    sport,
    submitter,
    capperDisplayName: readString(row['capper_display_name']),
    marketTypeDisplayName: readString(row['market_type_display_name']),
    tier,
    confidence,
    ev,
    playerSearchText: [player, team, submitter, matchup, String(row['selection'] ?? '')]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join(' ')
      .toLowerCase(),
    statusLabel: deriveStatusLabel(status, approvalStatus, reviewDecision),
  };
}

export function filterOperatorPicks(picks: OperatorPickRow[], filters: PicksWorkflowFilters) {
  const search = filters.search.trim().toLowerCase();

  return picks.filter((pick) => {
    if (filters.sport !== 'All' && (pick.sport ?? 'Unknown') !== filters.sport) {
      return false;
    }

    if (filters.tiers.length > 0 && !filters.tiers.includes(pick.tier ?? '')) {
      return false;
    }

    if (filters.status !== 'all' && pick.statusLabel !== filters.status) {
      return false;
    }

    if (filters.dateFrom || filters.dateTo) {
      const pickDate = toIsoDate(pick.createdAt);
      if (!pickDate) {
        return false;
      }
      if (filters.dateFrom && pickDate < filters.dateFrom) {
        return false;
      }
      if (filters.dateTo && pickDate > filters.dateTo) {
        return false;
      }
    }

    if (search && !pick.playerSearchText.includes(search)) {
      return false;
    }

    return true;
  });
}

function tierRank(value: string | null) {
  switch (value) {
    case 'S':
      return 0;
    case 'A':
      return 1;
    case 'B':
      return 2;
    case 'C':
      return 3;
    case 'D':
      return 4;
    default:
      return 99;
  }
}

function compareNullableNumber(left: number | null, right: number | null) {
  if (left == null && right == null) {
    return 0;
  }
  if (left == null) {
    return 1;
  }
  if (right == null) {
    return -1;
  }
  return left - right;
}

export function sortOperatorPicks(
  picks: OperatorPickRow[],
  sortKey: PicksSortKey,
  sortDirection: SortDirection,
) {
  const direction = sortDirection === 'asc' ? 1 : -1;

  return [...picks].sort((left, right) => {
    let comparison = 0;

    switch (sortKey) {
      case 'tier':
        comparison = tierRank(left.tier) - tierRank(right.tier);
        break;
      case 'player':
        comparison = left.playerSearchText.localeCompare(right.playerSearchText);
        break;
      case 'sport':
        comparison = String(left.sport ?? '').localeCompare(String(right.sport ?? ''));
        break;
      case 'market':
        comparison = left.market.localeCompare(right.market);
        break;
      case 'odds':
        comparison = compareNullableNumber(left.odds, right.odds);
        break;
      case 'ev':
        comparison = compareNullableNumber(left.ev, right.ev);
        break;
      case 'confidence':
        comparison = compareNullableNumber(left.confidence, right.confidence);
        break;
      case 'status':
        comparison = left.statusLabel.localeCompare(right.statusLabel);
        break;
      case 'submitted':
        comparison = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
        break;
      default:
        comparison = 0;
        break;
    }

    return comparison * direction;
  });
}

function escapeCsv(value: string) {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildOperatorPickCsv(picks: OperatorPickRow[]) {
  const lines = [
    ['id', 'tier', 'player', 'sport', 'market', 'odds', 'ev', 'confidence', 'status', 'submitted'].join(','),
  ];

  for (const pick of picks) {
    lines.push(
      [
        pick.id,
        pick.tier ?? '',
        pick.playerSearchText,
        pick.sport ?? '',
        pick.market,
        pick.odds != null ? String(pick.odds) : '',
        pick.ev != null ? String(pick.ev) : '',
        pick.confidence != null ? String(pick.confidence) : '',
        pick.statusLabel,
        pick.createdAt,
      ]
        .map(escapeCsv)
        .join(','),
    );
  }

  return `${lines.join('\n')}\n`;
}
