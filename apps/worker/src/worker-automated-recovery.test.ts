import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  isEligibleForAutoRecovery,
  isRecoveryEnabled,
  runAutoRecoverySweep,
  MAX_AUTO_RECOVERY_ATTEMPTS,
} from './automated-recovery.js';
import {
  InMemoryOutboxRepository,
  InMemoryAuditLogRepository,
} from '@unit-talk/db';
import type { OutboxRecord, RepositoryBundle } from '@unit-talk/db';

function makeRepos() {
  const outbox = new InMemoryOutboxRepository();
  const audit = new InMemoryAuditLogRepository();
  return { outbox, audit } as unknown as RepositoryBundle;
}

function makeRow(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    id: randomUUID(),
    pick_id: randomUUID(),
    target: 'discord:canary',
    status: 'failed',
    attempt_count: 0,
    last_error: 'fetch failed',
    payload: {},
    idempotency_key: null,
    claimed_at: null,
    claimed_by: null,
    next_attempt_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

test('eligible: failed + transient fetch error', () => {
  assert.equal(isEligibleForAutoRecovery(makeRow({ status: 'failed', last_error: 'fetch failed' })), true);
});

test('eligible: dead_letter + ECONNRESET', () => {
  assert.equal(isEligibleForAutoRecovery(makeRow({ status: 'dead_letter', last_error: 'ECONNRESET', attempt_count: 1 })), true);
});

test('not eligible: pending row', () => {
  assert.equal(isEligibleForAutoRecovery(makeRow({ status: 'pending' })), false);
});

test('not eligible: sent row', () => {
  assert.equal(isEligibleForAutoRecovery(makeRow({ status: 'sent' })), false);
});

test('not eligible: at attempt ceiling', () => {
  assert.equal(isEligibleForAutoRecovery(makeRow({ status: 'failed', attempt_count: MAX_AUTO_RECOVERY_ATTEMPTS })), false);
});

test('not eligible: null last_error', () => {
  assert.equal(isEligibleForAutoRecovery(makeRow({ status: 'failed', last_error: null })), false);
});

test('not eligible: unknown error not in allowlist', () => {
  assert.equal(isEligibleForAutoRecovery(makeRow({ status: 'failed', last_error: 'some random internal error' })), false);
});

test('denylist: foreign key violation', () => {
  assert.equal(isEligibleForAutoRecovery(makeRow({ status: 'failed', last_error: 'violates foreign key constraint' })), false);
});

test('denylist: lifecycle invariant', () => {
  assert.equal(isEligibleForAutoRecovery(makeRow({ status: 'failed', last_error: 'InvalidTransitionError: draft -> settled' })), false);
});

test('denylist: invalid transition', () => {
  assert.equal(isEligibleForAutoRecovery(makeRow({ status: 'failed', last_error: 'invalid transition from queued to draft' })), false);
});

test('denylist: unique constraint', () => {
  assert.equal(isEligibleForAutoRecovery(makeRow({ status: 'failed', last_error: 'duplicate key violates unique constraint' })), false);
});

test('denylist wins over allowlist', () => {
  assert.equal(isEligibleForAutoRecovery(makeRow({ status: 'failed', last_error: 'ECONNRESET while enforcing foreign key constraint' })), false);
});

test('eligible: 503 Service Unavailable', () => {
  assert.equal(isEligibleForAutoRecovery(makeRow({ status: 'failed', last_error: '503 Service Unavailable' })), true);
});

test('eligible: 521 Web server is down', () => {
  assert.equal(isEligibleForAutoRecovery(makeRow({ status: 'failed', last_error: '521 Web server is down' })), true);
});

test('eligible: HTML DOCTYPE response', () => {
  assert.equal(isEligibleForAutoRecovery(makeRow({ status: 'failed', last_error: '<!DOCTYPE html>' })), true);
});

test('eligible: ETIMEDOUT', () => {
  assert.equal(isEligibleForAutoRecovery(makeRow({ status: 'failed', last_error: 'ETIMEDOUT' })), true);
});

test('isRecoveryEnabled returns false when env unset', () => {
  const prev = process.env['AUTOMATED_RECOVERY_ENABLED'];
  delete process.env['AUTOMATED_RECOVERY_ENABLED'];
  try { assert.equal(isRecoveryEnabled(), false); }
  finally { if (prev !== undefined) process.env['AUTOMATED_RECOVERY_ENABLED'] = prev; }
});

test('isRecoveryEnabled returns true when env is true', () => {
  const prev = process.env['AUTOMATED_RECOVERY_ENABLED'];
  process.env['AUTOMATED_RECOVERY_ENABLED'] = 'true';
  try { assert.equal(isRecoveryEnabled(), true); }
  finally {
    if (prev !== undefined) process.env['AUTOMATED_RECOVERY_ENABLED'] = prev;
    else delete process.env['AUTOMATED_RECOVERY_ENABLED'];
  }
});

test('no-op when isEnabled returns false', async () => {
  const result = await runAutoRecoverySweep(makeRepos(), randomUUID(), () => false);
  assert.equal(result.recovered, 0);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.errors, []);
});

test('recovers eligible failed row, resets to pending, emits audit', async () => {
  const repos = makeRepos();
  const outbox = repos.outbox as InMemoryOutboxRepository;
  const pid = randomUUID();
  const row = makeRow({ status: 'failed', last_error: 'fetch failed', attempt_count: 1, pick_id: pid, target: 'discord:canary' });
  outbox['entries'].push(row);
  const correlationId = randomUUID();
  const result = await runAutoRecoverySweep(repos, correlationId, () => true);
  assert.equal(result.recovered, 1);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.errors, []);
  const updated = outbox['entries'].find((e) => e.id === row.id);
  assert.equal(updated?.status, 'pending');
  assert.equal(updated?.last_error, null);
  const audit = repos.audit as InMemoryAuditLogRepository;
  const auditRows = await audit.listRecentByEntityType('distribution_outbox', new Date(0).toISOString(), 'distribution.auto_recovered');
  assert.equal(auditRows.length, 1);
  const a = auditRows[0];
  assert.ok(a, 'audit row must exist');
  assert.equal(a.actor, 'system.automated-recovery');
  assert.equal(a.entity_id, row.id);
  assert.equal(a.entity_ref, pid);
  const p = a.payload as Record<string, unknown>;
  assert.equal(p['correlationId'], correlationId);
  assert.equal(p['recoveryReason'], 'transient_infrastructure_failure');
  assert.equal(p['originalFailureReason'], 'fetch failed');
  assert.equal(p['replayTarget'], 'discord:canary');
  assert.equal(p['recoveryOutcome'], 'reset_to_pending');
  assert.equal(p['previousStatus'], 'failed');
  assert.equal(p['attemptCountBefore'], 1);
});

test('skips ineligible row: denylist match', async () => {
  const repos = makeRepos();
  (repos.outbox as InMemoryOutboxRepository)['entries'].push(
    makeRow({ status: 'failed', last_error: 'violates foreign key constraint' }),
  );
  const result = await runAutoRecoverySweep(repos, randomUUID(), () => true);
  assert.equal(result.recovered, 0);
  assert.equal(result.skipped, 1);
});

test('skips row at attempt ceiling: not returned by query', async () => {
  const repos = makeRepos();
  (repos.outbox as InMemoryOutboxRepository)['entries'].push(
    makeRow({ status: 'failed', last_error: 'fetch failed', attempt_count: MAX_AUTO_RECOVERY_ATTEMPTS }),
  );
  // Rows at ceiling are filtered at DB level — sweep sees nothing to recover
  const result = await runAutoRecoverySweep(repos, randomUUID(), () => true);
  assert.equal(result.recovered, 0);
  assert.equal(result.errors.length, 0);
});

test('duplicate prevention: second sweep finds no eligible rows', async () => {
  const repos = makeRepos();
  const row = makeRow({ status: 'failed', last_error: 'fetch failed' });
  (repos.outbox as InMemoryOutboxRepository)['entries'].push(row);
  const r1 = await runAutoRecoverySweep(repos, randomUUID(), () => true);
  assert.equal(r1.recovered, 1);
  const r2 = await runAutoRecoverySweep(repos, randomUUID(), () => true);
  assert.equal(r2.recovered, 0);
});

test('kill-switch: mid-run disable leaves subsequent rows unprocessed', async () => {
  const repos = makeRepos();
  const outbox = repos.outbox as InMemoryOutboxRepository;
  const row1 = makeRow({ id: randomUUID(), status: 'failed', last_error: 'ECONNRESET' });
  const row2 = makeRow({ id: randomUUID(), status: 'failed', last_error: 'ECONNRESET' });
  outbox['entries'].push(row1, row2);
  let calls = 0;
  const isEnabled = () => { calls++; return calls <= 2; };
  const result = await runAutoRecoverySweep(repos, randomUUID(), isEnabled);
  const r2 = outbox['entries'].find((e) => e.id === row2.id);
  assert.equal(r2?.status, 'failed', 'row2 should remain failed after kill-switch');
  assert.ok(result.recovered <= 1);
});