import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderQuarantineRegistry } from './provider-quarantine.js';
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

  // First two calls fail and trip the circuit
  await assert.rejects(() => cb.call(), /provider down/);
  await assert.rejects(() => cb.call(), /provider down/);

  // Third call — circuit is open — should throw CircuitOpenError, not return fallback
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
  await assert.rejects(() => cb.call(), /provider down/);

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
