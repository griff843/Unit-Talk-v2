import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  CertificationLifecycleManager,
  CertificationStateMachine,
  CERTIFICATION_DOMAINS,
  REVOCATION_TRIGGER_EXECUTION_MATRIX,
  type CertificationDomain,
  type CertificationRecord,
  type CertificationRepository,
  type CertificationTransitionEvent,
  type ProgramId,
  type TransitionResult,
} from './index.js';
import { RevocationTriggerWiring } from './revocation-trigger-wiring.js';
import type { InvariantViolation } from '../engine.js';
import type { EscalationNotice } from '../quarantine.js';

class InMemoryCertificationRepository implements CertificationRepository {
  readonly records = new Map<string, CertificationRecord>();
  readonly events: CertificationTransitionEvent[] = [];
  readonly batches: TransitionResult[][] = [];

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
    for (const [key, record] of this.records) {
      if (!key.startsWith(`${programId}:`)) continue;
      result[record.domain] = record;
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
    this.batches.push(results);
    for (const result of results) {
      await this.insertTransition(result.record, result.event);
    }
  }
}

const PROGRAM: ProgramId = 'P1';
const EVIDENCE_SHA = '1'.repeat(64);
const MERGE_SHA = '2'.repeat(40);
const NOW = '2026-05-26T18:00:00.000Z';

async function activateDomain(
  manager: CertificationLifecycleManager,
  domain: CertificationDomain,
): Promise<void> {
  await manager.initiate({
    programId: PROGRAM,
    domain,
    evidenceSha: EVIDENCE_SHA,
    mergeSha: MERGE_SHA,
    transitionedBy: 'test',
    transitionReason: `init ${domain}`,
    occurredAt: NOW,
  });
  await manager.activate({
    programId: PROGRAM,
    domain,
    evidenceSha: EVIDENCE_SHA,
    mergeSha: MERGE_SHA,
    transitionedBy: 'test',
    transitionReason: `activate ${domain}`,
    occurredAt: NOW,
  });
}

test('revocation trigger execution matrix covers every required ACTIVE_CERT signal', () => {
  assert.deepStrictEqual(
    REVOCATION_TRIGGER_EXECUTION_MATRIX.map(entry => entry.signal),
    [
      'replay_nondeterminism',
      'invariant_violation',
      'stale_proof_lineage',
      'freshness_enforcement_failure',
      'divergence_threshold_breach',
      'quarantine_escalation',
      'dependency_invalidation',
    ],
  );
  assert.ok(REVOCATION_TRIGGER_EXECUTION_MATRIX.every(entry => entry.propagates));
  assert.ok(REVOCATION_TRIGGER_EXECUTION_MATRIX.every(entry => entry.replayVisible));
  assert.ok(REVOCATION_TRIGGER_EXECUTION_MATRIX.every(entry => entry.evidenceMode === 'append_only'));
  assert.ok(REVOCATION_TRIGGER_EXECUTION_MATRIX.every(entry => entry.failClosed));
});

test('executeRevocationTrigger persists replay-visible append-only evidence', async () => {
  const repo = new InMemoryCertificationRepository();
  const manager = new CertificationLifecycleManager(repo);
  await activateDomain(manager, 'replay');

  const result = await manager.executeRevocationTrigger({
    programId: PROGRAM,
    signal: 'replay_nondeterminism',
    evidenceSha: EVIDENCE_SHA,
    mergeSha: MERGE_SHA,
    detail: 'same replay pack produced different digest',
    occurredAt: NOW,
  });

  assert.equal(result.record.status, 'revoked');
  assert.equal(result.record.revocationTrigger, 'replay_nondeterminism');
  assert.equal(result.event.replaySafe, true);
  assert.equal(result.event.certRecordId, result.record.id);
  assert.equal(repo.events.at(-1)?.toStatus, 'revoked');
});

test('all required trigger hooks map to deterministic certification revocations', async (t) => {
  const cases: Array<{
    readonly name: string;
    readonly domain: CertificationDomain;
    readonly run: (manager: CertificationLifecycleManager) => Promise<TransitionResult['record']>;
    readonly trigger: CertificationRecord['revocationTrigger'];
    readonly actor: string;
  }> = [
    {
      name: 'replay nondeterminism',
      domain: 'replay',
      run: async manager => (await manager.onReplayNondeterminism(
        PROGRAM,
        'replay',
        EVIDENCE_SHA,
        MERGE_SHA,
        'digest mismatch',
      )).record,
      trigger: 'replay_nondeterminism',
      actor: 'replay-harness',
    },
    {
      name: 'invariant violation',
      domain: 'invariant',
      run: async manager => (await manager.onInvariantViolationEscalation(
        PROGRAM,
        'invariant',
        EVIDENCE_SHA,
        MERGE_SHA,
        'hard invariant failed',
      )).record,
      trigger: 'invariant_gap',
      actor: 'invariant-engine',
    },
    {
      name: 'stale proof lineage',
      domain: 'proof_lineage',
      run: async manager => (await manager.onStaleProofLineage(
        PROGRAM,
        EVIDENCE_SHA,
        MERGE_SHA,
        'proof predecessor not current',
      )).record,
      trigger: 'proof_corruption',
      actor: 'proof-lineage-enforcement',
    },
    {
      name: 'freshness enforcement failure',
      domain: 'freshness',
      run: async manager => (await manager.onFreshnessEnforcementFailure(
        PROGRAM,
        EVIDENCE_SHA,
        MERGE_SHA,
        'stale price accepted',
      )).record,
      trigger: 'stale_replay_acceptance',
      actor: 'freshness-enforcement',
    },
    {
      name: 'divergence threshold breach',
      domain: 'divergence',
      run: async manager => (await manager.onDivergenceThresholdBreach(
        PROGRAM,
        EVIDENCE_SHA,
        MERGE_SHA,
        'threshold exceeded',
      )).record,
      trigger: 'divergence_leakage',
      actor: 'divergence-monitor',
    },
    {
      name: 'quarantine escalation',
      domain: 'quarantine',
      run: async manager => (await manager.onQuarantineBypass(
        PROGRAM,
        EVIDENCE_SHA,
        MERGE_SHA,
        'escalated quarantine source',
      )).record,
      trigger: 'quarantine_bypass',
      actor: 'quarantine-enforcement',
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const repo = new InMemoryCertificationRepository();
      const manager = new CertificationLifecycleManager(repo);
      await activateDomain(manager, item.domain);

      const record = await item.run(manager);

      assert.equal(record.domain, item.domain);
      assert.equal(record.status, 'revoked');
      assert.equal(record.revocationTrigger, item.trigger);
      assert.equal(record.transitionedBy, item.actor);
    });
  }
});

test('dependency invalidation propagation revokes downstream missing state fail-closed', () => {
  const stateMachine = new CertificationStateMachine();
  const replay = stateMachine.transition(
    null,
    {
      programId: PROGRAM,
      domain: 'replay',
      status: 'revoked',
      evidenceSha: EVIDENCE_SHA,
      mergeSha: MERGE_SHA,
      transitionedBy: 'replay-harness',
      transitionReason: 'Replay nondeterminism detected: digest mismatch',
      revocationTrigger: 'replay_nondeterminism',
    },
    NOW,
  );

  const propagation = stateMachine.computePropagation(
    {
      programId: PROGRAM,
      revokedDomain: 'replay',
      revocationTrigger: 'replay_nondeterminism',
      evidenceSha: EVIDENCE_SHA,
      mergeSha: MERGE_SHA,
      transitionedBy: 'certification-lifecycle-manager',
    },
    { replay: replay.record },
    NOW,
  );

  const revokedDomains = propagation.revocations.map(result => result.record.domain);
  assert.deepStrictEqual(
    revokedDomains,
    ['divergence', 'quarantine', 'cert_evidence', 'proof_lineage', 'freshness'],
  );
  assert.ok(propagation.revocations.every(result => result.record.revocationTrigger === 'dependency_revoked'));
  assert.ok(propagation.revocations.every(result => result.record.predecessorId === null));
});

test('transition events reconstruct audit-visible lifecycle state', async () => {
  const repo = new InMemoryCertificationRepository();
  const manager = new CertificationLifecycleManager(repo);
  await activateDomain(manager, 'freshness');
  await manager.onFreshnessEnforcementFailure(
    PROGRAM,
    EVIDENCE_SHA,
    MERGE_SHA,
    'stale proof window',
  );

  const reconstructed = new CertificationStateMachine()
    .reconstructCurrentStateFromEvents(repo.events);

  assert.equal(reconstructed.freshness?.status, 'revoked');
  assert.equal(reconstructed.freshness?.certRecordId, repo.records.get(`${PROGRAM}:freshness`)?.id);
});

test('deterministic replay produces identical revocation records and events', () => {
  const left = new CertificationStateMachine().transition(
    null,
    {
      programId: PROGRAM,
      domain: 'freshness',
      status: 'revoked',
      evidenceSha: EVIDENCE_SHA,
      mergeSha: MERGE_SHA,
      transitionedBy: 'freshness-enforcement',
      transitionReason: 'Freshness enforcement failed: stale price accepted',
      revocationTrigger: 'stale_replay_acceptance',
    },
    NOW,
  );
  const right = new CertificationStateMachine().transition(
    null,
    {
      programId: PROGRAM,
      domain: 'freshness',
      status: 'revoked',
      evidenceSha: EVIDENCE_SHA,
      mergeSha: MERGE_SHA,
      transitionedBy: 'freshness-enforcement',
      transitionReason: 'Freshness enforcement failed: stale price accepted',
      revocationTrigger: 'stale_replay_acceptance',
    },
    NOW,
  );

  assert.deepStrictEqual(left, right);
});

test('trigger propagation keeps constitutional activation order stable', async () => {
  const repo = new InMemoryCertificationRepository();
  const manager = new CertificationLifecycleManager(repo);
  for (const domain of CERTIFICATION_DOMAINS) {
    await activateDomain(manager, domain);
  }

  const result = await manager.executeRevocationTrigger({
    programId: PROGRAM,
    signal: 'replay_nondeterminism',
    evidenceSha: EVIDENCE_SHA,
    mergeSha: MERGE_SHA,
    detail: 'digest mismatch',
    occurredAt: NOW,
  });

  assert.deepStrictEqual(
    result.propagated.map(item => item.record.domain),
    ['divergence', 'quarantine', 'cert_evidence', 'proof_lineage', 'freshness'],
  );
});

// ---------------------------------------------------------------------------
// RevocationTriggerWiring — event-listener integration
// ---------------------------------------------------------------------------

test('RevocationTriggerWiring: engine violation (no replay_run_id) calls onInvariantViolationEscalation', async () => {
  const repo = new InMemoryCertificationRepository();
  const manager = new CertificationLifecycleManager(repo);
  await activateDomain(manager, 'invariant');

  const engine = new EventEmitter();
  const wiring = new RevocationTriggerWiring(manager);
  wiring.wireEngine(engine as never, {
    programId: PROGRAM,
    domain: 'invariant',
    evidenceSha: EVIDENCE_SHA,
    mergeSha: MERGE_SHA,
  });

  const violation: InvariantViolation = {
    invariant_id: 'INV-0001',
    title: 'agent claim override',
    severity: 'governance-critical',
    quarantine_behavior: 'fail-closed',
    detected_at: NOW,
    context: {},
  };

  engine.emit('violation', violation);
  // Drain the microtask queue
  await new Promise(resolve => setImmediate(resolve));

  const record = repo.records.get(`${PROGRAM}:invariant`);
  assert.ok(record, 'record should be written after violation');
  assert.equal(record?.status, 'revoked');
  assert.equal(record?.revocationTrigger, 'invariant_gap');
});

test('RevocationTriggerWiring: engine violation with replay_run_id calls onReplayNondeterminism', async () => {
  const repo = new InMemoryCertificationRepository();
  const manager = new CertificationLifecycleManager(repo);
  await activateDomain(manager, 'replay');

  const engine = new EventEmitter();
  const wiring = new RevocationTriggerWiring(manager);
  wiring.wireEngine(engine as never, {
    programId: PROGRAM,
    domain: 'replay',
    evidenceSha: EVIDENCE_SHA,
    mergeSha: MERGE_SHA,
  });

  const violation: InvariantViolation = {
    invariant_id: 'INV-0009',
    title: 'replay result mismatch',
    severity: 'governance-critical',
    quarantine_behavior: 'fail-closed',
    detected_at: NOW,
    context: {},
    replay_run_id: 'run-test-001',
  };

  engine.emit('violation', violation);
  await new Promise(resolve => setImmediate(resolve));

  const record = repo.records.get(`${PROGRAM}:replay`);
  assert.ok(record);
  assert.equal(record?.status, 'revoked');
  assert.equal(record?.revocationTrigger, 'replay_nondeterminism');
});

test('RevocationTriggerWiring: quarantine escalation calls onQuarantineBypass', async () => {
  const repo = new InMemoryCertificationRepository();
  const manager = new CertificationLifecycleManager(repo);
  await activateDomain(manager, 'quarantine');

  const qm = new EventEmitter();
  const wiring = new RevocationTriggerWiring(manager);
  wiring.wireQuarantineManager(qm as never, {
    programId: PROGRAM,
    evidenceSha: EVIDENCE_SHA,
    mergeSha: MERGE_SHA,
  });

  const notice: EscalationNotice = {
    invariant_id: 'INV-0011',
    target: 'governance-team',
    quarantine_record_id: 'qrec-abc',
    audit_event_id: 'audit-abc',
    routed_at: NOW,
  };

  qm.emit('escalation', notice);
  await new Promise(resolve => setImmediate(resolve));

  const record = repo.records.get(`${PROGRAM}:quarantine`);
  assert.ok(record);
  assert.equal(record?.status, 'revoked');
  assert.equal(record?.revocationTrigger, 'quarantine_bypass');
});

test('RevocationTriggerWiring: dispose removes all listeners', async () => {
  const repo = new InMemoryCertificationRepository();
  const manager = new CertificationLifecycleManager(repo);
  await activateDomain(manager, 'invariant');

  const engine = new EventEmitter();
  const wiring = new RevocationTriggerWiring(manager);
  wiring.wireEngine(engine as never, {
    programId: PROGRAM,
    domain: 'invariant',
    evidenceSha: EVIDENCE_SHA,
    mergeSha: MERGE_SHA,
  });

  wiring.dispose();

  const violation: InvariantViolation = {
    invariant_id: 'INV-0001',
    title: 'should be ignored after dispose',
    severity: 'governance-critical',
    quarantine_behavior: 'fail-closed',
    detected_at: NOW,
    context: {},
  };

  engine.emit('violation', violation);
  await new Promise(resolve => setImmediate(resolve));

  // No revocation should have been written after dispose
  assert.equal(repo.records.get(`${PROGRAM}:invariant`)?.status, 'active');
});

test('RevocationTriggerWiring: triggerReplayNondeterminism direct entry-point', async () => {
  const repo = new InMemoryCertificationRepository();
  const manager = new CertificationLifecycleManager(repo);
  await activateDomain(manager, 'replay');

  const wiring = new RevocationTriggerWiring(manager);
  const result = await wiring.triggerReplayNondeterminism(
    PROGRAM, 'replay', EVIDENCE_SHA, MERGE_SHA, 'nondeterministic output',
  );

  assert.equal(result.record.status, 'revoked');
  assert.equal(result.record.revocationTrigger, 'replay_nondeterminism');
});

test('RevocationTriggerWiring: triggerStaleProofLineage direct entry-point', async () => {
  const repo = new InMemoryCertificationRepository();
  const manager = new CertificationLifecycleManager(repo);
  await activateDomain(manager, 'proof_lineage');

  const wiring = new RevocationTriggerWiring(manager);
  const result = await wiring.triggerStaleProofLineage(
    PROGRAM, EVIDENCE_SHA, MERGE_SHA, 'proof older than 72h',
  );

  assert.equal(result.record.status, 'revoked');
  assert.equal(result.record.revocationTrigger, 'proof_corruption');
});
