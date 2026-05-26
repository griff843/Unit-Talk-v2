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

export { createProofBundle, validateProofBundle, ProofBundleValidationError } from './proof-bundle.js';
export type {
  ProofArtifactKind,
  ProofArtifact,
  ProofBundle,
  ProofBundleInput,
  ProofBundleValidationResult,
} from './proof-bundle.js';

export {
  validateProofBundle as validateProofBundleV2,
  ProofValidatorCertificationGate,
  ProofValidationGateError,
} from './proof-validator.js';
export type {
  ProofValidationFailureKind,
  ProofValidationFailure,
  ProofValidationResult,
  ProofValidatorOptions,
} from './proof-validator.js';

export {
  assertMergeShaBinding,
  assertShaBindingBlock,
  requireMergeShaBinding,
  ShaBindingGateError,
} from './merge-sha-binding.js';
export type {
  ShaBindingFailureKind,
  ShaBindingFailure,
  ShaBindingResult,
  ShaBindingBlock,
} from './merge-sha-binding.js';

export {
  FRESHNESS_WINDOWS_MS,
  checkProofFreshness,
  checkBundleFreshness,
  requireFreshProof,
  ProofFreshnessGateError,
} from './proof-freshness.js';
export type {
  FreshnessClass,
  FreshnessFailureKind,
  FreshnessFailure,
  FreshnessResult,
} from './proof-freshness.js';
