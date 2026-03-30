export type SignalStatus = 'WORKING' | 'DEGRADED' | 'BROKEN';

export interface LifecycleSignal {
  signal: 'submission' | 'scoring' | 'promotion' | 'discord_delivery' | 'settlement' | 'stats_propagation';
  status: SignalStatus;
  detail: string;
}

export type DeliveryStatus = 'not_promoted' | 'queued' | 'delivered' | 'failed' | 'dead_letter';
export type SettlementStatus = 'pending' | 'settled' | 'corrected' | 'manual_review';
export type LifecycleStatus = 'submitted' | 'validated' | 'queued' | 'posted' | 'settled' | 'voided';

export interface PickRow {
  id: string;
  submittedAt: string;
  submitter: string;
  source: string;
  sport: string;
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
  deliveryStatus: DeliveryStatus;
  settlementStatus: SettlementStatus;
  result: string | null;
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
