/**
 * CertificationLifecycleManager (UTV2-1097)
 *
 * Runtime driver for CertificationRecord state transitions.
 * Wraps CertificationStateMachine with a repository interface so the package
 * stays pure — callers inject a real Supabase-backed repository.
 *
 * Design invariants:
 * - Fail-closed: unknown cert state = certification denied.
 * - Append-only: every call produces new records, never mutations.
 * - Audit-visible: every transition returns CertificationTransitionEvent(s).
 * - Propagation: revoking a domain cascades to all dependents automatically.
 */

import {
  certificationStateMachine,
  type TransitionResult,
  type PropagationResult,
  type PropagationAuditEvent,
} from './state-machine.js';
import {
  dependentGateChecker,
  DependentGateViolationError,
  type DependentGateEvent,
} from './dependent-gate.js';
import type {
  CertificationDomain,
  CertificationRecord,
  CertificationTransitionEvent,
  ProgramId,
  RevocationTrigger,
  RevocationTriggerSignal,
  ProgramCertificationState,
  DomainCertificationState,
} from './types.js';
import {
  CERTIFICATION_DOMAINS,
  DOMAIN_DEPENDENCIES,
  REVOCATION_TRIGGER_EXECUTION_MATRIX,
  getRevocationTriggerMatrixEntry,
} from './types.js';

// ---------------------------------------------------------------------------
// Repository interface — injected by callers
// ---------------------------------------------------------------------------

export interface CertificationRepository {
  /**
   * Fetch the most-recent CertificationRecord for a (programId, domain) pair.
   * Returns null if no record exists yet.
   */
  getCurrentRecord(
    programId: ProgramId,
    domain: CertificationDomain,
  ): Promise<CertificationRecord | null>;

  /**
   * Fetch all current records for a program (one per domain, most-recent).
   * Returns a partial map — missing domains have no record yet.
   */
  getAllCurrentRecords(
    programId: ProgramId,
  ): Promise<Partial<Record<CertificationDomain, CertificationRecord>>>;

  /**
   * Atomically insert one CertificationRecord + one CertificationTransitionEvent.
   * Must throw on constraint violation (duplicate id, invalid predecessor, etc).
   */
  insertTransition(
    record: CertificationRecord,
    event: CertificationTransitionEvent,
  ): Promise<void>;

  /**
   * Atomically insert multiple records + events (propagation batch).
   * Must be a single DB transaction; partial insert is not acceptable.
   */
  insertPropagationBatch(results: TransitionResult[]): Promise<void>;

  /**
   * Append replay-visible dependent-gate evidence. Implementations may store
   * this in an audit ledger; failure must fail closed for denied gates.
   */
  insertGateEvent(event: DependentGateEvent): Promise<void>;

  /** Append propagation audit evidence that is not itself a state transition. */
  insertPropagationAuditEvent(event: PropagationAuditEvent): Promise<void>;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ActivateResult {
  readonly domain: CertificationDomain;
  readonly record: CertificationRecord;
  readonly event: CertificationTransitionEvent;
  /**
   * Gate event produced by the dependent-gate check.
   * Present only when the result came from activate() (pending→active).
   * Absent for initiate() (null→pending) since gate checks apply only to activation.
   * When present, callers must persist it alongside the transition record.
   */
  readonly gateEvent?: DependentGateEvent;
}

export interface SuspendResult {
  readonly domain: CertificationDomain;
  readonly record: CertificationRecord;
  readonly event: CertificationTransitionEvent;
}

export interface RevokeResult {
  readonly domain: CertificationDomain;
  readonly record: CertificationRecord;
  readonly event: CertificationTransitionEvent;
  /** Propagated revocations for all dependent domains, in dependency order. */
  readonly propagated: TransitionResult[];
}

export interface RevocationTriggerExecutionResult extends RevokeResult {
  readonly signal: RevocationTriggerSignal;
  readonly matrixEntry: typeof REVOCATION_TRIGGER_EXECUTION_MATRIX[number];
}

export interface GateCheckResult {
  readonly programId: ProgramId;
  readonly allCertified: boolean;
  readonly blockers: CertificationDomain[];
  readonly state: ProgramCertificationState;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface TransitionInput {
  readonly programId: ProgramId;
  readonly domain: CertificationDomain;
  readonly evidenceSha: string;
  readonly mergeSha: string;
  readonly transitionedBy: string;
  readonly transitionReason: string;
  readonly expiresAt?: string | null;
  readonly occurredAt?: string;
}

export interface RevokeInput extends TransitionInput {
  readonly revocationTrigger: RevocationTrigger;
}

export interface RevocationSignalInput {
  readonly programId: ProgramId;
  readonly signal: RevocationTriggerSignal;
  readonly evidenceSha: string;
  readonly mergeSha: string;
  readonly detail: string;
  readonly domain?: CertificationDomain;
  readonly occurredAt?: string;
}

// ---------------------------------------------------------------------------
// CertificationLifecycleManager
// ---------------------------------------------------------------------------

export class CertificationLifecycleManager {
  constructor(private readonly repo: CertificationRepository) {}

  /**
   * Initiate a new 'pending' certification record for a domain.
   * Idempotent if the domain is already pending — returns existing record.
   */
  async initiate(input: TransitionInput): Promise<ActivateResult> {
    const { programId, domain, evidenceSha, mergeSha, transitionedBy, transitionReason } = input;
    const current = await this.repo.getCurrentRecord(programId, domain);

    if (current?.status === 'pending') {
      // Already pending — treat as idempotent success
      const fakeEvent: CertificationTransitionEvent = {
        id: current.id,
        certRecordId: current.id,
        programId,
        domain,
        fromStatus: null,
        toStatus: 'pending',
        triggeredBy: current.transitionedBy,
        triggerReason: current.transitionReason,
        evidenceSha: current.evidenceSha,
        occurredAt: current.transitionedAt,
        replaySafe: true,
      };
      return { domain, record: current, event: fakeEvent };
    }

    const result = current === null
      ? certificationStateMachine.initiate(
          programId, domain, evidenceSha, mergeSha,
          transitionedBy, transitionReason, input.occurredAt,
        )
      : certificationStateMachine.transition(
          current,
          {
            programId, domain,
            status: 'pending',
            evidenceSha, mergeSha,
            transitionedBy, transitionReason,
            expiresAt: input.expiresAt ?? null,
            revocationTrigger: null,
            predecessorId: current.id,
          },
          input.occurredAt,
        );
    await this.repo.insertTransition(result.record, result.event);
    return { domain, record: result.record, event: result.event };
  }

  /**
   * Activate a domain — transitions pending → active or suspended → active.
   *
   * Fails closed on two conditions:
   * 1. No current record exists (must initiate first).
   * 2. Any upstream dependency is not certified (dependent-gate check).
   *
   * The DependentGateEvent is returned alongside the transition result so
   * callers can persist it for replay-visible audit reconstruction.
   * Throws DependentGateViolationError if dependencies are unmet — fail-closed.
   */
  async activate(input: TransitionInput): Promise<ActivateResult> {
    const { programId, domain, evidenceSha, mergeSha, transitionedBy, transitionReason, expiresAt } = input;
    const now = input.occurredAt ?? new Date().toISOString();

    const [current, allRecords] = await Promise.all([
      this.repo.getCurrentRecord(programId, domain),
      this.repo.getAllCurrentRecords(programId),
    ]);

    // Dependent-gate check — fail closed if any upstream dep is not certified.
    // DependentGateViolationError is thrown and propagates to the caller.
    const gateResult = dependentGateChecker.checkDomainGates(programId, domain, allRecords, now);
    if (!gateResult.allowed) {
      await this.repo.insertGateEvent(gateResult.event);
      throw new DependentGateViolationError(gateResult.event);
    }

    const result = certificationStateMachine.transition(
      current,
      {
        programId, domain,
        status: 'active',
        evidenceSha, mergeSha,
        transitionedBy, transitionReason,
        expiresAt: expiresAt ?? null,
        revocationTrigger: null,
        predecessorId: current?.id ?? null,
      },
      now,
    );
    await this.repo.insertTransition(result.record, result.event);
    await this.repo.insertGateEvent(gateResult.event);
    return { domain, record: result.record, event: result.event, gateEvent: gateResult.event };
  }

  /**
   * Suspend a domain — transitions active → suspended.
   * Suspended domains are not certified; they can be re-activated.
   */
  async suspend(input: TransitionInput): Promise<SuspendResult> {
    const { programId, domain, evidenceSha, mergeSha, transitionedBy, transitionReason } = input;
    const current = await this.repo.getCurrentRecord(programId, domain);

    const result = certificationStateMachine.transition(
      current,
      {
        programId, domain,
        status: 'suspended',
        evidenceSha, mergeSha,
        transitionedBy, transitionReason,
        revocationTrigger: null,
        predecessorId: current?.id ?? null,
      },
      input.occurredAt,
    );
    await this.repo.insertTransition(result.record, result.event);
    return { domain, record: result.record, event: result.event };
  }

  /**
   * Revoke a domain and cascade revocations to all dependent domains.
   * Revocation is terminal — revoked domains cannot be re-activated.
   * Cascade uses the constitutional domain dependency graph.
   */
  async revoke(input: RevokeInput): Promise<RevokeResult> {
    const {
      programId, domain, evidenceSha, mergeSha,
      transitionedBy, transitionReason, revocationTrigger, occurredAt,
    } = input;

    const [current, allRecords] = await Promise.all([
      this.repo.getCurrentRecord(programId, domain),
      this.repo.getAllCurrentRecords(programId),
    ]);

    // Revoke the target domain
    const primaryResult = certificationStateMachine.transition(
      current,
      {
        programId, domain,
        status: 'revoked',
        evidenceSha, mergeSha,
        transitionedBy, transitionReason,
        revocationTrigger,
        predecessorId: current?.id ?? null,
      },
      occurredAt,
    );

    // Compute cascade revocations
    const propagation: PropagationResult = certificationStateMachine.computePropagation(
      { programId, revokedDomain: domain, revocationTrigger, evidenceSha, mergeSha, transitionedBy },
      { ...allRecords, [domain]: primaryResult.record },
      occurredAt,
    );

    // Persist: primary + all propagated in one atomic batch
    const allResults: TransitionResult[] = [primaryResult, ...propagation.revocations];
    if (allResults.length === 1) {
      await this.repo.insertTransition(primaryResult.record, primaryResult.event);
    } else {
      await this.repo.insertPropagationBatch(allResults);
    }
    for (const auditEvent of propagation.auditEvents) {
      await this.repo.insertPropagationAuditEvent(auditEvent);
    }

    return {
      domain,
      record: primaryResult.record,
      event: primaryResult.event,
      propagated: propagation.revocations,
    };
  }

  /**
   * Execute one canonical revocation trigger signal through the deterministic
   * matrix. This is the single wiring point for runtime trigger producers.
   */
  async executeRevocationTrigger(
    input: RevocationSignalInput,
  ): Promise<RevocationTriggerExecutionResult> {
    const matrixEntry = getRevocationTriggerMatrixEntry(input.signal);
    const result = await this.revoke({
      programId: input.programId,
      domain: input.domain ?? matrixEntry.defaultDomain,
      evidenceSha: input.evidenceSha,
      mergeSha: input.mergeSha,
      transitionedBy: matrixEntry.triggeredBy,
      transitionReason: `${matrixEntry.reasonPrefix}: ${input.detail}`,
      revocationTrigger: matrixEntry.revocationTrigger,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    });
    return { ...result, signal: input.signal, matrixEntry };
  }

  /**
   * Check certification gates for all 7 domains of a program.
   * Fail-closed: missing or non-active domains are blockers.
   */
  async checkGates(programId: ProgramId): Promise<GateCheckResult> {
    const allRecords = await this.repo.getAllCurrentRecords(programId);
    const now = new Date().toISOString();

    const blockers = certificationStateMachine.getProgramBlockers(allRecords, now);

    const domainStates = {} as Record<CertificationDomain, DomainCertificationState>;
    for (const d of CERTIFICATION_DOMAINS) {
      const record = allRecords[d] ?? null;
      domainStates[d] = {
        domain: d,
        record,
        isCertified: certificationStateMachine.isCertified(record, now),
        isRevoked: record?.status === 'revoked',
        isExpired: record !== null && record.status === 'active' &&
          record.expiresAt !== null && now >= record.expiresAt,
      };
    }

    const state: ProgramCertificationState = {
      programId,
      domains: domainStates,
      allCertified: blockers.length === 0,
      blockers,
    };

    return {
      programId,
      allCertified: blockers.length === 0,
      blockers,
      state,
    };
  }

  /**
   * Wire invariant violation escalation → automatic revocation.
   * Called by the invariant engine when a violation requires cert invalidation.
   */
  async onInvariantViolationEscalation(
    programId: ProgramId,
    domain: CertificationDomain,
    evidenceSha: string,
    mergeSha: string,
    violationDetail: string,
  ): Promise<RevokeResult> {
    return this.executeRevocationTrigger({
      programId,
      domain,
      signal: 'invariant_violation',
      evidenceSha,
      mergeSha,
      detail: violationDetail,
    });
  }

  /**
   * Wire replay nondeterminism detection → automatic revocation.
   * Called by the replay harness when a nondeterministic result is detected.
   */
  async onReplayNondeterminism(
    programId: ProgramId,
    domain: CertificationDomain,
    evidenceSha: string,
    mergeSha: string,
    detail: string,
  ): Promise<RevokeResult> {
    return this.executeRevocationTrigger({
      programId,
      domain,
      signal: 'replay_nondeterminism',
      evidenceSha,
      mergeSha,
      detail,
    });
  }

  /**
   * Wire quarantine bypass detection → automatic revocation.
   * Called when a quarantine bypass is detected without a valid GovernanceException.
   */
  async onQuarantineBypass(
    programId: ProgramId,
    evidenceSha: string,
    mergeSha: string,
    detail: string,
  ): Promise<RevokeResult> {
    return this.executeRevocationTrigger({
      programId,
      signal: 'quarantine_escalation',
      evidenceSha,
      mergeSha,
      detail,
    });
  }

  async onStaleProofLineage(
    programId: ProgramId,
    evidenceSha: string,
    mergeSha: string,
    detail: string,
  ): Promise<RevokeResult> {
    return this.executeRevocationTrigger({
      programId,
      signal: 'stale_proof_lineage',
      evidenceSha,
      mergeSha,
      detail,
    });
  }

  async onFreshnessEnforcementFailure(
    programId: ProgramId,
    evidenceSha: string,
    mergeSha: string,
    detail: string,
  ): Promise<RevokeResult> {
    return this.executeRevocationTrigger({
      programId,
      signal: 'freshness_enforcement_failure',
      evidenceSha,
      mergeSha,
      detail,
    });
  }

  async onDivergenceThresholdBreach(
    programId: ProgramId,
    evidenceSha: string,
    mergeSha: string,
    detail: string,
  ): Promise<RevokeResult> {
    return this.executeRevocationTrigger({
      programId,
      signal: 'divergence_threshold_breach',
      evidenceSha,
      mergeSha,
      detail,
    });
  }
}

// ---------------------------------------------------------------------------
// Re-exports for callers that need gate types alongside lifecycle types
// ---------------------------------------------------------------------------
export { DOMAIN_DEPENDENCIES };
export type { DependentGateEvent } from './dependent-gate.js';
export { DependentGateViolationError } from './dependent-gate.js';
