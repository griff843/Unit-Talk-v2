// UTV2-1150: Burn-in orchestration types — INIT-5.3.1
// Stub for lane file-scope lock. Implementation by Codex lane.

import type { RawProviderSnapshot } from './independent-data-path.types.js';

export type BurnInStatus = 'pass' | 'fail' | 'divergence_reset' | 'violation_paused';

export interface BurnInScenario {
  readonly id: string;
  readonly name: string;
  readonly snapshots: readonly RawProviderSnapshot[];
  readonly expectedEscalations: number;
  readonly expectedNonEscalations: number;
}

export interface BurnInRun {
  readonly id: string;
  readonly scenarioId: string;
  readonly startedAt: string;
  readonly clockResetCount: number;
}

export interface BurnInResult {
  readonly runId: string;
  readonly scenarioId: string;
  readonly status: BurnInStatus;
  readonly escalations: number;
  readonly nonEscalations: number;
  readonly clockResets: number;
  readonly violations: readonly string[];
  readonly replayStable: boolean;
  readonly completedAt: string;
}
