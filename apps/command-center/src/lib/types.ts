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

export interface DashboardData {
  signals: LifecycleSignal[];
  picks: PickRow[];
  stats: StatsSnapshot;
  observedAt: string;
}
