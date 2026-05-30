/**
 * ExecutionIntent — INIT-4.1.1
 *
 * Canonical entity binding execution attempts to immutable, replay-visible
 * decision provenance. Program 4 root (WS-4.1 Execution Runtime Hardening).
 *
 * Constitutional guarantees:
 *  1. All records are append-only and immutable (readonly fields, Object.freeze).
 *  2. Intent provenance is replay-visible via stored inputs_hash + provenance.
 *  3. Intent reconstruction is deterministic from persisted evidence.
 *  4. No wall-clock nondeterminism — issued_at_ms is caller-supplied epoch ms.
 *  5. Idempotency key (when set) supports UTV2-1133 re-confirm without duplication.
 *  6. predecessor_id chain supports UTV2-1134 dead-letter recovery traversal.
 *  7. No capital, treasury, or scaling surface introduced.
 *  8. Program 1 certification topology is untouched.
 */

// ── Core Types ─────────────────────────────────────────────────────────────────

/** Classification of this intent record within the append-only chain. */
export type ExecutionIntentType =
  | 'initial'     // first intent for this pick's execution chain
  | 're_confirm'  // idempotent re-confirmation (UTV2-1133)
  | 'recovery';   // dead-letter recovery intent (UTV2-1134)

/** Lifecycle status of this intent record. */
export type ExecutionIntentStatus =
  | 'pending'      // intent created, awaiting execution confirmation
  | 'confirmed'    // receipt confirmed — terminal success state
  | 'dead_letter'  // failed beyond retry threshold — recovery eligible
  | 'recovered';   // recovered from dead-letter — terminal recovery state

/** Who or what authorized this execution intent. Immutable trace of authority. */
export interface ExecutionIntentProvenance {
  readonly authority: 'system' | 'pm' | 'operator';
  readonly policy_version: string;
  readonly executor_version: string;
}

/**
 * A single immutable execution intent record. Once created, no field may be
 * mutated. Records form an append-only chain via predecessor_id.
 *
 * decision_record_id links to the originating DecisionRecord.record_id.
 * DecisionRecord is a domain-layer type (no DB table); provenance is enforced
 * at the domain layer, not via FK constraint.
 */
export interface ExecutionIntent {
  readonly id: string;
  /** null = root of chain; non-null = follow-on record */
  readonly predecessor_id: string | null;
  /** The pick this intent targets (logical reference to picks.id). */
  readonly pick_id: string;
  /** Provenance link to DecisionRecord.record_id (domain-layer, no FK). */
  readonly decision_record_id: string;
  readonly intent_type: ExecutionIntentType;
  readonly status: ExecutionIntentStatus;
  /** When set, enables idempotent re-confirm (UTV2-1133). Must be non-empty if provided. */
  readonly idempotency_key: string | null;
  /** SHA-256 hex of the serialized inputs that produced this intent. */
  readonly inputs_hash: string;
  readonly provenance: ExecutionIntentProvenance;
  readonly payload: Record<string, unknown>;
  /** Deterministic epoch milliseconds from the caller. Never use Date.now() here. */
  readonly issued_at_ms: number;
  /** ISO-8601 wall-clock creation timestamp (from DB or test injection). */
  readonly created_at: string;
}

/** An ordered, append-only chain of ExecutionIntents for a single pick. */
export interface ExecutionIntentChain {
  readonly pick_id: string;
  readonly intents: readonly ExecutionIntent[];
}

// ── Validation ─────────────────────────────────────────────────────────────────

const VALID_INTENT_TYPES = new Set<ExecutionIntentType>(['initial', 're_confirm', 'recovery']);
const VALID_STATUSES = new Set<ExecutionIntentStatus>(['pending', 'confirmed', 'dead_letter', 'recovered']);
const INPUTS_HASH_RE = /^[0-9a-f]{64}$/;

function assertValidInputsHash(hash: string): void {
  if (!INPUTS_HASH_RE.test(hash)) {
    throw new Error(`ExecutionIntent: inputs_hash must be a 64-char lowercase hex SHA-256, got ${JSON.stringify(hash)}`);
  }
}

function assertValidIntentType(type: string): asserts type is ExecutionIntentType {
  if (!VALID_INTENT_TYPES.has(type as ExecutionIntentType)) {
    throw new Error(`ExecutionIntent: intent_type must be one of ${[...VALID_INTENT_TYPES].join(', ')}, got ${JSON.stringify(type)}`);
  }
}

function assertValidStatus(status: string): asserts status is ExecutionIntentStatus {
  if (!VALID_STATUSES.has(status as ExecutionIntentStatus)) {
    throw new Error(`ExecutionIntent: status must be one of ${[...VALID_STATUSES].join(', ')}, got ${JSON.stringify(status)}`);
  }
}

function assertValidIdempotencyKey(key: string | null): void {
  if (key !== null && key.length === 0) {
    throw new Error('ExecutionIntent: idempotency_key must be non-empty when provided (use null to omit)');
  }
}

function assertValidProvenance(p: ExecutionIntentProvenance): void {
  if (!p.authority || !p.policy_version || !p.executor_version) {
    throw new Error('ExecutionIntent: provenance must include authority, policy_version, and executor_version');
  }
  if (!['system', 'pm', 'operator'].includes(p.authority)) {
    throw new Error(`ExecutionIntent: provenance.authority must be system|pm|operator, got ${JSON.stringify(p.authority)}`);
  }
}

function assertPositiveMs(ms: number): void {
  if (!Number.isInteger(ms) || ms <= 0) {
    throw new Error(`ExecutionIntent: issued_at_ms must be a positive integer epoch milliseconds, got ${ms}`);
  }
}

// ── Factory ────────────────────────────────────────────────────────────────────

export interface CreateExecutionIntentInput {
  /** Caller-supplied stable UUID. */
  id: string;
  pick_id: string;
  decision_record_id: string;
  intent_type: ExecutionIntentType;
  status?: ExecutionIntentStatus;
  idempotency_key: string | null;
  /** SHA-256 hex of serialized inputs. */
  inputs_hash: string;
  provenance: ExecutionIntentProvenance;
  payload: Record<string, unknown>;
  /** Deterministic epoch ms. Never pass Date.now() directly — inject from caller context. */
  issued_at_ms: number;
  /** ISO-8601. Defaults to UTC now() in test; DB sets this at insert time. */
  created_at?: string;
}

/**
 * Create a root ExecutionIntent (predecessor_id = null).
 * All fields are validated and the returned object is frozen.
 */
export function createExecutionIntent(input: CreateExecutionIntentInput): ExecutionIntent {
  assertValidIntentType(input.intent_type);
  assertValidStatus(input.status ?? 'pending');
  assertValidInputsHash(input.inputs_hash);
  assertValidIdempotencyKey(input.idempotency_key);
  assertValidProvenance(input.provenance);
  assertPositiveMs(input.issued_at_ms);

  return Object.freeze({
    id: input.id,
    predecessor_id: null,
    pick_id: input.pick_id,
    decision_record_id: input.decision_record_id,
    intent_type: input.intent_type,
    status: input.status ?? 'pending',
    idempotency_key: input.idempotency_key,
    inputs_hash: input.inputs_hash,
    provenance: Object.freeze({ ...input.provenance }),
    payload: Object.freeze({ ...input.payload }),
    issued_at_ms: input.issued_at_ms,
    created_at: input.created_at ?? new Date().toISOString(),
  });
}

export interface AppendExecutionIntentInput {
  /** Caller-supplied stable UUID for the new record. */
  id: string;
  intent_type: ExecutionIntentType;
  status?: ExecutionIntentStatus;
  idempotency_key: string | null;
  inputs_hash: string;
  provenance: ExecutionIntentProvenance;
  payload: Record<string, unknown>;
  issued_at_ms: number;
  created_at?: string;
}

/**
 * Append a follow-on ExecutionIntent to an existing chain record.
 * predecessor_id is set to prior.id. pick_id and decision_record_id
 * are inherited from the predecessor to maintain chain integrity.
 */
export function appendExecutionIntent(
  prior: ExecutionIntent,
  input: AppendExecutionIntentInput,
): ExecutionIntent {
  assertValidIntentType(input.intent_type);
  assertValidStatus(input.status ?? 'pending');
  assertValidInputsHash(input.inputs_hash);
  assertValidIdempotencyKey(input.idempotency_key);
  assertValidProvenance(input.provenance);
  assertPositiveMs(input.issued_at_ms);

  if (input.issued_at_ms < prior.issued_at_ms) {
    throw new Error(
      `ExecutionIntent: append issued_at_ms (${input.issued_at_ms}) must be >= predecessor issued_at_ms (${prior.issued_at_ms})`,
    );
  }

  return Object.freeze({
    id: input.id,
    predecessor_id: prior.id,
    pick_id: prior.pick_id,
    decision_record_id: prior.decision_record_id,
    intent_type: input.intent_type,
    status: input.status ?? 'pending',
    idempotency_key: input.idempotency_key,
    inputs_hash: input.inputs_hash,
    provenance: Object.freeze({ ...input.provenance }),
    payload: Object.freeze({ ...input.payload }),
    issued_at_ms: input.issued_at_ms,
    created_at: input.created_at ?? new Date().toISOString(),
  });
}

// ── Chain Operations ───────────────────────────────────────────────────────────

/**
 * Reconstruct an ordered ExecutionIntentChain from an unordered set of records.
 * Follows predecessor_id links to produce chronological order (root first).
 * Throws if the input contains a cycle or a broken predecessor reference.
 */
export function reconstructExecutionChain(records: readonly ExecutionIntent[]): ExecutionIntent[] {
  if (records.length === 0) return [];

  const byId = new Map<string, ExecutionIntent>();
  for (const r of records) byId.set(r.id, r);

  // Find root(s): records with no predecessor or whose predecessor is not in this set
  const roots = records.filter(
    r => r.predecessor_id === null || !byId.has(r.predecessor_id),
  );

  if (roots.length === 0) {
    throw new Error('ExecutionIntent: reconstructExecutionChain found no root record (possible cycle)');
  }

  // Build a reverse index: predecessor_id → child
  const childOf = new Map<string, ExecutionIntent>();
  for (const r of records) {
    if (r.predecessor_id !== null) {
      childOf.set(r.predecessor_id, r);
    }
  }

  // Detect self-loops before walking
  for (const r of records) {
    if (r.predecessor_id !== null && r.predecessor_id === r.id) {
      throw new Error(`ExecutionIntent: reconstructExecutionChain detected cycle (self-loop) at id=${r.id}`);
    }
  }

  // Walk the chain from the root(s). Use the first root for now (single chain expected).
  const chain: ExecutionIntent[] = [];
  let current: ExecutionIntent | undefined = roots[0];
  const visited = new Set<string>();

  while (current !== undefined) {
    if (visited.has(current.id)) {
      throw new Error(`ExecutionIntent: reconstructExecutionChain detected cycle at id=${current.id}`);
    }
    visited.add(current.id);
    chain.push(current);
    current = childOf.get(current.id);
  }

  // Verify all records were reached — unvisited records indicate cycles or disconnected nodes
  const unvisited = records.filter(r => !visited.has(r.id));
  if (unvisited.length > 0) {
    throw new Error(
      `ExecutionIntent: reconstructExecutionChain detected cycle or disconnected records: ${unvisited.map(r => r.id).join(', ')}`,
    );
  }

  return chain;
}

/**
 * Verify structural integrity of a single ExecutionIntent record.
 * Throws with a descriptive message on any violation.
 */
export function verifyExecutionIntentIntegrity(intent: ExecutionIntent): void {
  assertValidInputsHash(intent.inputs_hash);
  assertValidIntentType(intent.intent_type);
  assertValidStatus(intent.status);
  assertValidIdempotencyKey(intent.idempotency_key);
  assertValidProvenance(intent.provenance);
  assertPositiveMs(intent.issued_at_ms);

  if (!intent.id || intent.id.trim() === '') {
    throw new Error('ExecutionIntent: id must be non-empty');
  }
  if (!intent.pick_id || intent.pick_id.trim() === '') {
    throw new Error('ExecutionIntent: pick_id must be non-empty');
  }
  if (!intent.decision_record_id || intent.decision_record_id.trim() === '') {
    throw new Error('ExecutionIntent: decision_record_id must be non-empty');
  }
}

/**
 * Verify integrity of an entire ExecutionIntentChain.
 * Validates each record individually and checks predecessor linkage.
 */
export function verifyExecutionChainIntegrity(chain: ExecutionIntentChain): void {
  const { intents } = chain;
  if (intents.length === 0) return;

  for (const intent of intents) {
    verifyExecutionIntentIntegrity(intent);
  }

  // Verify pick_id and decision_record_id are consistent across the chain
  const root = intents[0]!;
  for (let i = 1; i < intents.length; i++) {
    const r = intents[i]!;
    if (r.pick_id !== root.pick_id) {
      throw new Error(
        `ExecutionIntent chain: pick_id mismatch at index ${i}: expected ${root.pick_id}, got ${r.pick_id}`,
      );
    }
    if (r.decision_record_id !== root.decision_record_id) {
      throw new Error(
        `ExecutionIntent chain: decision_record_id mismatch at index ${i}: expected ${root.decision_record_id}, got ${r.decision_record_id}`,
      );
    }
    if (r.predecessor_id !== intents[i - 1]!.id) {
      throw new Error(
        `ExecutionIntent chain: predecessor linkage broken at index ${i}: expected predecessor_id=${intents[i - 1]!.id}, got ${r.predecessor_id}`,
      );
    }
  }
}
