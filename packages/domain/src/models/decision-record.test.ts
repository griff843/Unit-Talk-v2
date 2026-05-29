import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDecisionRecord,
  appendDecisionRecord,
  buildDecisionChain,
  reconstructDecisionChain,
  verifyDecisionIntegrity,
  verifyDecisionChainIntegrity,
  latestDecision,
  chainHasForceDecision,
  chainHasOverrideDecision,
  getTracedDecisions,
  type DecisionRecordInput,
} from './decision-record.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const PROV = {
  authority: 'system' as const,
  policy_version: 'promotion-v1',
  evaluator_version: 'eval-v1',
};

function makeInput(overrides: Partial<DecisionRecordInput> = {}): DecisionRecordInput {
  return {
    record_id: 'rec-001',
    decision_type: 'promotion',
    entity_id: 'entity-abc',
    entity_type: 'pick' as const,
    decided_at_ms: 1_700_000_000_000,
    outcome: 'approved',
    reason: 'all gates passed',
    inputs_hash: 'a'.repeat(64),
    provenance: PROV,
    preceding_record_id: null,
    ...overrides,
  };
}

// ── createDecisionRecord ───────────────────────────────────────────────────────

test('createDecisionRecord: creates a frozen, valid record', () => {
  const rec = createDecisionRecord(makeInput());
  assert.equal(rec.record_id, 'rec-001');
  assert.equal(rec.outcome, 'approved');
  assert.equal(rec.is_force, false);
  assert.equal(rec.is_override, false);
  assert.equal(rec.preceding_record_id, null);
  // Immutability — object is frozen
  assert.ok(Object.isFrozen(rec));
  assert.ok(Object.isFrozen(rec.provenance));
});

test('createDecisionRecord: defaults is_force and is_override to false', () => {
  const rec = createDecisionRecord(makeInput());
  assert.equal(rec.is_force, false);
  assert.equal(rec.is_override, false);
});

test('createDecisionRecord: accepts is_force and is_override overrides', () => {
  const rec = createDecisionRecord(makeInput({
    decision_type: 'force_promote',
    is_force: true,
    is_override: true,
    provenance: { ...PROV, authority: 'pm' },
  }));
  assert.equal(rec.is_force, true);
  assert.equal(rec.is_override, true);
});

// ── Adversarial immutability ───────────────────────────────────────────────────

test('adversarial: frozen record resists direct mutation', () => {
  const rec = createDecisionRecord(makeInput());
  assert.throws(() => {
    // @ts-expect-error — intentional mutation attempt
    rec.outcome = 'blocked';
  }, TypeError);
  assert.equal(rec.outcome, 'approved');
});

test('adversarial: frozen provenance resists direct mutation', () => {
  const rec = createDecisionRecord(makeInput());
  assert.throws(() => {
    // @ts-expect-error — intentional mutation attempt
    rec.provenance.policy_version = 'hacked';
  }, TypeError);
  assert.equal(rec.provenance.policy_version, 'promotion-v1');
});

// ── Validation ─────────────────────────────────────────────────────────────────

test('createDecisionRecord: throws on missing record_id', () => {
  assert.throws(
    () => createDecisionRecord(makeInput({ record_id: '' })),
    /record_id and entity_id are required/,
  );
});

test('createDecisionRecord: throws on missing entity_id', () => {
  assert.throws(
    () => createDecisionRecord(makeInput({ entity_id: '' })),
    /record_id and entity_id are required/,
  );
});

test('createDecisionRecord: throws on invalid decided_at_ms', () => {
  assert.throws(
    () => createDecisionRecord(makeInput({ decided_at_ms: 0 })),
    /decided_at_ms/,
  );
});

test('createDecisionRecord: throws on missing inputs_hash', () => {
  assert.throws(
    () => createDecisionRecord(makeInput({ inputs_hash: '' })),
    /inputs_hash is required/,
  );
});

test('createDecisionRecord: throws on missing provenance policy_version', () => {
  assert.throws(
    () => createDecisionRecord(makeInput({ provenance: { ...PROV, policy_version: '' } })),
    /provenance must include/,
  );
});

// ── appendDecisionRecord ───────────────────────────────────────────────────────

test('appendDecisionRecord: appends correctly and returns new chain', () => {
  const r1 = createDecisionRecord(makeInput());
  const chain0 = buildDecisionChain('entity-abc', 'pick', [r1]);
  const r2 = createDecisionRecord(makeInput({
    record_id: 'rec-002',
    outcome: 'blocked',
    reason: 'gate failed',
    preceding_record_id: 'rec-001',
  }));
  const chain1 = appendDecisionRecord(chain0, r2);
  assert.equal(chain1.records.length, 2);
  assert.equal(chain1.records[1]!.record_id, 'rec-002');
  // Original chain is unchanged
  assert.equal(chain0.records.length, 1);
});

test('appendDecisionRecord: throws on entity_id mismatch', () => {
  const r1 = createDecisionRecord(makeInput());
  const chain = buildDecisionChain('entity-abc', 'pick', [r1]);
  const wrong = createDecisionRecord(makeInput({
    record_id: 'rec-002',
    entity_id: 'different-entity',
    preceding_record_id: 'rec-001',
  }));
  assert.throws(
    () => appendDecisionRecord(chain, wrong),
    /entity_id mismatch/,
  );
});

test('appendDecisionRecord: throws on broken chain linkage', () => {
  const r1 = createDecisionRecord(makeInput());
  const chain = buildDecisionChain('entity-abc', 'pick', [r1]);
  const broken = createDecisionRecord(makeInput({
    record_id: 'rec-002',
    preceding_record_id: 'wrong-id',
  }));
  assert.throws(
    () => appendDecisionRecord(chain, broken),
    /preceding_record_id mismatch/,
  );
});

// ── Replay reconstruction ──────────────────────────────────────────────────────

test('reconstructDecisionChain: reconstructs ordered chain from unordered records', () => {
  const r1 = createDecisionRecord(makeInput({ record_id: 'r1' }));
  const r2 = createDecisionRecord(makeInput({ record_id: 'r2', preceding_record_id: 'r1' }));
  const r3 = createDecisionRecord(makeInput({ record_id: 'r3', preceding_record_id: 'r2' }));
  // Pass in reverse order
  const chain = reconstructDecisionChain('entity-abc', 'pick', [r3, r1, r2]);
  assert.ok(chain !== null);
  assert.equal(chain!.records.length, 3);
  assert.equal(chain!.records[0]!.record_id, 'r1');
  assert.equal(chain!.records[1]!.record_id, 'r2');
  assert.equal(chain!.records[2]!.record_id, 'r3');
});

test('reconstructDecisionChain: returns null for empty set', () => {
  const chain = reconstructDecisionChain('entity-abc', 'pick', []);
  assert.equal(chain, null);
});

test('reconstructDecisionChain: returns null for multiple roots (gap)', () => {
  const r1 = createDecisionRecord(makeInput({ record_id: 'r1' }));
  const r2 = createDecisionRecord(makeInput({ record_id: 'r2', preceding_record_id: null }));
  const chain = reconstructDecisionChain('entity-abc', 'pick', [r1, r2]);
  assert.equal(chain, null);
});

test('reconstructDecisionChain: deterministic — same inputs same output', () => {
  const r1 = createDecisionRecord(makeInput({ record_id: 'r1' }));
  const r2 = createDecisionRecord(makeInput({ record_id: 'r2', preceding_record_id: 'r1' }));
  const c1 = reconstructDecisionChain('entity-abc', 'pick', [r1, r2]);
  const c2 = reconstructDecisionChain('entity-abc', 'pick', [r2, r1]);
  assert.ok(c1 !== null && c2 !== null);
  assert.deepEqual(c1!.records[0]!.record_id, c2!.records[0]!.record_id);
  assert.deepEqual(c1!.records[1]!.record_id, c2!.records[1]!.record_id);
});

// ── Append-only evidence ───────────────────────────────────────────────────────

test('append-only: chain grows monotonically, old records never change', () => {
  const r1 = createDecisionRecord(makeInput({ record_id: 'r1' }));
  let chain = buildDecisionChain('entity-abc', 'pick', [r1]);
  const originalRecordId = chain.records[0]!.record_id;

  for (let i = 2; i <= 5; i++) {
    const next = createDecisionRecord(makeInput({
      record_id: `r${i}`,
      preceding_record_id: `r${i - 1}`,
    }));
    chain = appendDecisionRecord(chain, next);
  }

  assert.equal(chain.records.length, 5);
  // First record unchanged
  assert.equal(chain.records[0]!.record_id, originalRecordId);
  assert.equal(chain.records[0]!.preceding_record_id, null);
});

// ── Force / override tracing ───────────────────────────────────────────────────

test('force path is traceable via is_force flag', () => {
  const normal = createDecisionRecord(makeInput({ record_id: 'r1' }));
  const forced = createDecisionRecord(makeInput({
    record_id: 'r2',
    decision_type: 'force_promote',
    is_force: true,
    provenance: { ...PROV, authority: 'pm' },
    preceding_record_id: 'r1',
  }));
  const chain = buildDecisionChain('entity-abc', 'pick', [normal, forced]);
  assert.ok(chainHasForceDecision(chain));
  assert.equal(getTracedDecisions(chain).length, 1);
  assert.equal(getTracedDecisions(chain)[0]!.record_id, 'r2');
});

test('override path is traceable via is_override flag', () => {
  const normal = createDecisionRecord(makeInput({ record_id: 'r1' }));
  const overridden = createDecisionRecord(makeInput({
    record_id: 'r2',
    decision_type: 'override_block',
    is_override: true,
    provenance: { ...PROV, authority: 'operator' },
    preceding_record_id: 'r1',
  }));
  const chain = buildDecisionChain('entity-abc', 'pick', [normal, overridden]);
  assert.ok(chainHasOverrideDecision(chain));
});

test('clean chain has no force or override decisions', () => {
  const r1 = createDecisionRecord(makeInput({ record_id: 'r1' }));
  const r2 = createDecisionRecord(makeInput({ record_id: 'r2', preceding_record_id: 'r1' }));
  const chain = buildDecisionChain('entity-abc', 'pick', [r1, r2]);
  assert.ok(!chainHasForceDecision(chain));
  assert.ok(!chainHasOverrideDecision(chain));
  assert.equal(getTracedDecisions(chain).length, 0);
});

// ── Integrity verification ─────────────────────────────────────────────────────

test('verifyDecisionIntegrity: clean record has no violations', () => {
  const rec = createDecisionRecord(makeInput());
  assert.deepEqual(verifyDecisionIntegrity(rec), []);
});

test('verifyDecisionChainIntegrity: clean chain has no violations', () => {
  const r1 = createDecisionRecord(makeInput({ record_id: 'r1' }));
  const r2 = createDecisionRecord(makeInput({ record_id: 'r2', preceding_record_id: 'r1' }));
  const chain = buildDecisionChain('entity-abc', 'pick', [r1, r2]);
  assert.deepEqual(verifyDecisionChainIntegrity(chain), []);
});

test('adversarial: force decision with system authority fails integrity check', () => {
  // Simulate a tampered record that bypassed force authority validation
  // (createDecisionRecord would normally throw; here we test verifyDecisionIntegrity directly)
  // We use Object.assign to bypass freeze — simulating what an adversary might do via JSON parse
  const rec = createDecisionRecord(makeInput({
    record_id: 'r1',
    decision_type: 'force_promote',
    is_force: true,
    provenance: { ...PROV, authority: 'pm' }, // correct — passes
  }));
  assert.deepEqual(verifyDecisionIntegrity(rec), []);

  // Construct an invalid record directly (bypassing createDecisionRecord validation)
  const tampered = {
    ...rec,
    is_force: true,
    provenance: { ...rec.provenance, authority: 'system' as const },
  };
  const violations = verifyDecisionIntegrity(tampered);
  assert.ok(violations.some(v => v.includes('force decision must have authority pm or operator')));
});

// ── Query helpers ──────────────────────────────────────────────────────────────

test('latestDecision: returns last record in chain', () => {
  const r1 = createDecisionRecord(makeInput({ record_id: 'r1' }));
  const r2 = createDecisionRecord(makeInput({ record_id: 'r2', preceding_record_id: 'r1' }));
  const chain = buildDecisionChain('entity-abc', 'pick', [r1, r2]);
  assert.equal(latestDecision(chain)!.record_id, 'r2');
});

test('latestDecision: returns null for empty chain', () => {
  const chain = buildDecisionChain('entity-abc', 'pick', []);
  assert.equal(latestDecision(chain), null);
});
