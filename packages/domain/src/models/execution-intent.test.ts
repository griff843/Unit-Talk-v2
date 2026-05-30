import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createExecutionIntent,
  appendExecutionIntent,
  reconstructExecutionChain,
  verifyExecutionIntentIntegrity,
  verifyExecutionChainIntegrity,
} from './execution-intent.js';
import type { ExecutionIntentProvenance } from './execution-intent.js';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const VALID_HASH = 'a'.repeat(64);
const VALID_PROVENANCE: ExecutionIntentProvenance = {
  authority: 'system',
  policy_version: '1.0.0',
  executor_version: '4.0.0',
};

function baseInput() {
  return {
    id: 'intent-root',
    pick_id: 'pick-abc',
    decision_record_id: 'dr-xyz',
    intent_type: 'initial' as const,
    idempotency_key: null,
    inputs_hash: VALID_HASH,
    provenance: VALID_PROVENANCE,
    payload: {},
    issued_at_ms: 1_700_000_000_000,
    created_at: '2026-05-30T00:00:00.000Z',
  };
}

// ── Immutability tests ────────────────────────────────────────────────────────

test('createExecutionIntent: returns frozen object', () => {
  const intent = createExecutionIntent(baseInput());
  assert.ok(Object.isFrozen(intent), 'intent must be frozen');
});

test('createExecutionIntent: provenance is frozen', () => {
  const intent = createExecutionIntent(baseInput());
  assert.ok(Object.isFrozen(intent.provenance), 'provenance must be frozen');
});

test('createExecutionIntent: payload is frozen', () => {
  const intent = createExecutionIntent({ ...baseInput(), payload: { key: 'val' } });
  assert.ok(Object.isFrozen(intent.payload), 'payload must be frozen');
});

test('createExecutionIntent: mutating status throws TypeError in strict mode', () => {
  const intent = createExecutionIntent(baseInput());
  assert.throws(() => {
    (intent as unknown as Record<string, unknown>)['status'] = 'confirmed';
  }, TypeError);
});

test('appendExecutionIntent: returns frozen object', () => {
  const root = createExecutionIntent(baseInput());
  const follow = appendExecutionIntent(root, {
    id: 'intent-follow',
    intent_type: 're_confirm',
    idempotency_key: 'key-1',
    inputs_hash: VALID_HASH,
    provenance: VALID_PROVENANCE,
    payload: {},
    issued_at_ms: root.issued_at_ms + 1000,
    created_at: '2026-05-30T00:01:00.000Z',
  });
  assert.ok(Object.isFrozen(follow), 'follow-on intent must be frozen');
});

// ── Append-only tests ─────────────────────────────────────────────────────────

test('createExecutionIntent: predecessor_id is null for root', () => {
  const intent = createExecutionIntent(baseInput());
  assert.equal(intent.predecessor_id, null);
});

test('appendExecutionIntent: sets predecessor_id to prior.id', () => {
  const root = createExecutionIntent(baseInput());
  const follow = appendExecutionIntent(root, {
    id: 'intent-2',
    intent_type: 're_confirm',
    idempotency_key: null,
    inputs_hash: VALID_HASH,
    provenance: VALID_PROVENANCE,
    payload: {},
    issued_at_ms: root.issued_at_ms + 1,
  });
  assert.equal(follow.predecessor_id, root.id);
});

test('appendExecutionIntent: inherits pick_id and decision_record_id from predecessor', () => {
  const root = createExecutionIntent(baseInput());
  const follow = appendExecutionIntent(root, {
    id: 'intent-2',
    intent_type: 'recovery',
    idempotency_key: null,
    inputs_hash: VALID_HASH,
    provenance: VALID_PROVENANCE,
    payload: {},
    issued_at_ms: root.issued_at_ms + 1,
  });
  assert.equal(follow.pick_id, root.pick_id);
  assert.equal(follow.decision_record_id, root.decision_record_id);
});

test('appendExecutionIntent: throws when issued_at_ms < predecessor issued_at_ms', () => {
  const root = createExecutionIntent(baseInput());
  assert.throws(
    () =>
      appendExecutionIntent(root, {
        id: 'intent-bad',
        intent_type: 're_confirm',
        idempotency_key: null,
        inputs_hash: VALID_HASH,
        provenance: VALID_PROVENANCE,
        payload: {},
        issued_at_ms: root.issued_at_ms - 1,
      }),
    /issued_at_ms/,
  );
});

// ── Replay reconstruction tests ───────────────────────────────────────────────

test('reconstructExecutionChain: returns empty array for empty input', () => {
  const chain = reconstructExecutionChain([]);
  assert.deepEqual(chain, []);
});

test('reconstructExecutionChain: single root returns [root]', () => {
  const root = createExecutionIntent(baseInput());
  const chain = reconstructExecutionChain([root]);
  assert.deepEqual(chain.map(r => r.id), [root.id]);
});

test('reconstructExecutionChain: orders records root → leaf regardless of input order', () => {
  const root = createExecutionIntent({ ...baseInput(), id: 'a' });
  const second = appendExecutionIntent(root, {
    id: 'b',
    intent_type: 're_confirm',
    idempotency_key: null,
    inputs_hash: VALID_HASH,
    provenance: VALID_PROVENANCE,
    payload: {},
    issued_at_ms: root.issued_at_ms + 1000,
  });
  const third = appendExecutionIntent(second, {
    id: 'c',
    intent_type: 'recovery',
    idempotency_key: null,
    inputs_hash: VALID_HASH,
    provenance: VALID_PROVENANCE,
    payload: {},
    issued_at_ms: root.issued_at_ms + 2000,
  });
  // Feed in reverse order
  const chain = reconstructExecutionChain([third, root, second]);
  assert.deepEqual(chain.map(r => r.id), ['a', 'b', 'c']);
});

test('reconstructExecutionChain: throws on cycle detection', () => {
  const root = createExecutionIntent({ ...baseInput(), id: 'a' });
  // Manually craft a cyclic structure (bypass factory) for cycle test
  const fake: typeof root = Object.freeze({ ...root, id: 'b', predecessor_id: 'b' });
  assert.throws(
    () => reconstructExecutionChain([root, fake]),
    /cycle|root/i,
  );
});

// ── Provenance binding tests ──────────────────────────────────────────────────

test('createExecutionIntent: stores decision_record_id', () => {
  const intent = createExecutionIntent({ ...baseInput(), decision_record_id: 'dr-007' });
  assert.equal(intent.decision_record_id, 'dr-007');
});

test('createExecutionIntent: stores inputs_hash', () => {
  const hash = 'b'.repeat(64);
  const intent = createExecutionIntent({ ...baseInput(), inputs_hash: hash });
  assert.equal(intent.inputs_hash, hash);
});

test('createExecutionIntent: stores provenance fields', () => {
  const intent = createExecutionIntent(baseInput());
  assert.equal(intent.provenance.authority, 'system');
  assert.equal(intent.provenance.policy_version, '1.0.0');
  assert.equal(intent.provenance.executor_version, '4.0.0');
});

test('createExecutionIntent: stores issued_at_ms unchanged', () => {
  const intent = createExecutionIntent({ ...baseInput(), issued_at_ms: 999_999 });
  assert.equal(intent.issued_at_ms, 999_999);
});

// ── Validation tests ──────────────────────────────────────────────────────────

test('createExecutionIntent: throws on invalid inputs_hash (too short)', () => {
  assert.throws(
    () => createExecutionIntent({ ...baseInput(), inputs_hash: 'tooshort' }),
    /inputs_hash/,
  );
});

test('createExecutionIntent: throws on inputs_hash with uppercase', () => {
  assert.throws(
    () => createExecutionIntent({ ...baseInput(), inputs_hash: 'A'.repeat(64) }),
    /inputs_hash/,
  );
});

test('createExecutionIntent: throws on invalid intent_type', () => {
  assert.throws(
    () =>
      createExecutionIntent({
        ...baseInput(),
        intent_type: 'bad_type' as 'initial',
      }),
    /intent_type/,
  );
});

test('createExecutionIntent: throws on empty idempotency_key string', () => {
  assert.throws(
    () => createExecutionIntent({ ...baseInput(), idempotency_key: '' }),
    /idempotency_key/,
  );
});

test('createExecutionIntent: accepts null idempotency_key', () => {
  const intent = createExecutionIntent({ ...baseInput(), idempotency_key: null });
  assert.equal(intent.idempotency_key, null);
});

test('createExecutionIntent: accepts non-empty idempotency_key', () => {
  const intent = createExecutionIntent({ ...baseInput(), idempotency_key: 'ikey-1' });
  assert.equal(intent.idempotency_key, 'ikey-1');
});

test('createExecutionIntent: throws on invalid provenance authority', () => {
  assert.throws(
    () =>
      createExecutionIntent({
        ...baseInput(),
        provenance: { ...VALID_PROVENANCE, authority: 'robot' as 'system' },
      }),
    /authority/,
  );
});

test('createExecutionIntent: throws on non-positive issued_at_ms', () => {
  assert.throws(
    () => createExecutionIntent({ ...baseInput(), issued_at_ms: 0 }),
    /issued_at_ms/,
  );
});

test('createExecutionIntent: throws on non-integer issued_at_ms', () => {
  assert.throws(
    () => createExecutionIntent({ ...baseInput(), issued_at_ms: 1.5 }),
    /issued_at_ms/,
  );
});

// ── verifyExecutionIntentIntegrity tests ──────────────────────────────────────

test('verifyExecutionIntentIntegrity: passes on valid record', () => {
  const intent = createExecutionIntent(baseInput());
  assert.doesNotThrow(() => verifyExecutionIntentIntegrity(intent));
});

test('verifyExecutionIntentIntegrity: throws on bad inputs_hash', () => {
  const intent = createExecutionIntent(baseInput());
  assert.throws(
    () => verifyExecutionIntentIntegrity({ ...intent, inputs_hash: 'bad' }),
    /inputs_hash/,
  );
});

// ── verifyExecutionChainIntegrity tests ───────────────────────────────────────

test('verifyExecutionChainIntegrity: passes on valid two-record chain', () => {
  const root = createExecutionIntent({ ...baseInput(), id: 'r1' });
  const follow = appendExecutionIntent(root, {
    id: 'r2',
    intent_type: 're_confirm',
    idempotency_key: null,
    inputs_hash: VALID_HASH,
    provenance: VALID_PROVENANCE,
    payload: {},
    issued_at_ms: root.issued_at_ms + 1,
  });
  assert.doesNotThrow(() =>
    verifyExecutionChainIntegrity({ pick_id: root.pick_id, intents: [root, follow] }),
  );
});

test('verifyExecutionChainIntegrity: throws on pick_id mismatch', () => {
  const root = createExecutionIntent({ ...baseInput(), id: 'r1' });
  const tampered = { ...root, id: 'r2', predecessor_id: 'r1', pick_id: 'other-pick' };
  assert.throws(
    () =>
      verifyExecutionChainIntegrity({ pick_id: root.pick_id, intents: [root, tampered] }),
    /pick_id/,
  );
});

test('verifyExecutionChainIntegrity: throws on broken predecessor linkage', () => {
  const root = createExecutionIntent({ ...baseInput(), id: 'r1' });
  const broken = { ...root, id: 'r2', predecessor_id: 'wrong-id' };
  assert.throws(
    () =>
      verifyExecutionChainIntegrity({ pick_id: root.pick_id, intents: [root, broken] }),
    /predecessor/,
  );
});

// ── Downstream compatibility tests ───────────────────────────────────────────

test('UTV2-1133 compatibility: idempotency_key field present and correctly typed', () => {
  // UTV2-1133 needs to use idempotency_key for re-confirm without duplication
  const intent = createExecutionIntent({
    ...baseInput(),
    intent_type: 're_confirm',
    idempotency_key: 'confirm-abc-123',
    status: 'pending',
  });
  assert.equal(typeof intent.idempotency_key, 'string');
  assert.equal(intent.idempotency_key, 'confirm-abc-123');
  assert.equal(intent.intent_type, 're_confirm');
});

test('UTV2-1134 compatibility: predecessor_id chain traversal works for recovery', () => {
  // UTV2-1134 needs to follow predecessor chain to find dead-letter root
  const root = createExecutionIntent({ ...baseInput(), id: 'root', status: 'dead_letter' });
  const recovery = appendExecutionIntent(root, {
    id: 'recovery',
    intent_type: 'recovery',
    idempotency_key: null,
    inputs_hash: VALID_HASH,
    provenance: VALID_PROVENANCE,
    payload: { recovery_reason: 'exception_cleared' },
    issued_at_ms: root.issued_at_ms + 5000,
    created_at: '2026-05-30T00:05:00.000Z',
  });
  assert.equal(recovery.predecessor_id, root.id);
  assert.equal(recovery.intent_type, 'recovery');
  // Chain can be reconstructed
  const chain = reconstructExecutionChain([recovery, root]);
  assert.deepEqual(chain.map(r => r.id), ['root', 'recovery']);
});
