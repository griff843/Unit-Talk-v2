export type {
  CertificationDomain,
  CertificationStatus,
  RevocationTrigger,
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
  PROGRAM_IDS,
  DOMAIN_DEPENDENCIES,
  getDependents,
} from './types.js';

export {
  CertificationStateMachine,
  CertificationTransitionError,
  certificationStateMachine,
} from './state-machine.js';

export type { TransitionResult, PropagationResult } from './state-machine.js';

export {
  CertificationLifecycleManager,
  DOMAIN_DEPENDENCIES as LIFECYCLE_DOMAIN_DEPENDENCIES,
} from './lifecycle-manager.js';

export type {
  CertificationRepository,
  ActivateResult,
  SuspendResult,
  RevokeResult,
  GateCheckResult,
  TransitionInput,
  RevokeInput,
} from './lifecycle-manager.js';
