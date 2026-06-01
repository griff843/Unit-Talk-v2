// UTV2-1147: Independent adversarial data path types — INIT-5.2.1
// Stub for lane file-scope lock. Implementation by Codex lane.

export interface RawProviderSnapshot {
  readonly source: string;
  readonly capturedAt: string;
  readonly payload: unknown;
}

export interface IndependentAdversarialRecord {
  readonly id: string;
  readonly rawSnapshot: RawProviderSnapshot;
  readonly capturedAt: string;
  readonly pathId: 'independent-adversarial';
}

export interface ReplayableAdversarialFinding {
  readonly id: string;
  readonly recordId: string;
  readonly finding: unknown;
  readonly replayableFromPath: 'independent-adversarial';
  readonly detectedAt: string;
}
