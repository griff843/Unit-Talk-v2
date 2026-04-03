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
