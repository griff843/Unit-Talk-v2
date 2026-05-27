import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CertificationLifecycleManager,
  type CertificationRepository,
} from './lifecycle-manager.js';
import type {
  CertificationDomain,
  CertificationRecord,
  CertificationTransitionEvent,
  ProgramId,
  RevocationTrigger,
} from './types.js';
import type { PropagationAuditEvent, TransitionResult } from './state-machine.js';
import type { DependentGateEvent } from './dependent-gate.js';

// ---------------------------------------------------------------------------
// In-memory repository for tests
// ---------------------------------------------------------------------------

class InMemoryRepo implements CertificationRepository {
  private records = new Map<string, CertificationRecord>();   // key: `${programId}:${domain}`
  private events: CertificationTransitionEvent[] = [];
  private gateEvents: DependentGateEvent[] = [];
  private propagationAuditEvents: PropagationAuditEvent[] = [];
  insertedBatches: TransitionResult[][] = [];

  async getCurrentRecord(
    programId: ProgramId,
    domain: CertificationDomain,
  ): Promise<CertificationRecord | null> {
    return this.records.get(`${programId}:${domain}`) ?? null;
  }

  async getAllCurrentRecords(
    programId: ProgramId,
  ): Promise<Partial<Record<CertificationDomain, CertificationRecord>>> {
    const result: Partial<Record<CertificationDomain, CertificationRecord>> = {};
    for (const [key, rec] of this.records) {
      if (key.startsWith(`${programId}:`)) {
        const domain = key.slice(`${programId}:`.length) as CertificationDomain;
        result[domain] = rec;
      }
    }
    return result;
  }

  async insertTransition(
    record: CertificationRecord,
    event: CertificationTransitionEvent,
  ): Promise<void> {
    this.records.set(`${record.programId}:${record.domain}`, record);
    this.events.push(event);
  }

  async insertPropagationBatch(results: TransitionResult[]): Promise<void> {
    this.insertedBatches.push(results);
    for (const { record, event } of results) {
      this.records.set(`${record.programId}:${record.domain}`, record);
      this.events.push(event);
    }
  }

  getEvents() { return [...this.events]; }
  getGateEvents() { return [...this.gateEvents]; }
  getPropagationAuditEvents() { return [...this.propagationAuditEvents]; }

  async insertGateEvent(event: DependentGateEvent): Promise<void> {
    this.gateEvents.push(event);
  }

  async insertPropagationAuditEvent(event: PropagationAuditEvent): Promise<void> {
    this.propagationAuditEvents.push(event);
  }
}

const EVIDENCE = 'a'.repeat(64);
const MERGE    = 'b'.repeat(40);
const PROGRAM: ProgramId = 'P1';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CertificationLifecycleManager', () => {
  let repo: InMemoryRepo;
  let mgr: CertificationLifecycleManager;

  beforeEach(() => {
    repo = new InMemoryRepo();
    mgr  = new CertificationLifecycleManager(repo);
  });

  describe('initiate', () => {
    it('creates a pending record', async () => {
      const result = await mgr.initiate({
        programId: PROGRAM, domain: 'replay',
        evidenceSha: EVIDENCE, mergeSha: MERGE,
        transitionedBy: 'test', transitionReason: 'init',
      });
      assert.equal(result.record.status, 'pending');
      assert.equal(result.record.domain, 'replay');
      assert.equal(result.event.toStatus, 'pending');
      assert.equal(result.event.replaySafe, true);
    });

    it('is idempotent when already pending', async () => {
      await mgr.initiate({ programId: PROGRAM, domain: 'replay', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'init' });
      await mgr.initiate({ programId: PROGRAM, domain: 'replay', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'init2' });
      // Only one event emitted (first call)
      assert.equal(repo.getEvents().length, 1);
    });
  });

  describe('activate', () => {
    it('pending → active', async () => {
      await mgr.initiate({ programId: PROGRAM, domain: 'invariant', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'init' });
      const result = await mgr.activate({ programId: PROGRAM, domain: 'invariant', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'activate' });
      assert.equal(result.record.status, 'active');
      assert.equal(result.event.fromStatus, 'pending');
      assert.equal(result.event.toStatus, 'active');
      assert.equal(repo.getGateEvents().at(-1)?.verdict, 'allowed');
    });

    it('persists denied dependent-gate evidence before failing closed', async () => {
      await mgr.initiate({ programId: PROGRAM, domain: 'divergence', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'init' });

      await assert.rejects(
        () => mgr.activate({ programId: PROGRAM, domain: 'divergence', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'activate' }),
        /Dependent-gate denied/,
      );

      const [gateEvent] = repo.getGateEvents();
      assert.equal(gateEvent?.verdict, 'denied');
      assert.equal(gateEvent.domain, 'divergence');
      assert.ok(gateEvent.blockers.some(blocker => blocker.reason === 'missing'));
    });

    it('rejects active → pending (invalid transition)', async () => {
      await mgr.initiate({ programId: PROGRAM, domain: 'replay', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'init' });
      await mgr.activate({ programId: PROGRAM, domain: 'replay', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'activate' });
      await assert.rejects(
        () => mgr.initiate({ programId: PROGRAM, domain: 'replay', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 're-init' }),
        /transition active.*pending is not permitted/i,
      );
    });
  });

  describe('suspend', () => {
    it('active → suspended', async () => {
      await mgr.initiate({ programId: PROGRAM, domain: 'invariant', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'init' });
      await mgr.activate({ programId: PROGRAM, domain: 'invariant', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'activate' });
      const result = await mgr.suspend({ programId: PROGRAM, domain: 'invariant', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'suspend' });
      assert.equal(result.record.status, 'suspended');
    });

    it('suspended → active (re-activation)', async () => {
      await mgr.initiate({ programId: PROGRAM, domain: 'invariant', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'init' });
      await mgr.activate({ programId: PROGRAM, domain: 'invariant', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'activate' });
      await mgr.suspend({ programId: PROGRAM, domain: 'invariant', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'suspend' });
      const result = await mgr.activate({ programId: PROGRAM, domain: 'invariant', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 're-activate' });
      assert.equal(result.record.status, 'active');
    });
  });

  describe('revoke', () => {
    it('revocation is terminal — no further transitions allowed', async () => {
      await mgr.initiate({ programId: PROGRAM, domain: 'replay', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'init' });
      await mgr.activate({ programId: PROGRAM, domain: 'replay', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'activate' });
      await mgr.revoke({ programId: PROGRAM, domain: 'replay', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'revoke', revocationTrigger: 'replay_nondeterminism' });
      await assert.rejects(
        () => mgr.activate({ programId: PROGRAM, domain: 'replay', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'attempt re-activate' }),
        /transition revoked.*active is not permitted/i,
      );
    });

    it('revoking replay cascades to dependent domains', async () => {
      // Set up replay + divergence (depends on replay) as active
      for (const domain of ['replay', 'invariant', 'divergence'] as CertificationDomain[]) {
        await mgr.initiate({ programId: PROGRAM, domain, evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'init' });
        await mgr.activate({ programId: PROGRAM, domain, evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'activate' });
      }

      const result = await mgr.revoke({
        programId: PROGRAM, domain: 'replay',
        evidenceSha: EVIDENCE, mergeSha: MERGE,
        transitionedBy: 'test', transitionReason: 'revoke',
        revocationTrigger: 'replay_nondeterminism',
      });

      assert.equal(result.record.status, 'revoked');
      assert.ok(result.propagated.length > 0, 'should cascade to dependents');
      // divergence depends on replay — must be revoked
      const revokedDomains = result.propagated.map(r => r.record.domain);
      assert.ok(revokedDomains.includes('divergence'), 'divergence must be cascade-revoked');

      // Batch insert used for propagation
      assert.equal(repo.insertedBatches.length, 1);
    });

    it('revocation requires a trigger', async () => {
      await mgr.initiate({ programId: PROGRAM, domain: 'quarantine', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'init' });
      await assert.rejects(
        () => mgr.revoke({ programId: PROGRAM, domain: 'quarantine', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'revoke', revocationTrigger: undefined as unknown as RevocationTrigger }),
        /revocationTrigger/i,
      );
    });
  });

  describe('checkGates', () => {
    it('returns all 7 domains as blockers when nothing certified', async () => {
      const result = await mgr.checkGates(PROGRAM);
      assert.equal(result.allCertified, false);
      assert.equal(result.blockers.length, 7);
    });

    it('returns allCertified when all 7 domains are active', async () => {
      const domains: CertificationDomain[] = ['replay', 'invariant', 'divergence', 'quarantine', 'proof_lineage', 'freshness', 'cert_evidence'];
      for (const domain of domains) {
        await mgr.initiate({ programId: PROGRAM, domain, evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'init' });
        await mgr.activate({ programId: PROGRAM, domain, evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'activate' });
      }
      const result = await mgr.checkGates(PROGRAM);
      assert.equal(result.allCertified, true);
      assert.equal(result.blockers.length, 0);
    });

    it('fail-closed after revocation — revoked domain is a blocker', async () => {
      const domains: CertificationDomain[] = ['replay', 'invariant', 'divergence', 'quarantine', 'proof_lineage', 'freshness', 'cert_evidence'];
      for (const domain of domains) {
        await mgr.initiate({ programId: PROGRAM, domain, evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'init' });
        await mgr.activate({ programId: PROGRAM, domain, evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'activate' });
      }
      await mgr.revoke({ programId: PROGRAM, domain: 'replay', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'revoke', revocationTrigger: 'replay_nondeterminism' });

      const result = await mgr.checkGates(PROGRAM);
      assert.equal(result.allCertified, false);
      assert.ok(result.blockers.includes('replay'));
    });
  });

  describe('event wiring', () => {
    it('onInvariantViolationEscalation triggers invariant_gap revocation', async () => {
      await mgr.initiate({ programId: PROGRAM, domain: 'invariant', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'init' });
      await mgr.activate({ programId: PROGRAM, domain: 'invariant', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'activate' });

      const result = await mgr.onInvariantViolationEscalation(PROGRAM, 'invariant', EVIDENCE, MERGE, 'gap detected');
      assert.equal(result.record.revocationTrigger, 'invariant_gap');
      assert.equal(result.record.transitionedBy, 'invariant-engine');
    });

    it('onReplayNondeterminism triggers replay_nondeterminism revocation', async () => {
      await mgr.initiate({ programId: PROGRAM, domain: 'replay', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'init' });
      await mgr.activate({ programId: PROGRAM, domain: 'replay', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'activate' });

      const result = await mgr.onReplayNondeterminism(PROGRAM, 'replay', EVIDENCE, MERGE, 'hash mismatch');
      assert.equal(result.record.revocationTrigger, 'replay_nondeterminism');
      assert.equal(result.record.transitionedBy, 'replay-harness');
    });

    it('onQuarantineBypass revokes quarantine domain', async () => {
      for (const domain of ['replay', 'invariant', 'divergence', 'quarantine'] as CertificationDomain[]) {
        await mgr.initiate({ programId: PROGRAM, domain, evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'init' });
        await mgr.activate({ programId: PROGRAM, domain, evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'activate' });
      }

      const result = await mgr.onQuarantineBypass(PROGRAM, EVIDENCE, MERGE, 'unauthorized bypass');
      assert.equal(result.record.revocationTrigger, 'quarantine_bypass');
      assert.equal(result.record.transitionedBy, 'quarantine-enforcement');
    });
  });

  describe('audit trail', () => {
    it('every transition emits a replaySafe event', async () => {
      await mgr.initiate({ programId: PROGRAM, domain: 'replay', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'init' });
      await mgr.activate({ programId: PROGRAM, domain: 'replay', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'activate' });
      await mgr.suspend({ programId: PROGRAM, domain: 'replay', evidenceSha: EVIDENCE, mergeSha: MERGE, transitionedBy: 'test', transitionReason: 'suspend' });

      const events = repo.getEvents();
      assert.equal(events.length, 3);
      assert.ok(events.every(e => e.replaySafe === true));
    });
  });
});
