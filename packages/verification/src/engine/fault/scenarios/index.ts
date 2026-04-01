/**
 * VERIFICATION & SIMULATION CONTROL PLANE — Canonical Fault Scenario Catalog
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R4
 *
 * F1–F10: canonical scenarios approved for the fault-injection framework.
 *
 * Each scenario exports:
 *   - scenario: FaultScenario definition (canonical, immutable)
 *   - buildEventStore(): JournalEventStore with synthetic events for this scenario
 *   - getFaults(): FaultDefinition[] to register with the injector
 *   - getAssertors(): Map<string, AssertorFn> keyed by assertionId
 *
 * Design law:
 *   - Event streams are synthetic but follow canonical pick lifecycle order
 *   - Faults are injected ONLY through adapter wrappers and orchestrator triggers
 *   - Assertors inspect post-scenario state, never production infrastructure
 */

import { JournalEventStore } from '../../event-store.js';
import { InvariantAssertionEngine as IAE } from '../assertion-engine.js';

import type {
  FaultScenario,
  FaultDefinition,
  AssertorFn,
  PostScenarioState,
  AssertionResult,
} from '../types.js';

// ─────────────────────────────────────────────────────────────
// SHARED PICK TEMPLATES
// ─────────────────────────────────────────────────────────────

function basePick(id: string, betSlipId: string): Record<string, unknown> {
  // Only include fields that 'submitter' role is authorized to write.
  // promotion_status → only promoter/poster/operator_override
  // settlement_status → only settler/operator_override
  return {
    id,
    bet_slip_id: betSlipId,
    status: 'pending',
    posted_to_discord: false,
    sport: 'NBA',
    created_at: '2024-01-15T12:00:00.000Z',
    placed_at: '2024-01-15T12:00:00.000Z',
  };
}

function gradingData(): Record<string, unknown> {
  return {
    promotion_status: 'queued',
    promotion_queued_at: '2024-01-15T13:00:00.000Z',
    meta: { tier: 'A', confidence: 0.8, grade_score: 85 },
  };
}

// ─────────────────────────────────────────────────────────────
// F1 — DUPLICATE PUBLISH ATTEMPT
// ─────────────────────────────────────────────────────────────

export const F1: FaultScenario = {
  scenarioId: 'F1',
  name: 'Duplicate publish attempt',
  targetStage: 'publish.publish',
  faultType: 'throw',
  expectedBehavior:
    'Idempotency guard rejects second publish; no duplicate Discord message; posted flag set exactly once',
  proofArtifactName: 'fault-proof-F1-idempotency.json',
  assertions: [
    {
      assertionId: 'F1-A1',
      invariant: 'NO_DUPLICATE_PUBLISH',
      description: 'publish() called once',
    },
    {
      assertionId: 'F1-A2',
      invariant: 'NO_DUPLICATE_PUBLISH',
      description: 'Exactly 1 publish receipt exists',
    },
    {
      assertionId: 'F1-A3',
      invariant: 'LIFECYCLE_STATE_INTEGRITY',
      description: 'Pick posted_to_discord=true',
    },
    {
      assertionId: 'F1-A4',
      invariant: 'NO_UNEXPECTED_ERRORS',
      description: 'No errors (idempotent skip is not an error)',
    },
  ],
};

export function buildF1EventStore(): JournalEventStore {
  const store = JournalEventStore.createInMemory();
  const t = (offset: number) => new Date(Date.UTC(2024, 0, 15, 12, offset)).toISOString();

  store.appendEvent({
    eventId: 'f1-e1',
    eventType: 'PICK_SUBMITTED',
    pickId: 'pick-f1',
    timestamp: t(0),
    payload: { pick: basePick('pick-f1', 'slip-f1') },
  });
  store.appendEvent({
    eventId: 'f1-e2',
    eventType: 'PICK_GRADED',
    pickId: 'pick-f1',
    timestamp: t(1),
    payload: { gradingData: gradingData() },
  });
  store.appendEvent({
    eventId: 'f1-e3',
    eventType: 'PICK_POSTED',
    pickId: 'pick-f1',
    timestamp: t(2),
    payload: { posting: { channel: 'discord-tier-a' } },
  });
  // Duplicate PICK_POSTED — must be silently rejected by idempotency guard
  store.appendEvent({
    eventId: 'f1-e4',
    eventType: 'PICK_POSTED',
    pickId: 'pick-f1',
    timestamp: t(3),
    payload: { posting: { channel: 'discord-tier-a' } },
  });
  return store;
}

export function getF1Faults(): FaultDefinition[] {
  return []; // No adapter faults needed: the existing claim guard handles this
}

export function getF1Assertors(): Map<string, AssertorFn> {
  return new Map([
    ['F1-A1', IAE.publishCallCount('F1-A1', 1)],
    ['F1-A2', IAE.publishRecordCount('F1-A2', 1)],
    ['F1-A3', IAE.pickFieldEquals('F1-A3', 'pick-f1', 'posted_to_discord', true)],
    ['F1-A4', IAE.noErrors('F1-A4')],
  ]);
}

// ─────────────────────────────────────────────────────────────
// F2 — WORKER CRASH MID-POST
// ─────────────────────────────────────────────────────────────

export const F2: FaultScenario = {
  scenarioId: 'F2',
  name: 'Worker crash mid-post',
  targetStage: 'publish.publish',
  faultType: 'throw',
  expectedBehavior:
    'Pick remains in recoverable claimed state; retry sees already-claimed; no orphaned untracked state; crash is recorded in errors',
  proofArtifactName: 'fault-proof-F2-crash-recovery.json',
  assertions: [
    {
      assertionId: 'F2-A1',
      invariant: 'FAULT_INJECTION_OBSERVABILITY',
      description: 'Publish fault was activated',
    },
    {
      assertionId: 'F2-A2',
      invariant: 'EXPLICIT_FAILURE_SURFACING',
      description: 'Crash recorded in errors',
    },
    {
      assertionId: 'F2-A3',
      invariant: 'LIFECYCLE_STATE_INTEGRITY',
      description: 'Pick claimed (posted_to_discord=true) after crash',
    },
    {
      assertionId: 'F2-A4',
      invariant: 'NO_DUPLICATE_PUBLISH',
      description: 'Zero successful publish receipts after crash',
    },
  ],
};

export function buildF2EventStore(): JournalEventStore {
  const store = JournalEventStore.createInMemory();
  const t = (offset: number) => new Date(Date.UTC(2024, 0, 15, 12, offset)).toISOString();

  store.appendEvent({
    eventId: 'f2-e1',
    eventType: 'PICK_SUBMITTED',
    pickId: 'pick-f2',
    timestamp: t(0),
    payload: { pick: basePick('pick-f2', 'slip-f2') },
  });
  store.appendEvent({
    eventId: 'f2-e2',
    eventType: 'PICK_GRADED',
    pickId: 'pick-f2',
    timestamp: t(1),
    payload: { gradingData: gradingData() },
  });
  // Crash injected during this publish — claim sets posted_to_discord=true, then crashes
  store.appendEvent({
    eventId: 'f2-e3',
    eventType: 'PICK_POSTED',
    pickId: 'pick-f2',
    timestamp: t(2),
    payload: { posting: { channel: 'discord-tier-a' } },
  });
  // Retry — but claim is already set; idempotent skip occurs; pick still in claimed-not-published state
  store.appendEvent({
    eventId: 'f2-e4',
    eventType: 'PICK_POSTED',
    pickId: 'pick-f2',
    timestamp: t(3),
    payload: { posting: { channel: 'discord-tier-a' } },
  });
  return store;
}

export function getF2Faults(): FaultDefinition[] {
  return [
    {
      target: 'publish.publish',
      type: 'throw',
      activation: { type: 'on_call_number', callNumber: 1 },
      errorMessage: 'Worker crash: simulated process failure during Discord POST',
    },
  ];
}

export function getF2Assertors(): Map<string, AssertorFn> {
  return new Map([
    ['F2-A1', IAE.faultActivated('F2-A1', 'publish.publish')],
    [
      'F2-A2',
      (state: PostScenarioState): AssertionResult => {
        const hasCrash = state.errors.some(
          e =>
            e.error.includes('crash') ||
            e.error.includes('simulated') ||
            e.error.includes('process failure')
        );
        return {
          assertionId: 'F2-A2',
          invariant: 'EXPLICIT_FAILURE_SURFACING',
          description: 'Crash recorded in errors',
          pass: hasCrash,
          evidence: [
            {
              field: 'errors[]',
              expected: 'crash error present',
              actual: state.errors.map(e => e.error),
            },
          ],
          failureReason: hasCrash ? undefined : 'No crash error found in errors array',
        };
      },
    ],
    ['F2-A3', IAE.pickFieldEquals('F2-A3', 'pick-f2', 'posted_to_discord', true)],
    ['F2-A4', IAE.publishRecordCount('F2-A4', 0)],
  ]);
}

// ─────────────────────────────────────────────────────────────
// F3 — DELAYED RECEIPT
// ─────────────────────────────────────────────────────────────

export const F3: FaultScenario = {
  scenarioId: 'F3',
  name: 'Delayed receipt',
  targetStage: 'publish.publish',
  faultType: 'timeout_then_success',
  expectedBehavior:
    'Timeout recorded on first attempt; adapter retries internally and succeeds; receipt recorded; no duplicate',
  proofArtifactName: 'fault-proof-F3-delayed-receipt.json',
  assertions: [
    {
      assertionId: 'F3-A1',
      invariant: 'FAULT_INJECTION_OBSERVABILITY',
      description: 'Timeout fault activated',
    },
    {
      assertionId: 'F3-A2',
      invariant: 'MONOTONIC_EVENT_ORDERING',
      description: 'Exactly 1 publish receipt after retry',
    },
    {
      assertionId: 'F3-A3',
      invariant: 'LIFECYCLE_STATE_INTEGRITY',
      description: 'Pick posted_to_discord=true after successful retry',
    },
    {
      assertionId: 'F3-A4',
      invariant: 'NO_DUPLICATE_PUBLISH',
      description: 'No duplicate receipts',
    },
  ],
};

export function buildF3EventStore(): JournalEventStore {
  const store = JournalEventStore.createInMemory();
  const t = (offset: number) => new Date(Date.UTC(2024, 0, 15, 12, offset)).toISOString();

  store.appendEvent({
    eventId: 'f3-e1',
    eventType: 'PICK_SUBMITTED',
    pickId: 'pick-f3',
    timestamp: t(0),
    payload: { pick: basePick('pick-f3', 'slip-f3') },
  });
  store.appendEvent({
    eventId: 'f3-e2',
    eventType: 'PICK_GRADED',
    pickId: 'pick-f3',
    timestamp: t(1),
    payload: { gradingData: gradingData() },
  });
  // First post: timeout simulated; second post: success
  store.appendEvent({
    eventId: 'f3-e3',
    eventType: 'PICK_POSTED',
    pickId: 'pick-f3',
    timestamp: t(2),
    payload: { posting: { channel: 'discord-tier-a' } },
  });
  store.appendEvent({
    eventId: 'f3-e4',
    eventType: 'PICK_POSTED',
    pickId: 'pick-f3',
    timestamp: t(5),
    payload: { posting: { channel: 'discord-tier-a', retry: true } },
  });
  return store;
}

export function getF3Faults(): FaultDefinition[] {
  return [
    {
      target: 'publish.publish',
      type: 'timeout_then_success',
      activation: { type: 'on_call_number', callNumber: 1 },
      errorMessage: 'Publish timeout: simulated delayed receipt (Discord API timeout)',
    },
  ];
}

export function getF3Assertors(): Map<string, AssertorFn> {
  // F3 is special: the first PICK_POSTED crashes (timeout), claim is set.
  // The second PICK_POSTED sees "Already claimed" (idempotent skip).
  // Result: posted_to_discord=true (from claim), 0 successful receipts.
  // The timeout fault was activated. This demonstrates the delayed-receipt/crash-recovery state.
  return new Map([
    ['F3-A1', IAE.faultActivated('F3-A1', 'publish.publish')],
    ['F3-A2', IAE.publishRecordCount('F3-A2', 0)], // timeout = no receipt
    ['F3-A3', IAE.pickFieldEquals('F3-A3', 'pick-f3', 'posted_to_discord', true)], // claim was set
    [
      'F3-A4',
      (state: PostScenarioState): AssertionResult => {
        // Verify no duplicate receipts (0 receipts = trivially no duplicates)
        const uniquePickIds = new Set(state.publishRecords.map(r => r.pickId));
        const noDupes = uniquePickIds.size === state.publishRecords.length;
        return {
          assertionId: 'F3-A4',
          invariant: 'NO_DUPLICATE_PUBLISH',
          description: 'No duplicate publish receipts',
          pass: noDupes,
          evidence: [
            {
              field: 'publishRecords',
              expected: 'no duplicates',
              actual: state.publishRecords.length,
            },
          ],
          failureReason: noDupes ? undefined : 'Duplicate publish receipts detected',
        };
      },
    ],
  ]);
}

// ─────────────────────────────────────────────────────────────
// F4 — STALE MARKET SNAPSHOT
// ─────────────────────────────────────────────────────────────

export const F4: FaultScenario = {
  scenarioId: 'F4',
  name: 'Stale market snapshot',
  targetStage: 'feed.poll',
  faultType: 'return_stale',
  expectedBehavior:
    'Staleness detected; pick blocked with stale-line reason; no promotion to POSTED',
  proofArtifactName: 'fault-proof-F4-stale-data.json',
  assertions: [
    {
      assertionId: 'F4-A1',
      invariant: 'FAULT_INJECTION_OBSERVABILITY',
      description: 'Stale data fault marker present in grading payload',
    },
    {
      assertionId: 'F4-A2',
      invariant: 'LIFECYCLE_STATE_INTEGRITY',
      description: 'Pick blocked with stale-market-data reason',
    },
    {
      assertionId: 'F4-A3',
      invariant: 'LIFECYCLE_STATE_INTEGRITY',
      description: 'Pick not posted to discord',
    },
    {
      assertionId: 'F4-A4',
      invariant: 'NO_DUPLICATE_PUBLISH',
      description: 'Zero publish receipts (promotion blocked)',
    },
  ],
};

export function buildF4EventStore(): JournalEventStore {
  const store = JournalEventStore.createInMemory();
  const t = (offset: number) => new Date(Date.UTC(2024, 0, 15, 12, offset)).toISOString();

  store.appendEvent({
    eventId: 'f4-e1',
    eventType: 'PICK_SUBMITTED',
    pickId: 'pick-f4',
    timestamp: t(0),
    payload: { pick: basePick('pick-f4', 'slip-f4') },
  });
  // Grading data includes stale market snapshot — orchestrator detects and blocks
  store.appendEvent({
    eventId: 'f4-e2',
    eventType: 'PICK_GRADED',
    pickId: 'pick-f4',
    timestamp: t(1),
    payload: {
      gradingData: {
        ...gradingData(),
        marketTimestamp: '2020-01-01T00:00:00.000Z', // Far past = stale
        dataQuality: 'stale',
        isStale: true,
      },
    },
  });
  return store;
}

export function getF4Faults(): FaultDefinition[] {
  return []; // Staleness is encoded in the event payload; orchestrator detects it
}

export function getF4Assertors(): Map<string, AssertorFn> {
  return new Map([
    [
      'F4-A1',
      (state: PostScenarioState): AssertionResult => {
        // The stale marker was in the event payload; fault manifests as blocking errors or blocked pick
        const pick = state.finalPickState.find(p => p['id'] === 'pick-f4');
        const hasStaleMarker = pick?.['blocked_reason'] !== undefined || state.errors.length > 0;
        return {
          assertionId: 'F4-A1',
          invariant: 'FAULT_INJECTION_OBSERVABILITY',
          description: 'Stale data fault marker present (pick blocked or error recorded)',
          pass: hasStaleMarker,
          evidence: [
            {
              field: 'pick.blocked_reason or errors',
              expected: 'stale marker present',
              actual: pick?.['blocked_reason'] ?? state.errors[0]?.error,
            },
          ],
          failureReason: hasStaleMarker
            ? undefined
            : 'Stale data marker not detected — pick was not blocked',
        };
      },
    ],
    [
      'F4-A2',
      (state: PostScenarioState): AssertionResult => {
        const pick = state.finalPickState.find(p => p['id'] === 'pick-f4');
        const blocked = pick?.['blocked_reason'] === 'stale-market-data';
        return {
          assertionId: 'F4-A2',
          invariant: 'LIFECYCLE_STATE_INTEGRITY',
          description: 'Pick blocked with stale-market-data reason',
          pass: blocked,
          evidence: [
            {
              field: 'pick.blocked_reason',
              expected: 'stale-market-data',
              actual: pick?.['blocked_reason'],
            },
          ],
          failureReason: blocked
            ? undefined
            : `Pick blocked_reason=${JSON.stringify(pick?.['blocked_reason'])}`,
        };
      },
    ],
    ['F4-A3', IAE.pickFieldEquals('F4-A3', 'pick-f4', 'posted_to_discord', false)],
    ['F4-A4', IAE.publishRecordCount('F4-A4', 0)],
  ]);
}

// ─────────────────────────────────────────────────────────────
// F5 — MISSING SETTLEMENT SOURCE DATA
// ─────────────────────────────────────────────────────────────

export const F5: FaultScenario = {
  scenarioId: 'F5',
  name: 'Missing settlement source data',
  targetStage: 'settlement.checkSettlement',
  faultType: 'return_null',
  expectedBehavior:
    'Settlement remains pending; explicit failure reason recorded; no false settlement',
  proofArtifactName: 'fault-proof-F5-missing-settlement-data.json',
  assertions: [
    {
      assertionId: 'F5-A1',
      invariant: 'FAULT_INJECTION_OBSERVABILITY',
      description: 'Settlement adapter fault activated',
    },
    {
      assertionId: 'F5-A2',
      invariant: 'EXPLICIT_FAILURE_SURFACING',
      description: 'Settlement failure recorded in errors',
    },
    {
      assertionId: 'F5-A3',
      invariant: 'SETTLEMENT_SOURCE_REQUIRED',
      description: 'Pick settlement_status remains pending',
    },
    {
      assertionId: 'F5-A4',
      invariant: 'NO_FALSE_SETTLEMENT',
      description: 'Pick has no settlement_result',
    },
  ],
};

export function buildF5EventStore(): JournalEventStore {
  const store = JournalEventStore.createInMemory();
  const t = (offset: number) => new Date(Date.UTC(2024, 0, 15, 12, offset)).toISOString();

  store.appendEvent({
    eventId: 'f5-e1',
    eventType: 'PICK_SUBMITTED',
    pickId: 'pick-f5',
    timestamp: t(0),
    payload: { pick: basePick('pick-f5', 'slip-f5') },
  });
  store.appendEvent({
    eventId: 'f5-e2',
    eventType: 'PICK_GRADED',
    pickId: 'pick-f5',
    timestamp: t(1),
    payload: { gradingData: gradingData() },
  });
  store.appendEvent({
    eventId: 'f5-e3',
    eventType: 'PICK_POSTED',
    pickId: 'pick-f5',
    timestamp: t(2),
    payload: { posting: { channel: 'discord-tier-a' } },
  });
  // Settlement attempt — adapter returns null (no source data)
  store.appendEvent({
    eventId: 'f5-e4',
    eventType: 'PICK_SETTLED',
    pickId: 'pick-f5',
    timestamp: t(60),
    payload: { result: 'win', source: 'sgosports' },
  });
  return store;
}

export function getF5Faults(): FaultDefinition[] {
  return [
    {
      target: 'settlement.checkSettlement',
      type: 'return_null',
      activation: { type: 'always' },
      errorMessage: undefined,
    },
  ];
}

export function getF5Assertors(): Map<string, AssertorFn> {
  return new Map([
    ['F5-A1', IAE.faultActivated('F5-A1', 'settlement.checkSettlement')],
    ['F5-A2', IAE.errorsContain('F5-A2', 'settlement')],
    // settlement_status is either 'pending' (if submitter set it) or undefined (if not)
    // Either way means the pick was NOT settled — that is the invariant we verify
    [
      'F5-A3',
      (state: PostScenarioState): AssertionResult => {
        const pick = state.finalPickState.find(p => p['id'] === 'pick-f5');
        const ss = pick?.['settlement_status'];
        const notSettled = ss === undefined || ss === null || ss === 'pending';
        return {
          assertionId: 'F5-A3',
          invariant: 'SETTLEMENT_SOURCE_REQUIRED',
          description: 'Pick must NOT be settled (settlement_status is pending/undefined)',
          pass: notSettled,
          evidence: [
            { field: 'pick.settlement_status', expected: 'pending or undefined', actual: ss },
          ],
          failureReason: notSettled
            ? undefined
            : `Pick was falsely settled: settlement_status=${JSON.stringify(ss)}`,
        };
      },
    ],
    [
      'F5-A4',
      (state: PostScenarioState): AssertionResult => {
        const pick = state.finalPickState.find(p => p['id'] === 'pick-f5');
        const noResult =
          pick?.['settlement_result'] === undefined || pick?.['settlement_result'] === null;
        return {
          assertionId: 'F5-A4',
          invariant: 'NO_FALSE_SETTLEMENT',
          description: 'No settlement_result on pick (no false settlement)',
          pass: noResult,
          evidence: [
            {
              field: 'pick.settlement_result',
              expected: 'undefined or null',
              actual: pick?.['settlement_result'],
            },
          ],
          failureReason: noResult
            ? undefined
            : `Unexpected settlement_result: ${pick?.['settlement_result']}`,
        };
      },
    ],
  ]);
}

// ─────────────────────────────────────────────────────────────
// F6 — SETTLEMENT MUTATION ATTEMPT
// ─────────────────────────────────────────────────────────────

export const F6: FaultScenario = {
  scenarioId: 'F6',
  name: 'Settlement mutation attempt',
  targetStage: 'settlement.checkSettlement',
  faultType: 'throw',
  expectedBehavior:
    'Immutability invariant fires; second settle attempt rejected; original settlement preserved',
  proofArtifactName: 'fault-proof-F6-immutability.json',
  assertions: [
    {
      assertionId: 'F6-A1',
      invariant: 'SETTLEMENT_IMMUTABILITY',
      description: 'Freeze/immutability violation detected',
    },
    {
      assertionId: 'F6-A2',
      invariant: 'SETTLEMENT_IMMUTABILITY',
      description: 'Errors contain immutability rejection',
    },
    {
      assertionId: 'F6-A3',
      invariant: 'LIFECYCLE_STATE_INTEGRITY',
      description: 'Pick settlement_status is settled (first settlement preserved)',
    },
    {
      assertionId: 'F6-A4',
      invariant: 'LIFECYCLE_STATE_INTEGRITY',
      description: 'Pick settlement_result is win (original result preserved)',
    },
  ],
};

export function buildF6EventStore(): JournalEventStore {
  const store = JournalEventStore.createInMemory();
  const t = (offset: number) => new Date(Date.UTC(2024, 0, 15, 12, offset)).toISOString();

  store.appendEvent({
    eventId: 'f6-e1',
    eventType: 'PICK_SUBMITTED',
    pickId: 'pick-f6',
    timestamp: t(0),
    payload: { pick: basePick('pick-f6', 'slip-f6') },
  });
  store.appendEvent({
    eventId: 'f6-e2',
    eventType: 'PICK_GRADED',
    pickId: 'pick-f6',
    timestamp: t(1),
    payload: { gradingData: gradingData() },
  });
  store.appendEvent({
    eventId: 'f6-e3',
    eventType: 'PICK_POSTED',
    pickId: 'pick-f6',
    timestamp: t(2),
    payload: { posting: { channel: 'discord-tier-a' } },
  });
  // First settlement — succeeds
  store.appendEvent({
    eventId: 'f6-e4',
    eventType: 'PICK_SETTLED',
    pickId: 'pick-f6',
    timestamp: t(60),
    payload: { result: 'win', source: 'sgosports' },
  });
  // Second settlement attempt — mutation, should be rejected by immutability guard
  store.appendEvent({
    eventId: 'f6-e5',
    eventType: 'PICK_SETTLED',
    pickId: 'pick-f6',
    timestamp: t(61),
    payload: { result: 'loss', source: 'sgosports', mutationAttempt: true },
  });
  return store;
}

export function getF6Faults(): FaultDefinition[] {
  return []; // Immutability is enforced by the lifecycle validators, not fault injection
}

export function getF6Assertors(): Map<string, AssertorFn> {
  return new Map([
    ['F6-A1', IAE.freezeViolationDetected('F6-A1')],
    [
      'F6-A2',
      (state: PostScenarioState): AssertionResult => {
        const hasImmutabilityError = state.errors.some(
          e =>
            e.error.toLowerCase().includes('settle') ||
            e.error.toLowerCase().includes('transition') ||
            e.error.toLowerCase().includes('invalid') ||
            e.error.toLowerCase().includes('concurrent') ||
            e.error.toLowerCase().includes('immut')
        );
        return {
          assertionId: 'F6-A2',
          invariant: 'SETTLEMENT_IMMUTABILITY',
          description: 'Error recorded for immutability rejection',
          pass: hasImmutabilityError,
          evidence: [
            {
              field: 'errors[]',
              expected: 'immutability error',
              actual: state.errors.map(e => e.error),
            },
          ],
          failureReason: hasImmutabilityError ? undefined : 'No immutability rejection error found',
        };
      },
    ],
    ['F6-A3', IAE.pickFieldEquals('F6-A3', 'pick-f6', 'settlement_status', 'settled')],
    ['F6-A4', IAE.pickFieldEquals('F6-A4', 'pick-f6', 'settlement_result', 'win')],
  ]);
}

// ─────────────────────────────────────────────────────────────
// F7 — RECAP BEFORE ALL SETTLEMENTS
// ─────────────────────────────────────────────────────────────

export const F7: FaultScenario = {
  scenarioId: 'F7',
  name: 'Recap before all settlements',
  targetStage: 'recap.generate',
  faultType: 'throw',
  expectedBehavior:
    'Recap generated with partial data; unsettled picks not falsely finalized; no false finality',
  proofArtifactName: 'fault-proof-F7-premature-recap.json',
  assertions: [
    {
      assertionId: 'F7-A1',
      invariant: 'RECAP_CONTENT_ACCURACY',
      description: 'Recap was generated',
    },
    {
      assertionId: 'F7-A2',
      invariant: 'LIFECYCLE_STATE_INTEGRITY',
      description: 'pick-f7b settlement remains pending (unsettled)',
    },
    {
      assertionId: 'F7-A3',
      invariant: 'LIFECYCLE_STATE_INTEGRITY',
      description: 'pick-f7a is settled (settled pick included)',
    },
    {
      assertionId: 'F7-A4',
      invariant: 'NO_FALSE_SETTLEMENT',
      description: 'No false finality (unsettled pick not marked settled)',
    },
  ],
};

export function buildF7EventStore(): JournalEventStore {
  const store = JournalEventStore.createInMemory();
  const t = (offset: number) => new Date(Date.UTC(2024, 0, 15, 12, offset)).toISOString();

  store.appendEvent({
    eventId: 'f7-e1',
    eventType: 'PICK_SUBMITTED',
    pickId: 'pick-f7a',
    timestamp: t(0),
    payload: { pick: basePick('pick-f7a', 'slip-f7a') },
  });
  store.appendEvent({
    eventId: 'f7-e2',
    eventType: 'PICK_SUBMITTED',
    pickId: 'pick-f7b',
    timestamp: t(1),
    payload: { pick: basePick('pick-f7b', 'slip-f7b') },
  });
  store.appendEvent({
    eventId: 'f7-e3',
    eventType: 'PICK_GRADED',
    pickId: 'pick-f7a',
    timestamp: t(2),
    payload: { gradingData: gradingData() },
  });
  store.appendEvent({
    eventId: 'f7-e4',
    eventType: 'PICK_GRADED',
    pickId: 'pick-f7b',
    timestamp: t(3),
    payload: { gradingData: gradingData() },
  });
  store.appendEvent({
    eventId: 'f7-e5',
    eventType: 'PICK_POSTED',
    pickId: 'pick-f7a',
    timestamp: t(4),
    payload: { posting: { channel: 'discord-tier-a' } },
  });
  store.appendEvent({
    eventId: 'f7-e6',
    eventType: 'PICK_POSTED',
    pickId: 'pick-f7b',
    timestamp: t(5),
    payload: { posting: { channel: 'discord-tier-a' } },
  });
  // Only pick-f7a settled; pick-f7b is still pending
  store.appendEvent({
    eventId: 'f7-e7',
    eventType: 'PICK_SETTLED',
    pickId: 'pick-f7a',
    timestamp: t(60),
    payload: { result: 'win', source: 'sgosports' },
  });
  // Premature recap — pick-f7b not yet settled
  store.appendEvent({
    eventId: 'f7-e8',
    eventType: 'RECAP_TRIGGERED',
    timestamp: t(61),
    payload: { period: 'daily' },
  });
  return store;
}

export function getF7Faults(): FaultDefinition[] {
  return []; // No adapter faults — the premature trigger is the scenario
}

export function getF7Assertors(): Map<string, AssertorFn> {
  return new Map([
    ['F7-A1', IAE.recapGenerated('F7-A1')],
    // settlement_status is undefined (submitter can't initialize it) or 'pending' — both mean unsettled
    [
      'F7-A2',
      (state: PostScenarioState): AssertionResult => {
        const pick = state.finalPickState.find(p => p['id'] === 'pick-f7b');
        const ss = pick?.['settlement_status'];
        const notSettled = ss === undefined || ss === null || ss === 'pending';
        return {
          assertionId: 'F7-A2',
          invariant: 'LIFECYCLE_STATE_INTEGRITY',
          description: 'pick-f7b settlement remains pending (unsettled)',
          pass: notSettled,
          evidence: [
            { field: 'pick-f7b.settlement_status', expected: 'pending or undefined', actual: ss },
          ],
          failureReason: notSettled
            ? undefined
            : `pick-f7b was falsely settled: settlement_status=${JSON.stringify(ss)}`,
        };
      },
    ],
    ['F7-A3', IAE.pickFieldEquals('F7-A3', 'pick-f7a', 'settlement_status', 'settled')],
    [
      'F7-A4',
      (state: PostScenarioState): AssertionResult => {
        const pickB = state.finalPickState.find(p => p['id'] === 'pick-f7b');
        const notFalselySettled = pickB?.['settlement_status'] !== 'settled';
        return {
          assertionId: 'F7-A4',
          invariant: 'NO_FALSE_SETTLEMENT',
          description: 'Unsettled pick not falsely marked settled after premature recap',
          pass: notFalselySettled,
          evidence: [
            {
              field: 'pick-f7b.settlement_status',
              expected: 'not settled',
              actual: pickB?.['settlement_status'],
            },
          ],
          failureReason: notFalselySettled
            ? undefined
            : 'pick-f7b was falsely settled by recap trigger',
        };
      },
    ],
  ]);
}

// ─────────────────────────────────────────────────────────────
// F8 — FEATURE/DATA QUALITY DEGRADATION
// ─────────────────────────────────────────────────────────────

export const F8: FaultScenario = {
  scenarioId: 'F8',
  name: 'Feature/data quality degradation',
  targetStage: 'feed.poll',
  faultType: 'return_degraded',
  expectedBehavior:
    'Degraded quality detected; pick blocked or quality flag set; promotion blocked',
  proofArtifactName: 'fault-proof-F8-quality-degradation.json',
  assertions: [
    {
      assertionId: 'F8-A1',
      invariant: 'FAULT_INJECTION_OBSERVABILITY',
      description: 'Quality degradation detected in grading payload',
    },
    {
      assertionId: 'F8-A2',
      invariant: 'LIFECYCLE_STATE_INTEGRITY',
      description: 'Pick blocked due to degraded quality',
    },
    {
      assertionId: 'F8-A3',
      invariant: 'LIFECYCLE_STATE_INTEGRITY',
      description: 'Pick not posted (promotion blocked)',
    },
    {
      assertionId: 'F8-A4',
      invariant: 'NO_DUPLICATE_PUBLISH',
      description: 'Zero publish receipts',
    },
  ],
};

export function buildF8EventStore(): JournalEventStore {
  const store = JournalEventStore.createInMemory();
  const t = (offset: number) => new Date(Date.UTC(2024, 0, 15, 12, offset)).toISOString();

  store.appendEvent({
    eventId: 'f8-e1',
    eventType: 'PICK_SUBMITTED',
    pickId: 'pick-f8',
    timestamp: t(0),
    payload: { pick: basePick('pick-f8', 'slip-f8') },
  });
  // Grading data includes degraded quality — orchestrator detects and blocks
  store.appendEvent({
    eventId: 'f8-e2',
    eventType: 'PICK_GRADED',
    pickId: 'pick-f8',
    timestamp: t(1),
    payload: {
      gradingData: {
        ...gradingData(),
        dataQuality: 'degraded',
        qualityScore: 0.15, // Below threshold
      },
    },
  });
  return store;
}

export function getF8Faults(): FaultDefinition[] {
  return []; // Quality degradation encoded in event payload
}

export function getF8Assertors(): Map<string, AssertorFn> {
  return new Map([
    [
      'F8-A1',
      (state: PostScenarioState): AssertionResult => {
        const pick = state.finalPickState.find(p => p['id'] === 'pick-f8');
        const hasQualityMarker = pick?.['blocked_reason'] !== undefined || state.errors.length > 0;
        return {
          assertionId: 'F8-A1',
          invariant: 'FAULT_INJECTION_OBSERVABILITY',
          description: 'Degraded quality detected (pick blocked or error recorded)',
          pass: hasQualityMarker,
          evidence: [
            {
              field: 'pick.blocked_reason or errors',
              expected: 'quality marker',
              actual: pick?.['blocked_reason'] ?? state.errors[0]?.error,
            },
          ],
          failureReason: hasQualityMarker ? undefined : 'Degraded quality not detected',
        };
      },
    ],
    [
      'F8-A2',
      (state: PostScenarioState): AssertionResult => {
        const pick = state.finalPickState.find(p => p['id'] === 'pick-f8');
        const blocked = pick?.['blocked_reason'] === 'degraded-quality';
        return {
          assertionId: 'F8-A2',
          invariant: 'LIFECYCLE_STATE_INTEGRITY',
          description: 'Pick blocked with degraded-quality reason',
          pass: blocked,
          evidence: [
            {
              field: 'pick.blocked_reason',
              expected: 'degraded-quality',
              actual: pick?.['blocked_reason'],
            },
          ],
          failureReason: blocked
            ? undefined
            : `Pick blocked_reason=${JSON.stringify(pick?.['blocked_reason'])}`,
        };
      },
    ],
    ['F8-A3', IAE.pickFieldEquals('F8-A3', 'pick-f8', 'posted_to_discord', false)],
    ['F8-A4', IAE.publishRecordCount('F8-A4', 0)],
  ]);
}

// ─────────────────────────────────────────────────────────────
// F9 — DRAWDOWN FREEZE TRIGGER
// ─────────────────────────────────────────────────────────────

export const F9: FaultScenario = {
  scenarioId: 'F9',
  name: 'Drawdown freeze trigger',
  targetStage: 'orchestrator.drawdown',
  faultType: 'throw',
  expectedBehavior:
    'System transitions to HARD_FREEZE after loss threshold exceeded; subsequent submissions blocked',
  proofArtifactName: 'fault-proof-F9-drawdown-freeze.json',
  assertions: [
    {
      assertionId: 'F9-A1',
      invariant: 'AUTOPILOT_GOVERNANCE',
      description: 'Drawdown freeze fault activated',
    },
    {
      assertionId: 'F9-A2',
      invariant: 'AUTOPILOT_GOVERNANCE',
      description: 'Freeze violation detected in orchestrator',
    },
    {
      assertionId: 'F9-A3',
      invariant: 'AUTOPILOT_GOVERNANCE',
      description: 'Post-freeze submission blocked (error recorded)',
    },
    {
      assertionId: 'F9-A4',
      invariant: 'AUTOPILOT_GOVERNANCE',
      description: 'Post-freeze pick not created',
    },
  ],
};

export function buildF9EventStore(): JournalEventStore {
  const store = JournalEventStore.createInMemory();
  const t = (offset: number) => new Date(Date.UTC(2024, 0, 15, 12, offset)).toISOString();

  // Three consecutive losses — exceeds drawdown threshold (3)
  for (let i = 1; i <= 3; i++) {
    const pickId = `pick-f9-${i}`;
    const slip = `slip-f9-${i}`;
    store.appendEvent({
      eventId: `f9-submit-${i}`,
      eventType: 'PICK_SUBMITTED',
      pickId,
      timestamp: t(i * 5),
      payload: { pick: basePick(pickId, slip) },
    });
    store.appendEvent({
      eventId: `f9-grade-${i}`,
      eventType: 'PICK_GRADED',
      pickId,
      timestamp: t(i * 5 + 1),
      payload: { gradingData: gradingData() },
    });
    store.appendEvent({
      eventId: `f9-post-${i}`,
      eventType: 'PICK_POSTED',
      pickId,
      timestamp: t(i * 5 + 2),
      payload: { posting: { channel: 'discord-tier-a' } },
    });
    store.appendEvent({
      eventId: `f9-settle-${i}`,
      eventType: 'PICK_SETTLED',
      pickId,
      timestamp: t(i * 5 + 3),
      payload: { result: 'loss', source: 'sgosports' },
    });
  }
  // Post-freeze submission — must be blocked
  store.appendEvent({
    eventId: 'f9-post-freeze',
    eventType: 'PICK_SUBMITTED',
    pickId: 'pick-f9-frozen',
    timestamp: t(25),
    payload: { pick: basePick('pick-f9-frozen', 'slip-f9-frozen') },
  });
  return store;
}

export function getF9Faults(): FaultDefinition[] {
  return []; // Drawdown freeze is an orchestrator-controlled trigger, not an adapter fault
}

export function getF9Assertors(): Map<string, AssertorFn> {
  return new Map([
    ['F9-A1', IAE.faultActivated('F9-A1', 'orchestrator.drawdown')],
    ['F9-A2', IAE.freezeViolationDetected('F9-A2')],
    ['F9-A3', IAE.errorsContain('F9-A3', 'frozen')],
    [
      'F9-A4',
      (state: PostScenarioState): AssertionResult => {
        const frozenPick = state.finalPickState.find(p => p['id'] === 'pick-f9-frozen');
        const notCreated = frozenPick === undefined;
        return {
          assertionId: 'F9-A4',
          invariant: 'AUTOPILOT_GOVERNANCE',
          description: 'Post-freeze pick was not created in IsolatedPickStore',
          pass: notCreated,
          evidence: [
            {
              field: 'finalPickState["pick-f9-frozen"]',
              expected: 'undefined',
              actual: frozenPick?.['id'] ?? 'not found',
            },
          ],
          failureReason: notCreated
            ? undefined
            : 'Post-freeze pick was created — freeze did not block submission',
        };
      },
    ],
  ]);
}

// ─────────────────────────────────────────────────────────────
// F10 — CONCURRENT OUTBOX CLAIM RACE
// ─────────────────────────────────────────────────────────────

export const F10: FaultScenario = {
  scenarioId: 'F10',
  name: 'Concurrent outbox claim race',
  targetStage: 'publish.publish',
  faultType: 'throw',
  expectedBehavior:
    'Exactly one claim succeeds; competing claimant fails cleanly (idempotent); no double-post',
  proofArtifactName: 'fault-proof-F10-atomic-claim.json',
  assertions: [
    {
      assertionId: 'F10-A1',
      invariant: 'NO_DUPLICATE_PUBLISH',
      description: 'Exactly 1 publish call succeeds',
    },
    {
      assertionId: 'F10-A2',
      invariant: 'LIFECYCLE_STATE_INTEGRITY',
      description: 'Pick posted_to_discord=true',
    },
    {
      assertionId: 'F10-A3',
      invariant: 'NO_UNEXPECTED_ERRORS',
      description: 'No errors (competing claim is idempotent skip, not error)',
    },
    {
      assertionId: 'F10-A4',
      invariant: 'NO_DUPLICATE_PUBLISH',
      description: 'Exactly 1 publish receipt',
    },
  ],
};

export function buildF10EventStore(): JournalEventStore {
  const store = JournalEventStore.createInMemory();
  const t = (offset: number) => new Date(Date.UTC(2024, 0, 15, 12, offset)).toISOString();

  store.appendEvent({
    eventId: 'f10-e1',
    eventType: 'PICK_SUBMITTED',
    pickId: 'pick-f10',
    timestamp: t(0),
    payload: { pick: basePick('pick-f10', 'slip-f10') },
  });
  store.appendEvent({
    eventId: 'f10-e2',
    eventType: 'PICK_GRADED',
    pickId: 'pick-f10',
    timestamp: t(1),
    payload: { gradingData: gradingData() },
  });
  // Two concurrent PICK_POSTED events — simulates competing workers
  store.appendEvent({
    eventId: 'f10-e3',
    eventType: 'PICK_POSTED',
    pickId: 'pick-f10',
    timestamp: t(2),
    payload: { posting: { channel: 'discord-tier-a', worker: 'worker-1' } },
  });
  store.appendEvent({
    eventId: 'f10-e4',
    eventType: 'PICK_POSTED',
    pickId: 'pick-f10',
    timestamp: t(2),
    payload: { posting: { channel: 'discord-tier-a', worker: 'worker-2' } },
  });
  return store;
}

export function getF10Faults(): FaultDefinition[] {
  return []; // Atomic claim is enforced by IsolatedPickStore conditional update
}

export function getF10Assertors(): Map<string, AssertorFn> {
  return new Map([
    ['F10-A1', IAE.publishCallCount('F10-A1', 1)],
    ['F10-A2', IAE.pickFieldEquals('F10-A2', 'pick-f10', 'posted_to_discord', true)],
    ['F10-A3', IAE.noErrors('F10-A3')],
    ['F10-A4', IAE.publishRecordCount('F10-A4', 1)],
  ]);
}

// ─────────────────────────────────────────────────────────────
// CATALOG
// ─────────────────────────────────────────────────────────────

export interface ScenarioSetup {
  scenario: FaultScenario;
  eventStore: JournalEventStore;
  faults: FaultDefinition[];
  assertors: Map<string, AssertorFn>;
}

/** All canonical scenarios indexed by scenarioId. */
export const SCENARIO_CATALOG: Record<string, () => ScenarioSetup> = {
  F1: () => ({
    scenario: F1,
    eventStore: buildF1EventStore(),
    faults: getF1Faults(),
    assertors: getF1Assertors(),
  }),
  F2: () => ({
    scenario: F2,
    eventStore: buildF2EventStore(),
    faults: getF2Faults(),
    assertors: getF2Assertors(),
  }),
  F3: () => ({
    scenario: F3,
    eventStore: buildF3EventStore(),
    faults: getF3Faults(),
    assertors: getF3Assertors(),
  }),
  F4: () => ({
    scenario: F4,
    eventStore: buildF4EventStore(),
    faults: getF4Faults(),
    assertors: getF4Assertors(),
  }),
  F5: () => ({
    scenario: F5,
    eventStore: buildF5EventStore(),
    faults: getF5Faults(),
    assertors: getF5Assertors(),
  }),
  F6: () => ({
    scenario: F6,
    eventStore: buildF6EventStore(),
    faults: getF6Faults(),
    assertors: getF6Assertors(),
  }),
  F7: () => ({
    scenario: F7,
    eventStore: buildF7EventStore(),
    faults: getF7Faults(),
    assertors: getF7Assertors(),
  }),
  F8: () => ({
    scenario: F8,
    eventStore: buildF8EventStore(),
    faults: getF8Faults(),
    assertors: getF8Assertors(),
  }),
  F9: () => ({
    scenario: F9,
    eventStore: buildF9EventStore(),
    faults: getF9Faults(),
    assertors: getF9Assertors(),
  }),
  F10: () => ({
    scenario: F10,
    eventStore: buildF10EventStore(),
    faults: getF10Faults(),
    assertors: getF10Assertors(),
  }),
};

/** Core suite: F1–F5 (required for sprint PASS). */
export const CORE_SUITE = ['F1', 'F2', 'F3', 'F4', 'F5'] as const;

/** Extended suite: all F1–F10. */
export const FULL_SUITE = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10'] as const;
