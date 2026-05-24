import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProviderQuarantineRegistry,
  ProviderQuarantinedError,
} from './provider-quarantine.js';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';

// UTV2-1087: Gap #49 — ProviderQuarantineRegistry

test('quarantine() records the provider', () => {
  const registry = new ProviderQuarantineRegistry();
  registry.quarantine('sgo', 'circuit_open', { failureCount: 3 });
  assert.equal(registry.isQuarantined('sgo'), true);
});

test('quarantine() is idempotent — second call does not overwrite', () => {
  const registry = new ProviderQuarantineRegistry();
  registry.quarantine('sgo', 'circuit_open', { failureCount: 3 });
  registry.quarantine('sgo', 'second_reason', { failureCount: 10 });
  const record = registry.getRecord('sgo');
  assert.ok(record);
  assert.equal(record.reason, 'circuit_open');
  assert.equal(record.failureCount, 3);
});

test('quarantine() emits an event even when provider is already quarantined', () => {
  const warnings: string[] = [];
  const registry = new ProviderQuarantineRegistry({
    logger: {
      warn: (msg: string) => { warnings.push(msg); },
      info() {},
    },
  });

  registry.quarantine('sgo', 'circuit_open', { failureCount: 3 });
  registry.quarantine('sgo', 'duplicate_circuit_open', { failureCount: 4 });

  assert.equal(warnings.length, 2);
  const duplicate = JSON.parse(warnings[1] ?? '{}') as {
    reason?: string;
    details?: { active?: boolean };
  };
  assert.equal(duplicate.reason, 'duplicate_circuit_open');
  assert.equal(duplicate.details?.active, false);
  assert.equal(registry.getRecord('sgo')?.reason, 'circuit_open');
});

test('isQuarantined() returns false for unknown provider', () => {
  const registry = new ProviderQuarantineRegistry();
  assert.equal(registry.isQuarantined('unknown_provider'), false);
});

test('release() removes the quarantine record', () => {
  const registry = new ProviderQuarantineRegistry();
  registry.quarantine('sgo', 'circuit_open');
  registry.release('sgo');
  assert.equal(registry.isQuarantined('sgo'), false);
});

test('release() on non-quarantined provider is a no-op', () => {
  const registry = new ProviderQuarantineRegistry();
  assert.doesNotThrow(() => registry.release('sgo'));
});

test('release() on non-quarantined provider still emits a release event', () => {
  const infos: string[] = [];
  const registry = new ProviderQuarantineRegistry({
    logger: {
      warn() {},
      info: (msg: string) => { infos.push(msg); },
    },
  });

  registry.release('sgo', 'manual_release');

  assert.equal(infos.length, 1);
  const parsed = JSON.parse(infos[0] ?? '{}') as {
    event?: string;
    details?: { released?: boolean };
  };
  assert.equal(parsed.event, 'release');
  assert.equal(parsed.details?.released, false);
});

test('assertAvailable() throws ProviderQuarantinedError before provider calls', () => {
  const registry = new ProviderQuarantineRegistry();
  registry.quarantine('sgo', 'circuit_open');

  assert.throws(
    () => registry.assertAvailable('sgo'),
    (error: unknown) =>
      error instanceof ProviderQuarantinedError &&
      error.providerKey === 'sgo',
  );
});

test('listQuarantined() returns all quarantined providers', () => {
  const registry = new ProviderQuarantineRegistry();
  registry.quarantine('sgo', 'reason_a');
  registry.quarantine('odds-api', 'reason_b');
  const list = registry.listQuarantined();
  assert.equal(list.length, 2);
  const keys = list.map((r) => r.providerKey).sort();
  assert.deepEqual(keys, ['odds-api', 'sgo']);
});

test('getRecord() returns undefined for non-quarantined provider', () => {
  const registry = new ProviderQuarantineRegistry();
  assert.equal(registry.getRecord('nonexistent'), undefined);
});

test('quarantine() emits structured JSON log event', () => {
  const warnings: string[] = [];
  const logger = {
    warn: (msg: string) => { warnings.push(msg); },
    info: () => {},
  };
  const registry = new ProviderQuarantineRegistry({ logger });
  registry.quarantine('sgo', 'circuit_open', { failureCount: 5 });
  assert.equal(warnings.length, 1);
  const rawWarning = warnings[0];
  assert.ok(rawWarning, 'Expected a warning message');
  const parsed = JSON.parse(rawWarning) as Record<string, unknown>;
  assert.equal(parsed['event'], 'quarantine');
  assert.equal(parsed['providerKey'], 'sgo');
  assert.equal(parsed['reason'], 'circuit_open');
});

test('release() emits structured JSON log event', () => {
  const infos: string[] = [];
  const logger = {
    warn: () => {},
    info: (msg: string) => { infos.push(msg); },
  };
  const registry = new ProviderQuarantineRegistry({ logger });
  registry.quarantine('sgo', 'circuit_open');
  registry.release('sgo', 'circuit_recovered');
  assert.equal(infos.length, 1);
  const rawInfo = infos[0];
  assert.ok(rawInfo, 'Expected an info message');
  const parsed = JSON.parse(rawInfo) as Record<string, unknown>;
  assert.equal(parsed['event'], 'release');
  assert.equal(parsed['providerKey'], 'sgo');
  assert.equal(parsed['reason'], 'circuit_recovered');
});

// UTV2-1087: Gap #19 — CircuitBreaker fail-closed mode

test('CircuitBreaker fail-closed: throws CircuitOpenError when open', async () => {
  let calls = 0;
  const always_fail = () => { calls++; return Promise.reject(new Error('provider down')); };
  const cb = new CircuitBreaker(always_fail, null, {
    failureThreshold: 2,
    failClosed: true,
    cooldownMs: 60_000,
  });

  // First call fails below threshold; second call trips the circuit.
  await assert.rejects(() => cb.call(), /provider down/);
  await assert.rejects(
    () => cb.call(),
    (err: unknown) => err instanceof CircuitOpenError,
  );

  // Third call — circuit is already open — should throw CircuitOpenError, not return fallback
  await assert.rejects(
    () => cb.call(),
    (err: unknown) => err instanceof CircuitOpenError,
  );
  assert.equal(calls, 2);
});

test('CircuitBreaker fail-open (default): returns fallback when open', async () => {
  const always_fail = () => Promise.reject(new Error('provider down'));
  const cb = new CircuitBreaker(always_fail, 'fallback_value', {
    failureThreshold: 2,
    failClosed: false,
    cooldownMs: 60_000,
  });

  await assert.rejects(() => cb.call(), /provider down/);
  const thresholdResult = await cb.call();
  assert.equal(thresholdResult, 'fallback_value');

  // Third call — circuit open — should return fallback silently
  const result = await cb.call();
  assert.equal(result, 'fallback_value');
});

test('CircuitBreaker fail-closed: CircuitOpenError includes openedAt', async () => {
  const always_fail = () => Promise.reject(new Error('x'));
  const cb = new CircuitBreaker(always_fail, null, {
    failureThreshold: 1,
    failClosed: true,
    cooldownMs: 60_000,
  });

  // Trip the circuit
  await assert.rejects(() => cb.call());

  try {
    await cb.call();
    assert.fail('Expected CircuitOpenError');
  } catch (err) {
    assert.ok(err instanceof CircuitOpenError);
    assert.ok(typeof err.openedAt === 'number');
  }
});

test('CircuitBreaker uses per-call function override while preserving breaker state', async () => {
  let currentTime = 1000;
  const cb = new CircuitBreaker(async () => 'unused', 'fallback', {
    failureThreshold: 2,
    cooldownMs: 60_000,
    now: () => currentTime,
  });

  await assert.rejects(
    () => cb.call(async () => { throw new Error('first failure'); }),
    /first failure/,
  );
  const fallback = await cb.call(async () => { throw new Error('second failure'); });
  assert.equal(fallback, 'fallback');
  assert.equal(cb.state, 'open');

  currentTime += 60_001;
  const recovered = await cb.call(async () => 'fresh closure');
  assert.equal(recovered, 'fresh closure');
  assert.equal(cb.state, 'closed');
});
