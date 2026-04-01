/**
 * VERIFICATION & SIMULATION CONTROL PLANE — Fault Types
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R4
 *
 * Core type definitions for the fault-injection framework.
 * All scenario definitions, fault contracts, and assertion interfaces live here.
 */

import type { LifecycleTrace } from '../replay-lifecycle-runner.js';

// ─────────────────────────────────────────────────────────────
// FAULT TARGETS
// ─────────────────────────────────────────────────────────────

/**
 * Pipeline injection points where faults can be activated.
 * Faults are introduced ONLY through adapter wrappers and orchestrator-controlled
 * triggers — never by branching inside lifecycle validation functions.
 */
export type FaultTarget =
  | 'publish.publish' // PublishAdapter.publish()
  | 'feed.poll' // FeedAdapter.poll()
  | 'settlement.checkSettlement' // SettlementAdapter.checkSettlement()
  | 'recap.generate' // RecapAdapter.generate()
  | 'orchestrator.drawdown'; // Orchestrator drawdown freeze trigger

// ─────────────────────────────────────────────────────────────
// FAULT TYPES
// ─────────────────────────────────────────────────────────────

/** Classification of injected fault behavior. */
export type FaultType =
  | 'throw' // Throw an error at the injection point
  | 'return_null' // Return null instead of expected value
  | 'return_stale' // Return data with stale market timestamps
  | 'return_degraded' // Return data with degraded quality markers
  | 'timeout_then_success'; // Simulate timeout, then succeed on next call

// ─────────────────────────────────────────────────────────────
// ACTIVATION RULES
// ─────────────────────────────────────────────────────────────

/** Determines when a registered fault should fire. */
export type ActivationRule =
  | { type: 'always' }
  | { type: 'on_call_number'; callNumber: number }
  | { type: 'on_pick_id'; pickId: string }
  | { type: 'after_call_number'; afterCallNumber: number };

// ─────────────────────────────────────────────────────────────
// FAULT DEFINITION
// ─────────────────────────────────────────────────────────────

/** A single fault injection specification. */
export interface FaultDefinition {
  /** Which adapter/hook to target. */
  target: FaultTarget;
  /** Classification of fault behavior. */
  type: FaultType;
  /** When to activate. */
  activation: ActivationRule;
  /** Error message to throw (for type='throw'). */
  errorMessage?: string;
  /** Stale marker payload (for type='return_stale'). */
  stalePayload?: Record<string, unknown>;
  /** Degraded marker payload (for type='return_degraded'). */
  degradedPayload?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// FAULT ACTIVATION RECORD
// ─────────────────────────────────────────────────────────────

/** Recorded trace of a fault activation event. */
export interface FaultActivationRecord {
  target: FaultTarget;
  faultType: FaultType;
  activatedAt: string; // WALL-CLOCK-ALLOWED: fault metadata, non-lifecycle
  callNumber: number;
  pickId?: string;
  errorThrown?: string;
}

// ─────────────────────────────────────────────────────────────
// ASSERTIONS
// ─────────────────────────────────────────────────────────────

/** Evidence field for an assertion. */
export interface AssertionEvidence {
  field: string;
  expected: unknown;
  actual: unknown;
}

/** Result of a single invariant assertion. */
export interface AssertionResult {
  assertionId: string;
  invariant: string;
  description: string;
  pass: boolean;
  evidence: AssertionEvidence[];
  failureReason?: string;
}

/** Specification for an assertion attached to a scenario. */
export interface AssertionSpec {
  assertionId: string;
  invariant: string;
  description: string;
}

// ─────────────────────────────────────────────────────────────
// POST-SCENARIO STATE
// ─────────────────────────────────────────────────────────────

/** System state snapshot available to the assertion engine after a scenario run. */
export interface PostScenarioState {
  scenarioId: string;
  lifecycleTrace: ReadonlyArray<LifecycleTrace>;
  finalPickState: ReadonlyArray<Record<string, unknown>>;
  publishRecords: ReadonlyArray<{ pickId: string; receiptId: string; recordedAt: string }>;
  publishCallCount: number;
  suppressedAlertCount: number;
  errors: ReadonlyArray<{
    eventId: string;
    eventType: string;
    pickId?: string;
    error: string;
    sequenceNumber: number;
  }>;
  activatedFaults: ReadonlyArray<FaultActivationRecord>;
  recapRecords: ReadonlyArray<Record<string, unknown>>;
  settlementCheckCount: number;
  /** True when an immutability violation or drawdown freeze was detected. */
  freezeViolationDetected: boolean;
  freezeViolationMessage?: string;
}

// ─────────────────────────────────────────────────────────────
// SCENARIO DEFINITION
// ─────────────────────────────────────────────────────────────

/** Canonical fault scenario definition (F1–F10). */
export interface FaultScenario {
  /** Canonical ID (e.g., 'F1'). */
  scenarioId: string;
  /** Human-readable name. */
  name: string;
  /** Primary injection point. */
  targetStage: FaultTarget;
  /** Fault classification. */
  faultType: FaultType;
  /** Expected system behavior description. */
  expectedBehavior: string;
  /** Required proof artifact filename. */
  proofArtifactName: string;
  /** Assertions to validate after execution. */
  assertions: AssertionSpec[];
}

// ─────────────────────────────────────────────────────────────
// SCENARIO RESULT
// ─────────────────────────────────────────────────────────────

/** Complete result of executing a fault scenario. */
export interface ScenarioResult {
  scenarioId: string;
  scenarioName: string;
  runId: string;
  mode: 'fault';
  startedAt: string; // WALL-CLOCK-ALLOWED: run metadata
  completedAt: string; // WALL-CLOCK-ALLOWED: run metadata
  durationMs: number;
  faultsActivated: number;
  assertions: AssertionResult[];
  assertionsPassed: number;
  assertionsFailed: number;
  pass: boolean;
  errors: ReadonlyArray<{
    eventId: string;
    eventType: string;
    pickId?: string;
    error: string;
    sequenceNumber: number;
  }>;
  finalPickState: ReadonlyArray<Record<string, unknown>>;
  lifecycleTrace: ReadonlyArray<LifecycleTrace>;
  activatedFaults: ReadonlyArray<FaultActivationRecord>;
}

// ─────────────────────────────────────────────────────────────
// ASSERTOR FUNCTION
// ─────────────────────────────────────────────────────────────

/** A function that inspects post-scenario state and returns an assertion result. */
export type AssertorFn = (state: PostScenarioState) => AssertionResult;
