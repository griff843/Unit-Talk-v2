/**
 * VERIFICATION & SIMULATION CONTROL PLANE — Fault Module Public API
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R4
 *
 * Import from here, not from internal sub-modules.
 */

// Core types
export type {
  FaultTarget,
  FaultType,
  ActivationRule,
  FaultDefinition,
  FaultActivationRecord,
  AssertionEvidence,
  AssertionResult,
  AssertionSpec,
  PostScenarioState,
  FaultScenario,
  ScenarioResult,
  AssertorFn,
} from './types.js';

// Fault injector
export { FaultInjector } from './fault-injector.js';

// Fault adapters
export { FaultPublishAdapter } from './adapters/fault-publish-adapter.js';
export type { FaultPublishRecord } from './adapters/fault-publish-adapter.js';

export { FaultFeedAdapter } from './adapters/fault-feed-adapter.js';
export { FaultSettlementAdapter } from './adapters/fault-settlement-adapter.js';
export { FaultRecapAdapter } from './adapters/fault-recap-adapter.js';
export type { FaultRecapRecord } from './adapters/fault-recap-adapter.js';

// Assertion engine
export { InvariantAssertionEngine } from './assertion-engine.js';

// Fault orchestrator
export { FaultOrchestrator } from './fault-orchestrator.js';

// Proof writer
export { FaultProofWriter } from './fault-proof-writer.js';

// Scenario catalog
export {
  SCENARIO_CATALOG,
  CORE_SUITE,
  FULL_SUITE,
  F1,
  F2,
  F3,
  F4,
  F5,
  F6,
  F7,
  F8,
  F9,
  F10,
} from './scenarios/index.js';
export type { ScenarioSetup } from './scenarios/index.js';
