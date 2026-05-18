import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type DispatchLease,
  type LeaseOwner,
  buildLeaseStaleReport,
  heartbeatLease,
  leasePathForIssue,
  readAllLeases,
  reclaimLease,
  releaseLease,
  reserveLease,
  validateActiveLeaseForLane,
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
    const first = reserve(registryDir, 'UTV2-1053', ['scripts/ops/lease-registry.ts']);
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

test('reserve rejects directory paths so lease and lane-start scopes use the same format', () => {
  withTempRegistry((registryDir) => {
    const result = reserve(registryDir, 'UTV2-1054', ['scripts/ops']);

    assert.strictEqual(result.ok, false);
    assert.match(result.message, /must reference a file, not a directory/);
  });
});

test('reserve fails closed when cwd does not exist', () => {
  withTempRegistry((registryDir) => {
    const result = reserveLease(
      {
        issue_id: 'UTV2-1054',
        branch: 'codex/utv2-1054-lease',
        executor: 'codex-cli',
        cwd: path.join(os.tmpdir(), `utv2-missing-cwd-${Date.now()}`),
        file_scope_lock: ['scripts/ops/lease-registry.ts'],
        owner: OWNER,
      },
      { registryDir },
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'lease_invalid_cwd');
    assert.match(result.message, /cwd does not exist/);
  });
});

test('reserve fails closed when worktree and execution cwd disagree with lease cwd', () => {
  withTempRegistry((registryDir) => {
    const result = reserveLease(
      {
        issue_id: 'UTV2-1054',
        branch: 'codex/utv2-1054-lease',
        executor: 'codex-cli',
        cwd: process.cwd(),
        worktree_path: path.join(process.cwd(), '.out', 'worktrees', 'other'),
        execution_location: { cwd: process.cwd() },
        file_scope_lock: ['scripts/ops/lease-registry.ts'],
        owner: OWNER,
      },
      { registryDir },
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'lease_invalid_cwd');
    assert.match(result.message, /worktree_path must match lease cwd/);
  });
});

test('heartbeat updates owner, timestamp, expiry, and keeps executor/cwd truth', () => {
  withTempRegistry((registryDir) => {
    reserve(registryDir, 'UTV2-1056', ['scripts/ops/lease-registry.ts']);
    const result = heartbeatLease(
      {
        issue_id: 'UTV2-1056',
        branch: 'codex/utv2-1056-lease',
        executor: 'codex-cli',
        cwd: process.cwd(),
        heartbeat_at: '2026-05-18T13:00:00.000Z',
        ttl_ms: 30 * 60 * 1000,
        owner: { ...OWNER, session_id: 'session-b' },
      },
      { registryDir, now: new Date('2026-05-18T13:00:00.000Z') },
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.ok ? result.lease.heartbeat_at : '', '2026-05-18T13:00:00.000Z');
    assert.strictEqual(result.ok ? result.lease.expires_at : '', '2026-05-18T13:30:00.000Z');
    assert.strictEqual(result.ok ? result.lease.owner.session_id : '', 'session-b');
    assert.strictEqual(result.ok ? result.lease.cwd : '', process.cwd().replaceAll('\\', '/'));
  });
});

test('heartbeat rejects wrong cwd so stale ownership cannot be hidden', () => {
  withTempRegistry((registryDir) => {
    reserve(registryDir, 'UTV2-1056', ['scripts/ops/lease-registry.ts']);
    const result = heartbeatLease(
      {
        issue_id: 'UTV2-1056',
        branch: 'codex/utv2-1056-lease',
        executor: 'codex-cli',
        cwd: path.join(process.cwd(), '.out', 'other'),
      },
      { registryDir },
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'lease_conflict');
  });
});

test('stale report marks expired active leases and emits visible lease details', () => {
  withTempRegistry((registryDir) => {
    reserve(
      registryDir,
      'UTV2-1056',
      ['scripts/ops/lease-registry.ts'],
      '2026-05-18T11:00:00.000Z',
    );
    const report = buildLeaseStaleReport(
      registryDir,
      new Date('2026-05-18T12:00:00.000Z'),
    );
    const staleLease = readAllLeases(registryDir)[0];

    assert.strictEqual(report.stale_count, 1);
    assert.strictEqual(report.leases[0]?.issue_id, 'UTV2-1056');
    assert.strictEqual(report.leases[0]?.status, 'stale_reclaim_required');
    assert.strictEqual(report.leases[0]?.cwd, process.cwd().replaceAll('\\', '/'));
    assert.deepStrictEqual(report.leases[0]?.file_scope_lock, ['scripts/ops/lease-registry.ts']);
    assert.strictEqual(staleLease?.status, 'stale_reclaim_required');
  });
});

test('stale lease blocks overlapping dispatch until explicit reclaim', () => {
  withTempRegistry((registryDir) => {
    reserve(
      registryDir,
      'UTV2-1056',
      ['scripts/ops/lease-registry.ts'],
      '2026-05-18T11:00:00.000Z',
    );
    const blocked = reserveLease(
      {
        issue_id: 'UTV2-1057',
        branch: 'codex/utv2-1057-lease',
        executor: 'codex-cli',
        cwd: process.cwd(),
        file_scope_lock: ['scripts/ops/lease-registry.ts'],
        owner: OWNER,
      },
      { registryDir, now: new Date('2026-05-18T12:00:00.000Z') },
    );
    const reclaimed = reclaimLease(
      {
        issue_id: 'UTV2-1056',
        actor: 'codex',
        reason: 'confirmed stale after checking PR and branch',
        branch_status: 'exists',
        pr_status: 'open',
      },
      { registryDir, now: new Date('2026-05-18T12:05:00.000Z') },
    );
    const unblocked = reserveLease(
      {
        issue_id: 'UTV2-1057',
        branch: 'codex/utv2-1057-lease',
        executor: 'codex-cli',
        cwd: process.cwd(),
        file_scope_lock: ['scripts/ops/lease-registry.ts'],
        owner: OWNER,
      },
      { registryDir, now: new Date('2026-05-18T12:10:00.000Z') },
    );

    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.code, 'lease_stale_reclaim_required');
    assert.strictEqual(reclaimed.ok, true);
    assert.strictEqual(reclaimed.code, 'lease_reclaimed');
    assert.strictEqual(reclaimed.ok ? reclaimed.lease.status : '', 'reclaimed');
    assert.strictEqual(reclaimed.ok ? reclaimed.lease.reclaim_history?.[0]?.previous_owner.session_id : '', 'session-a');
    assert.deepStrictEqual(reclaimed.ok ? reclaimed.lease.reclaim_history?.[0]?.locked_files : [], ['scripts/ops/lease-registry.ts']);
    assert.strictEqual(reclaimed.ok ? reclaimed.lease.reclaim_history?.[0]?.branch_status : '', 'exists');
    assert.strictEqual(reclaimed.ok ? reclaimed.lease.reclaim_history?.[0]?.pr_status : '', 'open');
    assert.strictEqual(unblocked.ok, true);
  });
});

test('release marks an active lease released without requiring stale reclaim', () => {
  withTempRegistry((registryDir) => {
    reserve(registryDir, 'UTV2-1056', ['scripts/ops/lease-registry.ts']);

    const result = releaseLease(
      {
        issue_id: 'UTV2-1056',
        actor: 'codex',
        reason: 'abandoning lane before implementation',
      },
      { registryDir, now: new Date('2026-05-18T12:05:00.000Z') },
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.code, 'lease_released');
    assert.strictEqual(result.ok ? result.lease.status : '', 'released');
    assert.match(result.ok ? result.lease.reclaim_history?.[0]?.reason ?? '' : '', /^released:/);
  });
});

test('active lease validation fails closed on missing lease and cwd drift', () => {
  withTempRegistry((registryDir) => {
    const missing = validateActiveLeaseForLane(
      {
        issue_id: 'UTV2-1056',
        branch: 'codex/utv2-1056-lease',
        executor: 'codex-cli',
        cwd: process.cwd(),
        file_scope_lock: ['scripts/ops/lease-registry.ts'],
      },
      registryDir,
      new Date('2026-05-18T12:00:00.000Z'),
    );
    reserve(registryDir, 'UTV2-1056', ['scripts/ops/lease-registry.ts']);
    const drift = validateActiveLeaseForLane(
      {
        issue_id: 'UTV2-1056',
        branch: 'codex/utv2-1056-lease',
        executor: 'codex-cli',
        cwd: path.join(process.cwd(), '.out', 'wrong'),
        file_scope_lock: ['scripts/ops/lease-registry.ts'],
      },
      registryDir,
      new Date('2026-05-18T12:00:00.000Z'),
    );
    const pass = validateActiveLeaseForLane(
      {
        issue_id: 'UTV2-1056',
        branch: 'codex/utv2-1056-lease',
        executor: 'codex-cli',
        cwd: process.cwd(),
        file_scope_lock: ['scripts/ops/lease-registry.ts'],
      },
      registryDir,
      new Date('2026-05-18T12:00:00.000Z'),
    );

    assert.match(missing[0] ?? '', /matching active lease required/);
    assert.match(drift[0] ?? '', /lease cwd mismatch/);
    assert.deepStrictEqual(pass, []);
  });
});
