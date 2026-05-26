/**
 * DependentGateChecker (UTV2-1099)
 *
 * Enforces constitutional certification domain ordering. A domain may only be
 * activated when all upstream dependencies are currently certified (active,
 * non-expired, non-revoked).
 *
 * PM constraints (2026-05-26):
 * - Dependency graph is deterministic and acyclic — verified at module load.
 * - All dependency failures fail closed — missing/unmet dep = gate denied.
 * - Gate evaluation is replay-visible — emits DependentGateEvent records.
 * - Dependency propagation is append-safe and audit-reconstructable.
 * - No implicit certification inheritance — each domain proves its own state.
 * - Downstream revocation is immediate on upstream invalidation.
 * - Constitutional ordering is preserved across all 7 certification domains.
 */

import {
  CERTIFICATION_DOMAINS,
  DOMAIN_DEPENDENCIES,
  type CertificationDomain,
  type CertificationRecord,
  type ProgramId,
} from './types.js';

// ---------------------------------------------------------------------------
// Acyclicity verification — runs once at module load.
// The DOMAIN_DEPENDENCIES graph must remain acyclic to preserve constitutional
// ordering guarantees. Any cycle would create an unresolvable dependency chain.
// ---------------------------------------------------------------------------

function assertAcyclic(): void {
  for (const start of CERTIFICATION_DOMAINS) {
    const visited = new Set<CertificationDomain>();
    const stack: CertificationDomain[] = [...DOMAIN_DEPENDENCIES[start]];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === start) {
        throw new Error(
          `Certification domain dependency graph contains a cycle at "${start}". ` +
          'Constitutional ordering cannot be guaranteed. This is a fatal invariant violation.',
        );
      }
      if (!visited.has(current)) {
        visited.add(current);
        for (const dep of DOMAIN_DEPENDENCIES[current]) {
          stack.push(dep);
        }
      }
    }
  }
}

assertAcyclic();

// ---------------------------------------------------------------------------
// Gate evaluation result types (append-safe, replay-visible)
// ---------------------------------------------------------------------------

export interface DependentGateBlocker {
  readonly dependency: CertificationDomain;
  readonly reason: 'missing' | 'revoked' | 'expired' | 'not_certified';
  readonly status: string;
}

export interface DependentGateEvent {
  readonly programId: ProgramId;
  readonly domain: CertificationDomain;
  readonly evaluatedAt: string; // ISO-8601
  readonly replaySafe: true;    // always true — deterministic, replay-visible
  readonly verdict: 'allowed' | 'denied';
  readonly blockers: readonly DependentGateBlocker[];
  readonly dependenciesChecked: readonly CertificationDomain[];
}

export interface DependentGateCheckResult {
  readonly programId: ProgramId;
  readonly domain: CertificationDomain;
  readonly allowed: boolean;
  readonly event: DependentGateEvent;
}

export interface ProgramGateViolation {
  readonly domain: CertificationDomain;
  readonly blockers: readonly DependentGateBlocker[];
}

export interface ProgramGateCheckResult {
  readonly programId: ProgramId;
  readonly checkedAt: string; // ISO-8601
  readonly allSatisfied: boolean;
  readonly violations: readonly ProgramGateViolation[];
  readonly events: readonly DependentGateEvent[];
}

// ---------------------------------------------------------------------------
// Error type — thrown on gate denial (fail-closed)
// ---------------------------------------------------------------------------

export class DependentGateViolationError extends Error {
  constructor(public readonly gateEvent: DependentGateEvent) {
    const blockerList = gateEvent.blockers
      .map(b => `${b.dependency} (${b.reason}: ${b.status})`)
      .join(', ');
    super(
      `Dependent-gate denied activation of domain "${gateEvent.domain}" ` +
      `for program "${gateEvent.programId}": unsatisfied dependencies: ${blockerList}`,
    );
    this.name = 'DependentGateViolationError';
  }
}

// ---------------------------------------------------------------------------
// DependentGateChecker
// ---------------------------------------------------------------------------

export class DependentGateChecker {
  /**
   * Check whether a domain may be activated given the current certification
   * state. Fail-closed: any missing, revoked, expired, or pending upstream
   * dependency denies activation.
   *
   * The returned DependentGateEvent is immutable, append-safe, and replay-
   * visible. Callers that persist transitions must also persist this event
   * so the gate decision can be reconstructed from the audit trail.
   */
  checkDomainGates(
    programId: ProgramId,
    domain: CertificationDomain,
    allCurrentRecords: Partial<Record<CertificationDomain, CertificationRecord>>,
    now: string = new Date().toISOString(),
  ): DependentGateCheckResult {
    const deps = DOMAIN_DEPENDENCIES[domain];
    const blockers: DependentGateBlocker[] = [];

    for (const dep of deps) {
      const record = allCurrentRecords[dep];

      if (!record) {
        blockers.push({ dependency: dep, reason: 'missing', status: 'absent' });
        continue;
      }
      if (record.status === 'revoked') {
        blockers.push({ dependency: dep, reason: 'revoked', status: 'revoked' });
        continue;
      }
      if (record.status === 'expired') {
        blockers.push({ dependency: dep, reason: 'expired', status: 'expired' });
        continue;
      }
      // Clock-based expiry for records marked active
      if (
        record.status === 'active' &&
        record.expiresAt !== null &&
        now >= record.expiresAt
      ) {
        blockers.push({ dependency: dep, reason: 'expired', status: 'clock_expired' });
        continue;
      }
      if (record.status !== 'active') {
        // pending, suspended — not certified
        blockers.push({ dependency: dep, reason: 'not_certified', status: record.status });
        continue;
      }
    }

    const allowed = blockers.length === 0;
    const event: DependentGateEvent = {
      programId,
      domain,
      evaluatedAt: now,
      replaySafe: true,
      verdict: allowed ? 'allowed' : 'denied',
      blockers: Object.freeze([...blockers]),
      dependenciesChecked: Object.freeze([...deps]),
    };

    return { programId, domain, allowed, event };
  }

  /**
   * Compute all domains that must be immediately revoked when a given domain
   * is revoked. Revocation propagates transitively through the dependency graph.
   *
   * Returns domains in constitutional order (CERTIFICATION_DOMAINS sequence),
   * filtered to only those that depend (directly or transitively) on the
   * revoked domain. Downstream revocation is immediate — no grace period.
   *
   * This method is deterministic and produces the same result given the same
   * input — safe to replay for audit reconstruction.
   */
  computeDownstreamRevocations(
    revokedDomain: CertificationDomain,
  ): readonly CertificationDomain[] {
    const affected = new Set<CertificationDomain>();
    const queue: CertificationDomain[] = [revokedDomain];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const domain of CERTIFICATION_DOMAINS) {
        if (DOMAIN_DEPENDENCIES[domain].includes(current) && !affected.has(domain)) {
          affected.add(domain);
          queue.push(domain);
        }
      }
    }

    return CERTIFICATION_DOMAINS.filter(d => affected.has(d));
  }

  /**
   * Check the full program gate: identifies any ACTIVE domain that has an
   * unsatisfied upstream dependency. This is the CI-gate view.
   *
   * An active domain with an uncertified dependency is an invalid state —
   * it means a domain certified while its upstream was not, or upstream
   * was subsequently revoked/expired without propagating. Both are violations.
   *
   * Exits conceptually nonzero (allSatisfied=false) if violations exist.
   */
  checkProgramGates(
    programId: ProgramId,
    allCurrentRecords: Partial<Record<CertificationDomain, CertificationRecord>>,
    now: string = new Date().toISOString(),
  ): ProgramGateCheckResult {
    const violations: ProgramGateViolation[] = [];
    const events: DependentGateEvent[] = [];

    for (const domain of CERTIFICATION_DOMAINS) {
      const record = allCurrentRecords[domain];
      // Only check domains that are currently active — a pending or revoked
      // domain is not claiming certification, so it cannot violate ordering.
      if (!record || record.status !== 'active') {
        continue;
      }
      // Check if this active domain's dependencies are still satisfied
      const result = this.checkDomainGates(programId, domain, allCurrentRecords, now);
      events.push(result.event);
      if (!result.allowed) {
        violations.push({ domain, blockers: result.event.blockers });
      }
    }

    return {
      programId,
      checkedAt: now,
      allSatisfied: violations.length === 0,
      violations: Object.freeze(violations),
      events: Object.freeze(events),
    };
  }
}

export const dependentGateChecker = new DependentGateChecker();
