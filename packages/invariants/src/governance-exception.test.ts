/**
 * GovernanceException tests (UTV2-1104 / INIT-2.3.1)
 *
 * Uses node:test + node:assert/strict — NOT Jest.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createGovernanceException,
  GovernanceExceptionValidationError,
} from './governance-exception.js';
import type { GovernanceExceptionInput } from './governance-exception.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function futureISO(offsetMs = 60_000): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function validInput(overrides: Partial<GovernanceExceptionInput> = {}): GovernanceExceptionInput {
  return {
    scope: 'INV-0009',
    type: 'temporary-bypass',
    authorization: {
      approver: 'alice@example.com',
      secondaryApprover: 'bob@example.com',
      authorizedAt: new Date().toISOString(),
    },
    justification: 'Necessary for scheduled maintenance window',
    expiration: futureISO(3_600_000), // 1 hour from now
    rollbackCondition: 'Maintenance window ends or alert fired',
    auditRef: 'AUDIT-2026-001',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Valid complete exception — created successfully, has id + createdAt + status='active'
// ---------------------------------------------------------------------------

test('valid complete exception is created with id, createdAt, and status active', () => {
  const { exception } = createGovernanceException(validInput());
  assert.ok(typeof exception.id === 'string' && exception.id.length > 0, 'id must be non-empty');
  assert.ok(typeof exception.createdAt === 'string', 'createdAt must be a string');
  assert.ok(!isNaN(new Date(exception.createdAt).getTime()), 'createdAt must be valid ISO-8601');
  assert.equal(exception.status, 'active');
  assert.equal(exception.scope, 'INV-0009');
  assert.equal(exception.type, 'temporary-bypass');
});

// ---------------------------------------------------------------------------
// 2. Valid exception — auditEvent emitted with correct fields
// ---------------------------------------------------------------------------

test('valid exception produces auditEvent with correct fields', () => {
  const input = validInput();
  const { exception, auditEvent } = createGovernanceException(input);

  assert.ok(typeof auditEvent.id === 'string' && auditEvent.id.length > 0, 'auditEvent.id must be non-empty');
  assert.equal(auditEvent.immutable, true);
  assert.equal(auditEvent.payload['entity_type'], 'governance_exception');
  assert.equal(auditEvent.payload['action'], 'created');
  assert.equal(auditEvent.payload['exception_id'], exception.id);
  assert.equal(auditEvent.payload['scope'], input.scope);
  assert.equal(auditEvent.payload['type'], input.type);
  assert.equal(auditEvent.payload['approver'], input.authorization.approver);
  assert.equal(auditEvent.payload['secondaryApprover'], input.authorization.secondaryApprover);
  assert.equal(auditEvent.payload['expiration'], input.expiration);
  assert.equal(auditEvent.payload['auditRef'], input.auditRef);
});

// ---------------------------------------------------------------------------
// 3. Missing scope → throws GovernanceExceptionValidationError
// ---------------------------------------------------------------------------

test('missing scope throws GovernanceExceptionValidationError', () => {
  assert.throws(
    () => createGovernanceException(validInput({ scope: '' })),
    (err: unknown) => {
      assert.ok(err instanceof GovernanceExceptionValidationError, 'must be GovernanceExceptionValidationError');
      assert.equal(err.field, 'scope');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// 4. Missing approver → throws
// ---------------------------------------------------------------------------

test('missing approver throws GovernanceExceptionValidationError', () => {
  assert.throws(
    () =>
      createGovernanceException(
        validInput({ authorization: { approver: '', secondaryApprover: 'bob@example.com', authorizedAt: new Date().toISOString() } }),
      ),
    (err: unknown) => {
      assert.ok(err instanceof GovernanceExceptionValidationError);
      assert.equal(err.field, 'authorization.approver');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// 5. Missing secondaryApprover → throws
// ---------------------------------------------------------------------------

test('missing secondaryApprover throws GovernanceExceptionValidationError', () => {
  assert.throws(
    () =>
      createGovernanceException(
        validInput({ authorization: { approver: 'alice@example.com', secondaryApprover: '', authorizedAt: new Date().toISOString() } }),
      ),
    (err: unknown) => {
      assert.ok(err instanceof GovernanceExceptionValidationError);
      assert.equal(err.field, 'authorization.secondaryApprover');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// 6. Same approver and secondaryApprover → throws (no self-approval)
// ---------------------------------------------------------------------------

test('same approver and secondaryApprover throws GovernanceExceptionValidationError', () => {
  assert.throws(
    () =>
      createGovernanceException(
        validInput({ authorization: { approver: 'alice@example.com', secondaryApprover: 'alice@example.com', authorizedAt: new Date().toISOString() } }),
      ),
    (err: unknown) => {
      assert.ok(err instanceof GovernanceExceptionValidationError);
      assert.equal(err.field, 'authorization.secondaryApprover');
      assert.ok(err.message.includes('self-approval'), `expected self-approval message, got: ${err.message}`);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// 7. Empty justification → throws
// ---------------------------------------------------------------------------

test('empty justification throws GovernanceExceptionValidationError', () => {
  assert.throws(
    () => createGovernanceException(validInput({ justification: '' })),
    (err: unknown) => {
      assert.ok(err instanceof GovernanceExceptionValidationError);
      assert.equal(err.field, 'justification');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// 8. Short justification (< 10 chars) → throws
// ---------------------------------------------------------------------------

test('short justification (< 10 chars) throws GovernanceExceptionValidationError', () => {
  assert.throws(
    () => createGovernanceException(validInput({ justification: 'Fix it' })),
    (err: unknown) => {
      assert.ok(err instanceof GovernanceExceptionValidationError);
      assert.equal(err.field, 'justification');
      assert.ok(err.message.includes('10 characters'), `expected min-length message, got: ${err.message}`);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// 9. Missing expiration → throws
// ---------------------------------------------------------------------------

test('missing expiration throws GovernanceExceptionValidationError', () => {
  assert.throws(
    () => createGovernanceException(validInput({ expiration: '' })),
    (err: unknown) => {
      assert.ok(err instanceof GovernanceExceptionValidationError);
      assert.equal(err.field, 'expiration');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// 10. Past expiration date → throws
// ---------------------------------------------------------------------------

test('past expiration date throws GovernanceExceptionValidationError', () => {
  const pastDate = new Date(Date.now() - 60_000).toISOString();
  assert.throws(
    () => createGovernanceException(validInput({ expiration: pastDate })),
    (err: unknown) => {
      assert.ok(err instanceof GovernanceExceptionValidationError);
      assert.equal(err.field, 'expiration');
      assert.ok(err.message.includes('future'), `expected future-datetime message, got: ${err.message}`);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// 11. Missing rollbackCondition → throws
// ---------------------------------------------------------------------------

test('missing rollbackCondition throws GovernanceExceptionValidationError', () => {
  assert.throws(
    () => createGovernanceException(validInput({ rollbackCondition: '' })),
    (err: unknown) => {
      assert.ok(err instanceof GovernanceExceptionValidationError);
      assert.equal(err.field, 'rollbackCondition');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// 12. Missing auditRef → throws
// ---------------------------------------------------------------------------

test('missing auditRef throws GovernanceExceptionValidationError', () => {
  assert.throws(
    () => createGovernanceException(validInput({ auditRef: '' })),
    (err: unknown) => {
      assert.ok(err instanceof GovernanceExceptionValidationError);
      assert.equal(err.field, 'auditRef');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// 13. Missing type → throws
// ---------------------------------------------------------------------------

test('missing type throws GovernanceExceptionValidationError', () => {
  assert.throws(
    // @ts-expect-error intentionally invalid
    () => createGovernanceException(validInput({ type: undefined })),
    (err: unknown) => {
      assert.ok(err instanceof GovernanceExceptionValidationError);
      assert.equal(err.field, 'type');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// 14. Invalid type → throws
// ---------------------------------------------------------------------------

test('invalid type throws GovernanceExceptionValidationError', () => {
  assert.throws(
    // @ts-expect-error intentionally invalid
    () => createGovernanceException(validInput({ type: 'not-a-valid-type' })),
    (err: unknown) => {
      assert.ok(err instanceof GovernanceExceptionValidationError);
      assert.equal(err.field, 'type');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// 15. All fields present and valid — exception is replayable (serialize/deserialize)
// ---------------------------------------------------------------------------

test('exception is replayable via JSON round-trip without loss', () => {
  const input = validInput();
  const { exception } = createGovernanceException(input);

  const serialized = JSON.stringify(exception);
  const deserialized = JSON.parse(serialized) as typeof exception;

  assert.equal(deserialized.id, exception.id);
  assert.equal(deserialized.createdAt, exception.createdAt);
  assert.equal(deserialized.status, exception.status);
  assert.equal(deserialized.scope, exception.scope);
  assert.equal(deserialized.type, exception.type);
  assert.equal(deserialized.justification, exception.justification);
  assert.equal(deserialized.expiration, exception.expiration);
  assert.equal(deserialized.rollbackCondition, exception.rollbackCondition);
  assert.equal(deserialized.auditRef, exception.auditRef);
  assert.equal(deserialized.authorization.approver, exception.authorization.approver);
  assert.equal(deserialized.authorization.secondaryApprover, exception.authorization.secondaryApprover);
  assert.equal(deserialized.authorization.authorizedAt, exception.authorization.authorizedAt);

  // Confirm the deserialized data can be used to reconstruct a new exception (replayable lineage)
  const { exception: replayed } = createGovernanceException({
    scope: deserialized.scope,
    type: deserialized.type,
    authorization: deserialized.authorization,
    justification: deserialized.justification,
    expiration: deserialized.expiration,
    rollbackCondition: deserialized.rollbackCondition,
    auditRef: deserialized.auditRef,
  });
  assert.equal(replayed.status, 'active');
  assert.equal(replayed.scope, exception.scope);
});
