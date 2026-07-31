/**
 * UTV2-1594 section C fixtures.
 *
 * Everything here runs against a throwaway temp directory. The live
 * `.out/ops/preflight/full-verify-semaphore/` state is never touched: reaping
 * tests must not be able to clear a real lane's in-flight verify.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './shared.js';
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  VERIFY_SEMAPHORE_SCHEMA_VERSION,
  acquireVerifySlot,
  beatVerifySlot,
  bootIdsProveReboot,
  classifySlotRecord,
  configuredVerifyConcurrency,
  formatSemaphoreStatus,
  inspectSlot,
  installVerifySlotReleaseHandlers,
  readMachineIdentity,
  readProcessStartToken,
  readSemaphoreStatus,
  reapVerifySlots,
  startVerifySlotHeartbeat,
  verifySemaphoreDir,
  VerifySemaphoreWaitTimeoutError,
  type ClassifyContext,
  type VerifySlotOwner,
} from './verify-semaphore.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1594-semaphore-'));
}

const HOST = 'test-host';
const BOOT = 'ffffffff-1111-2222-3333-444444444444';

function ctx(overrides: Partial<ClassifyContext> = {}): ClassifyContext {
  return {
    now: Date.now(),
    machine: { hostname: HOST, boot_id: BOOT },
    isProcessAlive: () => true,
    processStartToken: () => 'linux:starttime:1000',
    graceMs: 60_000,
    legacyStaleMs: 6 * 60 * 60 * 1000,
    slotMtimeMs: Date.now(),
    ...overrides,
  };
}

function owner(overrides: Partial<VerifySlotOwner> = {}): VerifySlotOwner {
  const now = Date.now();
  return {
    schema_version: VERIFY_SEMAPHORE_SCHEMA_VERSION,
    operation_id: 'op-1',
    slot: 0,
    pid: 4242,
    ppid: 1,
    process_start_token: 'linux:starttime:1000',
    machine: { hostname: HOST, boot_id: BOOT },
    user: 'tester',
    issue_id: 'UTV2-1594',
    branch: 'codex/utv2-1594',
    worktree: '/tmp/worktree',
    command: 'pnpm type-check && pnpm test',
    reason: 'full-verify baseline',
    acquired_at: new Date(now).toISOString(),
    heartbeat_at: new Date(now).toISOString(),
    heartbeat_interval_ms: DEFAULT_HEARTBEAT_INTERVAL_MS,
    expires_at: new Date(now + 15 * 60_000).toISOString(),
    hard_deadline_at: new Date(now + 6 * 60 * 60_000).toISOString(),
    ...overrides,
  };
}

function seedSlot(dir: string, slot: number, record: unknown): string {
  const slotPath = path.join(dir, `slot-${slot}`);
  fs.mkdirSync(slotPath, { recursive: true });
  if (record !== undefined) {
    fs.writeFileSync(path.join(slotPath, 'owner.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  }
  return slotPath;
}

// ── configuration ───────────────────────────────────────────────────────────

test('configuredVerifyConcurrency defaults to 1 and only accepts positive integers', () => {
  assert.equal(configuredVerifyConcurrency({}), 1);
  assert.equal(configuredVerifyConcurrency({ UNIT_TALK_FULL_VERIFY_CONCURRENCY: 'nope' }), 1);
  assert.equal(configuredVerifyConcurrency({ UNIT_TALK_FULL_VERIFY_CONCURRENCY: '0' }), 1);
  assert.equal(configuredVerifyConcurrency({ UNIT_TALK_FULL_VERIFY_CONCURRENCY: '-3' }), 1);
  assert.equal(configuredVerifyConcurrency({ UNIT_TALK_FULL_VERIFY_CONCURRENCY: '4' }), 4);
});

test('verifySemaphoreDir honours an operator override without changing the default', () => {
  assert.equal(verifySemaphoreDir({}), verifySemaphoreDir({}));
  assert.ok(verifySemaphoreDir({}).endsWith(path.join('.out', 'ops', 'preflight', 'full-verify-semaphore')));
  assert.equal(
    verifySemaphoreDir({ UNIT_TALK_FULL_VERIFY_SEMAPHORE_DIR: '/shared/verify' }),
    path.resolve('/shared/verify'),
  );
});

// ── process identity ────────────────────────────────────────────────────────

test('readProcessStartToken is stable for a live process and absent for a dead pid', (t) => {
  const first = readProcessStartToken(process.pid);
  if (first === null) {
    t.skip('no /proc on this platform');
    return;
  }
  assert.match(first, /^linux:starttime:\d+$/);
  assert.equal(readProcessStartToken(process.pid), first, 'start token must not change for a live process');
  assert.equal(readProcessStartToken(2 ** 22), null, 'a pid with no /proc entry has no start token');
  assert.equal(readProcessStartToken(0), null);
  assert.equal(readProcessStartToken(-1), null);
});

test('readProcessStartToken distinguishes two different live processes', (t) => {
  if (readProcessStartToken(process.pid) === null) {
    t.skip('no /proc on this platform');
    return;
  }
  const child = spawnSync('bash', ['-c', 'echo $$'], { encoding: 'utf8' });
  const childPid = Number.parseInt((child.stdout ?? '').trim(), 10);
  assert.ok(Number.isInteger(childPid));
  // The child has exited, so its token is gone -- which is exactly the signal
  // that lets classification tell "this pid is my owner" from "this pid was
  // recycled into somebody else".
  assert.equal(readProcessStartToken(childPid), null);
});

test('bootIdsProveReboot only fires when both sides are real kernel boot ids', () => {
  assert.equal(bootIdsProveReboot('boot-a', 'boot-b'), true);
  assert.equal(bootIdsProveReboot('boot-a', 'boot-a'), false);
  assert.equal(bootIdsProveReboot(null, 'boot-b'), false);
  assert.equal(bootIdsProveReboot('boot-a', null), false);
  // The portable uptime approximation can drift within one boot; treating that
  // drift as a reboot would reap a live owner.
  assert.equal(bootIdsProveReboot('uptime:100', 'uptime:101'), false);
  assert.equal(bootIdsProveReboot('boot-a', 'uptime:101'), false);
});

test('readMachineIdentity reports a hostname and a boot identity', () => {
  const identity = readMachineIdentity();
  assert.ok(identity.hostname.length > 0);
  assert.ok(identity.boot_id === null || identity.boot_id.length > 0);
});

// ── classification: reapable cases ──────────────────────────────────────────

test('a dead owner pid on this host is reapable', () => {
  const result = classifySlotRecord(owner(), ctx({ isProcessAlive: () => false }));
  assert.equal(result.state, 'dead_owner');
  assert.equal(result.reapable, true);
  assert.match(result.reason, /not running/);
});

test('a recycled pid is detected and is not mistaken for a live owner', () => {
  const result = classifySlotRecord(
    owner({ process_start_token: 'linux:starttime:1000' }),
    ctx({ isProcessAlive: () => true, processStartToken: () => 'linux:starttime:9999' }),
  );
  assert.equal(result.state, 'pid_reused');
  assert.equal(result.reapable, true);
  assert.match(result.reason, /recycled/);
});

test('a matching start token keeps a live owner protected', () => {
  const result = classifySlotRecord(
    owner({ process_start_token: 'linux:starttime:1000' }),
    ctx({ isProcessAlive: () => true, processStartToken: () => 'linux:starttime:1000' }),
  );
  assert.equal(result.state, 'live');
  assert.equal(result.reapable, false);
});

test('a slot acquired under a previous boot of this host is reapable', () => {
  const result = classifySlotRecord(
    owner({ machine: { hostname: HOST, boot_id: 'previous-boot' } }),
    ctx({ isProcessAlive: () => true }),
  );
  assert.equal(result.state, 'machine_reboot');
  assert.equal(result.reapable, true);
});

test('the hard deadline retires even a live, heartbeating owner', () => {
  const now = Date.now();
  const result = classifySlotRecord(
    owner({
      heartbeat_at: new Date(now).toISOString(),
      expires_at: new Date(now + 60_000).toISOString(),
      hard_deadline_at: new Date(now - 1_000).toISOString(),
    }),
    ctx({ now, isProcessAlive: () => true }),
  );
  assert.equal(result.state, 'hard_deadline_exceeded');
  assert.equal(result.reapable, true);
});

test('an incomplete slot is protected inside the write grace and reapable after it', () => {
  const now = Date.now();
  const recent = classifySlotRecord(null, ctx({ now, slotMtimeMs: now - 1_000, graceMs: 60_000 }));
  assert.equal(recent.state, 'corrupt_recent');
  assert.equal(recent.reapable, false);

  const orphan = classifySlotRecord(null, ctx({ now, slotMtimeMs: now - 600_000, graceMs: 60_000 }));
  assert.equal(orphan.state, 'corrupt_orphan');
  assert.equal(orphan.reapable, true);
});

// ── classification: protected cases ─────────────────────────────────────────

test('FIXTURE: a live slow verifier is never reaped, however long it has been running', () => {
  const now = Date.now();
  // Six hours of legitimate work, heartbeat current, hard deadline not reached.
  const acquired = now - 5.5 * 60 * 60_000;
  const result = classifySlotRecord(
    owner({
      acquired_at: new Date(acquired).toISOString(),
      heartbeat_at: new Date(now - 5_000).toISOString(),
      expires_at: new Date(now + 15 * 60_000).toISOString(),
      hard_deadline_at: new Date(now + 30 * 60_000).toISOString(),
    }),
    ctx({ now, isProcessAlive: () => true }),
  );
  assert.equal(result.state, 'live');
  assert.equal(result.reapable, false);
});

test('a live owner whose heartbeat merely lapsed is reported, not reaped', () => {
  const now = Date.now();
  const result = classifySlotRecord(
    owner({
      heartbeat_at: new Date(now - 10 * DEFAULT_HEARTBEAT_INTERVAL_MS).toISOString(),
      expires_at: new Date(now + 60_000).toISOString(),
    }),
    ctx({ now, isProcessAlive: () => true }),
  );
  assert.equal(result.state, 'live_heartbeat_stale');
  assert.equal(result.reapable, false, 'a running process is never provably dead');
});

test('a live owner past its lease is reported but still not auto-reaped', () => {
  const now = Date.now();
  const result = classifySlotRecord(
    owner({
      heartbeat_at: new Date(now - 30 * 60_000).toISOString(),
      expires_at: new Date(now - 60_000).toISOString(),
      hard_deadline_at: new Date(now + 60 * 60_000).toISOString(),
    }),
    ctx({ now, isProcessAlive: () => true }),
  );
  assert.equal(result.state, 'expired_live_owner');
  assert.equal(result.reapable, false);
  assert.match(result.reason, /hard deadline/);
});

test('a foreign-host owner is protected until its lease expires, then reclaimable', () => {
  const now = Date.now();
  const live = classifySlotRecord(
    owner({ machine: { hostname: 'other-host', boot_id: 'other-boot' }, expires_at: new Date(now + 60_000).toISOString() }),
    ctx({ now, isProcessAlive: () => false }),
  );
  assert.equal(live.state, 'live_foreign_host');
  assert.equal(live.reapable, false, 'a local pid probe says nothing about a remote host');

  const expired = classifySlotRecord(
    owner({ machine: { hostname: 'other-host', boot_id: 'other-boot' }, expires_at: new Date(now - 60_000).toISOString() }),
    ctx({ now, isProcessAlive: () => true }),
  );
  assert.equal(expired.state, 'expired_unverifiable');
  assert.equal(expired.reapable, true);
});

// ── legacy records ──────────────────────────────────────────────────────────

test('a pre-UTV2-1594 slot record held by a live pid is left alone', () => {
  const result = classifySlotRecord(
    { pid: 4242, acquired_at: new Date(0).toISOString() },
    ctx({ isProcessAlive: () => true }),
  );
  assert.equal(result.state, 'legacy_live');
  assert.equal(result.reapable, false, 'rollout must not clear slots held by the previous code path');
});

test('a pre-UTV2-1594 slot record held by a dead pid is reclaimed immediately, not after 6h', () => {
  const result = classifySlotRecord(
    { pid: 4242, acquired_at: new Date().toISOString() },
    ctx({ isProcessAlive: () => false }),
  );
  assert.equal(result.state, 'legacy_stale');
  assert.equal(result.reapable, true);
});

// ── acquire / release ───────────────────────────────────────────────────────

test('acquireVerifySlot writes a durable ownership record and releases it', () => {
  const dir = tmpDir();
  try {
    const handle = acquireVerifySlot({
      dir,
      maxConcurrent: 1,
      issueId: 'UTV2-1594',
      branch: 'codex/utv2-1594',
      enableHeartbeat: false,
      installSignalHandlers: false,
    });
    assert.equal(handle.slot, 0);
    const record = JSON.parse(fs.readFileSync(handle.owner_path, 'utf8')) as VerifySlotOwner;
    assert.equal(record.schema_version, VERIFY_SEMAPHORE_SCHEMA_VERSION);
    assert.equal(record.pid, process.pid);
    assert.equal(record.issue_id, 'UTV2-1594');
    assert.equal(record.branch, 'codex/utv2-1594');
    assert.ok(record.operation_id.length > 0);
    assert.ok(record.acquired_at && record.heartbeat_at && record.expires_at && record.hard_deadline_at);
    assert.ok(Date.parse(record.hard_deadline_at) > Date.parse(record.expires_at));
    handle.release();
    assert.equal(fs.existsSync(handle.slot_path), false);
    assert.doesNotThrow(() => handle.release(), 'release is idempotent');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('release does not delete a slot that has since been re-claimed by someone else', () => {
  const dir = tmpDir();
  try {
    const handle = acquireVerifySlot({ dir, maxConcurrent: 1, enableHeartbeat: false, installSignalHandlers: false });
    // Simulate: this slot was reaped and re-acquired by a different operation.
    fs.writeFileSync(handle.owner_path, `${JSON.stringify(owner({ operation_id: 'someone-else' }), null, 2)}\n`, 'utf8');
    handle.release();
    assert.equal(fs.existsSync(handle.slot_path), true, 'must not destroy another operation’s live slot');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireVerifySlot takes the next free slot when earlier slots are held', () => {
  const dir = tmpDir();
  try {
    const first = acquireVerifySlot({ dir, maxConcurrent: 2, enableHeartbeat: false, installSignalHandlers: false });
    const second = acquireVerifySlot({ dir, maxConcurrent: 2, enableHeartbeat: false, installSignalHandlers: false });
    assert.equal(first.slot, 0);
    assert.equal(second.slot, 1);
    first.release();
    second.release();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('FIXTURE: a dead process holding a slot is reaped and the next waiter is admitted', () => {
  const dir = tmpDir();
  try {
    const deadPid = 4242;
    seedSlot(dir, 0, owner({ pid: deadPid, operation_id: 'dead-op' }));

    const reaps: string[] = [];
    const handle = acquireVerifySlot({
      dir,
      maxConcurrent: 1,
      issueId: 'UTV2-1594',
      enableHeartbeat: false,
      installSignalHandlers: false,
      machine: { hostname: HOST, boot_id: BOOT },
      isProcessAlive: (pid) => pid !== deadPid,
      processStartToken: () => 'linux:starttime:1000',
      onReap: (record) => reaps.push(`${record.slot}:${record.state}`),
    });

    assert.deepEqual(reaps, ['0:dead_owner'], 'the corpse must be reclaimed with a stated reason');
    assert.equal(handle.slot, 0, 'the next waiter is admitted into the freed slot');
    assert.equal(handle.reaped.length, 1);
    assert.equal(handle.reaped[0]?.previous_owner?.operation_id, 'dead-op');
    const record = JSON.parse(fs.readFileSync(handle.owner_path, 'utf8')) as VerifySlotOwner;
    assert.equal(record.pid, process.pid);
    // The reclaim is auditable after the fact.
    const log = fs.readFileSync(path.join(dir, 'reap-log.jsonl'), 'utf8').trim().split('\n');
    assert.equal(log.length, 1);
    assert.equal(JSON.parse(log[0]!).state, 'dead_owner');
    handle.release();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('FIXTURE: a live slow verifier is not reaped and a contender queues behind it', () => {
  const dir = tmpDir();
  try {
    const livePid = 4242;
    const now = Date.now();
    seedSlot(
      dir,
      0,
      owner({
        pid: livePid,
        operation_id: 'live-op',
        acquired_at: new Date(now - 3 * 60 * 60_000).toISOString(),
        heartbeat_at: new Date(now - 2_000).toISOString(),
      }),
    );

    const progress: string[] = [];
    let thrown: unknown = null;
    try {
      acquireVerifySlot({
        dir,
        maxConcurrent: 1,
        issueId: 'UTV2-1594',
        enableHeartbeat: false,
        installSignalHandlers: false,
        machine: { hostname: HOST, boot_id: BOOT },
        isProcessAlive: () => true,
        processStartToken: () => 'linux:starttime:1000',
        waitPollMs: 0,
        waitProgressMs: 0,
        maxWaitMs: 5,
        sleep: () => {},
        now: (() => {
          let clock = now;
          return () => (clock += 3);
        })(),
        onWait: (p) => progress.push(p.message),
      });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown instanceof VerifySemaphoreWaitTimeoutError, 'the contender must wait, not steal the slot');
    const stillThere = JSON.parse(fs.readFileSync(path.join(dir, 'slot-0', 'owner.json'), 'utf8')) as VerifySlotOwner;
    assert.equal(stillThere.operation_id, 'live-op', 'the live verify survived untouched');
    assert.equal(stillThere.pid, livePid);
    assert.ok(!fs.existsSync(path.join(dir, 'reap-log.jsonl')), 'nothing was reaped');
    // A waiting process reports progress instead of looking hung.
    assert.ok(progress.length > 0, 'a waiter must emit periodic progress');
    assert.match(progress[0]!, /waiting \d+s for a full-verify slot/);
    assert.match(progress[0]!, /1\/1 occupied/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a waiter that gives up leaves no queue entry behind', () => {
  const dir = tmpDir();
  try {
    seedSlot(dir, 0, owner({ operation_id: 'live-op' }));
    assert.throws(
      () =>
        acquireVerifySlot({
          dir,
          maxConcurrent: 1,
          enableHeartbeat: false,
          installSignalHandlers: false,
          machine: { hostname: HOST, boot_id: BOOT },
          isProcessAlive: () => true,
          processStartToken: () => 'linux:starttime:1000',
          waitPollMs: 0,
          maxWaitMs: 0,
          sleep: () => {},
          now: (() => {
            let clock = Date.now();
            return () => (clock += 10);
          })(),
        }),
      VerifySemaphoreWaitTimeoutError,
    );
    const waitingDir = path.join(dir, 'waiting');
    const entries = fs.existsSync(waitingDir) ? fs.readdirSync(waitingDir) : [];
    assert.deepEqual(entries, [], 'the abandoned waiter must be removed from the queue');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reapVerifySlots clears only provably dead owners and leaves live ones alone', () => {
  const dir = tmpDir();
  try {
    const deadPid = 4242;
    seedSlot(dir, 0, owner({ pid: deadPid, operation_id: 'dead-op' }));
    seedSlot(dir, 1, owner({ pid: 4243, operation_id: 'live-op', slot: 1 }));

    const reaped = reapVerifySlots({
      dir,
      maxConcurrent: 2,
      ctx: {
        machine: { hostname: HOST, boot_id: BOOT },
        isProcessAlive: (pid) => pid !== deadPid,
        processStartToken: () => 'linux:starttime:1000',
      },
    });

    assert.equal(reaped.length, 1);
    assert.equal(reaped[0]?.slot, 0);
    assert.equal(fs.existsSync(path.join(dir, 'slot-0')), false);
    assert.equal(fs.existsSync(path.join(dir, 'slot-1')), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── heartbeat ───────────────────────────────────────────────────────────────

test('beatVerifySlot slides the lease forward but never the hard deadline', () => {
  const dir = tmpDir();
  try {
    const slotPath = seedSlot(dir, 0, owner());
    const ownerPath = path.join(slotPath, 'owner.json');
    const before = JSON.parse(fs.readFileSync(ownerPath, 'utf8')) as VerifySlotOwner;
    const now = Date.parse(before.acquired_at) + 60_000;
    const after = beatVerifySlot(ownerPath, { now, ttlMs: 15 * 60_000 });
    assert.ok(after);
    assert.equal(Date.parse(after.heartbeat_at), now);
    assert.equal(Date.parse(after.expires_at), now + 15 * 60_000);
    assert.equal(after.hard_deadline_at, before.hard_deadline_at, 'the hard bound is not renewable');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('beatVerifySlot refuses to touch a legacy or missing record', () => {
  const dir = tmpDir();
  try {
    const slotPath = seedSlot(dir, 0, { pid: 1, acquired_at: new Date().toISOString() });
    assert.equal(beatVerifySlot(path.join(slotPath, 'owner.json')), null);
    assert.equal(beatVerifySlot(path.join(dir, 'nope.json')), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the heartbeat keeps beating while the main thread is blocked in spawnSync', async () => {
  const dir = tmpDir();
  try {
    const slotPath = seedSlot(dir, 0, owner({ pid: process.pid }));
    const ownerPath = path.join(slotPath, 'owner.json');
    const before = JSON.parse(fs.readFileSync(ownerPath, 'utf8')) as VerifySlotOwner;

    const controller = startVerifySlotHeartbeat(ownerPath, { intervalMs: 50, ttlMs: 30 * 60_000 });
    assert.ok(controller, 'heartbeat worker should start');
    // A blocking child, exactly like `pnpm type-check` / `pnpm test`: the main
    // thread cannot run a timer for the whole duration.
    spawnSync(process.execPath, ['-e', 'const s=Date.now();while(Date.now()-s<600){}'], { stdio: 'ignore' });
    controller.stop();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const after = JSON.parse(fs.readFileSync(ownerPath, 'utf8')) as VerifySlotOwner;
    assert.ok(
      Date.parse(after.heartbeat_at) > Date.parse(before.heartbeat_at),
      'the worker thread must advance the heartbeat across a blocking spawnSync',
    );
    assert.ok(Date.parse(after.expires_at) > Date.parse(before.expires_at), 'the lease must slide forward too');
    assert.equal(after.operation_id, before.operation_id);
    assert.equal(after.hard_deadline_at, before.hard_deadline_at);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── signal / crash cleanup ──────────────────────────────────────────────────

function writeHolderScript(name: string, body: string[]): string {
  // Plain CommonJS driven by `tsx/cjs`, run as `node <script>`: the spawned pid
  // IS the node process that owns the slot, so a signal sent to it lands on the
  // release handler under test rather than on a wrapper that would swallow it.
  const scriptDir = fs.mkdtempSync(path.join(ROOT, '.out', 'utv2-1594-holder-'));
  const scriptPath = path.join(scriptDir, name);
  fs.writeFileSync(
    scriptPath,
    [
      `require('tsx/cjs');`,
      `const { acquireVerifySlot } = require(${JSON.stringify(path.join(ROOT, 'scripts', 'ops', 'verify-semaphore.ts'))});`,
      ...body,
      '',
    ].join('\n'),
    'utf8',
  );
  return scriptPath;
}

test('a killed process releases its slot through the signal path', async () => {
  const dir = tmpDir();
  const scriptPath = writeHolderScript('holder.cjs', [
    `acquireVerifySlot({ dir: ${JSON.stringify(dir)}, maxConcurrent: 1, issueId: 'UTV2-1594', enableHeartbeat: false });`,
    `process.stdout.write('HELD\\n');`,
    `setInterval(() => {}, 1000);`,
  ]);
  const child = spawn(process.execPath, [scriptPath], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => (output += String(chunk)));
  child.stderr.on('data', (chunk) => (output += String(chunk)));
  try {
    const ownerFile = path.join(dir, 'slot-0', 'owner.json');
    const deadline = Date.now() + 60_000;
    while (!fs.existsSync(ownerFile) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(fs.existsSync(ownerFile), `child never acquired the slot: ${output}`);

    child.kill('SIGTERM');
    const [code, signal] = (await once(child, 'exit')) as [number | null, NodeJS.Signals | null];
    assert.ok(signal === 'SIGTERM' || code !== 0, `child should die from SIGTERM, got code=${code} signal=${signal}`);
    assert.equal(fs.existsSync(path.join(dir, 'slot-0')), false, `SIGTERM must release the slot; ${output}`);
  } finally {
    child.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.dirname(scriptPath), { recursive: true, force: true });
  }
});

test('an uncaught exception releases the slot before the process dies', () => {
  const dir = tmpDir();
  const scriptPath = writeHolderScript('thrower.cjs', [
    `acquireVerifySlot({ dir: ${JSON.stringify(dir)}, maxConcurrent: 1, issueId: 'UTV2-1594', enableHeartbeat: false });`,
    `if (!require('node:fs').existsSync(${JSON.stringify(path.join(dir, 'slot-0', 'owner.json'))})) { process.exit(9); }`,
    `process.stdout.write('HELD\\n');`,
    `setTimeout(() => { throw new Error('boom'); }, 10);`,
  ]);
  try {
    const child = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8', cwd: ROOT, timeout: 120_000 });
    const combined = `${child.stdout ?? ''}${child.stderr ?? ''}`;
    assert.match(child.stdout ?? '', /HELD/, `child never acquired the slot: ${combined}`);
    assert.notEqual(child.status, 0, 'the crash must still be a crash');
    assert.match(combined, /boom/, `the original error must not be swallowed: ${combined}`);
    assert.equal(fs.existsSync(path.join(dir, 'slot-0')), false, `an uncaught throw must not leave a slot behind; ${combined}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.dirname(scriptPath), { recursive: true, force: true });
  }
});

test('installVerifySlotReleaseHandlers can be uninstalled and leaves no listeners behind', () => {
  const before = {
    exit: process.listenerCount('exit'),
    sigint: process.listenerCount('SIGINT'),
    sigterm: process.listenerCount('SIGTERM'),
    uncaught: process.listenerCount('uncaughtException'),
  };
  const uninstall = installVerifySlotReleaseHandlers({ release() {} });
  assert.equal(process.listenerCount('SIGTERM'), before.sigterm + 1);
  uninstall();
  assert.equal(process.listenerCount('exit'), before.exit);
  assert.equal(process.listenerCount('SIGINT'), before.sigint);
  assert.equal(process.listenerCount('SIGTERM'), before.sigterm);
  assert.equal(process.listenerCount('uncaughtException'), before.uncaught);
});

// ── operator surface ────────────────────────────────────────────────────────

test('operator status explains every occupied and waiting slot', () => {
  const dir = tmpDir();
  try {
    const deadPid = 4242;
    seedSlot(dir, 0, owner({ pid: deadPid, operation_id: 'dead-op', issue_id: 'UTV2-1111', branch: 'codex/utv2-1111' }));
    seedSlot(dir, 1, owner({ slot: 1, pid: 4243, operation_id: 'live-op', issue_id: 'UTV2-2222' }));
    fs.mkdirSync(path.join(dir, 'waiting'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'waiting', 'waiter-1.json'),
      `${JSON.stringify({
        schema_version: VERIFY_SEMAPHORE_SCHEMA_VERSION,
        operation_id: 'waiter-1',
        pid: 4244,
        process_start_token: 'linux:starttime:1000',
        machine: { hostname: HOST, boot_id: BOOT },
        user: 'tester',
        issue_id: 'UTV2-3333',
        branch: 'codex/utv2-3333',
        worktree: '/tmp/w',
        command: 'pnpm type-check && pnpm test',
        reason: 'full-verify baseline',
        waiting_since: new Date(Date.now() - 120_000).toISOString(),
        heartbeat_at: new Date().toISOString(),
        waited_ms: 120_000,
        polls: 24,
      })}\n`,
      'utf8',
    );

    const status = readSemaphoreStatus({
      dir,
      maxConcurrent: 3,
      ctx: {
        machine: { hostname: HOST, boot_id: BOOT },
        isProcessAlive: (pid) => pid !== deadPid,
        processStartToken: () => 'linux:starttime:1000',
      },
    });

    assert.equal(status.max_concurrent, 3);
    assert.equal(status.occupied, 2);
    assert.equal(status.free, 1);
    assert.equal(status.reapable, 1);
    assert.equal(status.slots[2]?.classification.state, 'free');
    assert.equal(status.waiters.length, 1);
    assert.equal(status.waiters[0]?.issue_id, 'UTV2-3333');
    assert.ok((status.waiters[0]?.waiting_ms ?? 0) >= 120_000);

    // Every occupied and waiting entry carries owner, age, heartbeat and reason.
    for (const slot of status.slots.filter((s) => s.occupied)) {
      assert.ok(slot.raw_owner?.pid);
      assert.ok(typeof slot.age_ms === 'number');
      assert.ok(typeof slot.heartbeat_age_ms === 'number');
      assert.ok(slot.classification.reason.length > 0);
    }

    const rendered = formatSemaphoreStatus(status);
    assert.match(rendered, /DEAD_OWNER \(reapable\)/);
    assert.match(rendered, /UTV2-1111/);
    assert.match(rendered, /UTV2-2222/);
    assert.match(rendered, /waiting:/);
    assert.match(rendered, /UTV2-3333/);
    assert.match(rendered, /slot 2: FREE/);
    assert.match(rendered, /heartbeat/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a dead waiter is dropped from the queue view', () => {
  const dir = tmpDir();
  try {
    fs.mkdirSync(path.join(dir, 'waiting'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'waiting', 'ghost.json'),
      `${JSON.stringify({
        schema_version: VERIFY_SEMAPHORE_SCHEMA_VERSION,
        operation_id: 'ghost',
        pid: 4242,
        process_start_token: null,
        machine: { hostname: HOST, boot_id: BOOT },
        user: 'tester',
        issue_id: 'UTV2-9999',
        branch: null,
        worktree: '/tmp/w',
        command: 'pnpm test',
        reason: 'full-verify baseline',
        waiting_since: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
        waited_ms: 0,
        polls: 1,
      })}\n`,
      'utf8',
    );
    const status = readSemaphoreStatus({
      dir,
      maxConcurrent: 1,
      ctx: { machine: { hostname: HOST, boot_id: BOOT }, isProcessAlive: () => false },
    });
    assert.equal(status.waiters.length, 0);
    assert.equal(fs.existsSync(path.join(dir, 'waiting', 'ghost.json')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('inspectSlot reports a free slot without inventing an owner', () => {
  const dir = tmpDir();
  try {
    const view = inspectSlot(dir, 0);
    assert.equal(view.occupied, false);
    assert.equal(view.classification.state, 'free');
    assert.equal(view.classification.reapable, false);
    assert.equal(view.owner, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
