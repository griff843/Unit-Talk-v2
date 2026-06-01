// UTV2-1148: Manipulation detector types — INIT-5.2.2
// Stub for lane file-scope lock. Implementation by Codex lane.

import type { IndependentAdversarialRecord, ReplayableAdversarialFinding } from './independent-data-path.types.js';

export type ManipulationClassification = 'line_fabrication' | 'volume_spoofing' | 'timestamp_forgery' | 'none';

export interface ManipulationFinding extends ReplayableAdversarialFinding {
  readonly classification: ManipulationClassification;
  readonly confidence: number;
  readonly quarantineSignal: boolean;
}

export interface ManipulationDetectorInput {
  readonly record: IndependentAdversarialRecord;
  readonly detectedAt: string;
}
