/**
 * R3 SHADOW COMPARISON GATE
 * UTV2-556 — Operationalize R3 shadow comparison.
 *
 * This test makes R3 runnable in a supported path by:
 *   1. Running the same events through both reference and shadow pipelines
 *   2. Verifying CLEAN verdict when inputs are identical
 *   3. Introducing a mutation and verifying divergence detection
 *   4. Checking divergence classification (critical vs informational)
 *
 * Trigger: mandatory for lifecycle/FSM, promotion/scoring, and settlement
 * changes per R1_R5_OPERATING_RULE.md.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { JournalEventStore } from './event-store.js';
import { RealClockProvider } from './clock.js';
import { RecordingPublishAdapter } from './adapters/recording-publish.js';
import { NullNotificationAdapter } from './adapters/null-notification.js';
import { ReplayFeedAdapter } from './adapters/replay-feed.js';
import { ReplaySettlementAdapter } from './adapters/replay-settlement.js';
import { NullRecapAdapter } from './adapters/null-recap.js';
import { ShadowOrchestrator } from './shadow-orchestrator.js';

import type { AdapterManifest } from './adapters.js';

// ─────────────────────────────────────────────────────────────
// INLINE CORPUS — self-contained, no external file dependency
// ─────────────────────────────────────────────────────────────

function buildCorpus(): JournalEventStore {
  const store = JournalEventStore.createInMemory();
  const t = (min: number) => new Date(Date.UTC(2026, 2, 20, 19, min)).toISOString();

  store.appendEvent({ eventId: 'e1', eventType: 'PICK_SUBMITTED', pickId: 'pick-a', timestamp: t(0), payload: { pick: { id: 'pick-a', status: 'validated', market: 'NFL ML', selection: 'Chiefs -3', odds: -110, posted_to_discord: false, promotion_status: null, settlement_status: null } } });
  store.appendEvent({ eventId: 'e2', eventType: 'PICK_GRADED', pickId: 'pick-a', timestamp: t(1), payload: { gradingData: { status: 'queued', promotion_status: 'qualified', promotion_target: 'best-bets' } } });
  store.appendEvent({ eventId: 'e3', eventType: 'PICK_POSTED', pickId: 'pick-a', timestamp: t(2), payload: { posting: { target: 'discord:best-bets' } } });
  store.appendEvent({ eventId: 'e4', eventType: 'PICK_SETTLED', pickId: 'pick-a', timestamp: t(30), payload: { settlement: { result: 'win', source: 'sgo', settledAt: t(30) } } });

  return store;
}

function buildDivergentCorpus(): JournalEventStore {
  const store = JournalEventStore.createInMemory();
  const t = (min: number) => new Date(Date.UTC(2026, 2, 20, 19, min)).toISOString();

  // Shadow has an EXTRA pick that reference doesn't — should produce a divergence
  store.appendEvent({ eventId: 'e1', eventType: 'PICK_SUBMITTED', pickId: 'pick-a', timestamp: t(0), payload: { pick: { id: 'pick-a', status: 'validated', market: 'NFL ML', selection: 'Chiefs -3', odds: -110, posted_to_discord: false, promotion_status: null, settlement_status: null } } });
  store.appendEvent({ eventId: 'e2', eventType: 'PICK_GRADED', pickId: 'pick-a', timestamp: t(1), payload: { gradingData: { status: 'queued', promotion_status: 'qualified', promotion_target: 'best-bets' } } });
  store.appendEvent({ eventId: 'e3', eventType: 'PICK_POSTED', pickId: 'pick-a', timestamp: t(2), payload: { posting: { target: 'discord:best-bets' } } });
  store.appendEvent({ eventId: 'e4', eventType: 'PICK_SETTLED', pickId: 'pick-a', timestamp: t(30), payload: { settlement: { result: 'win', source: 'sgo', settledAt: t(30) } } });
  // Extra pick only in shadow
  store.appendEvent({ eventId: 'e5', eventType: 'PICK_SUBMITTED', pickId: 'pick-extra', timestamp: t(31), payload: { pick: { id: 'pick-extra', status: 'validated', market: 'NBA Total', selection: 'Over 210', odds: -105, posted_to_discord: false, promotion_status: null, settlement_status: null } } });

  return store;
}

function buildAdapters(store: JournalEventStore): AdapterManifest {
  return {
    mode: 'shadow',
    publish: new RecordingPublishAdapter('shadow'),
    notification: new NullNotificationAdapter('shadow'),
    feed: new ReplayFeedAdapter('shadow', store),
    settlement: new ReplaySettlementAdapter('shadow', store),
    recap: new NullRecapAdapter('shadow'),
  };
}

// ─────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────

describe('R3 Shadow Comparison Gate', () => {
  it('identical inputs produce CLEAN verdict with zero divergences', async () => {
    const refStore = buildCorpus();
    const shadowStore = buildCorpus();
    const clock = new RealClockProvider();

    const orchestrator = new ShadowOrchestrator({
      runId: 'shadow-clean-test',
      referenceStore: refStore,
      shadowStore: shadowStore,
      clock,
      referenceAdapters: buildAdapters(refStore),
      shadowAdapters: buildAdapters(shadowStore),
    });

    const result = await orchestrator.run();

    assert.equal(result.mode, 'shadow');
    assert.equal(result.divergenceReport.verdict, 'CLEAN', 'Identical inputs must produce CLEAN verdict');
    assert.equal(result.divergenceReport.totalDivergences, 0, 'No divergences expected');
    assert.ok(result.divergenceReport.passed, 'Report must pass');
    assert.equal(result.referenceErrors.length, 0, 'Reference should have no errors');
    assert.equal(result.shadowErrors.length, 0, 'Shadow should have no errors');
  });

  it('both pipelines process the correct event count', async () => {
    const refStore = buildCorpus();
    const shadowStore = buildCorpus();
    const clock = new RealClockProvider();

    const orchestrator = new ShadowOrchestrator({
      runId: 'shadow-count-test',
      referenceStore: refStore,
      shadowStore: shadowStore,
      clock,
      referenceAdapters: buildAdapters(refStore),
      shadowAdapters: buildAdapters(shadowStore),
    });

    const result = await orchestrator.run();

    assert.equal(result.referenceEventsProcessed, 4);
    assert.equal(result.shadowEventsProcessed, 4);
    assert.equal(result.referencePicksCreated, 1);
    assert.equal(result.shadowPicksCreated, 1);
  });

  it('divergent shadow input produces divergences with correct classification', async () => {
    const refStore = buildCorpus();
    const shadowStore = buildDivergentCorpus();
    const clock = new RealClockProvider();

    const orchestrator = new ShadowOrchestrator({
      runId: 'shadow-divergence-test',
      referenceStore: refStore,
      shadowStore: shadowStore,
      clock,
      referenceAdapters: buildAdapters(refStore),
      shadowAdapters: buildAdapters(shadowStore),
    });

    const result = await orchestrator.run();

    assert.ok(result.divergenceReport.totalDivergences > 0, 'Must detect divergences');
    assert.ok(!result.divergenceReport.passed, 'Report must not pass');
    assert.notEqual(result.divergenceReport.verdict, 'CLEAN', 'Verdict must not be CLEAN');

    // Extra pick in shadow → pick_state divergence (spurious pick)
    const pickStateDivergences = result.divergenceReport.divergences.filter(
      d => d.category === 'pick_state'
    );
    assert.ok(pickStateDivergences.length > 0, 'Should detect pick_state divergences from extra pick in shadow');
  });

  it('divergence report structure is complete and well-formed', async () => {
    const refStore = buildCorpus();
    const shadowStore = buildCorpus();
    const clock = new RealClockProvider();

    const orchestrator = new ShadowOrchestrator({
      runId: 'shadow-structure-test',
      referenceStore: refStore,
      shadowStore: shadowStore,
      clock,
      referenceAdapters: buildAdapters(refStore),
      shadowAdapters: buildAdapters(shadowStore),
    });

    const result = await orchestrator.run();
    const report = result.divergenceReport;

    assert.ok(report.runId);
    assert.ok(report.generatedAt);
    assert.equal(typeof report.referenceEventCount, 'number');
    assert.equal(typeof report.shadowEventCount, 'number');
    assert.ok(report.bySeverity);
    assert.equal(typeof report.bySeverity.critical, 'number');
    assert.equal(typeof report.bySeverity.warning, 'number');
    assert.equal(typeof report.bySeverity.informational, 'number');
    assert.ok(report.byCategory);
    assert.equal(typeof report.passed, 'boolean');
    assert.ok(report.verdict);
    assert.equal(result.runManifest.mode, 'shadow');
  });
});
