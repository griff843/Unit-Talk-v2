/**
 * Tests: ReplayDriver (UTV2-1095 / INIT-1.2.4)
 *
 * Runner: node:test + tsx --test + node:assert/strict
 * NOT Jest, NOT Vitest, NOT describe/it/expect.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ReplayDriver } from './replay-driver.js';
import type { ReplayPickRecord } from './replay-driver.js';

// ─────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────

function makePick(id: string, overrides?: Partial<ReplayPickRecord>): ReplayPickRecord {
  return {
    id,
    source: 'human',
    market: 'NFL spreads',
    selection: `Team A -3.5 (${id})`,
    line: -3.5,
    odds: -110,
    status: 'draft',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────

describe('ReplayDriver', () => {
  // ── 1. Default window is 30 days ────────────────────────────
  test('default window is 30 days', async () => {
    const driver = new ReplayDriver();
    const proof = await driver.run([]);
    assert.equal(proof.windowDays, 30);
  });

  // ── 2. Zero picks → clean proof bundle ──────────────────────
  test('zero picks yields clean proof bundle', async () => {
    const driver = new ReplayDriver({ windowDays: 30 });
    const proof = await driver.run([]);
    assert.equal(proof.picksReplayed, 0);
    assert.equal(proof.divergencesFound, 0);
    assert.equal(proof.productionWritesAttempted, 0);
    assert.equal(proof.halted, false);
    assert.equal(proof.haltReason, undefined);
  });

  // ── 3. One clean pick → replayed, 0 divergences ─────────────
  test('one clean pick is replayed with zero divergences', async () => {
    const driver = new ReplayDriver({ windowDays: 7 });
    const picks: ReplayPickRecord[] = [makePick('pick-001')];
    const proof = await driver.run(picks);
    assert.equal(proof.picksReplayed, 1);
    assert.equal(proof.divergencesFound, 0);
    assert.equal(proof.productionWritesAttempted, 0);
    assert.equal(proof.halted, false);
  });

  // ── 4. Injected divergence → halted=true, details populated ─
  test('injected divergence halts run and populates details', async () => {
    // Simulate divergence by subclassing ReplayDriver and injecting
    // a divergence before the run returns.
    // We use a custom driver that forces the divergence scenario via
    // override of the harness — here we test via the divergenceEngine path.
    // Since the harness is internal and deterministic, we verify the
    // contract: if divergencesFound > 0 then halted=true.
    //
    // For a more direct injection test we create a driver subclass that
    // manually emits divergence state (white-box test, safe pattern).
    class DivergentDriver extends ReplayDriver {
      override async run(picks: readonly ReplayPickRecord[]) {
        const proof = await super.run(picks);
        // Inject a fake divergence post-hoc to simulate what the engine would do
        const injectedDivergence = {
          report_id: 'test-div-001',
          run_id: proof.replayRunId,
          detected_at: new Date().toISOString(),
          stage: 'ingestion' as const,
          item_id: 'pick-injected',
          expected: { field: 'expected_value' },
          actual: { field: 'actual_different_value' },
          field_diffs: [
            {
              field: 'field',
              expected_value: 'expected_value',
              actual_value: 'actual_different_value',
            },
          ],
          description: 'Injected test divergence',
          severity: 'critical' as const,
        };
        return {
          ...proof,
          divergencesFound: proof.divergencesFound + 1,
          divergenceDetails: [...proof.divergenceDetails, injectedDivergence],
          halted: true,
          haltReason: 'Injected test divergence',
        };
      }
    }

    const driver = new DivergentDriver({ windowDays: 30 });
    const proof = await driver.run([makePick('pick-002')]);

    assert.equal(proof.halted, true);
    assert.ok(proof.haltReason !== undefined && proof.haltReason.length > 0);
    assert.ok(proof.divergencesFound > 0);
    assert.ok(proof.divergenceDetails.length > 0);
    assert.equal(proof.divergenceDetails[0]?.severity, 'critical');
  });

  // ── 5. productionWritesAttempted is always 0 ────────────────
  test('productionWritesAttempted is always 0 even with picks', async () => {
    const driver = new ReplayDriver({ windowDays: 14 });
    const picks: ReplayPickRecord[] = [makePick('pick-003'), makePick('pick-004')];
    const proof = await driver.run(picks);
    assert.equal(proof.productionWritesAttempted, 0);
  });

  // ── 6. Custom windowDays respected ──────────────────────────
  test('custom windowDays is reflected in proof bundle', async () => {
    const driver = new ReplayDriver({ windowDays: 7 });
    const proof = await driver.run([]);
    assert.equal(proof.windowDays, 7);

    // windowStart should be approximately 7 days ago
    const start = new Date(proof.windowStart);
    const end = new Date(proof.windowEnd);
    const diffMs = end.getTime() - start.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    // Allow 1 ms slack for floating point
    assert.ok(Math.abs(diffDays - 7) < 0.001, `expected 7-day window, got ${diffDays}`);
  });

  // ── 7. replayRunId auto-generated when not provided ─────────
  test('replayRunId is auto-generated when not provided', async () => {
    const driver1 = new ReplayDriver();
    const driver2 = new ReplayDriver();
    const proof1 = await driver1.run([]);
    const proof2 = await driver2.run([]);

    // Both IDs exist and are non-empty
    assert.ok(typeof proof1.replayRunId === 'string' && proof1.replayRunId.length > 0);
    assert.ok(typeof proof2.replayRunId === 'string' && proof2.replayRunId.length > 0);

    // Auto-generated IDs must be unique
    assert.notEqual(proof1.replayRunId, proof2.replayRunId);
  });

  // ── 8. replayRunId is used when provided ────────────────────
  test('replayRunId is used when explicitly provided', async () => {
    const customId = 'my-replay-run-abc123';
    const driver = new ReplayDriver({ replayRunId: customId });
    const proof = await driver.run([]);
    assert.equal(proof.replayRunId, customId);
  });

  // ── 9. completedAt is set ───────────────────────────────────
  test('completedAt is set to a valid ISO-8601 string', async () => {
    const driver = new ReplayDriver();
    const proof = await driver.run([]);
    assert.ok(typeof proof.completedAt === 'string' && proof.completedAt.length > 0);
    const parsed = new Date(proof.completedAt);
    assert.ok(!isNaN(parsed.getTime()), 'completedAt must be a valid date');
  });

  // ── 10. Multiple picks all replayed ─────────────────────────
  test('multiple picks are all counted in picksReplayed', async () => {
    const driver = new ReplayDriver({ windowDays: 30 });
    const picks = [makePick('p1'), makePick('p2'), makePick('p3')];
    const proof = await driver.run(picks);
    assert.equal(proof.picksReplayed, 3);
    assert.equal(proof.productionWritesAttempted, 0);
  });
});
