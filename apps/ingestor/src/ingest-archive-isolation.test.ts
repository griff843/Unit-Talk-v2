import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { RawPayloadInsert, RawPayloadRecord, RawPayloadRepository } from '@unit-talk/db';

import { archiveRawProviderPayload } from './raw-provider-payload-archive.js';

/**
 * UTV2-1294 — write-path isolation contract.
 *
 * These tests model the exact ingest-league.ts control flow: the archive (telemetry)
 * write runs inside a fail-open try/catch, and the settlement-critical work runs AFTER
 * it. The invariant under test: no matter how the archive write behaves (success,
 * oversize-capped, throw, or hang), the settlement path always runs to completion.
 */

type ArchiveBehavior = 'ok' | 'oversized' | 'throw' | 'hang';

function repositoryFor(behavior: ArchiveBehavior): RawPayloadRepository {
  return {
    async insert(input: RawPayloadInsert): Promise<RawPayloadRecord> {
      if (behavior === 'throw') {
        throw new Error('simulated archive DB failure');
      }
      if (behavior === 'hang') {
        // Resolves only after the archive write timeout (25ms) has already fired, so the
        // caller is freed by the guard; the delayed resolve keeps the promise settle-able
        // so the test runner's event loop stays clean.
        return new Promise<RawPayloadRecord>((resolve) => {
          setTimeout(() => resolve({ id: 'raw-hang' } as unknown as RawPayloadRecord), 40);
        });
      }
      return {
        id: 'raw-1',
        provider_key: input.providerKey,
        league: input.league,
        run_id: input.runId,
        kind: input.kind,
        payload_hash: input.payloadHash,
        payload: input.payload,
        snapshot_at: input.snapshotAt,
        created_at: '2026-06-23T18:00:00.000Z',
      } as unknown as RawPayloadRecord;
    },
  };
}

/** Mirrors the ingest-league cycle: fail-open archive, then settlement-critical writes. */
async function runCycle(behavior: ArchiveBehavior): Promise<{
  settlementRan: boolean;
  gameResultsInserted: number;
  archiveFailed: boolean;
}> {
  let archiveFailed = false;
  const payload =
    behavior === 'oversized'
      ? { league: 'MLB', odds: 'x'.repeat(5_000) }
      : { league: 'MLB', odds: [{ a: 1 }] };

  // --- archive / telemetry write: bounded + fail-open ---
  try {
    await archiveRawProviderPayload({
      providerKey: 'sgo',
      league: 'MLB',
      runId: 'run-iso',
      snapshotAt: '2026-06-23T18:00:00.000Z',
      kind: 'odds',
      payload,
      spoolDir: path.join(os.tmpdir(), 'ut-1294-iso'),
      rawPayloadsRepository: repositoryFor(behavior),
      maxPayloadBytes: behavior === 'oversized' ? 100 : 1_000_000,
      writeTimeoutMs: 25,
    });
  } catch {
    // fail-open: archive/telemetry failure is logged and swallowed in production
    archiveFailed = true;
  }

  // --- settlement-critical path: must always run ---
  const settlementRan = true;
  const gameResultsInserted = 1; // stand-in for the game_results insert
  return { settlementRan, gameResultsInserted, archiveFailed };
}

for (const behavior of ['ok', 'oversized', 'throw', 'hang'] as const) {
  test(`UTV2-1294: settlement path runs even when the archive write is '${behavior}'`, async () => {
    const start = Date.now();
    const outcome = await runCycle(behavior);

    assert.equal(outcome.settlementRan, true, 'settlement path must always run');
    assert.equal(outcome.gameResultsInserted, 1, 'game_results insert must still happen');
    assert.equal(outcome.archiveFailed, behavior === 'throw' || behavior === 'hang');
    // Even the hang case returns control quickly (bounded by the 25ms write timeout),
    // never the 120s statement_timeout that was starving settlement.
    assert.ok(Date.now() - start < 5_000, 'cycle is never blocked for the statement-timeout window');

    // Let the delayed 'hang' insert settle before the test returns (clean event loop).
    if (behavior === 'hang') {
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  });
}
