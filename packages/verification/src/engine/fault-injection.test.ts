/**
 * R4 FAULT INJECTION GATE
 * UTV2-556 — Operationalize R4 fault injection scenarios.
 *
 * This test exercises the CORE_SUITE (F1-F5) fault scenarios through
 * the FaultOrchestrator, verifying all invariant assertions pass.
 *
 * F1: Duplicate publish attempt (idempotency guard)
 * F2: Worker crash mid-post (recovery / explicit failure surfacing)
 * F3: Settlement conflict (conflicting results, first-write wins)
 * F4: Stale market data at scoring time (staleness guard)
 * F5: Drawdown/consecutive-loss freeze (drawdown monitor)
 *
 * These are the highest-value fault scenarios for the pipeline.
 * F6-F10 are available in the FULL_SUITE for certification lanes.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { VirtualEventClock } from './clock.js';
import { FaultOrchestrator } from './fault/fault-orchestrator.js';
import { SCENARIO_CATALOG, CORE_SUITE } from './fault/scenarios/index.js';

import type { ScenarioSetup } from './fault/scenarios/index.js';

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

async function runScenario(scenarioId: string): Promise<{
  passed: boolean;
  failedAssertions: string[];
  errors: string[];
}> {
  const setupFn = SCENARIO_CATALOG[scenarioId];
  if (!setupFn) throw new Error(`Unknown scenario: ${scenarioId}`);

  const setup: ScenarioSetup = setupFn();
  // Start clock before any scenario events (scenarios use 2024-01-15T12:00:00.000Z+)
  const clock = new VirtualEventClock(new Date('2024-01-15T11:00:00.000Z'));

  const orchestrator = new FaultOrchestrator(
    setup,
    clock,
    `fault-gate-${scenarioId}`
  );

  const result = await orchestrator.run(setup.assertors);

  const failedAssertions = result.assertions
    .filter(a => !a.pass)
    .map(a => `${a.assertionId}: ${a.description} — ${a.failureReason ?? 'failed'}`);

  return {
    passed: failedAssertions.length === 0,
    failedAssertions,
    errors: result.errors.map(e => `${e.eventType}[${e.eventId}]: ${e.error}`),
  };
}

// ─────────────────────────────────────────────────────────────
// TESTS — CORE_SUITE (F1-F5)
// ─────────────────────────────────────────────────────────────

describe('R4 Fault Injection Gate — CORE_SUITE', () => {
  for (const scenarioId of CORE_SUITE) {
    it(`${scenarioId}: all invariant assertions pass`, async () => {
      const result = await runScenario(scenarioId);

      assert.ok(
        result.passed,
        `${scenarioId} failed assertions:\n${result.failedAssertions.join('\n')}`
      );
    });
  }

  it('CORE_SUITE covers F1 through F5', () => {
    assert.deepEqual([...CORE_SUITE], ['F1', 'F2', 'F3', 'F4', 'F5']);
  });

  it('all CORE_SUITE scenarios are defined in SCENARIO_CATALOG', () => {
    for (const id of CORE_SUITE) {
      assert.ok(SCENARIO_CATALOG[id], `${id} must exist in SCENARIO_CATALOG`);
    }
  });

  it('SCENARIO_CATALOG contains all F1-F10', () => {
    for (let i = 1; i <= 10; i++) {
      assert.ok(SCENARIO_CATALOG[`F${i}`], `F${i} must exist in SCENARIO_CATALOG`);
    }
  });
});
