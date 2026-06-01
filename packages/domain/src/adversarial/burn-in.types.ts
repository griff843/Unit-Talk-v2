import type { RawProviderSnapshot } from './independent-data-path.types.js';
import type { AdversarialFinding, EscalationResult } from './escalation.types.js';
import type { ManipulationDetectorThresholds } from './manipulation-detector.types.js';
import type { ProviderAnomalyDetectorThresholds } from './provider-anomaly.types.js';

export type BurnInStatus = 'pass' | 'fail' | 'divergence_reset' | 'violation_paused';

export interface BurnInScenario {
  readonly id: string;
  readonly name: string;
  readonly snapshots: readonly RawProviderSnapshot[];
  readonly expectedEscalations: number;
  readonly expectedNonEscalations: number;
  readonly manipulationThresholds?: Partial<ManipulationDetectorThresholds>;
  readonly providerThresholds?: Partial<ProviderAnomalyDetectorThresholds>;
}

export interface BurnInRun {
  readonly id: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly clockResetCount: number;
  readonly scenarios: readonly BurnInScenario[];
}

export interface RunBurnInInput {
  readonly id?: string;
  readonly scenarios: readonly BurnInScenario[];
  readonly startedAt: string;
  readonly detectedAt: string;
  readonly replayedAt: string;
  readonly escalatedAt: string;
  readonly completedAt: string;
  readonly clockResetCount?: number;
  readonly maxClockResetCount?: number;
}

export interface BurnInScenarioResult {
  readonly scenarioId: string;
  readonly status: BurnInStatus;
  readonly escalations: number;
  readonly nonEscalations: number;
  readonly clockResets: number;
  readonly violations: readonly string[];
  readonly replayStable: boolean;
  readonly findings: readonly AdversarialFinding[];
  readonly escalationResults: readonly EscalationResult[];
}

export interface BurnInResult {
  readonly runId: string;
  readonly status: BurnInStatus;
  readonly escalations: number;
  readonly nonEscalations: number;
  readonly clockResets: number;
  readonly violations: readonly string[];
  readonly replayStable: boolean;
  readonly scenarios: readonly BurnInScenarioResult[];
  readonly completedAt: string;
}
