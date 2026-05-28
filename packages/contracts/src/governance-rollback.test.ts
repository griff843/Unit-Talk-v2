/**
 * Frozen-domain enforcement — adversarial test matrix (UTV2-1179)
 *
 * Covers: assertDomainNotFrozen, isFrozenDomain
 * Constitutional requirement: capital, scaling, ws-3.5, treasury are frozen.
 * All assertions must throw RollbackDomainFrozenError before any auth check.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertDomainNotFrozen,
  isFrozenDomain,
  RollbackDomainFrozenError,
} from './governance-rollback.js';

// ---------------------------------------------------------------------------
// FD-1 through FD-4: All four frozen domains throw
// ---------------------------------------------------------------------------

test('FD-1: assertDomainNotFrozen throws for capital', () => {
  assert.throws(
    () => assertDomainNotFrozen('capital'),
    (err: unknown) => {
      assert.ok(err instanceof RollbackDomainFrozenError, 'must be RollbackDomainFrozenError');
      assert.equal(err.domain, 'capital');
      assert.ok(err.message.includes('ERRCODE=ROLLBACK_DOMAIN_FROZEN'));
      return true;
    },
  );
});

test('FD-2: assertDomainNotFrozen throws for scaling', () => {
  assert.throws(
    () => assertDomainNotFrozen('scaling'),
    (err: unknown) => {
      assert.ok(err instanceof RollbackDomainFrozenError);
      assert.equal(err.domain, 'scaling');
      assert.ok(err.message.includes('ERRCODE=ROLLBACK_DOMAIN_FROZEN'));
      return true;
    },
  );
});

test('FD-3: assertDomainNotFrozen throws for ws-3.5', () => {
  assert.throws(
    () => assertDomainNotFrozen('ws-3.5'),
    (err: unknown) => {
      assert.ok(err instanceof RollbackDomainFrozenError);
      assert.equal(err.domain, 'ws-3.5');
      assert.ok(err.message.includes('ERRCODE=ROLLBACK_DOMAIN_FROZEN'));
      return true;
    },
  );
});

test('FD-4: assertDomainNotFrozen throws for treasury (UTV2-1179)', () => {
  assert.throws(
    () => assertDomainNotFrozen('treasury'),
    (err: unknown) => {
      assert.ok(err instanceof RollbackDomainFrozenError, 'must be RollbackDomainFrozenError');
      assert.equal(err.domain, 'treasury');
      assert.ok(err.message.includes('treasury'));
      assert.ok(err.message.includes('ERRCODE=ROLLBACK_DOMAIN_FROZEN'));
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// FD-5: isFrozenDomain returns true for all four constitutional domains
// ---------------------------------------------------------------------------

test('FD-5: isFrozenDomain returns true for all four frozen domains', () => {
  assert.equal(isFrozenDomain('capital'), true, 'capital must be frozen');
  assert.equal(isFrozenDomain('scaling'), true, 'scaling must be frozen');
  assert.equal(isFrozenDomain('ws-3.5'), true, 'ws-3.5 must be frozen');
  assert.equal(isFrozenDomain('treasury'), true, 'treasury must be frozen (UTV2-1179)');
});

// ---------------------------------------------------------------------------
// FD-6: Non-frozen domains pass through assertDomainNotFrozen without throw
// ---------------------------------------------------------------------------

test('FD-6: assertDomainNotFrozen does not throw for unfrozen domains', () => {
  assert.doesNotThrow(() => assertDomainNotFrozen('picks'));
  assert.doesNotThrow(() => assertDomainNotFrozen('settlement'));
  assert.doesNotThrow(() => assertDomainNotFrozen('operator'));
  assert.doesNotThrow(() => assertDomainNotFrozen('replay'));
  assert.doesNotThrow(() => assertDomainNotFrozen('member'));
});

// ---------------------------------------------------------------------------
// FD-7: isFrozenDomain returns false for non-frozen domains
// ---------------------------------------------------------------------------

test('FD-7: isFrozenDomain returns false for non-frozen domains', () => {
  assert.equal(isFrozenDomain('picks'), false);
  assert.equal(isFrozenDomain('settlement'), false);
  assert.equal(isFrozenDomain('operator'), false);
  assert.equal(isFrozenDomain('replay'), false);
  assert.equal(isFrozenDomain('member'), false);
  assert.equal(isFrozenDomain('TREASURY'), false, 'case-sensitive: TREASURY is not treasury');
  assert.equal(isFrozenDomain(''), false, 'empty string is not frozen');
});

// ---------------------------------------------------------------------------
// FD-8: Adversarial — near-miss strings do not bypass the freeze
// ---------------------------------------------------------------------------

test('FD-8: adversarial near-miss strings are not frozen', () => {
  assert.equal(isFrozenDomain('treasury '), false, 'trailing space must not match');
  assert.equal(isFrozenDomain(' treasury'), false, 'leading space must not match');
  assert.equal(isFrozenDomain('Treasury'), false, 'mixed case must not match');
  assert.equal(isFrozenDomain('ws-3.5 '), false, 'ws-3.5 trailing space must not match');
  assert.equal(isFrozenDomain('capital_'), false, 'capital_ must not match');
});

// ---------------------------------------------------------------------------
// FD-9: RollbackDomainFrozenError shape
// ---------------------------------------------------------------------------

test('FD-9: RollbackDomainFrozenError has correct shape for treasury', () => {
  let caught: unknown;
  try {
    assertDomainNotFrozen('treasury');
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof RollbackDomainFrozenError);
  assert.equal((caught as RollbackDomainFrozenError).code, 'ROLLBACK_DOMAIN_FROZEN');
  assert.equal((caught as RollbackDomainFrozenError).name, 'RollbackDomainFrozenError');
  assert.equal((caught as RollbackDomainFrozenError).domain, 'treasury');
});
