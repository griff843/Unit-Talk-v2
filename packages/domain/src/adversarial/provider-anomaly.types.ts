// UTV2-1148: Provider anomaly detector types — INIT-5.2.2
// Stub for lane file-scope lock. Implementation by Codex lane.

import type { IndependentAdversarialRecord, ReplayableAdversarialFinding } from './independent-data-path.types.js';

export type AnomalyClassification = 'cross_provider_divergence' | 'stale_data' | 'missing_market' | 'none';

export interface ProviderAnomalyReport extends ReplayableAdversarialFinding {
  readonly classification: AnomalyClassification;
  readonly confidence: number;
  readonly affectedSources: readonly string[];
  readonly quarantineSignal: boolean;
}

export interface ProviderAnomalyDetectorInput {
  readonly records: readonly IndependentAdversarialRecord[];
  readonly detectedAt: string;
  readonly thresholds?: Partial<ProviderAnomalyDetectorThresholds>;
}

export interface ProviderAnomalyDetectorThresholds {
  readonly staleAfterMs: number;
  readonly lineDivergence: number;
  readonly oddsDivergence: number;
}
