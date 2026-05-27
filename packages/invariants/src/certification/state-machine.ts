/**
 * CertificationStateMachine (UTV2-1096)
 *
 * Pure, deterministic state machine for certification lifecycle transitions.
 * - No I/O, no DB, no HTTP, no side effects.
 * - Validates all transitions before they happen.
 * - Computes revocation propagation from the domain dependency graph.
 * - All outputs are immutable records ready for DB insertion.
 *
 * Callers (apps, workers) are responsible for persisting the output.
 */

import { createHash } from 'node:crypto';
import type {
  CertificationDomain,
  CertificationStatus,
  ProgramId,
  CertificationRecord,
  CertificationTransitionEvent,
  CertificationRecordInput,
  PropagationInput,
} from './types.js';
import { computeCanonicalDownstreamRevocations } from './types.js';

// ---------------------------------------------------------------------------
// Transition table
//
// VALID_TRANSITIONS[from][to] = true means the transition is permitted.
// Anything not listed is rejected (fail-closed).
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Partial<Record<CertificationStatus, readonly CertificationStatus[]>> = {
  pending:   ['active', 'revoked'],
  active:    ['suspended', 'revoked', 'expired'],
  suspended: ['active', 'revoked'],
  expired:   ['pending'],
  revoked:   [],   // terminal — no transitions out
};

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class CertificationTransitionError extends Error {
  constructor(
    message: string,
    public readonly domain: CertificationDomain,
    public readonly from: CertificationStatus | null,
    public readonly to: CertificationStatus,
  ) {
    super(message);
    this.name = 'CertificationTransitionError';
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const SHA256_RE = /^[0-9a-f]{64}$/;
const SHA40_RE  = /^[0-9a-f]{40}$/;

function assertValidEvidenceSha(sha: string, ctx: string): void {
  if (!SHA256_RE.test(sha)) {
    throw new CertificationTransitionError(
      `${ctx}: evidenceSha must be 64 hex chars, got "${sha}"`,
      'cert_evidence',
      null,
      'pending',
    );
  }
}

function assertValidMergeSha(sha: string, ctx: string): void {
  if (!SHA40_RE.test(sha)) {
    throw new CertificationTransitionError(
      `${ctx}: mergeSha must be 40 hex chars, got "${sha}"`,
      'cert_evidence',
      null,
      'pending',
    );
  }
}

// ---------------------------------------------------------------------------
// Core transition validator
// ---------------------------------------------------------------------------

function assertTransitionAllowed(
  domain: CertificationDomain,
  from: CertificationStatus | null,
  to: CertificationStatus,
): void {
  if (from === null) {
    // Initial insert is normally pending. Revoked is also allowed so a trigger
    // against unknown state can still leave append-only invalidation evidence.
    if (to !== 'pending' && to !== 'revoked') {
      throw new CertificationTransitionError(
        `Domain "${domain}": initial status must be "pending" or fail-closed "revoked", got "${to}"`,
        domain, from, to,
      );
    }
    return;
  }
  const allowed = VALID_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new CertificationTransitionError(
      `Domain "${domain}": transition ${from} → ${to} is not permitted`,
      domain, from, to,
    );
  }
}

function assertRevocationConstraints(
  input: CertificationRecordInput,
  from: CertificationStatus | null,
): void {
  if (input.status === 'revoked' && !input.revocationTrigger) {
    throw new CertificationTransitionError(
      `Domain "${input.domain}": revoked status requires a revocationTrigger`,
      input.domain, from, 'revoked',
    );
  }
  if (input.status !== 'revoked' && input.revocationTrigger) {
    throw new CertificationTransitionError(
      `Domain "${input.domain}": revocationTrigger must be null for status "${input.status}"`,
      input.domain, from, input.status,
    );
  }
}

// ---------------------------------------------------------------------------
// Record construction helpers
// ---------------------------------------------------------------------------

function buildRecord(
  input: CertificationRecordInput,
  now: string,
): CertificationRecord {
  const predecessorId = input.predecessorId ?? null;
  const expiresAt = input.expiresAt ?? null;
  const revocationTrigger = input.revocationTrigger ?? null;
  const id = deterministicUuid('certification-record', [
    input.programId,
    input.domain,
    input.status,
    input.evidenceSha,
    input.mergeSha,
    input.transitionedBy,
    input.transitionReason,
    expiresAt ?? '',
    revocationTrigger ?? '',
    predecessorId ?? '',
    now,
  ]);

  return {
    id,
    programId:          input.programId,
    domain:             input.domain,
    status:             input.status,
    evidenceSha:        input.evidenceSha,
    mergeSha:           input.mergeSha,
    transitionedAt:     now,
    transitionedBy:     input.transitionedBy,
    transitionReason:   input.transitionReason,
    expiresAt,
    revocationTrigger,
    predecessorId,
    createdAt:          now,
  };
}

function buildTransitionEvent(
  record: CertificationRecord,
  fromStatus: CertificationStatus | null,
): CertificationTransitionEvent {
  return {
    id:            deterministicUuid('certification-transition-event', [
      record.id,
      fromStatus ?? '',
      record.status,
      record.transitionedAt,
    ]),
    certRecordId:  record.id,
    programId:     record.programId,
    domain:        record.domain,
    fromStatus,
    toStatus:      record.status,
    triggeredBy:   record.transitionedBy,
    triggerReason: record.transitionReason,
    evidenceSha:   record.evidenceSha,
    occurredAt:    record.transitionedAt,
    replaySafe:    true,
  };
}

function deterministicUuid(scope: string, parts: readonly string[]): string {
  const hash = createHash('sha256')
    .update(scope)
    .update('\0')
    .update(parts.join('\0'))
    .digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `${((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hash.slice(18, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

export interface TransitionResult {
  readonly record: CertificationRecord;
  readonly event: CertificationTransitionEvent;
}

export interface PropagationResult {
  /** Propagated revocations for all dependents, in dependency order. */
  readonly revocations: TransitionResult[];
  readonly auditEvents: PropagationAuditEvent[];
}

export interface PropagationAuditEvent {
  readonly programId: ProgramId;
  readonly domain: CertificationDomain;
  readonly action: 'certification.propagation.expired-domain';
  readonly reason: string;
  readonly status: CertificationStatus;
  readonly encounteredAt: string;
  readonly replaySafe: true;
}

export interface ReconstructedCertificationEventState {
  readonly certRecordId: string;
  readonly programId: ProgramId;
  readonly domain: CertificationDomain;
  readonly status: CertificationStatus;
  readonly evidenceSha: string | null;
  readonly occurredAt: string;
}

// ---------------------------------------------------------------------------
// CertificationStateMachine
// ---------------------------------------------------------------------------

export class CertificationStateMachine {

  /**
   * Validate and produce a new CertificationRecord for an initial 'pending' entry.
   * Caller must persist both record and event atomically.
   */
  initiate(
    programId: ProgramId,
    domain: CertificationDomain,
    evidenceSha: string,
    mergeSha: string,
    initiatedBy: string,
    reason: string,
    now: string = new Date().toISOString(),
  ): TransitionResult {
    assertValidEvidenceSha(evidenceSha, `initiate(${domain})`);
    assertValidMergeSha(mergeSha, `initiate(${domain})`);
    assertTransitionAllowed(domain, null, 'pending');

    const input: CertificationRecordInput = {
      programId, domain, status: 'pending',
      evidenceSha, mergeSha,
      transitionedBy: initiatedBy,
      transitionReason: reason,
      revocationTrigger: null,
      predecessorId: null,
    };
    const record = buildRecord(input, now);
    return { record, event: buildTransitionEvent(record, null) };
  }

  /**
   * Validate and produce a new CertificationRecord for any transition.
   * `current` is the most-recent record in this domain's chain (or null for init).
   * Caller must persist both record and event atomically.
   */
  transition(
    current: CertificationRecord | null,
    input: CertificationRecordInput,
    now: string = new Date().toISOString(),
  ): TransitionResult {
    const fromStatus = current?.status ?? null;

    assertValidEvidenceSha(input.evidenceSha, `transition(${input.domain})`);
    assertValidMergeSha(input.mergeSha, `transition(${input.domain})`);
    assertTransitionAllowed(input.domain, fromStatus, input.status);
    assertRevocationConstraints(input, fromStatus);

    const inputWithPredecessor: CertificationRecordInput = {
      ...input,
      predecessorId: current?.id ?? null,
    };
    const record = buildRecord(inputWithPredecessor, now);
    return { record, event: buildTransitionEvent(record, fromStatus) };
  }

  /**
   * Compute all revocations that must propagate when a domain is revoked.
   *
   * Returns TransitionResults for each affected dependent domain, in
   * topological order (upstream before downstream). The caller provides
   * current records for all domains; missing dependent domains are revoked
   * into explicit fail-closed evidence.
   *
   * Fail-closed: if any domain in the dependency graph was active, suspended,
   * pending, or missing, it MUST receive a revoked transition.
   */
  computePropagation(
    propagationInput: PropagationInput,
    currentRecords: Partial<Record<CertificationDomain, CertificationRecord>>,
    now: string = new Date().toISOString(),
  ): PropagationResult {
    const { programId, revokedDomain, evidenceSha, mergeSha, transitionedBy } = propagationInput;
    const downstream = computeCanonicalDownstreamRevocations(revokedDomain);
    const revocations: TransitionResult[] = [];
    const auditEvents: PropagationAuditEvent[] = [];

    for (const dep of downstream) {
      const current = currentRecords[dep] ?? null;
      // Missing dependents are fail-closed into explicit revoked evidence.
      if (current?.status === 'revoked') continue;  // already revoked
      if (current?.status === 'expired') {
        auditEvents.push({
          programId,
          domain: dep,
          action: 'certification.propagation.expired-domain',
          reason: `Expired domain "${dep}" encountered while propagating revocation from "${revokedDomain}"`,
          status: current.status,
          encounteredAt: now,
          replaySafe: true,
        });
        continue;
      }
      if (current !== null && !['active', 'suspended', 'pending'].includes(current.status)) continue;

      const result = this.transition(
        current,
        {
          programId,
          domain: dep,
          status: 'revoked',
          evidenceSha,
          mergeSha,
          transitionedBy,
          transitionReason: `Dependency "${revokedDomain}" was revoked`,
          revocationTrigger: 'dependency_revoked',
        },
        now,
      );
      revocations.push(result);
    }

    return { revocations, auditEvents };
  }

  /**
   * Reconstruct current certification status from append-only transition events.
   * This intentionally uses only event fields so replay/audit consumers can
   * verify lifecycle transitions without reading mutable current-state views.
   */
  reconstructCurrentStateFromEvents(
    events: readonly CertificationTransitionEvent[],
  ): Partial<Record<CertificationDomain, ReconstructedCertificationEventState>> {
    const ordered = [...events].sort((a, b) => {
      const byTime = a.occurredAt.localeCompare(b.occurredAt);
      return byTime === 0 ? a.id.localeCompare(b.id) : byTime;
    });
    const state: Partial<Record<CertificationDomain, ReconstructedCertificationEventState>> = {};
    for (const event of ordered) {
      state[event.domain] = {
        certRecordId: event.certRecordId,
        programId: event.programId,
        domain: event.domain,
        status: event.toStatus,
        evidenceSha: event.evidenceSha,
        occurredAt: event.occurredAt,
      };
    }
    return state;
  }

  /**
   * Evaluate the certification gate for a domain.
   * Fail-closed: returns false for any non-'active' status, missing records,
   * or expired records past their expiry time.
   */
  isCertified(
    record: CertificationRecord | null,
    now: string = new Date().toISOString(),
  ): boolean {
    if (!record) return false;
    if (record.status !== 'active') return false;
    if (record.expiresAt !== null && now >= record.expiresAt) return false;
    return true;
  }

  /**
   * Evaluate whether all 7 domains are certified for a program.
   * Returns the list of blocking domains (empty = all certified).
   *
   * Fail-closed: any missing domain counts as a blocker.
   */
  getProgramBlockers(
    currentRecords: Partial<Record<CertificationDomain, CertificationRecord>>,
    now: string = new Date().toISOString(),
  ): CertificationDomain[] {
    const blockers: CertificationDomain[] = [];
    const allDomains: CertificationDomain[] = [
      'replay', 'invariant', 'divergence', 'quarantine',
      'proof_lineage', 'freshness', 'cert_evidence',
    ];
    for (const domain of allDomains) {
      const record = currentRecords[domain] ?? null;
      if (!this.isCertified(record, now)) {
        blockers.push(domain);
      }
    }
    return blockers;
  }
}

export const certificationStateMachine = new CertificationStateMachine();
