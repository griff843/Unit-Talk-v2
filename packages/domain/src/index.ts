export type ProgramSurface =
  | 'submission'
  | 'promotion'
  | 'distribution'
  | 'settlement'
  | 'operator-control';

export interface ProgramCapability {
  surface: ProgramSurface;
  authority: 'read' | 'write';
  owner: string;
}

export * from './distribution.js';
export * from './submission.js';
export * from './picks.js';
export * from './promotion.js';
export * from './market-key.js';
export * from './probability/index.js';
export * from './outcomes/index.js';
export * from './market/index.js';
export * from './features/index.js';
export * from './models/index.js';
export * from './signals/index.js';
export * from './bands/index.js';
export * from './scoring/index.js';
export * from './edge-validation/index.js';
export * from './rollups/index.js';
export * from './system-health/index.js';
export * from './risk/index.js';
export * from './hedge-detection.js';
export * from './multi-book-consensus.js';
export * from './clv-weight-tuner.js';
// strategy/ not re-exported here (name collision: americanToDecimal with risk/kelly-sizer)
// import directly: import { ExecutionSimulator } from '@unit-talk/domain/strategy'
// calibration/ not re-exported here (name collision with probability/calibration)
// import directly: import { calibrate } from '@unit-talk/domain/calibration'
// evaluation/ not re-exported here (name collision: computeBrierScore/computeLogLoss)
// import directly: import { computeAlphaEvaluation } from '@unit-talk/domain/evaluation'
