/**
 * VERIFICATION & SIMULATION CONTROL PLANE — InvariantAssertionEngine
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R4
 *
 * Post-scenario invariant assertion engine.
 *
 * Responsibilities:
 *   - Run registered assertors against post-scenario system state
 *   - Return per-assertion pass/fail with evidence payload
 *   - Surface invariant failures explicitly — no swallowed failures
 *
 * Each scenario registers assertors by assertionId.
 * The engine matches specs to assertors and executes them.
 */

import type {
  AssertionSpec,
  AssertionResult,
  AssertionEvidence,
  PostScenarioState,
  AssertorFn,
} from './types.js';

export class InvariantAssertionEngine {
  /**
   * Run all assertions for a scenario against the post-run state.
   * Missing assertors produce explicit FAIL results (no silent skips).
   */
  static runAssertions(
    specs: AssertionSpec[],
    state: PostScenarioState,
    assertors: Map<string, AssertorFn>
  ): AssertionResult[] {
    return specs.map(spec => {
      const assertor = assertors.get(spec.assertionId);
      if (!assertor) {
        return {
          assertionId: spec.assertionId,
          invariant: spec.invariant,
          description: spec.description,
          pass: false,
          evidence: [],
          failureReason: `No assertor registered for assertion ID '${spec.assertionId}'`,
        };
      }
      try {
        return assertor(state);
      } catch (err) {
        return {
          assertionId: spec.assertionId,
          invariant: spec.invariant,
          description: spec.description,
          pass: false,
          evidence: [],
          failureReason: `Assertor threw: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  // COMMON ASSERTION BUILDERS
  // ─────────────────────────────────────────────────────────────

  /** Assert: publish() was called exactly N times. */
  static publishCallCount(assertionId: string, expected: number): AssertorFn {
    return state => {
      const actual = state.publishCallCount;
      const pass = actual === expected;
      return {
        assertionId,
        invariant: 'NO_DUPLICATE_PUBLISH',
        description: `publish() must be called exactly ${expected} time(s)`,
        pass,
        evidence: [evidence('publishCallCount', expected, actual)],
        failureReason: pass ? undefined : `Expected ${expected} publish call(s), got ${actual}`,
      };
    };
  }

  /** Assert: the publish receipt list has exactly N entries. */
  static publishRecordCount(assertionId: string, expected: number): AssertorFn {
    return state => {
      const actual = state.publishRecords.length;
      const pass = actual === expected;
      return {
        assertionId,
        invariant: 'NO_DUPLICATE_PUBLISH',
        description: `Exactly ${expected} successful publish receipt(s) must exist`,
        pass,
        evidence: [evidence('publishRecords.length', expected, actual)],
        failureReason: pass ? undefined : `Expected ${expected} receipt(s), got ${actual}`,
      };
    };
  }

  /** Assert: a pick has a specific field value. */
  static pickFieldEquals(
    assertionId: string,
    pickId: string,
    field: string,
    expected: unknown
  ): AssertorFn {
    return state => {
      const pick = state.finalPickState.find(p => p['id'] === pickId);
      if (!pick) {
        return {
          assertionId,
          invariant: 'LIFECYCLE_STATE_INTEGRITY',
          description: `Pick ${pickId}.${field} must equal ${JSON.stringify(expected)}`,
          pass: false,
          evidence: [evidence(field, expected, 'pick not found')],
          failureReason: `Pick ${pickId} not found in final state`,
        };
      }
      const actual = pick[field];
      const pass = actual === expected;
      return {
        assertionId,
        invariant: 'LIFECYCLE_STATE_INTEGRITY',
        description: `Pick ${pickId}.${field} must equal ${JSON.stringify(expected)}`,
        pass,
        evidence: [evidence(field, expected, actual)],
        failureReason: pass
          ? undefined
          : `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      };
    };
  }

  /** Assert: errors array contains at least one entry matching pattern. */
  static errorsContain(assertionId: string, pattern: string): AssertorFn {
    return state => {
      const match = state.errors.some(e => e.error.includes(pattern));
      return {
        assertionId,
        invariant: 'EXPLICIT_FAILURE_SURFACING',
        description: `Errors must contain: "${pattern}"`,
        pass: match,
        evidence: [
          evidence(
            'errors[]',
            `contains "${pattern}"`,
            state.errors.map(e => e.error)
          ),
        ],
        failureReason: match ? undefined : `No error matched pattern "${pattern}"`,
      };
    };
  }

  /** Assert: errors array is empty. */
  static noErrors(assertionId: string): AssertorFn {
    return state => {
      const actual = state.errors.length;
      const pass = actual === 0;
      return {
        assertionId,
        invariant: 'NO_UNEXPECTED_ERRORS',
        description: 'No errors must occur during scenario execution',
        pass,
        evidence: [evidence('errors.length', 0, actual)],
        failureReason: pass
          ? undefined
          : `Expected 0 errors, got ${actual}: ${state.errors.map(e => e.error).join('; ')}`,
      };
    };
  }

  /** Assert: a fault was activated at the given target. */
  static faultActivated(assertionId: string, target: string): AssertorFn {
    return state => {
      const activated = state.activatedFaults.some(f => f.target === target);
      return {
        assertionId,
        invariant: 'FAULT_INJECTION_OBSERVABILITY',
        description: `Fault must have been activated at target: ${target}`,
        pass: activated,
        evidence: [
          evidence(
            'activatedFaults[].target',
            target,
            state.activatedFaults.map(f => f.target)
          ),
        ],
        failureReason: activated ? undefined : `No fault activated at target '${target}'`,
      };
    };
  }

  /** Assert: freeze/immutability violation was detected. */
  static freezeViolationDetected(assertionId: string): AssertorFn {
    return state => ({
      assertionId,
      invariant: 'SETTLEMENT_IMMUTABILITY',
      description: 'A freeze or immutability violation must have been detected',
      pass: state.freezeViolationDetected,
      evidence: [evidence('freezeViolationDetected', true, state.freezeViolationDetected)],
      failureReason: state.freezeViolationDetected ? undefined : 'No freeze violation was detected',
    });
  }

  /** Assert: settlement check was called at least N times. */
  static settlementCheckCallCount(assertionId: string, minCalls: number): AssertorFn {
    return state => {
      const actual = state.settlementCheckCount;
      const pass = actual >= minCalls;
      return {
        assertionId,
        invariant: 'SETTLEMENT_SOURCE_REQUIRED',
        description: `Settlement check must be called at least ${minCalls} time(s)`,
        pass,
        evidence: [evidence('settlementCheckCount', `>= ${minCalls}`, actual)],
        failureReason: pass
          ? undefined
          : `Expected >= ${minCalls} settlement checks, got ${actual}`,
      };
    };
  }

  /** Assert: at least one recap was generated. */
  static recapGenerated(assertionId: string): AssertorFn {
    return state => {
      const actual = state.recapRecords.length;
      const pass = actual >= 1;
      return {
        assertionId,
        invariant: 'RECAP_CONTENT_ACCURACY',
        description: 'At least one recap must have been generated',
        pass,
        evidence: [evidence('recapRecords.length', '>= 1', actual)],
        failureReason: pass ? undefined : 'No recap records found',
      };
    };
  }

  /** Assert: a pick's settlement_status is still 'pending'. */
  static settlementPending(assertionId: string, pickId: string): AssertorFn {
    return InvariantAssertionEngine.pickFieldEquals(
      assertionId,
      pickId,
      'settlement_status',
      'pending'
    );
  }
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function evidence(field: string, expected: unknown, actual: unknown): AssertionEvidence {
  return { field, expected, actual };
}
