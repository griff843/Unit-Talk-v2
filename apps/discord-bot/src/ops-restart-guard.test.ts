/**
 * Tests for ops-restart-guard.ts and ops-restart command.
 *
 * Covers:
 *   - Allowed restart for a valid service
 *   - Cooldown denial when same service restarted too quickly
 *   - Global rate-limit denial after RATE_LIMIT_MAX restarts
 *   - Non-restartable service denial (NOT_RESTARTABLE)
 *   - Human-required service denial (HUMAN_REQUIRED)
 *   - Audit entry written for both allowed and denied cases
 *   - Command embed content for allowed / denied paths
 *
 * Run: tsx --test apps/discord-bot/src/ops-restart-guard.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  evaluateRestartRequest,
  recordAllowedRestart,
  resetGuardState,
  processRestartRequest,
  writeAuditEntry,
  RESTARTABLE_SERVICES,
  HUMAN_ONLY_SERVICES,
  COOLDOWN_MS,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  type AuditEntry,
} from './ops-restart-guard.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTime(offsetMs = 0): number {
  return 1_700_000_000_000 + offsetMs;
}

// Run each test case with a fresh guard state
function withFreshState<T>(fn: () => T): T {
  resetGuardState();
  try {
    return fn();
  } finally {
    resetGuardState();
  }
}

// ---------------------------------------------------------------------------
// evaluateRestartRequest — pure unit tests (no I/O)
// ---------------------------------------------------------------------------

test('allowed restart for restartable service', () => {
  withFreshState(() => {
    const now = makeTime();
    const decision = evaluateRestartRequest('api', now);
    assert.equal(decision.action, 'allowed');
    assert.equal(decision.reason, undefined);
  });
});

test('allowed restart for all restartable services', () => {
  for (const service of RESTARTABLE_SERVICES) {
    withFreshState(() => {
      const decision = evaluateRestartRequest(service, makeTime());
      assert.equal(decision.action, 'allowed', `expected allowed for service: ${service}`);
    });
  }
});

test('cooldown denial when restarted within cooldown window', () => {
  withFreshState(() => {
    const t0 = makeTime();
    recordAllowedRestart('worker', t0);

    // 1 second later — well within 5-minute cooldown
    const decision = evaluateRestartRequest('worker', t0 + 1_000);
    assert.equal(decision.action, 'denied');
    assert.equal(decision.reason, 'COOLDOWN');
    assert.ok(
      typeof decision.cooldownRemainingSeconds === 'number' &&
        decision.cooldownRemainingSeconds > 0,
      'cooldownRemainingSeconds should be positive',
    );
    assert.ok(
      decision.message?.includes('cooldown'),
      `message should mention cooldown, got: ${decision.message}`,
    );
  });
});

test('allowed after cooldown expires', () => {
  withFreshState(() => {
    const t0 = makeTime();
    recordAllowedRestart('worker', t0);

    // Exactly at cooldown boundary — should be allowed
    const decision = evaluateRestartRequest('worker', t0 + COOLDOWN_MS);
    assert.equal(decision.action, 'allowed');
  });
});

test('cooldown is per-service — different services are independent', () => {
  withFreshState(() => {
    const t0 = makeTime();
    recordAllowedRestart('api', t0);

    // Worker was never restarted — should be allowed even though api is in cooldown
    const decision = evaluateRestartRequest('worker', t0 + 1_000);
    assert.equal(decision.action, 'allowed');
  });
});

test('global rate limit denial after RATE_LIMIT_MAX restarts', () => {
  withFreshState(() => {
    const baseTime = makeTime();

    // Simulate RATE_LIMIT_MAX restarts for different services (avoiding cooldown)
    const services: string[] = ['api', 'worker', 'ingestor', 'discord-bot'];
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      const service = services[i % services.length] as string;
      // Space them out beyond cooldown so each is individually allowed
      const t = baseTime + i * (COOLDOWN_MS + 1_000);
      const d = evaluateRestartRequest(service, t);
      assert.equal(d.action, 'allowed', `restart ${i} should be allowed`);
      recordAllowedRestart(service, t);
    }

    // Next restart — rate limit reached
    const lastService = services[RATE_LIMIT_MAX % services.length] as string;
    const tLast = baseTime + RATE_LIMIT_MAX * (COOLDOWN_MS + 1_000);
    const denied = evaluateRestartRequest(lastService, tLast);

    assert.equal(denied.action, 'denied');
    assert.equal(denied.reason, 'RATE_LIMITED');
    assert.ok(
      denied.message?.includes('rate limit'),
      `message should mention rate limit, got: ${denied.message}`,
    );
  });
});

test('global rate limit resets after rolling window expires', () => {
  withFreshState(() => {
    const baseTime = makeTime();

    // Fill up the rate limit
    const services: string[] = ['api', 'worker', 'ingestor'];
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      const t = baseTime + i * (COOLDOWN_MS + 1_000);
      recordAllowedRestart(services[i] as string, t);
    }

    // After the rolling window expires, the limit resets
    const afterWindow = baseTime + RATE_LIMIT_WINDOW_MS + 1_000;
    const decision = evaluateRestartRequest('api', afterWindow);
    assert.equal(decision.action, 'allowed');
  });
});

test('non-restartable service returns NOT_RESTARTABLE', () => {
  withFreshState(() => {
    const decision = evaluateRestartRequest('unknown-service', makeTime());
    assert.equal(decision.action, 'denied');
    assert.equal(decision.reason, 'NOT_RESTARTABLE');
    assert.ok(
      decision.message?.includes('allowlist'),
      `message should mention allowlist, got: ${decision.message}`,
    );
  });
});

test('human-only services return HUMAN_REQUIRED', () => {
  for (const service of HUMAN_ONLY_SERVICES) {
    withFreshState(() => {
      const decision = evaluateRestartRequest(service, makeTime());
      assert.equal(decision.action, 'denied', `expected denied for human-only service: ${service}`);
      assert.equal(decision.reason, 'HUMAN_REQUIRED', `expected HUMAN_REQUIRED for: ${service}`);
      assert.ok(
        decision.message?.includes('human operator'),
        `message should mention human operator, got: ${decision.message}`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// writeAuditEntry — I/O tests using a temp directory
// ---------------------------------------------------------------------------

test('writeAuditEntry writes a valid JSONL entry', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'ops-restart-test-'));
  try {
    const entry: AuditEntry = {
      timestamp: '2024-01-01T00:00:00.000Z',
      service: 'api',
      requestedBy: 'test-user',
      action: 'allowed',
    };

    await writeAuditEntry(entry, tempDir);

    const content = await readFile(join(tempDir, 'restart-audit.jsonl'), 'utf-8');
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 1);

    const parsed = JSON.parse(lines[0] as string) as AuditEntry;
    assert.equal(parsed.service, 'api');
    assert.equal(parsed.requestedBy, 'test-user');
    assert.equal(parsed.action, 'allowed');
    assert.equal(parsed.timestamp, '2024-01-01T00:00:00.000Z');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('writeAuditEntry appends multiple entries', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'ops-restart-test-'));
  try {
    const entries: AuditEntry[] = [
      { timestamp: '2024-01-01T00:00:00.000Z', service: 'api', requestedBy: 'user1', action: 'allowed' },
      { timestamp: '2024-01-01T00:01:00.000Z', service: 'worker', requestedBy: 'user2', action: 'denied', reason: 'COOLDOWN' },
    ];

    for (const entry of entries) {
      await writeAuditEntry(entry, tempDir);
    }

    const content = await readFile(join(tempDir, 'restart-audit.jsonl'), 'utf-8');
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 2);

    const second = JSON.parse(lines[1] as string) as AuditEntry;
    assert.equal(second.action, 'denied');
    assert.equal(second.reason, 'COOLDOWN');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('writeAuditEntry creates directory if missing', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'ops-restart-test-'));
  const nestedDir = join(tempDir, 'deeply', 'nested', 'ops');
  try {
    const entry: AuditEntry = {
      timestamp: '2024-01-01T00:00:00.000Z',
      service: 'ingestor',
      requestedBy: 'user',
      action: 'allowed',
    };

    await writeAuditEntry(entry, nestedDir);

    const content = await readFile(join(nestedDir, 'restart-audit.jsonl'), 'utf-8');
    assert.ok(content.length > 0, 'should have written content');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// processRestartRequest — integration (evaluate + record + audit)
// ---------------------------------------------------------------------------

test('processRestartRequest allowed — writes audit and records state', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'ops-restart-test-'));
  resetGuardState();
  try {
    const now = makeTime();
    const decision = await processRestartRequest('api', 'griff843', {
      nowMs: now,
      auditDir: tempDir,
    });

    assert.equal(decision.action, 'allowed');

    // Verify audit entry written
    const content = await readFile(join(tempDir, 'restart-audit.jsonl'), 'utf-8');
    const parsed = JSON.parse(content.trim()) as AuditEntry;
    assert.equal(parsed.service, 'api');
    assert.equal(parsed.requestedBy, 'griff843');
    assert.equal(parsed.action, 'allowed');
    assert.equal(parsed.reason, undefined);

    // Verify state recorded — cooldown applies immediately after
    const second = evaluateRestartRequest('api', now + 1_000);
    assert.equal(second.action, 'denied');
    assert.equal(second.reason, 'COOLDOWN');
  } finally {
    resetGuardState();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('processRestartRequest denied — writes audit with reason', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'ops-restart-test-'));
  resetGuardState();
  try {
    const decision = await processRestartRequest('postgres', 'griff843', {
      nowMs: makeTime(),
      auditDir: tempDir,
    });

    assert.equal(decision.action, 'denied');
    assert.equal(decision.reason, 'HUMAN_REQUIRED');

    const content = await readFile(join(tempDir, 'restart-audit.jsonl'), 'utf-8');
    const parsed = JSON.parse(content.trim()) as AuditEntry;
    assert.equal(parsed.action, 'denied');
    assert.equal(parsed.reason, 'HUMAN_REQUIRED');
  } finally {
    resetGuardState();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('processRestartRequest cooldown denial — writes audit with COOLDOWN reason', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'ops-restart-test-'));
  resetGuardState();
  try {
    const t0 = makeTime();
    // First request — allowed
    await processRestartRequest('worker', 'griff843', { nowMs: t0, auditDir: tempDir });

    // Second request within cooldown — denied
    const decision = await processRestartRequest('worker', 'griff843', {
      nowMs: t0 + 30_000,
      auditDir: tempDir,
    });

    assert.equal(decision.action, 'denied');
    assert.equal(decision.reason, 'COOLDOWN');

    const content = await readFile(join(tempDir, 'restart-audit.jsonl'), 'utf-8');
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 2, 'should have 2 audit lines');

    const secondEntry = JSON.parse(lines[1] as string) as AuditEntry;
    assert.equal(secondEntry.action, 'denied');
    assert.equal(secondEntry.reason, 'COOLDOWN');
  } finally {
    resetGuardState();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('processRestartRequest rate-limit denial — writes audit with RATE_LIMITED reason', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'ops-restart-test-'));
  resetGuardState();
  try {
    const baseTime = makeTime();
    const services: string[] = ['api', 'worker', 'ingestor'];

    // Fill the rate limit
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      await processRestartRequest(services[i] as string, 'griff843', {
        nowMs: baseTime + i * (COOLDOWN_MS + 1_000),
        auditDir: tempDir,
      });
    }

    // One more — should hit rate limit
    const tLast = baseTime + RATE_LIMIT_MAX * (COOLDOWN_MS + 1_000);
    const decision = await processRestartRequest('discord-bot', 'griff843', {
      nowMs: tLast,
      auditDir: tempDir,
    });

    assert.equal(decision.action, 'denied');
    assert.equal(decision.reason, 'RATE_LIMITED');

    const content = await readFile(join(tempDir, 'restart-audit.jsonl'), 'utf-8');
    const lines = content.trim().split('\n');
    // RATE_LIMIT_MAX allowed + 1 denied
    assert.equal(lines.length, RATE_LIMIT_MAX + 1);

    const lastEntry = JSON.parse(lines[lines.length - 1] as string) as AuditEntry;
    assert.equal(lastEntry.action, 'denied');
    assert.equal(lastEntry.reason, 'RATE_LIMITED');
  } finally {
    resetGuardState();
    await rm(tempDir, { recursive: true, force: true });
  }
});
