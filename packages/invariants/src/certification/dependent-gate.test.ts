import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DependentGateChecker,
  DependentGateViolationError,
  dependentGateChecker,
} from './dependent-gate.js';
import type { CertificationRecord, CertificationDomain, ProgramId } from './types.js';
import { DOMAIN_DEPENDENCIES, CERTIFICATION_DOMAINS } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = '2026-05-26T00:00:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2020-01-01T00:00:00.000Z';
const PROGRAM: ProgramId = 'P1';

function makeRecord(
  domain: CertificationDomain,
  status: CertificationRecord['status'],
  opts: Partial<Pick<CertificationRecord, 'expiresAt' | 'revocationTrigger'>> = {},
): CertificationRecord {
  return {
    id: `${domain}-${status}`,
    programId: PROGRAM,
    domain,
    status,
    evidenceSha: 'a'.repeat(64),
    mergeSha: 'b'.repeat(40),
    transitionedAt: NOW,
    transitionedBy: 'test',
    transitionReason: 'test',
    expiresAt: opts.expiresAt ?? null,
    revocationTrigger: opts.revocationTrigger ?? null,
    predecessorId: null,
    createdAt: NOW,
  };
}

function allActive(
  domains: readonly CertificationDomain[],
): Partial<Record<CertificationDomain, CertificationRecord>> {
  const records: Partial<Record<CertificationDomain, CertificationRecord>> = {};
  for (const d of domains) {
    records[d] = makeRecord(d, 'active');
  }
  return records;
}

// ---------------------------------------------------------------------------
// Module-level invariant: acyclicity
// ---------------------------------------------------------------------------

describe('dependency graph invariants', () => {
  it('graph is acyclic — no domain depends on itself directly or transitively', () => {
    for (const domain of CERTIFICATION_DOMAINS) {
      const visited = new Set<CertificationDomain>();
      const stack: CertificationDomain[] = [...DOMAIN_DEPENDENCIES[domain]];
      while (stack.length > 0) {
        const current = stack.pop()!;
        assert.notEqual(current, domain, `Cycle detected at domain "${domain}"`);
        if (!visited.has(current)) {
          visited.add(current);
          for (const dep of DOMAIN_DEPENDENCIES[current]) stack.push(dep);
        }
      }
    }
  });

  it('all dependency references resolve to known domains', () => {
    const known = new Set(CERTIFICATION_DOMAINS);
    for (const [domain, deps] of Object.entries(DOMAIN_DEPENDENCIES)) {
      for (const dep of deps as CertificationDomain[]) {
        assert.ok(known.has(dep), `Domain "${domain}" depends on unknown "${dep}"`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// checkDomainGates
// ---------------------------------------------------------------------------

describe('DependentGateChecker.checkDomainGates', () => {
  it('allows domain with no dependencies (replay, invariant)', () => {
    for (const domain of ['replay', 'invariant'] as CertificationDomain[]) {
      const result = dependentGateChecker.checkDomainGates(PROGRAM, domain, {}, NOW);
      assert.equal(result.allowed, true);
      assert.equal(result.event.verdict, 'allowed');
      assert.equal(result.event.blockers.length, 0);
      assert.equal(result.event.replaySafe, true);
    }
  });

  it('denies domain when upstream dependency is missing', () => {
    const result = dependentGateChecker.checkDomainGates(PROGRAM, 'divergence', {}, NOW);
    assert.equal(result.allowed, false);
    assert.equal(result.event.verdict, 'denied');
    const reasons = result.event.blockers.map(b => b.reason);
    assert.ok(reasons.every(r => r === 'missing'));
  });

  it('denies domain when upstream dependency is revoked', () => {
    const records: Partial<Record<CertificationDomain, CertificationRecord>> = {
      replay: makeRecord('replay', 'revoked', { revocationTrigger: 'replay_nondeterminism' }),
      invariant: makeRecord('invariant', 'active'),
    };
    const result = dependentGateChecker.checkDomainGates(PROGRAM, 'divergence', records, NOW);
    assert.equal(result.allowed, false);
    const replayBlocker = result.event.blockers.find(b => b.dependency === 'replay');
    assert.ok(replayBlocker);
    assert.equal(replayBlocker.reason, 'revoked');
  });

  it('denies domain when upstream dependency is pending (not yet certified)', () => {
    const records: Partial<Record<CertificationDomain, CertificationRecord>> = {
      replay: makeRecord('replay', 'pending'),
      invariant: makeRecord('invariant', 'active'),
    };
    const result = dependentGateChecker.checkDomainGates(PROGRAM, 'divergence', records, NOW);
    assert.equal(result.allowed, false);
    const replayBlocker = result.event.blockers.find(b => b.dependency === 'replay');
    assert.ok(replayBlocker);
    assert.equal(replayBlocker.reason, 'not_certified');
  });

  it('denies domain when upstream dependency is suspended', () => {
    const records: Partial<Record<CertificationDomain, CertificationRecord>> = {
      replay: makeRecord('replay', 'suspended'),
      invariant: makeRecord('invariant', 'active'),
    };
    const result = dependentGateChecker.checkDomainGates(PROGRAM, 'divergence', records, NOW);
    assert.equal(result.allowed, false);
    const replayBlocker = result.event.blockers.find(b => b.dependency === 'replay');
    assert.equal(replayBlocker?.reason, 'not_certified');
    assert.equal(replayBlocker?.status, 'suspended');
  });

  it('denies domain when upstream dependency is clock-expired', () => {
    const records: Partial<Record<CertificationDomain, CertificationRecord>> = {
      replay: makeRecord('replay', 'active', { expiresAt: PAST }),
      invariant: makeRecord('invariant', 'active'),
    };
    const result = dependentGateChecker.checkDomainGates(PROGRAM, 'divergence', records, NOW);
    assert.equal(result.allowed, false);
    const replayBlocker = result.event.blockers.find(b => b.dependency === 'replay');
    assert.equal(replayBlocker?.reason, 'expired');
    assert.equal(replayBlocker?.status, 'clock_expired');
  });

  it('allows domain when upstream has future expiry', () => {
    const records: Partial<Record<CertificationDomain, CertificationRecord>> = {
      replay: makeRecord('replay', 'active', { expiresAt: FUTURE }),
      invariant: makeRecord('invariant', 'active'),
    };
    const result = dependentGateChecker.checkDomainGates(PROGRAM, 'divergence', records, NOW);
    assert.equal(result.allowed, true);
  });

  it('allows cert_evidence only when all 6 upstream domains are active', () => {
    const allDeps = DOMAIN_DEPENDENCIES['cert_evidence'] as readonly CertificationDomain[];
    const records = allActive(allDeps);
    const result = dependentGateChecker.checkDomainGates(PROGRAM, 'cert_evidence', records, NOW);
    assert.equal(result.allowed, true);
    assert.equal(result.event.dependenciesChecked.length, allDeps.length);
  });

  it('denies cert_evidence if even one upstream dep is missing', () => {
    const allDeps = DOMAIN_DEPENDENCIES['cert_evidence'] as readonly CertificationDomain[];
    const records = allActive(allDeps);
    // Remove one dep
    delete records['quarantine'];
    const result = dependentGateChecker.checkDomainGates(PROGRAM, 'cert_evidence', records, NOW);
    assert.equal(result.allowed, false);
    const quarantineBlocker = result.event.blockers.find(b => b.dependency === 'quarantine');
    assert.equal(quarantineBlocker?.reason, 'missing');
  });

  it('event is replay-safe and append-safe (immutable frozen arrays)', () => {
    const result = dependentGateChecker.checkDomainGates(PROGRAM, 'divergence', {}, NOW);
    assert.equal(result.event.replaySafe, true);
    assert.ok(Object.isFrozen(result.event.blockers));
    assert.ok(Object.isFrozen(result.event.dependenciesChecked));
  });

  it('reports all blockers when multiple deps are unmet (not short-circuit)', () => {
    // cert_evidence depends on 6 domains — all absent
    const result = dependentGateChecker.checkDomainGates(PROGRAM, 'cert_evidence', {}, NOW);
    assert.equal(result.allowed, false);
    const deps = DOMAIN_DEPENDENCIES['cert_evidence'];
    assert.equal(result.event.blockers.length, deps.length);
  });
});

// ---------------------------------------------------------------------------
// DependentGateViolationError
// ---------------------------------------------------------------------------

describe('DependentGateViolationError', () => {
  it('includes domain and blocker info in message', () => {
    const result = dependentGateChecker.checkDomainGates(PROGRAM, 'divergence', {}, NOW);
    const err = new DependentGateViolationError(result.event);
    assert.ok(err.message.includes('divergence'));
    assert.ok(err.message.includes('missing'));
    assert.equal(err.name, 'DependentGateViolationError');
    assert.equal(err.gateEvent, result.event);
  });
});

// ---------------------------------------------------------------------------
// computeDownstreamRevocations
// ---------------------------------------------------------------------------

describe('DependentGateChecker.computeDownstreamRevocations', () => {
  it('revoking replay cascades to all downstream domains', () => {
    const downstream = dependentGateChecker.computeDownstreamRevocations('replay');
    // replay is depended on by: divergence, proof_lineage, freshness, cert_evidence
    assert.ok(downstream.includes('divergence'));
    assert.ok(downstream.includes('proof_lineage'));
    assert.ok(downstream.includes('freshness'));
    assert.ok(downstream.includes('cert_evidence'));
    // divergence is depended on by quarantine, cert_evidence (already counted)
    assert.ok(downstream.includes('quarantine'));
    // replay itself should not be in its own downstream
    assert.ok(!downstream.includes('replay'));
  });

  it('revoking invariant cascades to all dependent domains', () => {
    const downstream = dependentGateChecker.computeDownstreamRevocations('invariant');
    assert.ok(downstream.includes('divergence'));
    assert.ok(downstream.includes('proof_lineage'));
    assert.ok(downstream.includes('cert_evidence'));
    assert.ok(!downstream.includes('invariant'));
  });

  it('revoking cert_evidence has no downstream (terminal domain)', () => {
    const downstream = dependentGateChecker.computeDownstreamRevocations('cert_evidence');
    assert.equal(downstream.length, 0);
  });

  it('revoking quarantine cascades to cert_evidence only', () => {
    const downstream = dependentGateChecker.computeDownstreamRevocations('quarantine');
    assert.ok(downstream.includes('cert_evidence'));
    assert.equal(downstream.length, 1);
  });

  it('revoking freshness cascades to cert_evidence only', () => {
    const downstream = dependentGateChecker.computeDownstreamRevocations('freshness');
    assert.ok(downstream.includes('cert_evidence'));
    assert.equal(downstream.length, 1);
  });

  it('result preserves constitutional domain ordering', () => {
    const downstream = dependentGateChecker.computeDownstreamRevocations('replay');
    // All returned domains should be in CERTIFICATION_DOMAINS order
    const indices = downstream.map(d => CERTIFICATION_DOMAINS.indexOf(d));
    const sorted = [...indices].sort((a, b) => a - b);
    assert.deepEqual(indices, sorted);
  });

  it('is deterministic — same input always produces same output', () => {
    const run1 = dependentGateChecker.computeDownstreamRevocations('invariant');
    const run2 = dependentGateChecker.computeDownstreamRevocations('invariant');
    assert.deepEqual(run1, run2);
  });
});

// ---------------------------------------------------------------------------
// checkProgramGates — CI gate view
// ---------------------------------------------------------------------------

describe('DependentGateChecker.checkProgramGates', () => {
  it('all satisfied when no domains are active', () => {
    const result = dependentGateChecker.checkProgramGates(PROGRAM, {}, NOW);
    assert.equal(result.allSatisfied, true);
    assert.equal(result.violations.length, 0);
  });

  it('all satisfied when active domains have all deps certified', () => {
    const records: Partial<Record<CertificationDomain, CertificationRecord>> = {
      replay: makeRecord('replay', 'active'),
      invariant: makeRecord('invariant', 'active'),
      divergence: makeRecord('divergence', 'active'),
      quarantine: makeRecord('quarantine', 'active'),
      proof_lineage: makeRecord('proof_lineage', 'active'),
      freshness: makeRecord('freshness', 'active'),
      cert_evidence: makeRecord('cert_evidence', 'active'),
    };
    const result = dependentGateChecker.checkProgramGates(PROGRAM, records, NOW);
    assert.equal(result.allSatisfied, true);
    assert.equal(result.violations.length, 0);
  });

  it('detects violation when active domain has revoked dependency', () => {
    const records: Partial<Record<CertificationDomain, CertificationRecord>> = {
      replay: makeRecord('replay', 'revoked', { revocationTrigger: 'replay_nondeterminism' }),
      invariant: makeRecord('invariant', 'active'),
      // divergence is active but replay (its dep) is revoked — violation
      divergence: makeRecord('divergence', 'active'),
    };
    const result = dependentGateChecker.checkProgramGates(PROGRAM, records, NOW);
    assert.equal(result.allSatisfied, false);
    const divViolation = result.violations.find(v => v.domain === 'divergence');
    assert.ok(divViolation);
    assert.equal(divViolation.blockers.find(b => b.dependency === 'replay')?.reason, 'revoked');
  });

  it('only checks active domains (pending domains are not violations)', () => {
    const records: Partial<Record<CertificationDomain, CertificationRecord>> = {
      // divergence is pending — its dep replay is missing — NOT a violation
      divergence: makeRecord('divergence', 'pending'),
    };
    const result = dependentGateChecker.checkProgramGates(PROGRAM, records, NOW);
    assert.equal(result.allSatisfied, true);
  });

  it('result includes checkedAt ISO timestamp and is append-safe', () => {
    const result = dependentGateChecker.checkProgramGates(PROGRAM, {}, NOW);
    assert.equal(result.checkedAt, NOW);
    assert.ok(Object.isFrozen(result.violations));
    assert.ok(Object.isFrozen(result.events));
  });

  it('no implicit inheritance — sibling domain status does not satisfy a dep', () => {
    // proof_lineage depends on [invariant, replay]
    // cert_evidence depends on all 6 — if proof_lineage is active but invariant is not,
    // cert_evidence should be a violation because proof_lineage does NOT certify invariant
    const records: Partial<Record<CertificationDomain, CertificationRecord>> = {
      replay: makeRecord('replay', 'active'),
      invariant: makeRecord('invariant', 'revoked', { revocationTrigger: 'invariant_gap' }),
      proof_lineage: makeRecord('proof_lineage', 'active'), // violation — invariant revoked
      cert_evidence: makeRecord('cert_evidence', 'active'), // violation — invariant revoked
    };
    const result = dependentGateChecker.checkProgramGates(PROGRAM, records, NOW);
    assert.equal(result.allSatisfied, false);
    const plfViolation = result.violations.find(v => v.domain === 'proof_lineage');
    assert.ok(plfViolation, 'proof_lineage should have violation');
    const ceViolation = result.violations.find(v => v.domain === 'cert_evidence');
    assert.ok(ceViolation, 'cert_evidence should have violation');
  });
});

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

describe('dependentGateChecker singleton', () => {
  it('is an instance of DependentGateChecker', () => {
    assert.ok(dependentGateChecker instanceof DependentGateChecker);
  });
});
