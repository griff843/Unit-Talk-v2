import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type MergeLockOwner,
  acquireMergeLock,
  readMergeLock,
  reclaimMergeLock,
  releaseMergeLock,
  requireMergeLockHeld,
} from './merge-mutex.js';

const OWNER: MergeLockOwner = {
  user: 'codex-test',
  host: 'unit-test',
  pid: 1002,
  session_id: 'merge-session-a',
};

function withTempLock(run: (lockPath: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-merge-lock-'));
  try {
    run(path.join(dir, 'merge-lock.json'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function acquire(
  lockPath: string,
  issueId: string,
  expiresAt = '2026-05-18T13:00:00.000Z',
) {
  return acquireMergeLock(
    {
      issue_id: issueId,
      branch: `codex/${issueId.toLowerCase()}-merge-lock`,
      pr: 'https://github.com/griff843/Unit-Talk-v2/pull/758',
      cwd: process.cwd(),
      reason: 'unit-test',
      owner: OWNER,
      acquired_at: '2026-05-18T12:00:00.000Z',
      expires_at: expiresAt,
    },
    { lockPath, now: new Date('2026-05-18T12:00:00.000Z') },
  );
}

test('acquire writes a held merge lock', () => {
  withTempLock((lockPath) => {
    const result = acquire(lockPath, 'UTV2-1055');
    const loaded = readMergeLock(lockPath);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.code, 'merge_lock_acquired');
    assert.strictEqual(loaded.ok, true);
    assert.strictEqual(loaded.ok ? loaded.lock.issue_id : '', 'UTV2-1055');
    assert.strictEqual(loaded.ok ? loaded.lock.status : '', 'held');
  });
});

test('acquire fails closed when another unexpired lock exists', () => {
  withTempLock((lockPath) => {
    const first = acquire(lockPath, 'UTV2-1055');
    const second = acquire(lockPath, 'UTV2-1056');

    assert.strictEqual(first.ok, true);
    assert.strictEqual(second.ok, false);
    assert.strictEqual(second.code, 'merge_lock_held');
    assert.strictEqual(second.lock?.issue_id, 'UTV2-1055');
  });
});

test('acquire fails closed when required fields are missing', () => {
  withTempLock((lockPath) => {
    const result = acquireMergeLock(
      {
        issue_id: 'UTV2-1055',
        branch: 'codex/utv2-1055-merge-lock',
        cwd: process.cwd(),
        owner: OWNER,
      },
      { lockPath },
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'merge_lock_missing_required_fields');
    assert.deepStrictEqual(result.missing_fields, ['reason']);
  });
});

test('expired lock becomes stale and requires explicit reclaim', () => {
  withTempLock((lockPath) => {
    const expired = acquire(lockPath, 'UTV2-1055', '2026-05-18T11:00:00.000Z');
    const blocked = acquireMergeLock(
      {
        issue_id: 'UTV2-1056',
        branch: 'codex/utv2-1056-merge-lock',
        cwd: process.cwd(),
        reason: 'unit-test',
        owner: OWNER,
        acquired_at: '2026-05-18T12:00:00.000Z',
        expires_at: '2026-05-18T13:00:00.000Z',
      },
      { lockPath, now: new Date('2026-05-18T12:00:00.000Z') },
    );
    const loaded = readMergeLock(lockPath);

    assert.strictEqual(expired.ok, true);
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.code, 'merge_lock_stale_reclaim_required');
    assert.strictEqual(loaded.ok ? loaded.lock.status : '', 'stale_reclaim_required');
  });
});

test('reclaim overwrites only an explicitly stale lock', () => {
  withTempLock((lockPath) => {
    acquire(lockPath, 'UTV2-1055', '2026-05-18T11:00:00.000Z');
    const blocked = acquire(lockPath, 'UTV2-1056');
    const reclaimed = reclaimMergeLock(
      {
        issue_id: 'UTV2-1056',
        branch: 'codex/utv2-1056-merge-lock',
        cwd: process.cwd(),
        reason: 'explicit-reclaim',
        owner: OWNER,
        acquired_at: '2026-05-18T12:05:00.000Z',
        expires_at: '2026-05-18T13:05:00.000Z',
      },
      { lockPath, now: new Date('2026-05-18T12:05:00.000Z') },
    );

    assert.strictEqual(blocked.code, 'merge_lock_stale_reclaim_required');
    assert.strictEqual(reclaimed.ok, true);
    assert.strictEqual(reclaimed.code, 'merge_lock_reclaimed');
    assert.strictEqual(reclaimed.ok ? reclaimed.lock.issue_id : '', 'UTV2-1056');
  });
});

test('release fails when the holder does not match', () => {
  withTempLock((lockPath) => {
    acquire(lockPath, 'UTV2-1055');
    const result = releaseMergeLock(
      { issue_id: 'UTV2-1056', branch: 'codex/utv2-1056-merge-lock' },
      { lockPath },
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'merge_lock_owner_mismatch');
  });
});

test('release marks the lock released for the owning issue and branch', () => {
  withTempLock((lockPath) => {
    acquire(lockPath, 'UTV2-1055');
    const result = releaseMergeLock(
      { issue_id: 'UTV2-1055', branch: 'codex/utv2-1055-merge-lock' },
      { lockPath, now: new Date('2026-05-18T12:30:00.000Z') },
    );
    const loaded = readMergeLock(lockPath);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.code, 'merge_lock_released');
    assert.strictEqual(loaded.ok ? loaded.lock.status : '', 'released');
  });
});

test('acquire can reuse a released lock file without manual deletion', () => {
  withTempLock((lockPath) => {
    acquire(lockPath, 'UTV2-1055');
    releaseMergeLock(
      { issue_id: 'UTV2-1055', branch: 'codex/utv2-1055-merge-lock' },
      { lockPath, now: new Date('2026-05-18T12:30:00.000Z') },
    );
    const result = acquire(lockPath, 'UTV2-1056');

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.code, 'merge_lock_acquired');
    assert.strictEqual(result.ok ? result.lock.issue_id : '', 'UTV2-1056');
  });
});

test('guard fails closed without a held matching lock', () => {
  withTempLock((lockPath) => {
    const missing = requireMergeLockHeld(
      { issue_id: 'UTV2-1055' },
      { lockPath, now: new Date('2026-05-18T12:00:00.000Z') },
    );
    acquire(lockPath, 'UTV2-1056');
    const mismatch = requireMergeLockHeld(
      { issue_id: 'UTV2-1055' },
      { lockPath, now: new Date('2026-05-18T12:00:00.000Z') },
    );

    assert.strictEqual(missing.ok, false);
    assert.strictEqual(missing.code, 'merge_lock_missing');
    assert.strictEqual(mismatch.ok, false);
    assert.strictEqual(mismatch.code, 'merge_lock_owner_mismatch');
  });
});

test('guard passes for the held lock owner', () => {
  withTempLock((lockPath) => {
    acquire(lockPath, 'UTV2-1055');
    const result = requireMergeLockHeld(
      {
        issue_id: 'UTV2-1055',
        branch: 'codex/utv2-1055-merge-lock',
        reason: 'lane-close',
      },
      { lockPath, now: new Date('2026-05-18T12:00:00.000Z') },
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.code, 'merge_lock_held');
  });
});
