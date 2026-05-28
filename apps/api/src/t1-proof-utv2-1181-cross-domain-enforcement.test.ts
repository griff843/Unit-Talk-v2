/**
 * T1 Proof — UTV2-1181 CR-2 — Enforce cross_domain_allowed in Authority Enforcement
 *
 * Adversarial assertions covering cross-domain restriction enforcement:
 *   XD-1: roles with cross_domain_allowed=false are rejected for multi-domain ops
 *   XD-2: roles with cross_domain_allowed=true are permitted for multi-domain ops
 *   XD-3: single-domain calls always pass regardless of cross_domain_allowed
 *   XD-4: unknown role is rejected fail-closed for multi-domain ops
 *   XD-5: enforceAllAuthorities enforces cross_domain_allowed before domain checks
 *   XD-6: assertCrossDomainAllowed is deterministic and replay-safe
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertCrossDomainAllowed,
  AuthorityViolationError,
  AUTHORITY_MATRIX,
} from '@unit-talk/contracts';

import { enforceAllAuthorities, enforceAuthority } from './authority-enforcement.js';

const AUTHORIZED_CONTEXT = { role: 'operator', identity: 'test-operator' } as const;
const RESTRICTED_CONTEXT = { role: 'submitter', identity: 'test-submitter' } as const;
const SETTLER_CONTEXT = { role: 'settler', identity: 'test-settler' } as const;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const UNKNOWN_CONTEXT = { role: 'unknown-role' as any, identity: 'test-unknown' };

// ── XD-1: restricted roles rejected for multi-domain ops ───────────────────

test('XD-1a: submitter with cross_domain_allowed=false rejected for 2-domain op', () => {
  assert.throws(
    () => assertCrossDomainAllowed('submitter', ['picks:submit', 'picks:read']),
    (err: unknown) => {
      assert.ok(err instanceof AuthorityViolationError);
      assert.equal(err.code, 'AUTHORITY_VIOLATION');
      assert.ok(err.message.includes('cross_domain_allowed=false'));
      return true;
    },
  );
});

test('XD-1b: settler with cross_domain_allowed=false rejected for 2-domain op', () => {
  assert.throws(
    () => assertCrossDomainAllowed('settler', ['picks:settle', 'settlement:record']),
    (err: unknown) => {
      assert.ok(err instanceof AuthorityViolationError);
      assert.ok(err.message.includes('cross_domain_allowed=false'));
      return true;
    },
  );
});

test('XD-1c: poster with cross_domain_allowed=false rejected for 2-domain op', () => {
  assert.throws(
    () => assertCrossDomainAllowed('poster', ['picks:post', 'outbox:enqueue']),
    (err: unknown) => {
      assert.ok(err instanceof AuthorityViolationError);
      return true;
    },
  );
});

// ── XD-2: authorized roles permitted for multi-domain ops ──────────────────

test('XD-2a: operator with cross_domain_allowed=true passes 2-domain check', () => {
  assert.doesNotThrow(() =>
    assertCrossDomainAllowed('operator', ['picks:override', 'promotion:evaluate']),
  );
});

test('XD-2b: operator passes 3-domain check', () => {
  assert.doesNotThrow(() =>
    assertCrossDomainAllowed('operator', ['picks:read', 'picks:void', 'operator:admin']),
  );
});

// ── XD-3: single-domain calls always pass ───────────────────────────────────

test('XD-3a: submitter single-domain passes assertCrossDomainAllowed', () => {
  assert.doesNotThrow(() =>
    assertCrossDomainAllowed('submitter', ['picks:submit']),
  );
});

test('XD-3b: empty domains array passes (no-op)', () => {
  assert.doesNotThrow(() => assertCrossDomainAllowed('submitter', []));
});

test('XD-3c: enforceAuthority (single-domain) is unaffected for restricted roles', () => {
  assert.doesNotThrow(() => enforceAuthority(RESTRICTED_CONTEXT, 'picks:submit'));
});

// ── XD-4: unknown role rejected fail-closed for multi-domain ────────────────

test('XD-4: unknown role rejected for multi-domain op', () => {
  assert.throws(
    () => assertCrossDomainAllowed('unknown-role', ['picks:submit', 'picks:read']),
    (err: unknown) => {
      assert.ok(err instanceof AuthorityViolationError);
      assert.ok(err.message.includes('unknown role'));
      return true;
    },
  );
});

// ── XD-5: enforceAllAuthorities enforces cross_domain_allowed ───────────────

test('XD-5a: enforceAllAuthorities rejects submitter for 2-domain op', () => {
  assert.throws(
    () => enforceAllAuthorities(RESTRICTED_CONTEXT, ['picks:submit', 'picks:read']),
    (err: unknown) => {
      assert.ok(err instanceof AuthorityViolationError);
      assert.ok(err.message.includes('cross_domain_allowed=false'));
      return true;
    },
  );
});

test('XD-5b: enforceAllAuthorities allows operator for multi-domain op', () => {
  assert.doesNotThrow(() =>
    enforceAllAuthorities(AUTHORIZED_CONTEXT, ['picks:read', 'picks:void']),
  );
});

test('XD-5c: enforceAllAuthorities still rejects unauthorized domain even for operator', () => {
  assert.throws(
    () => enforceAllAuthorities(AUTHORIZED_CONTEXT, ['picks:read', 'picks:settle']),
    (err: unknown) => {
      assert.ok(err instanceof AuthorityViolationError);
      assert.ok(err.message.includes('not authorized for domain'));
      return true;
    },
  );
});

test('XD-5d: enforceAllAuthorities rejects settler for cross-domain outbox op', () => {
  assert.throws(
    () => enforceAllAuthorities(SETTLER_CONTEXT, ['picks:settle', 'outbox:deliver']),
    AuthorityViolationError,
  );
});

test('XD-5e: enforceAllAuthorities single-domain still works for restricted roles', () => {
  assert.doesNotThrow(() =>
    enforceAllAuthorities(RESTRICTED_CONTEXT, ['picks:submit']),
  );
});

// ── XD-6: deterministic and replay-safe ─────────────────────────────────────

test('XD-6a: assertCrossDomainAllowed is deterministic — same inputs same result', () => {
  const run1 = () => assertCrossDomainAllowed('submitter', ['picks:submit', 'picks:read']);
  const run2 = () => assertCrossDomainAllowed('submitter', ['picks:submit', 'picks:read']);
  assert.throws(run1, AuthorityViolationError);
  assert.throws(run2, AuthorityViolationError);
});

test('XD-6b: AUTHORITY_MATRIX cross_domain_allowed values are stable', () => {
  const operatorRole = AUTHORITY_MATRIX.roles.find((r) => r.id === 'operator');
  assert.ok(operatorRole, 'operator role must exist');
  assert.equal(operatorRole.cross_domain_allowed, true);

  const restrictedRoles = AUTHORITY_MATRIX.roles.filter((r) => r.id !== 'operator');
  for (const role of restrictedRoles) {
    assert.equal(
      role.cross_domain_allowed,
      false,
      `role '${role.id}' must have cross_domain_allowed=false`,
    );
  }
});

test('XD-6c: enforceAllAuthorities rejects unknown role fail-closed for multi-domain', () => {
  assert.throws(
    () => enforceAllAuthorities(UNKNOWN_CONTEXT, ['picks:submit', 'picks:read']),
    AuthorityViolationError,
  );
});
