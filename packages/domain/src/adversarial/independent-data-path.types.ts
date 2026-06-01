// UTV2-1147: Independent adversarial data path types — INIT-5.2.1

export interface RawProviderSnapshot {
  readonly source: string;
  readonly capturedAt: string;
  readonly payload: unknown;
}

export interface IndependentAdversarialRecordInput {
  readonly id?: string;
  readonly rawSnapshot: RawProviderSnapshot;
  readonly capturedAt?: string;
}

export interface IndependentAdversarialRecord {
  readonly id: string;
  readonly rawSnapshot: RawProviderSnapshot;
  readonly capturedAt: string;
  readonly pathId: 'independent-adversarial';
  readonly payloadHash: string;
  readonly replayKey: string;
}

export interface ReplayableAdversarialFindingInput {
  readonly id?: string;
  readonly record: IndependentAdversarialRecord;
  readonly finding: unknown;
  readonly detectedAt: string;
}

export interface ReplayableAdversarialFinding {
  readonly id: string;
  readonly recordId: string;
  readonly finding: unknown;
  readonly replayableFromPath: 'independent-adversarial';
  readonly detectedAt: string;
  readonly payloadHash: string;
  readonly replayKey: string;
}

export interface ReplayedAdversarialFinding {
  readonly finding: ReplayableAdversarialFinding;
  readonly record: IndependentAdversarialRecord;
  readonly replayedAt: string;
  readonly verified: true;
}

export interface AdversarialReplayResult {
  readonly replayedAt: string;
  readonly verified: readonly ReplayedAdversarialFinding[];
  readonly rejected: readonly ReplayableAdversarialFinding[];
}
