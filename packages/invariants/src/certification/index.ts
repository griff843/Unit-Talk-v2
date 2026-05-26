export type {
  CertificationDomain,
  CertificationStatus,
  RevocationTrigger,
  RevocationTriggerSignal,
  RevocationTriggerMatrixEntry,
  ProgramId,
  CertificationRecord,
  CertificationTransitionEvent,
  CertificationRecordInput,
  PropagationInput,
  DomainCertificationState,
  ProgramCertificationState,
} from './types.js';

export {
  CERTIFICATION_DOMAINS,
  CERTIFICATION_STATUSES,
  REVOCATION_TRIGGERS,
  REVOCATION_TRIGGER_SIGNALS,
  REVOCATION_TRIGGER_EXECUTION_MATRIX,
  PROGRAM_IDS,
  DOMAIN_DEPENDENCIES,
  getDependents,
  getRevocationTriggerMatrixEntry,
} from './types.js';

export {
  CertificationStateMachine,
  CertificationTransitionError,
  certificationStateMachine,
} from './state-machine.js';

export type { TransitionResult, PropagationResult } from './state-machine.js';
export type { ReconstructedCertificationEventState } from './state-machine.js';

export {
  CertificationLifecycleManager,
  DOMAIN_DEPENDENCIES as LIFECYCLE_DOMAIN_DEPENDENCIES,
} from './lifecycle-manager.js';
export { RevocationTriggerWiring } from './revocation-trigger-wiring.js';

export type {
  CertificationRepository,
  ActivateResult,
  SuspendResult,
  RevokeResult,
  GateCheckResult,
  RevocationSignalInput,
  RevocationTriggerExecutionResult,
  TransitionInput,
  RevokeInput,
} from './lifecycle-manager.js';

export type {
  WireEngineOptions,
  WireQuarantineOptions,
} from './revocation-trigger-wiring.js';
