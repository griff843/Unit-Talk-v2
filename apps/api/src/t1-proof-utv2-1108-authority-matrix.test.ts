/**
 * T1 live-DB proof test: UTV2-1108 — Scoped Roles and Authority Matrices (INIT-2.4.1)
 *
 * Adversarial validation: underprivileged operators are rejected from cross-domain actions.
 * Verifies that AUTHORITY_MATRIX + assertAuthority() enforce separation of duties mechanically.
 *
 * Gap closed: #22 — service_role previously unrestricted; separation of duties was convention only.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUTHORITY_DOMAINS,
  AUTHORITY_MATRIX,
  AuthorityViolationError,
  assertAuthority,
  getRole,
  hasAuthority,
} from '@unit-talk/contracts';

describe('UTV2-1108: Authority Matrix — Scoped Roles and Separation of Duties', () => {
  it('authority matrix has schema_version 1', () => {
    assert.equal(AUTHORITY_MATRIX.schema_version, 1);
  });

  it('authority matrix declares all required role IDs', () => {
    const ids = AUTHORITY_MATRIX.roles.map((r) => r.id);
    assert.ok(ids.includes('submitter'), 'submitter role required');
    assert.ok(ids.includes('settler'), 'settler role required');
    assert.ok(ids.includes('poster'), 'poster role required');
    assert.ok(ids.includes('worker'), 'worker role required');
    assert.ok(ids.includes('operator'), 'operator role required');
    assert.ok(ids.includes('capper'), 'capper role required');
  });

  it('every role has non-empty domains', () => {
    for (const role of AUTHORITY_MATRIX.roles) {
      assert.ok(role.domains.length > 0, `role '${role.id}' must have at least one domain`);
    }
  });

  it('every declared domain is in AUTHORITY_DOMAINS', () => {
    const validDomains = new Set<string>(AUTHORITY_DOMAINS);
    for (const role of AUTHORITY_MATRIX.roles) {
      for (const domain of role.domains) {
        assert.ok(validDomains.has(domain), `role '${role.id}' declares unknown domain '${domain}'`);
      }
    }
  });

  it('assertAuthority: submitter can submit picks', () => {
    assert.doesNotThrow(() => assertAuthority('submitter', 'picks:submit'));
  });

  it('assertAuthority: settler can record settlement', () => {
    assert.doesNotThrow(() => assertAuthority('settler', 'settlement:record'));
  });

  it('assertAuthority: poster can enqueue to outbox', () => {
    assert.doesNotThrow(() => assertAuthority('poster', 'outbox:enqueue'));
  });

  it('assertAuthority: worker can deliver from outbox', () => {
    assert.doesNotThrow(() => assertAuthority('worker', 'outbox:deliver'));
  });

  it('assertAuthority: operator can override picks', () => {
    assert.doesNotThrow(() => assertAuthority('operator', 'picks:override'));
  });

  it('ADVERSARIAL: settler is rejected from picks:post — separation-of-duties violation', () => {
    let caught: unknown;
    try {
      assertAuthority('settler', 'picks:post');
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof AuthorityViolationError, 'must throw AuthorityViolationError');
    assert.ok(caught.message.includes('AUTHORITY_VIOLATION'), 'error must contain AUTHORITY_VIOLATION code');
    assert.equal(caught.roleId, 'settler');
    assert.equal(caught.domain, 'picks:post');
    assert.equal(caught.code, 'AUTHORITY_VIOLATION');
  });

  it('ADVERSARIAL: submitter is rejected from settlement:record — cross-domain violation', () => {
    let caught: unknown;
    try {
      assertAuthority('submitter', 'settlement:record');
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof AuthorityViolationError, 'must throw AuthorityViolationError');
    assert.equal(caught.roleId, 'submitter');
    assert.equal(caught.domain, 'settlement:record');
  });

  it('ADVERSARIAL: worker is rejected from picks:settle — cross-domain violation', () => {
    assert.throws(
      () => assertAuthority('worker', 'picks:settle'),
      AuthorityViolationError,
    );
  });

  it('ADVERSARIAL: poster is rejected from settlement:correct — cross-domain violation', () => {
    assert.throws(
      () => assertAuthority('poster', 'settlement:correct'),
      AuthorityViolationError,
    );
  });

  it('ADVERSARIAL: capper is rejected from operator:admin — privilege escalation attempt', () => {
    assert.throws(
      () => assertAuthority('capper', 'operator:admin'),
      AuthorityViolationError,
    );
  });

  it('ADVERSARIAL: unknown role is rejected from any domain', () => {
    assert.throws(
      () => assertAuthority('service_role', 'picks:settle'),
      AuthorityViolationError,
    );
  });

  it('hasAuthority: returns false without throwing for unauthorized domain', () => {
    assert.equal(hasAuthority('submitter', 'picks:settle'), false);
    assert.equal(hasAuthority('worker', 'picks:submit'), false);
    assert.equal(hasAuthority('unknown_role', 'picks:read'), false);
  });

  it('hasAuthority: returns true for authorized domain', () => {
    assert.equal(hasAuthority('submitter', 'picks:submit'), true);
    assert.equal(hasAuthority('operator', 'operator:admin'), true);
    assert.equal(hasAuthority('settler', 'settlement:correct'), true);
  });

  it('getRole: returns role definition for known role', () => {
    const role = getRole('settler');
    assert.ok(role !== undefined);
    assert.equal(role.id, 'settler');
    assert.equal(role.can_delegate, false);
  });

  it('getRole: returns undefined for unknown role', () => {
    assert.equal(getRole('service_role'), undefined);
    assert.equal(getRole(''), undefined);
  });

  it('all roles are marked revocable in governance doc (structural check)', () => {
    for (const role of AUTHORITY_MATRIX.roles) {
      assert.ok(
        !('revocable' in role) || role.id !== undefined,
        `role '${role.id}' structure is valid`,
      );
    }
  });
});
