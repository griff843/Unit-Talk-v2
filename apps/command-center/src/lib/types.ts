export type SignalStatus = 'WORKING' | 'DEGRADED' | 'BROKEN';

export interface LifecycleSignal {
  signal: 'submission' | 'scoring' | 'promotion' | 'discord_delivery' | 'settlement' | 'stats_propagation';
  status: SignalStatus;
  detail: string;
}

export type DeliveryStatus = 'not_promoted' | 'queued' | 'delivered' | 'failed' | 'dead_letter';
export type SettlementStatus = 'pending' | 'settled' | 'corrected' | 'manual_review';
export type LifecycleStatus = 'submitted' | 'validated' | 'queued' | 'posted' | 'settled' | 'voided';

export interface PickIntelligenceSummary {
  domainAnalysis: boolean;
  deviggingResult: boolean;
  kellySizing: boolean;
  realEdge: boolean;
  edgeSource: string | null;
  clv: boolean;
}

export interface PickRow {
  id: string;
  submittedAt: string;
  submitter: string;
  source: string;
  sport: string | null;
  pickDetails: {
    market: string;
    selection: string;
    line: number | null;
    odds: number | null;
  };
  unitSize: number | null;
  score: number | null;
  lifecycleStatus: LifecycleStatus;
  promotionStatus: 'qualified' | 'not_eligible' | 'suppressed' | 'expired' | 'pending';
  promotionReason: string | null;
  promotionTarget: string | null;
  deliveryStatus: DeliveryStatus;
  receiptStatus: string | null;
  receiptChannel: string | null;
  settlementStatus: SettlementStatus;
  result: string | null;
  intelligence: PickIntelligenceSummary;
}

export interface StatsSnapshot {
  total: number;
  wins: number;
  losses: number;
  pushes: number;
  roiPct: number | null;
}

export type ExceptionSeverity = 'warning' | 'critical';

export interface OperationalException {
  id: string;
  severity: ExceptionSeverity;
  category: 'settlement' | 'delivery' | 'lifecycle' | 'scoring' | 'correction';
  title: string;
  detail: string;
  pickId?: string;
}

export interface DashboardData {
  signals: LifecycleSignal[];
  picks: PickRow[];
  stats: StatsSnapshot;
  exceptions: OperationalException[];
  observedAt: string;
}

export interface IntelligenceCoverageMetric {
  count: number;
  rate: number;
}

export interface IntelligenceCoverage {
  window: string;
  totalPicks: number;
  picksWithOdds: number;
  domainAnalysis: IntelligenceCoverageMetric;
  deviggingResult: IntelligenceCoverageMetric;
  kellySizing: IntelligenceCoverageMetric;
  realEdge: IntelligenceCoverageMetric;
  edgeSourceDistribution: {
    realEdge: number;
    consensusEdge: number;
    sgoEdge: number;
    confidenceDelta: number;
    explicit: number;
    unknown: number;
  };
  clvCoverage: {
    settledPicks: number;
    withClv: number;
    rate: number;
  };
}

export interface ProviderQuotaSummary {
  creditsUsed: number;
  creditsRemaining: number | null;
}

export interface ProviderHealthRow {
  providerKey: string;
  totalRows: number;
  last24hRows: number;
  latestSnapshotAt: string | null;
  minutesSinceLastSnapshot: number | null;
  status: 'active' | 'stale' | 'absent';
}

export interface ProviderHealth {
  providers: ProviderHealthRow[];
  ingestorHealth: {
    status: string;
    lastRunAt: string | null;
  };
  quotaSummary: {
    sgo: ProviderQuotaSummary | null;
    oddsApi: ProviderQuotaSummary | null;
  };
  distinctEventsLast24h: number;
}

// ---------------------------------------------------------------------------
// Board-state overlay types (UTV2-444)
// ---------------------------------------------------------------------------

export type CapStatus = 'open' | 'near-cap' | 'at-cap';
export type ConflictReason = 'slate-cap' | 'sport-cap' | 'game-cap' | 'duplicate' | 'other';

export interface BoardCapDimension {
  current: number;
  cap: number;
  utilization: number;   // 0–1
  status: CapStatus;
}

export interface BoardSportDimension extends BoardCapDimension {
  sportKey: string;
}

export interface BoardGameDimension extends BoardCapDimension {
  gameId: string;
}

export interface ScoreComponents {
  edge: number;
  trust: number;
  readiness: number;
  uniqueness: number;
  boardFit: number;
}

export interface ScoreBreakdownRow {
  pickId: string;
  target: string;
  status: string;
  totalScore: number;
  threshold: number;
  qualifiedOnScore: boolean;
  components: ScoreComponents;
  weights: ScoreComponents;
  componentsWeighted: ScoreComponents;
  thresholdDelta: number;
  decidedAt: string;
}

export interface ConflictCard {
  pickId: string;
  status: string;
  totalScore: number;
  threshold: number;
  thresholdDelta: number;
  conflictReason: ConflictReason;
  rawReason: string;
  sport: string;
  decidedAt: string;
}

export interface BoardStateData {
  window: string;
  computedAt: string;
  target: string;
  caps: { perSlate: number; perSport: number; perGame: number };
  slate: BoardCapDimension;
  bySport: BoardSportDimension[];
  byGame: BoardGameDimension[];
  scoreBreakdowns: ScoreBreakdownRow[];
  conflictCards: ConflictCard[];
}

// ---------------------------------------------------------------------------
// Board Queue (UTV2-477)
// ---------------------------------------------------------------------------

export interface BoardQueueRow {
  boardRank: number;
  boardTier: string;
  candidateId: string;
  boardRunId: string;
  sportKey: string;
  modelScore: number;
  /** null = pending write; non-null = already written */
  pickId: string | null;
  shadowMode: boolean;
  canonicalMarketKey: string;
  currentLine: number | null;
  currentOverOdds: number | null;
  currentUnderOdds: number | null;
  universeId: string;
}

export interface BoardQueueData {
  boardRunId: string;
  observedAt: string;
  totalRows: number;
  pendingCount: number;
  writtenCount: number;
  rows: BoardQueueRow[];
}

export interface WriteBoardPicksResult {
  ok: boolean;
  boardRunId: string;
  boardSize: number;
  written: number;
  skipped: number;
  errors: number;
  durationMs: number;
  pickIds: string[];
  error?: string;
}

export interface DashboardRuntimeData {
  outbox: {
    pending: number;
    processing: number;
    sent: number;
    failed: number;
    deadLetter: number;
    simulated: number;
  };
  worker: {
    drainState: string;
    detail: string;
    latestRunAt: string | null;
    latestReceiptAt: string | null;
  };
  aging: {
    staleValidated: number;
    stalePosted: number;
    staleProcessing: number;
  };
  deliveryTargets: Array<{
    target: string;
    recentSentCount: number;
    recentFailureCount: number;
    latestSentAt: string | null;
    healthy: boolean;
  }>;
  providerSummary: {
    active: number;
    stale: number;
    absent: number;
    distinctEventsLast24h: number;
    ingestorStatus: string;
  };
}
