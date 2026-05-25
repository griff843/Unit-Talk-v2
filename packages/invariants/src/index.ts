export type {
  InvariantRegistryEntry,
  InvariantRegistry,
  InvariantIdLedger,
  InvariantSeverity,
  InvariantEnforcingLayer,
  InvariantQuarantineBehavior,
  InvariantStatus,
} from './types.js';

export {
  loadRegistry,
  loadLedger,
  getInvariant,
  getActiveInvariants,
  registryHash,
  validateConsistency,
} from './registry/loader.js';

export { InvariantEngine } from './engine.js';
export type { InvariantViolation, RuntimeContext } from './engine.js';

export { QuarantineManager } from './quarantine.js';
export type {
  QuarantineRecord,
  QuarantineStatus,
  QuarantineResult,
  AuditEvent,
  EscalationNotice,
} from './quarantine.js';

export { createGovernanceException, GovernanceExceptionValidationError } from './governance-exception.js';
export type {
  ExceptionAuthorization,
  GovernanceExceptionType,
  GovernanceExceptionInput,
  GovernanceException,
} from './governance-exception.js';
