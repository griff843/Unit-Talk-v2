import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  DEFAULT_HEARTBEAT_MAX_AGE_MS,
  evaluateHeartbeatLiveness,
  readHeartbeat,
  resolveHeartbeatFile,
  resolveHeartbeatMaxAgeMs,
  writeHeartbeat,
} from './heartbeat.js';
import { runHealthcheck } from './healthcheck.js';

/*
 * UTV2-1284 — loop-progress liveness. The old container healthcheck was
 * `pgrep -f 'node'`, which proves a process exists but NOT that the cycle loop
 * advanced — so a wedged loop reported "healthy" for ~5.5h (2026-06-20). These
 * tests prove the heartbeat-based replacement fails when the loop is stale even
 * though the node process is alive.
 */

function tempHeartbeatFile(): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'ut-hb-'));
  return { file: join(dir, 'heartbeat.json'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('writeHeartbeat → readHeartbeat round-trips', () => {
  const { file, cleanup } = tempHeartbeatFile();
  try {
    assert.equal(writeHeartbeat(file, { ts: 1000, cycle: 7, pid: 42 }), true);
    assert.deepEqual(readHeartbeat(file), { ts: 1000, cycle: 7, pid: 42 });
  } finally {
    cleanup();
  }
});

test('readHeartbeat returns null for a missing or malformed file', () => {
  const { file, cleanup } = tempHeartbeatFile();
  try {
    assert.equal(readHeartbeat(file), null);
    writeHeartbeat(file, { ts: 1, cycle: 1, pid: 1 });
    // overwrite with garbage
    assert.equal(writeHeartbeat(file, { ts: NaN as unknown as number, cycle: 1, pid: 1 }), true);
    // NaN serialises to null in JSON → ts is not a number → readHeartbeat rejects it
    assert.equal(readHeartbeat(file), null);
  } finally {
    cleanup();
  }
});

test('evaluateHeartbeatLiveness: fresh heartbeat is healthy', () => {
  const r = evaluateHeartbeatLiveness({ ts: 1_000_000, cycle: 3, pid: 1 }, 60_000, 1_030_000);
  assert.equal(r.healthy, true);
  assert.equal(r.ageMs, 30_000);
});

test('evaluateHeartbeatLiveness: stale heartbeat is unhealthy even though a process exists', () => {
  const r = evaluateHeartbeatLiveness({ ts: 1_000_000, cycle: 3, pid: 1 }, 60_000, 1_200_000);
  assert.equal(r.healthy, false);
  assert.ok(r.reason.includes('stale'));
});

test('evaluateHeartbeatLiveness: a missing heartbeat is not healthy', () => {
  const r = evaluateHeartbeatLiveness(null, 60_000, 1_000_000);
  assert.equal(r.healthy, false);
  assert.equal(r.ageMs, null);
});

test('resolveHeartbeatFile / resolveHeartbeatMaxAgeMs honour env overrides', () => {
  assert.equal(resolveHeartbeatFile({ UNIT_TALK_INGESTOR_HEARTBEAT_FILE: '/custom/hb' }), '/custom/hb');
  assert.equal(resolveHeartbeatMaxAgeMs({ UNIT_TALK_INGESTOR_HEARTBEAT_MAX_AGE_MS: '5000' }), 5000);
  // invalid / absent → default
  assert.equal(resolveHeartbeatMaxAgeMs({ UNIT_TALK_INGESTOR_HEARTBEAT_MAX_AGE_MS: 'nope' }), DEFAULT_HEARTBEAT_MAX_AGE_MS);
  assert.equal(resolveHeartbeatMaxAgeMs({}), DEFAULT_HEARTBEAT_MAX_AGE_MS);
});

test('runHealthcheck exits 0 on a fresh heartbeat and 1 when stale (process alive, loop wedged)', () => {
  const { file, cleanup } = tempHeartbeatFile();
  try {
    const env = { UNIT_TALK_INGESTOR_HEARTBEAT_FILE: file, UNIT_TALK_INGESTOR_HEARTBEAT_MAX_AGE_MS: '60000' };
    // No heartbeat yet → unhealthy.
    assert.equal(runHealthcheck(env, 1_000_000).code, 1);
    // Fresh heartbeat → healthy.
    writeHeartbeat(file, { ts: 1_000_000, cycle: 5, pid: process.pid });
    assert.equal(runHealthcheck(env, 1_030_000).code, 0);
    // Same heartbeat, now stale → unhealthy (the wedge signature).
    const stale = runHealthcheck(env, 1_200_000);
    assert.equal(stale.code, 1);
    assert.ok(stale.message.includes('UNHEALTHY'));
  } finally {
    cleanup();
  }
});
