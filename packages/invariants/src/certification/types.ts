/**
 * Certification entity types (UTV2-1096)
 *
 * Constitutional entity model for Program 1 certification tracking.
 * - Append-safe: all state transitions produce new records, never mutations.
 * - Replay-safe: full history reconstructable from certification_transition_events.
 * - Fail-closed: unknown/absent cert state = blocked.
 * - Audit-visible: every transition emits a CertificationTransitionEvent.
 */

// ---------------------------------------------------------------------------
// Core enumerations
// ---------------------------------------------------------------------------

export const CERTIFICATION_DOMAINS = [
  'replay',
  'invariant',
  'divergence',
  'quarantine',
  'proof_lineage',
  'freshness',
  'cert_evidence',
] as const;

export type CertificationDomain = (typeof CERTIFICATION_DOMAINS)[number];

export const CERTIFICATION_STATUSES = [
  'pending',
  'active',
  'suspended',
  'revoked',
  'expired',
] as const;

export type CertificationStatus = (typeof CERTIFICATION_STATUSES)[number];

export const REVOCATION_TRIGGERS = [
  'replay_nondeterminism',
  'invariant_gap',
  'proof_corruption',
  'divergence_leakage',
  'quarantine_bypass',
  'stale_replay_acceptance',
  'evidence_invalidation',
  'dependency_revoked',
  'manual_governance',
] as const;

export type RevocationTrigger = (typeof REVOCATION_TRIGGERS)[number];

export const PROGRAM_IDS = ['P1', 'P2', 'P3', 'P4', 'P5'] as const;
export type ProgramId = (typeof PROGRAM_IDS)[number];

// ---------------------------------------------------------------------------
// Domain dependency graph
//
// If a domain is revoked, all domains that depend on it must also be revoked
// with trigger 'dependency_revoked'. This graph is the constitutional source
// of truth for propagation semantics.
// ---------------------------------------------------------------------------

export const DOMAIN_DEPENDENCIES: Record<CertificationDomain, readonly CertificationDomain[]> = {
  replay:        [],
  invariant:     [],
  divergence:    ['replay', 'invariant'],
  quarantine:    ['divergence'],
  proof_lineage: ['invariant', 'replay'],
  freshness:     ['replay'],
  cert_evidence: ['replay', 'invariant', 'divergence', 'quarantine', 'proof_lineage', 'freshness'],
};

/** Domains that depend on a given domain (reverse dependency lookup). */
export function getDependents(domain: CertificationDomain): CertificationDomain[] {
  return CERTIFICATION_DOMAINS.filter(d => DOMAIN_DEPENDENCIES[d].includes(domain));
}

// ---------------------------------------------------------------------------
// Entity types
// ---------------------------------------------------------------------------

/**
 * CertificationRecord — immutable row representing one state in a domain's
 * certification history. Multiple records per domain chain via predecessor_id.
 *
 * INVARIANT: never mutate. Transitions produce new records.
 */
export interface CertificationRecord {
  readonly id: string;
  readonly programId: ProgramId;
  readonly domain: CertificationDomain;
  readonly status: CertificationStatus;
  /** SHA-256 of the proof bundle that supports this certification state. */
  readonly evidenceSha: string;
  /** 40-char hex git SHA anchoring this cert to code truth. */
  readonly mergeSha: string;
  readonly transitionedAt: string;         // ISO-8601
  readonly transitionedBy: string;
  readonly transitionReason: string;
  /** Null = no clock expiry; only revoked or dependency triggers invalidate. */
  readonly expiresAt: string | null;
  /** Populated only when status === 'revoked'. */
  readonly revocationTrigger: RevocationTrigger | null;
  /** Id of the previous record in this (programId, domain) chain. */
  readonly predecessorId: string | null;
  readonly createdAt: string;              // ISO-8601
}

/**
 * CertificationTransitionEvent — append-only audit trail row.
 * One emitted per CertificationRecord insert.
 * These are the replay evidence for certification state reconstruction.
 */
export interface CertificationTransitionEvent {
  readonly id: string;
  readonly certRecordId: string;
  readonly programId: ProgramId;
  readonly domain: CertificationDomain;
  /** Null for the initial 'pending' record. */
  readonly fromStatus: CertificationStatus | null;
  readonly toStatus: CertificationStatus;
  readonly triggeredBy: string;
  readonly triggerReason: string;
  readonly evidenceSha: string | null;
  readonly occurredAt: string;             // ISO-8601
  /** Always true — assertion that this event is deterministically replayable. */
  readonly replaySafe: true;
}

// ---------------------------------------------------------------------------
// Input types for creating transitions
// ---------------------------------------------------------------------------

export interface CertificationRecordInput {
  readonly programId: ProgramId;
  readonly domain: CertificationDomain;
  readonly status: CertificationStatus;
  readonly evidenceSha: string;
  readonly mergeSha: string;
  readonly transitionedBy: string;
  readonly transitionReason: string;
  readonly expiresAt?: string | null;
  readonly revocationTrigger?: RevocationTrigger | null;
  readonly predecessorId?: string | null;
}

export interface PropagationInput {
  readonly programId: ProgramId;
  readonly revokedDomain: CertificationDomain;
  readonly revocationTrigger: RevocationTrigger;
  readonly evidenceSha: string;
  readonly mergeSha: string;
  readonly transitionedBy: string;
}

// ---------------------------------------------------------------------------
// Query result types
// ---------------------------------------------------------------------------

/** Current (most-recent) certification state per domain. */
export interface DomainCertificationState {
  readonly domain: CertificationDomain;
  readonly record: CertificationRecord | null;
  readonly isCertified: boolean;
  readonly isRevoked: boolean;
  readonly isExpired: boolean;
}

/** Full program certification state across all 7 domains. */
export interface ProgramCertificationState {
  readonly programId: ProgramId;
  readonly domains: Record<CertificationDomain, DomainCertificationState>;
  readonly allCertified: boolean;
  readonly blockers: CertificationDomain[];
}
