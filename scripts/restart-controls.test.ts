import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MANUAL_APPROVAL_BOUNDARY,
  RESTART_POLICY,
  createRestartAuditEntry,
  evaluateRestartRequest,
} from './restart-controls.js';

test('restart controls deny services outside the allowlist with the manual approval boundary', () => {
  const decision = evaluateRestartRequest({
    service: 'postgres',
    history: [],
    now: new Date('2026-04-29T15:00:00.000Z'),
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'service_not_allowed');
  assert.match(decision.message, /not on the restart allowlist/i);
  assert.match(decision.message, /Manual approval boundary/i);
  assert.match(decision.message, new RegExp(MANUAL_APPROVAL_BOUNDARY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('restart controls enforce per-service cooldowns', () => {
  const history = [
    createRestartAuditEntry({
      service: 'api',
      outcome: 'allowed',
      reason: 'executed',
      message: 'Restart allowed',
      now: new Date('2026-04-29T15:00:00.000Z'),
    }),
  ];

  const decision = evaluateRestartRequest({
    service: 'api',
    history,
    now: new Date('2026-04-29T15:03:00.000Z'),
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'cooldown');
  assert.match(decision.message, /cooldown/i);
  assert.match(decision.message, /120s/);
});

test('restart controls enforce a global restart rate limit across services', () => {
  const now = new Date('2026-04-29T16:00:00.000Z');
  const history = [
    'api',
    'worker',
    'ingestor',
    'api',
    'worker',
    'ingestor',
  ].map((service, index) =>
    createRestartAuditEntry({
      service,
      outcome: 'allowed',
      reason: 'executed',
      message: 'Restart allowed',
      now: new Date(now.getTime() - index * 5 * 60_000),
    }),
  );

  const decision = evaluateRestartRequest({
    service: 'worker',
    history,
    now,
  });

  assert.equal(history.length, RESTART_POLICY.globalLimit);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'global_rate_limit');
  assert.match(decision.message, /global restart rate limit/i);
});

test('restart controls allow restart when history is outside cooldown and global windows', () => {
  const history = [
    createRestartAuditEntry({
      service: 'api',
      outcome: 'allowed',
      reason: 'executed',
      message: 'Restart allowed',
      now: new Date('2026-04-29T10:00:00.000Z'),
    }),
  ];

  const decision = evaluateRestartRequest({
    service: 'api',
    history,
    now: new Date('2026-04-29T16:00:00.000Z'),
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'executed');
  assert.match(decision.message, /Restart allowed/i);
});
