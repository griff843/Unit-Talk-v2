import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CertificationStateMachine,
  CertificationTransitionError,
  DOMAIN_DEPENDENCIES,
  getDependents,
  CERTIFICATION_DOMAINS,
} from './index.js';
import type { CertificationRecord } from './types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EVIDENCE_SHA  = 'a'.repeat(64);
const MERGE_SHA     = 'b'.repeat(40);
const EVIDENCE_SHA2 = 'c'.repeat(64);
const MERGE_SHA2    = 'd'.repeat(40);

function makeActive(domain: CertificationRecord['domain']): CertificationRecord {
  return {
    id:                 'test-id-' + domain,
    programId:          'P1',
    domain,
    status:             'active',
    evidenceSha:        EVIDENCE_SHA,
    mergeSha:           MERGE_SHA,
    transitionedAt:     '2026-05-26T00:00:00.000Z',
    transitionedBy:     'test',
    transitionReason:   'initial active',
    expiresAt:          null,
    revocationTrigger:  null,
    predecessorId:      null,
    createdAt:          '2026-05-26T00:00:00.000Z',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const sm = new CertificationStateMachine();
const NOW = '2026-05-26T12:00:00.000Z';

describe('CertificationStateMachine — initiate', () => {
  it('produces a pending record with correct fields', () => {
    const { record, event } = sm.initiate('P1', 'replay', EVIDENCE_SHA, MERGE_SHA, 'ci', 'initial', NOW);
    assert.equal(record.status, 'pending');
    assert.equal(record.domain, 'replay');
    assert.equal(record.programId, 'P1');
    assert.equal(record.predecessorId, null);
    assert.equal(record.revocationTrigger, null);
    assert.ok(typeof record.id === 'string');
    assert.equal(event.fromStatus, null);
    assert.equal(event.toStatus, 'pending');
    assert.equal(event.replaySafe, true);
  });

  it('rejects invalid evidenceSha', () => {
    assert.throws(
      () => sm.initiate('P1', 'replay', 'short', MERGE_SHA, 'ci', 'r'),
      CertificationTransitionError,
    );
  });

  it('rejects invalid mergeSha', () => {
    assert.throws(
      () => sm.initiate('P1', 'replay', EVIDENCE_SHA, 'not-a-sha', 'ci', 'r'),
      CertificationTransitionError,
    );
  });
});

describe('CertificationStateMachine — valid transitions', () => {
  it('pending → active', () => {
    const { record: pending } = sm.initiate('P1', 'invariant', EVIDENCE_SHA, MERGE_SHA, 'ci', 'init', NOW);
    const { record, event } = sm.transition(pending, {
      programId: 'P1', domain: 'invariant', status: 'active',
      evidenceSha: EVIDENCE_SHA, mergeSha: MERGE_SHA,
      transitionedBy: 'ci', transitionReason: 'all checks passed',
    }, NOW);
    assert.equal(record.status, 'active');
    assert.equal(record.predecessorId, pending.id);
    assert.equal(event.fromStatus, 'pending');
    assert.equal(event.toStatus, 'active');
  });

  it('pending → revoked (requires trigger)', () => {
    const { record: pending } = sm.initiate('P1', 'replay', EVIDENCE_SHA, MERGE_SHA, 'ci', 'init', NOW);
    const { record } = sm.transition(pending, {
      programId: 'P1', domain: 'replay', status: 'revoked',
      evidenceSha: EVIDENCE_SHA, mergeSha: MERGE_SHA,
      transitionedBy: 'ci', transitionReason: 'nondeterminism detected',
      revocationTrigger: 'replay_nondeterminism',
    }, NOW);
    assert.equal(record.status, 'revoked');
    assert.equal(record.revocationTrigger, 'replay_nondeterminism');
  });

  it('active → suspended', () => {
    const active = makeActive('divergence');
    const { record } = sm.transition(active, {
      programId: 'P1', domain: 'divergence', status: 'suspended',
      evidenceSha: EVIDENCE_SHA, mergeSha: MERGE_SHA,
      transitionedBy: 'invariant-engine', transitionReason: 'warning violation',
    }, NOW);
    assert.equal(record.status, 'suspended');
  });

  it('active → expired', () => {
    const active = makeActive('freshness');
    const { record } = sm.transition(active, {
      programId: 'P1', domain: 'freshness', status: 'expired',
      evidenceSha: EVIDENCE_SHA, mergeSha: MERGE_SHA,
      transitionedBy: 'system', transitionReason: 'staleness window elapsed',
    }, NOW);
    assert.equal(record.status, 'expired');
  });

  it('suspended → active (cleared)', () => {
    const active = makeActive('quarantine');
    const { record: suspended } = sm.transition(active, {
      programId: 'P1', domain: 'quarantine', status: 'suspended',
      evidenceSha: EVIDENCE_SHA, mergeSha: MERGE_SHA,
      transitionedBy: 'ci', transitionReason: 'warning',
    }, NOW);
    const { record } = sm.transition(suspended, {
      programId: 'P1', domain: 'quarantine', status: 'active',
      evidenceSha: EVIDENCE_SHA2, mergeSha: MERGE_SHA2,
      transitionedBy: 'ci', transitionReason: 'investigation cleared',
    }, NOW);
    assert.equal(record.status, 'active');
    assert.equal(record.predecessorId, suspended.id);
  });

  it('expired → pending (re-certification)', () => {
    const active = makeActive('proof_lineage');
    const { record: expired } = sm.transition(active, {
      programId: 'P1', domain: 'proof_lineage', status: 'expired',
      evidenceSha: EVIDENCE_SHA, mergeSha: MERGE_SHA,
      transitionedBy: 'system', transitionReason: 'stale',
    }, NOW);
    const { record } = sm.transition(expired, {
      programId: 'P1', domain: 'proof_lineage', status: 'pending',
      evidenceSha: EVIDENCE_SHA2, mergeSha: MERGE_SHA2,
      transitionedBy: 'ci', transitionReason: 're-certification initiated',
    }, NOW);
    assert.equal(record.status, 'pending');
  });
});

describe('CertificationStateMachine — invalid transitions', () => {
  it('rejects revoked → active (terminal state)', () => {
    const active = makeActive('replay');
    const { record: revoked } = sm.transition(active, {
      programId: 'P1', domain: 'replay', status: 'revoked',
      evidenceSha: EVIDENCE_SHA, mergeSha: MERGE_SHA,
      transitionedBy: 'ci', transitionReason: 'nondeterminism',
      revocationTrigger: 'replay_nondeterminism',
    }, NOW);
    assert.throws(
      () => sm.transition(revoked, {
        programId: 'P1', domain: 'replay', status: 'active',
        evidenceSha: EVIDENCE_SHA, mergeSha: MERGE_SHA,
        transitionedBy: 'ci', transitionReason: 'attempt to reactivate',
      }, NOW),
      CertificationTransitionError,
    );
  });

  it('rejects active → pending (not a valid transition)', () => {
    const active = makeActive('invariant');
    assert.throws(
      () => sm.transition(active, {
        programId: 'P1', domain: 'invariant', status: 'pending',
        evidenceSha: EVIDENCE_SHA, mergeSha: MERGE_SHA,
        transitionedBy: 'ci', transitionReason: 'invalid',
      }, NOW),
      CertificationTransitionError,
    );
  });

  it('rejects revoked without trigger', () => {
    const active = makeActive('divergence');
    assert.throws(
      () => sm.transition(active, {
        programId: 'P1', domain: 'divergence', status: 'revoked',
        evidenceSha: EVIDENCE_SHA, mergeSha: MERGE_SHA,
        transitionedBy: 'ci', transitionReason: 'missing trigger',
        revocationTrigger: null,
      }, NOW),
      CertificationTransitionError,
    );
  });

  it('rejects revocationTrigger on non-revoked status', () => {
    const { record: pending } = sm.initiate('P1', 'freshness', EVIDENCE_SHA, MERGE_SHA, 'ci', 'init', NOW);
    assert.throws(
      () => sm.transition(pending, {
        programId: 'P1', domain: 'freshness', status: 'active',
        evidenceSha: EVIDENCE_SHA, mergeSha: MERGE_SHA,
        transitionedBy: 'ci', transitionReason: 'stray trigger',
        revocationTrigger: 'proof_corruption',
      }, NOW),
      CertificationTransitionError,
    );
  });
});

describe('CertificationStateMachine — revocation propagation', () => {
  it('revoking replay propagates to divergence, quarantine, proof_lineage, freshness, cert_evidence', () => {
    const allActive: Partial<Record<string, CertificationRecord>> = {};
    for (const d of CERTIFICATION_DOMAINS) {
      allActive[d] = makeActive(d);
    }

    const { revocations } = sm.computePropagation(
      {
        programId: 'P1',
        revokedDomain: 'replay',
        revocationTrigger: 'replay_nondeterminism',
        evidenceSha: EVIDENCE_SHA,
        mergeSha: MERGE_SHA,
        transitionedBy: 'replay-harness',
      },
      allActive as Record<string, CertificationRecord>,
      NOW,
    );

    const revokedDomains = revocations.map(r => r.record.domain);
    assert.deepEqual(revokedDomains, ['divergence', 'quarantine', 'proof_lineage', 'freshness', 'cert_evidence']);
    assert.ok(
      revokedDomains.indexOf('cert_evidence') > revokedDomains.indexOf('proof_lineage') &&
      revokedDomains.indexOf('cert_evidence') > revokedDomains.indexOf('freshness'),
      'cert_evidence must revoke after proof_lineage and freshness',
    );

    // replay dependents
    assert.ok(revokedDomains.includes('divergence'),   'divergence must be revoked');
    assert.ok(revokedDomains.includes('quarantine'),   'quarantine must be revoked (depends on divergence)');
    assert.ok(revokedDomains.includes('proof_lineage'),'proof_lineage must be revoked');
    assert.ok(revokedDomains.includes('freshness'),    'freshness must be revoked');
    assert.ok(revokedDomains.includes('cert_evidence'),'cert_evidence must be revoked');

    // invariant is NOT a dependent of replay
    assert.ok(!revokedDomains.includes('invariant'),   'invariant must NOT be revoked');

    // all propagated records must have trigger = dependency_revoked
    for (const r of revocations) {
      assert.equal(r.record.revocationTrigger, 'dependency_revoked', `${r.record.domain} must have dependency_revoked trigger`);
      assert.equal(r.record.status, 'revoked');
      assert.equal(r.event.replaySafe, true);
    }
  });

  it('revoking invariant propagates to divergence, proof_lineage, cert_evidence', () => {
    const allActive: Partial<Record<string, CertificationRecord>> = {};
    for (const d of CERTIFICATION_DOMAINS) {
      allActive[d] = makeActive(d);
    }

    const { revocations } = sm.computePropagation(
      {
        programId: 'P1',
        revokedDomain: 'invariant',
        revocationTrigger: 'invariant_gap',
        evidenceSha: EVIDENCE_SHA,
        mergeSha: MERGE_SHA,
        transitionedBy: 'invariant-engine',
      },
      allActive as Record<string, CertificationRecord>,
      NOW,
    );

    const revokedDomains = revocations.map(r => r.record.domain);
    assert.ok(revokedDomains.includes('divergence'));
    assert.ok(revokedDomains.includes('proof_lineage'));
    assert.ok(revokedDomains.includes('cert_evidence'));
    assert.ok(!revokedDomains.includes('replay'));
    assert.ok(!revokedDomains.includes('freshness')); // freshness depends on replay, not invariant
  });

  it('does not propagate to already-revoked domains', () => {
    const records: Partial<Record<string, CertificationRecord>> = {};
    for (const d of CERTIFICATION_DOMAINS) {
      records[d] = makeActive(d);
    }
    // cert_evidence already revoked
    records['cert_evidence'] = { ...makeActive('cert_evidence'), status: 'revoked', revocationTrigger: 'evidence_invalidation' };

    const { revocations } = sm.computePropagation(
      {
        programId: 'P1',
        revokedDomain: 'replay',
        revocationTrigger: 'replay_nondeterminism',
        evidenceSha: EVIDENCE_SHA,
        mergeSha: MERGE_SHA,
        transitionedBy: 'system',
      },
      records as Record<string, CertificationRecord>,
      NOW,
    );

    const revokedDomains = revocations.map(r => r.record.domain);
    assert.ok(!revokedDomains.includes('cert_evidence'),
      'cert_evidence already revoked — should not be re-revoked');
    assert.equal(revokedDomains.filter(d => d === 'cert_evidence').length, 0,
      'cert_evidence count must be 0 — already revoked domains are skipped');
  });

  it('emits propagation audit event when an expired downstream domain is encountered', () => {
    const allActive: Partial<Record<string, CertificationRecord>> = {};
    for (const d of CERTIFICATION_DOMAINS) {
      allActive[d] = makeActive(d);
    }
    allActive['proof_lineage'] = {
      ...makeActive('proof_lineage'),
      status: 'expired',
    };

    const { auditEvents, revocations } = sm.computePropagation(
      {
        programId: 'P1',
        revokedDomain: 'replay',
        revocationTrigger: 'replay_nondeterminism',
        evidenceSha: EVIDENCE_SHA,
        mergeSha: MERGE_SHA,
        transitionedBy: 'replay-harness',
      },
      allActive as Record<string, CertificationRecord>,
      NOW,
    );

    assert.ok(!revocations.map(r => r.record.domain).includes('proof_lineage'));
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0]?.domain, 'proof_lineage');
    assert.equal(auditEvents[0]?.action, 'certification.propagation.expired-domain');
    assert.equal(auditEvents[0]?.replaySafe, true);
  });
});

describe('CertificationStateMachine — isCertified (fail-closed)', () => {
  it('returns false for null', () => {
    assert.equal(sm.isCertified(null, NOW), false);
  });

  it('returns false for pending', () => {
    const { record } = sm.initiate('P1', 'replay', EVIDENCE_SHA, MERGE_SHA, 'ci', 'init', NOW);
    assert.equal(sm.isCertified(record, NOW), false);
  });

  it('returns false for suspended', () => {
    const active = makeActive('invariant');
    const { record: suspended } = sm.transition(active, {
      programId: 'P1', domain: 'invariant', status: 'suspended',
      evidenceSha: EVIDENCE_SHA, mergeSha: MERGE_SHA,
      transitionedBy: 'ci', transitionReason: 'warning',
    }, NOW);
    assert.equal(sm.isCertified(suspended, NOW), false);
  });

  it('returns false for revoked', () => {
    const active = makeActive('divergence');
    const { record: revoked } = sm.transition(active, {
      programId: 'P1', domain: 'divergence', status: 'revoked',
      evidenceSha: EVIDENCE_SHA, mergeSha: MERGE_SHA,
      transitionedBy: 'ci', transitionReason: 'leakage',
      revocationTrigger: 'divergence_leakage',
    }, NOW);
    assert.equal(sm.isCertified(revoked, NOW), false);
  });

  it('returns false for active but expired by clock', () => {
    const active: CertificationRecord = {
      ...makeActive('freshness'),
      expiresAt: '2026-01-01T00:00:00.000Z',  // in the past
    };
    assert.equal(sm.isCertified(active, NOW), false);
  });

  it('returns true for active with no expiry', () => {
    assert.equal(sm.isCertified(makeActive('replay'), NOW), true);
  });
});

describe('CertificationStateMachine — getProgramBlockers', () => {
  it('returns all 7 domains when no records exist', () => {
    const blockers = sm.getProgramBlockers({}, NOW);
    assert.equal(blockers.length, 7);
  });

  it('returns empty array when all domains active', () => {
    const records: Partial<Record<string, CertificationRecord>> = {};
    for (const d of CERTIFICATION_DOMAINS) {
      records[d] = makeActive(d);
    }
    const blockers = sm.getProgramBlockers(records as Record<string, CertificationRecord>, NOW);
    assert.equal(blockers.length, 0);
  });

  it('identifies specific blockers', () => {
    const records: Partial<Record<string, CertificationRecord>> = {};
    for (const d of CERTIFICATION_DOMAINS) {
      records[d] = makeActive(d);
    }
    // Revoke replay and cert_evidence
    records['replay'] = { ...makeActive('replay'), status: 'revoked', revocationTrigger: 'replay_nondeterminism' };
    records['cert_evidence'] = { ...makeActive('cert_evidence'), status: 'revoked', revocationTrigger: 'evidence_invalidation' };

    const blockers = sm.getProgramBlockers(records as Record<string, CertificationRecord>, NOW);
    assert.ok(blockers.includes('replay'));
    assert.ok(blockers.includes('cert_evidence'));
    assert.equal(blockers.length, 2);
  });
});

describe('DOMAIN_DEPENDENCIES — structural invariants', () => {
  it('cert_evidence depends on all other 6 domains', () => {
    const deps = DOMAIN_DEPENDENCIES['cert_evidence'];
    const others = CERTIFICATION_DOMAINS.filter(d => d !== 'cert_evidence');
    for (const d of others) {
      assert.ok(deps.includes(d), `cert_evidence must depend on ${d}`);
    }
  });

  it('replay and invariant have no dependencies (root domains)', () => {
    assert.equal(DOMAIN_DEPENDENCIES['replay'].length, 0);
    assert.equal(DOMAIN_DEPENDENCIES['invariant'].length, 0);
  });

  it('getDependents(replay) includes divergence, proof_lineage, freshness, cert_evidence', () => {
    const deps = getDependents('replay');
    assert.ok(deps.includes('divergence'));
    assert.ok(deps.includes('proof_lineage'));
    assert.ok(deps.includes('freshness'));
    assert.ok(deps.includes('cert_evidence'));
  });
});
