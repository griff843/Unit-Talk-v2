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
  latestProviderOfferSnapshotAt?: string | null;
}

export type ProviderCycleStageStatus =
  | 'pending'
  | 'staged'
  | 'merge_blocked'
  | 'merged'
  | 'failed';
export type ProviderCycleFreshnessStatus =
  | 'unknown'
  | 'fresh'
  | 'stale'
  | 'invalid_snapshot';
export type ProviderCycleProofStatus = 'required' | 'verified' | 'waived';
export type ProviderIngestionFailureCategory =
  | 'provider_api_failure'
  | 'parse_failure'
  | 'zero_offers'
  | 'db_statement_timeout'
  | 'db_lock_timeout'
  | 'db_deadlock'
  | 'partial_market_failure'
  | 'stale_after_cycle'
  | 'archive_failure'
  | 'unknown_failure';
export type ProviderIngestionFailureScope =
  | 'cycle'
  | 'provider'
  | 'sport'
  | 'market'
  | 'archive'
  | 'db';

export interface ProviderCycleStatusRow {
  runId: string;
  providerKey: string;
  league: string;
  cycleSnapshotAt: string;
  stageStatus: ProviderCycleStageStatus;
  freshnessStatus: ProviderCycleFreshnessStatus;
  proofStatus: ProviderCycleProofStatus;
  stagedCount: number;
  mergedCount: number;
  duplicateCount: number;
  failureCategory: ProviderIngestionFailureCategory | null;
  failureScope: ProviderIngestionFailureScope | null;
  lastError: string | null;
  updatedAt: string;
  productionStatus: 'healthy' | 'warning' | 'critical';
  statusReason: string;
}

export interface ProviderCycleHealthSummary {
  overallStatus: 'healthy' | 'warning' | 'critical';
  trackedLanes: number;
  mergedLanes: number;
  blockedLanes: number;
  failedLanes: number;
  staleLanes: number;
  proofRequiredLanes: number;
  latestCycleSnapshotAt: string | null;
  latestUpdatedAt: string | null;
  liveOfferSnapshotAt: string | null;
  rows: ProviderCycleStatusRow[];
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

// ---------------------------------------------------------------------------
// Governed Pick Performance (UTV2-479)
// ---------------------------------------------------------------------------

export interface GovernedPickPerformanceRow {
  pick_id: string;
  market: string | null;
  selection: string | null;
  odds: number | null;
  pick_status: string | null;
  settled_at: string | null;
  pick_created_at: string | null;
  metadata: Record<string, unknown> | null;
  board_run_id: string | null;
  board_rank: number | null;
  board_tier: string | null;
  sport_key: string | null;
  market_type_id: string | null;
  board_model_score: number | null;
  candidate_id: string | null;
  universe_id: string | null;
  candidate_model_score: number | null;
  model_confidence: number | null;
  model_tier: string | null;
  selection_rank: number | null;
  provider_key: string | null;
  provider_market_key: string | null;
  /** null for unsettled picks */
  settlement_id: string | null;
  /** null for unsettled picks */
  settlement_result: string | null;
  /** null for unsettled picks */
  settlement_status: string | null;
  /** null for unsettled picks */
  settlement_settled_at: string | null;
  /** null for unsettled picks */
  settled_by: string | null;
  /** null for unsettled picks */
  settlement_confidence: number | null;
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
    latestLiveSnapshotAt: string | null;
  };
  providerCycleSummary: {
    overallStatus: 'healthy' | 'warning' | 'critical';
    trackedLanes: number;
    mergedLanes: number;
    blockedLanes: number;
    failedLanes: number;
    staleLanes: number;
    proofRequiredLanes: number;
    latestCycleSnapshotAt: string | null;
    latestUpdatedAt: string | null;
  };
}
