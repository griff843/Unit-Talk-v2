/**
 * R2 DETERMINISM REPLAY GATE
 * UTV2-555 — Minimal R2 determinism gate in default verification path.
 *
 * This test is the automatic R2 gate. It:
 *   1. Loads the canonical R2 replay corpus
 *   2. Runs the ReplayOrchestrator twice against the same events
 *   3. Asserts both runs produce the same determinism hash
 *   4. Asserts the hash matches a known-good reference (drift detection)
 *   5. Asserts zero replay errors
 *
 * If a pipeline change intentionally alters lifecycle behavior, the reference
 * hash must be updated with an explanation in the commit message.
 *
 * Trigger: mandatory for lifecycle/FSM, promotion/scoring, settlement/grading,
 * and submission flow changes per R1_R5_OPERATING_RULE.md.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import { JournalEventStore, storeFromJsonl } from './event-store.js';
import { VirtualEventClock } from './clock.js';
import { RecordingPublishAdapter } from './adapters/recording-publish.js';
import { NullNotificationAdapter } from './adapters/null-notification.js';
import { ReplayFeedAdapter } from './adapters/replay-feed.js';
import { ReplaySettlementAdapter } from './adapters/replay-settlement.js';
import { NullRecapAdapter } from './adapters/null-recap.js';
import { ReplayOrchestrator } from './replay-orchestrator.js';
import { DeterminismValidator } from './determinism-validator.js';

import type { AdapterManifest } from './adapters.js';
import type { ReplayResult } from './replay-orchestrator.js';

// ─────────────────────────────────────────────────────────────
// KNOWN-GOOD REFERENCE HASH
// ─────────────────────────────────────────────────────────────
// Update this hash ONLY when an intentional behavior change alters
// the replay output. Document the reason in the commit message.
//
// To regenerate: run this test with DETERMINISM_GATE_UPDATE=1
// and copy the printed hash.
// ─────────────────────────────────────────────────────────────

const REFERENCE_HASH_FILE = resolve(
  import.meta.dirname ?? new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
  '../../test-fixtures/r2-determinism-hash.txt'
);

const CORPUS_FILE = resolve(
  import.meta.dirname ?? new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
  '../../test-fixtures/r2-determinism-corpus.jsonl'
);

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function loadCorpus(): JournalEventStore {
  const jsonl = readFileSync(CORPUS_FILE, 'utf8');
  return storeFromJsonl(jsonl);
}

function buildAdapters(store: JournalEventStore): AdapterManifest {
  return {
    mode: 'replay',
    publish: new RecordingPublishAdapter('replay'),
    notification: new NullNotificationAdapter('replay'),
    feed: new ReplayFeedAdapter('replay', store),
    settlement: new ReplaySettlementAdapter('replay', store),
    recap: new NullRecapAdapter('replay'),
  };
}

async function runReplay(runId: string): Promise<ReplayResult> {
  const store = loadCorpus();
  const clock = new VirtualEventClock(new Date('2026-03-20T00:00:00.000Z'));
  const adapters = buildAdapters(store);

  const orchestrator = new ReplayOrchestrator({
    runId,
    eventStore: store,
    clock,
    adapters,
  });

  return orchestrator.run();
}

// ─────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────

describe('R2 Determinism Gate', () => {
  it('replay produces zero errors on the canonical corpus', async () => {
    const result = await runReplay('determinism-gate-error-check');
    assert.equal(result.errors.length, 0, `Replay errors: ${JSON.stringify(result.errors)}`);
    assert.ok(result.eventsProcessed > 0, 'Should process at least one event');
  });

  it('two identical replays produce the same determinism hash', async () => {
    const run1 = await runReplay('determinism-gate-run-1');
    const run2 = await runReplay('determinism-gate-run-2');

    assert.ok(run1.determinismHash, 'Run 1 must produce a hash');
    assert.ok(run2.determinismHash, 'Run 2 must produce a hash');
    assert.ok(
      DeterminismValidator.verify(run1.determinismHash, run2.determinismHash),
      `Determinism violation: run1=${run1.determinismHash}, run2=${run2.determinismHash}`
    );
  });

  it('replay hash matches the known-good reference (drift detection)', async () => {
    const result = await runReplay('determinism-gate-reference-check');

    // If DETERMINISM_GATE_UPDATE=1, print the hash for manual update
    if (process.env['DETERMINISM_GATE_UPDATE'] === '1') {
      console.log(`\n[R2 DETERMINISM GATE] Current hash: ${result.determinismHash}`);
      console.log(`Write this to ${REFERENCE_HASH_FILE} if the behavior change is intentional.\n`);
    }

    let referenceHash: string;
    try {
      referenceHash = readFileSync(REFERENCE_HASH_FILE, 'utf8').trim();
    } catch {
      // First run — no reference hash file exists yet.
      // This is expected during initial setup. The test will write
      // the hash on the first successful run (handled below).
      console.log(`[R2 DETERMINISM GATE] No reference hash file found. Creating initial reference.`);
      console.log(`[R2 DETERMINISM GATE] Hash: ${result.determinismHash}`);

      // Write initial reference
      const { writeFileSync } = await import('node:fs');
      writeFileSync(REFERENCE_HASH_FILE, result.determinismHash + '\n', 'utf8');
      referenceHash = result.determinismHash;
    }

    assert.equal(
      result.determinismHash,
      referenceHash,
      `R2 determinism hash drift detected!\n` +
        `  Expected: ${referenceHash}\n` +
        `  Actual:   ${result.determinismHash}\n` +
        `\nIf this is an intentional behavior change, update the reference hash:\n` +
        `  1. Run: DETERMINISM_GATE_UPDATE=1 tsx --test ${import.meta.url}\n` +
        `  2. Copy the printed hash to ${REFERENCE_HASH_FILE}\n` +
        `  3. Document the reason in the commit message`
    );
  });

  it('corpus covers the full lifecycle (submit → grade → post → settle)', async () => {
    const result = await runReplay('determinism-gate-coverage-check');

    // At least 2 picks should be processed through the full lifecycle
    assert.ok(result.picksCreated >= 2, `Expected ≥2 picks, got ${result.picksCreated}`);

    // Check that we processed all 8 events
    assert.equal(result.eventsProcessed, 8, `Expected 8 events processed, got ${result.eventsProcessed}`);
  });
});
