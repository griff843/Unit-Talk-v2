export type InjuryStatus =
  | 'out'
  | 'doubtful'
  | 'questionable'
  | 'probable'
  | 'confirmed'
  | 'available'
  | 'unknown';

export type InjurySourceTier =
  | 'official'
  | 'espn'
  | 'underdog'
  | 'sdio'
  | 'fantasydata'
  | 'rapidapi';

export interface NormalizedInjuryReport {
  participantId: string;
  playerName: string;
  sport: string;
  status: InjuryStatus;
  description?: string | undefined;
  sourceTier: InjurySourceTier;
  sourceUrl?: string | undefined;
  reportedAt: string;
  fetchedAt: string;
}

export interface InjuryChange {
  participantId: string;
  playerName: string;
  sport: string;
  previousStatus: InjuryStatus | null;
  currentStatus: InjuryStatus;
  sourceTier: InjurySourceTier;
  reportedAt: string;
  fetchedAt: string;
  affectedPickIds: string[];
  injuryNote?: string;
  source?: string;
}

export interface InjuryDetectionResult {
  changes: InjuryChange[];
  reportsEvaluated: number;
  participantsChecked: number;
  staleReportsSkipped: number;
  fetchedAt: string;
}
