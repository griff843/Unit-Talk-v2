/**
 * GovernanceException (UTV2-1104 / INIT-2.3.1)
 *
 * Runtime entity representing a sanctioned governance exception.
 * - All required fields validated on creation — throws GovernanceExceptionValidationError if any missing/invalid.
 * - Emits an AuditEvent when created.
 * - Pure data structure: no I/O, no Supabase, no HTTP.
 * - Replayable from stored lineage.
 */

import type { AuditEvent } from './quarantine.js';
import type { InvariantSeverity, InvariantQuarantineBehavior } from './types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ExceptionAuthorization {
  approver: string;           // required — identity of primary approver
  secondaryApprover: string;  // required — identity of secondary approver
  authorizedAt: string;       // ISO-8601
}

export type GovernanceExceptionType =
  | 'temporary-bypass'
  | 'operational-override'
  | 'emergency-exception'
  | 'scheduled-maintenance';

export interface GovernanceExceptionInput {
  scope: string;                     // required — which invariant/rule this exception applies to
  type: GovernanceExceptionType;     // required
  authorization: ExceptionAuthorization; // required (approver + secondaryApprover both required)
  justification: string;             // required — must be non-empty (min 10 chars)
  expiration: string;                // required — ISO-8601 datetime; must be in the future
  rollbackCondition: string;         // required — what triggers rollback
  auditRef: string;                  // required — reference to the audit record
}

export interface GovernanceException extends GovernanceExceptionInput {
  id: string;                        // auto-generated
  createdAt: string;                 // ISO-8601
  status: 'active' | 'expired' | 'rolled-back';
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class GovernanceExceptionValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'GovernanceExceptionValidationError';
    this.field = field;
  }
}

// ---------------------------------------------------------------------------
// Valid type set
// ---------------------------------------------------------------------------

const VALID_EXCEPTION_TYPES: ReadonlySet<string> = new Set<GovernanceExceptionType>([
  'temporary-bypass',
  'operational-override',
  'emergency-exception',
  'scheduled-maintenance',
]);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate(input: GovernanceExceptionInput): void {
  if (!input.scope || typeof input.scope !== 'string' || input.scope.trim() === '') {
    throw new GovernanceExceptionValidationError('scope', 'scope must be a non-empty string');
  }

  if (!input.type || !VALID_EXCEPTION_TYPES.has(input.type)) {
    throw new GovernanceExceptionValidationError(
      'type',
      `type must be one of: ${[...VALID_EXCEPTION_TYPES].join(', ')}; got: ${JSON.stringify(input.type)}`,
    );
  }

  if (!input.authorization || typeof input.authorization !== 'object') {
    throw new GovernanceExceptionValidationError('authorization', 'authorization is required');
  }

  if (
    !input.authorization.approver ||
    typeof input.authorization.approver !== 'string' ||
    input.authorization.approver.trim() === ''
  ) {
    throw new GovernanceExceptionValidationError(
      'authorization.approver',
      'authorization.approver must be a non-empty string',
    );
  }

  if (
    !input.authorization.secondaryApprover ||
    typeof input.authorization.secondaryApprover !== 'string' ||
    input.authorization.secondaryApprover.trim() === ''
  ) {
    throw new GovernanceExceptionValidationError(
      'authorization.secondaryApprover',
      'authorization.secondaryApprover must be a non-empty string',
    );
  }

  if (input.authorization.approver === input.authorization.secondaryApprover) {
    throw new GovernanceExceptionValidationError(
      'authorization.secondaryApprover',
      'authorization.approver and authorization.secondaryApprover must be distinct (self-approval not permitted)',
    );
  }

  if (!input.justification || typeof input.justification !== 'string' || input.justification.trim() === '') {
    throw new GovernanceExceptionValidationError('justification', 'justification must be a non-empty string');
  }
  if (input.justification.trim().length < 10) {
    throw new GovernanceExceptionValidationError(
      'justification',
      'justification must be at least 10 characters (trivial justifications are not permitted)',
    );
  }

  if (!input.expiration || typeof input.expiration !== 'string' || input.expiration.trim() === '') {
    throw new GovernanceExceptionValidationError('expiration', 'expiration must be a non-empty ISO-8601 datetime');
  }
  const expirationDate = new Date(input.expiration);
  if (isNaN(expirationDate.getTime())) {
    throw new GovernanceExceptionValidationError('expiration', `expiration is not a valid ISO-8601 datetime: ${input.expiration}`);
  }
  if (expirationDate <= new Date()) {
    throw new GovernanceExceptionValidationError(
      'expiration',
      `expiration must be a future datetime; got: ${input.expiration}`,
    );
  }

  if (!input.rollbackCondition || typeof input.rollbackCondition !== 'string' || input.rollbackCondition.trim() === '') {
    throw new GovernanceExceptionValidationError('rollbackCondition', 'rollbackCondition must be a non-empty string');
  }

  if (!input.auditRef || typeof input.auditRef !== 'string' || input.auditRef.trim() === '') {
    throw new GovernanceExceptionValidationError('auditRef', 'auditRef must be a non-empty string');
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

export function createGovernanceException(input: GovernanceExceptionInput): {
  exception: GovernanceException;
  auditEvent: AuditEvent;
} {
  validate(input);

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const exception: GovernanceException = {
    ...input,
    id,
    createdAt,
    status: 'active',
  };

  const auditEvent: AuditEvent = Object.freeze({
    id: crypto.randomUUID(),
    event_type: 'invariant_violation' as const, // closest semantic match; governance exception is a controlled bypass of an invariant
    invariant_id: input.scope,
    severity: 'governance-critical' as InvariantSeverity,
    quarantine_behavior: 'fail-closed' as InvariantQuarantineBehavior,
    recorded_at: createdAt,
    payload: Object.freeze({
      entity_type: 'governance_exception',
      action: 'created',
      exception_id: id,
      scope: input.scope,
      type: input.type,
      approver: input.authorization.approver,
      secondaryApprover: input.authorization.secondaryApprover,
      expiration: input.expiration,
      auditRef: input.auditRef,
    }),
    immutable: true as const,
  });

  return { exception, auditEvent };
}
