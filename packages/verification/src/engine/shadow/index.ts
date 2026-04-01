/**
 * VERIFICATION & SIMULATION CONTROL PLANE — Shadow Guardrails Public API
 * Sprint: SPRINT-VERIFICATION-SHADOW-DIVERGENCE-GUARDRAILS
 *
 * Import from here, not from internal sub-modules.
 */

// Types
export type {
  DivergenceLevel,
  ShadowVerdict,
  ScoreDivergence,
  StructuralDivergence,
  ClassifiedDivergences,
  ShadowVerdictResult,
  ShadowRunnerConfig,
  ShadowRunnerResult,
} from './types.js';

// Score comparator
export { ShadowScoreComparator } from './shadow-comparator.js';

// Divergence classifier
export { DivergenceClassifier } from './divergence-classifier.js';

// Verdict engine
export { ShadowVerdictEngine } from './shadow-verdict.js';

// Proof writer
export { ShadowGuardrailsProofWriter } from './shadow-proof-writer.js';

// Runner (top-level orchestrator)
export { ShadowRunner } from './shadow-runner.js';
