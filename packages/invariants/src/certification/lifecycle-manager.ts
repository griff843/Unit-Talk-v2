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
} from './state-machine.js';
import type {
  CertificationDomain,
  CertificationRecord,
  CertificationTransitionEvent,
  ProgramId,
  RevocationTrigger,
  ProgramCertificationState,
  DomainCertificationState,
} from './types.js';
import { CERTIFICATION_DOMAINS, DOMAIN_DEPENDENCIES } from './types.js';

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
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ActivateResult {
  readonly domain: CertificationDomain;
  readonly record: CertificationRecord;
  readonly event: CertificationTransitionEvent;
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
}

export interface RevokeInput extends TransitionInput {
  readonly revocationTrigger: RevocationTrigger;
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

    const result = certificationStateMachine.initiate(
      programId, domain, evidenceSha, mergeSha,
      transitionedBy, transitionReason,
    );
    await this.repo.insertTransition(result.record, result.event);
    return { domain, record: result.record, event: result.event };
  }

  /**
   * Activate a domain — transitions pending → active or suspended → active.
   * Fails closed if no current record exists (must initiate first).
   */
  async activate(input: TransitionInput): Promise<ActivateResult> {
    const { programId, domain, evidenceSha, mergeSha, transitionedBy, transitionReason, expiresAt } = input;
    const current = await this.repo.getCurrentRecord(programId, domain);

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
    );
    await this.repo.insertTransition(result.record, result.event);
    return { domain, record: result.record, event: result.event };
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
      transitionedBy, transitionReason, revocationTrigger,
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
    );

    // Compute cascade revocations
    const propagation: PropagationResult = certificationStateMachine.computePropagation(
      { programId, revokedDomain: domain, revocationTrigger, evidenceSha, mergeSha, transitionedBy },
      { ...allRecords, [domain]: primaryResult.record },
    );

    // Persist: primary + all propagated in one atomic batch
    const allResults: TransitionResult[] = [primaryResult, ...propagation.revocations];
    if (allResults.length === 1) {
      await this.repo.insertTransition(primaryResult.record, primaryResult.event);
    } else {
      await this.repo.insertPropagationBatch(allResults);
    }

    return {
      domain,
      record: primaryResult.record,
      event: primaryResult.event,
      propagated: propagation.revocations,
    };
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
    return this.revoke({
      programId, domain, evidenceSha, mergeSha,
      transitionedBy: 'invariant-engine',
      transitionReason: `Invariant violation escalated: ${violationDetail}`,
      revocationTrigger: 'invariant_gap',
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
    return this.revoke({
      programId, domain, evidenceSha, mergeSha,
      transitionedBy: 'replay-harness',
      transitionReason: `Replay nondeterminism detected: ${detail}`,
      revocationTrigger: 'replay_nondeterminism',
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
    return this.revoke({
      programId,
      domain: 'quarantine',
      evidenceSha, mergeSha,
      transitionedBy: 'quarantine-enforcement',
      transitionReason: `Quarantine bypass detected: ${detail}`,
      revocationTrigger: 'quarantine_bypass',
    });
  }
}

// ---------------------------------------------------------------------------
// Domain dependency re-export (useful for callers implementing the repo)
// ---------------------------------------------------------------------------
export { DOMAIN_DEPENDENCIES };
