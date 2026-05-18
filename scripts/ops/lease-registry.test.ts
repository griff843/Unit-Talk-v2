import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type DispatchLease,
  type LeaseOwner,
  leasePathForIssue,
  readAllLeases,
  reserveLease,
  writeLeaseAtomic,
} from './lease-registry.js';

const OWNER: LeaseOwner = {
  user: 'codex-test',
  host: 'unit-test',
  pid: 1001,
  session_id: 'session-a',
};

function withTempRegistry(run: (registryDir: string) => void): void {
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-lease-'));
  try {
    run(registryDir);
  } finally {
    fs.rmSync(registryDir, { recursive: true, force: true });
  }
}

function reserve(
  registryDir: string,
  issueId: string,
  fileScope: string[],
  expiresAt = '2026-05-18T16:00:00.000Z',
) {
  return reserveLease(
    {
      issue_id: issueId,
      branch: `codex/${issueId.toLowerCase()}-lease`,
      executor: 'codex-cli',
      cwd: process.cwd(),
      file_scope_lock: fileScope,
      owner: OWNER,
      heartbeat_at: '2026-05-18T12:00:00.000Z',
      expires_at: expiresAt,
    },
    { registryDir, now: new Date('2026-05-18T12:00:00.000Z') },
  );
}

function makeLease(overrides: Partial<DispatchLease> = {}): DispatchLease {
  return {
    schema_version: 1,
    issue_id: 'UTV2-1053',
    branch: 'codex/utv2-1053-lease',
    executor: 'codex-cli',
    cwd: process.cwd().replaceAll('\\', '/'),
    file_scope_lock: ['scripts/ops/lease-registry.ts'],
    heartbeat_at: '2026-05-18T12:00:00.000Z',
    expires_at: '2026-05-18T16:00:00.000Z',
    owner: OWNER,
    status: 'active',
    ...overrides,
  };
}

test('reserve succeeds for non-overlapping file scopes', () => {
  withTempRegistry((registryDir) => {
    const first = reserve(registryDir, 'UTV2-1053', ['scripts/ops/lease-registry.ts']);
    const second = reserve(registryDir, 'UTV2-1054', ['scripts/ops/lane-maximizer.ts']);

    assert.strictEqual(first.ok, true);
    assert.strictEqual(second.ok, true);
    assert.deepStrictEqual(readAllLeases(registryDir).map((lease) => lease.issue_id), [
      'UTV2-1053',
      'UTV2-1054',
    ]);
  });
});

test('reserve fails closed on overlap with an active non-reclaimed lease', () => {
  withTempRegistry((registryDir) => {
    const first = reserve(registryDir, 'UTV2-1053', ['scripts/ops']);
    const second = reserve(registryDir, 'UTV2-1054', ['scripts/ops/lease-registry.ts']);

    assert.strictEqual(first.ok, true);
    assert.strictEqual(second.ok, false);
    assert.strictEqual(second.code, 'lease_conflict');
    assert.deepStrictEqual(second.overlapping_files, ['scripts/ops/lease-registry.ts']);
    assert.strictEqual(second.conflicting_lease?.issue_id, 'UTV2-1053');
  });
});

test('reserve treats directory glob locks as overlapping scope', () => {
  withTempRegistry((registryDir) => {
    writeLeaseAtomic(
      leasePathForIssue('UTV2-1053', registryDir),
      makeLease({ file_scope_lock: ['scripts/ops/**'] }),
    );
    const second = reserve(registryDir, 'UTV2-1054', ['scripts/ops/lease-registry.ts']);

    assert.strictEqual(second.ok, false);
    assert.strictEqual(second.code, 'lease_conflict');
    assert.deepStrictEqual(second.overlapping_files, ['scripts/ops/lease-registry.ts']);
  });
});

test('reserve fails closed when required fields are missing', () => {
  withTempRegistry((registryDir) => {
    const result = reserveLease(
      {
        issue_id: 'UTV2-1053',
        executor: 'codex-cli',
        cwd: process.cwd(),
        file_scope_lock: ['scripts/ops/lease-registry.ts'],
        owner: OWNER,
      },
      { registryDir },
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'lease_missing_required_fields');
    assert.deepStrictEqual(result.missing_fields, ['branch']);
  });
});

test('expired overlapping leases become stale and require explicit reclaim', () => {
  withTempRegistry((registryDir) => {
    const expired = reserve(
      registryDir,
      'UTV2-1053',
      ['scripts/ops/lease-registry.ts'],
      '2026-05-18T11:00:00.000Z',
    );
    const blocked = reserveLease(
      {
        issue_id: 'UTV2-1054',
        branch: 'codex/utv2-1054-lease',
        executor: 'codex-cli',
        cwd: process.cwd(),
        file_scope_lock: ['scripts/ops/lease-registry.ts'],
        owner: OWNER,
        heartbeat_at: '2026-05-18T12:00:00.000Z',
        expires_at: '2026-05-18T16:00:00.000Z',
      },
      { registryDir, now: new Date('2026-05-18T12:00:00.000Z') },
    );
    const staleLease = readAllLeases(registryDir).find(
      (lease) => lease.issue_id === 'UTV2-1053',
    );

    assert.strictEqual(expired.ok, true);
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.code, 'lease_stale_reclaim_required');
    assert.strictEqual(staleLease?.status, 'stale_reclaim_required');
    assert.ok(fs.existsSync(leasePathForIssue('UTV2-1053', registryDir)));
  });
});

test('atomic write publishes complete JSON and leaves temp files out of reads', () => {
  withTempRegistry((registryDir) => {
    const leasePath = leasePathForIssue('UTV2-1053', registryDir);
    writeLeaseAtomic(leasePath, makeLease());
    fs.writeFileSync(`${leasePath}.leftover.tmp`, '{"not":"a lease"}\n', 'utf8');

    const raw = fs.readFileSync(leasePath, 'utf8');
    const leases = readAllLeases(registryDir);
    const tempFiles = fs.readdirSync(registryDir).filter((entry) => entry.endsWith('.tmp'));

    assert.match(raw, /"issue_id": "UTV2-1053"/);
    assert.strictEqual(leases.length, 1);
    assert.strictEqual(leases[0]?.issue_id, 'UTV2-1053');
    assert.deepStrictEqual(tempFiles, ['UTV2-1053.json.leftover.tmp']);
  });
});

test('reserve fails closed when an existing lease is missing required fields', () => {
  withTempRegistry((registryDir) => {
    fs.mkdirSync(registryDir, { recursive: true });
    fs.writeFileSync(
      leasePathForIssue('UTV2-1053', registryDir),
      `${JSON.stringify({ ...makeLease(), branch: undefined }, null, 2)}\n`,
      'utf8',
    );

    const result = reserve(registryDir, 'UTV2-1054', ['scripts/ops/lane-start.ts']);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'lease_invalid_existing');
    assert.match(result.message, /branch is required/);
  });
});
