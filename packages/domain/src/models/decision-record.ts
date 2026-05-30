/**
 * DecisionRecord — INIT-3.4.1
 *
 * Immutable, append-only record of every promotion, block, force, or override
 * decision in the Decision Integrity chain.
 *
 * Constitutional guarantees:
 *  1. All records are append-only and immutable (readonly fields, no mutation).
 *  2. Decision provenance is replay-visible via stored inputs_hash + provenance.
 *  3. Decision reconstruction is deterministic from stored inputs.
 *  4. Force and override paths are explicitly traced via is_force / is_override.
 *  5. No mutable decision authority is introduced (no setters, no mutation fns).
 *  6. Program 1 certification topology is untouched.
 */

// ── Core Types ─────────────────────────────────────────────────────────────────

export type DecisionType =
  | 'promotion'      // standard promotion evaluation
  | 'block'          // standard block (gate failed)
  | 'force_promote'  // override: force-promote path taken
  | 'override_block' // override: force-block path taken
  | 'calibration'    // calibration gate decision
  | 'cohort_hold';   // cohort degradation hold

export type DecisionEntityType =
  | 'pick'
  | 'model'
  | 'promotion'
  | 'calibration'
  | 'cohort';

export type DecisionOutcome = 'approved' | 'blocked';

/** Who or what authorized this decision. Immutable trace of authority. */
export interface DecisionProvenance {
  readonly authority: 'system' | 'pm' | 'operator';
  readonly policy_version: string;
  readonly evaluator_version: string;
}

export interface EdgePriceFreshnessDecisionEvidence {
  readonly price_snapshot_at: string | null;
  readonly price_provider_key: string | null;
  readonly event_starts_at: string | null;
  readonly snapshot_age_ms: number | null;
  readonly freshness_threshold_ms: number;
  readonly freshness_result: 'fresh' | 'stale' | 'missing';
}

export interface DecisionEvidence {
  readonly edge_price_freshness?: EdgePriceFreshnessDecisionEvidence;
}

/**
 * A single immutable decision event. Once created, no field may be mutated.
 * Records form an append-only chain via preceding_record_id.
 */
export interface DecisionRecord {
  readonly record_id: string;
  readonly decision_type: DecisionType;
  readonly entity_id: string;
  readonly entity_type: DecisionEntityType;
  readonly decided_at_ms: number;
  readonly outcome: DecisionOutcome;
  readonly reason: string;
  /** SHA-256 hex of the serialized inputs used to reach this decision. */
  readonly inputs_hash: string;
  readonly provenance: DecisionProvenance;
  /** Immutable replay-visible evidence used by the evaluator. */
  readonly evidence?: DecisionEvidence;
  /** ID of the immediately preceding record in this entity's chain. Null = root. */
  readonly preceding_record_id: string | null;
  /** True when a force-promote path was taken, bypassing gate checks. */
  readonly is_force: boolean;
  /** True when a PM/operator override was applied. */
  readonly is_override: boolean;
}

/** An ordered, append-only chain of DecisionRecords for a single entity. */
export interface DecisionChain {
  readonly entity_id: string;
  readonly entity_type: DecisionEntityType;
  readonly records: readonly DecisionRecord[];
}

// ── Input ──────────────────────────────────────────────────────────────────────

export interface DecisionRecordInput {
  readonly record_id: string;
  readonly decision_type: DecisionType;
  readonly entity_id: string;
  readonly entity_type: DecisionEntityType;
  readonly decided_at_ms: number;
  readonly outcome: DecisionOutcome;
  readonly reason: string;
  readonly inputs_hash: string;
  readonly provenance: DecisionProvenance;
  readonly evidence?: DecisionEvidence;
  readonly preceding_record_id: string | null;
  readonly is_force?: boolean;
  readonly is_override?: boolean;
}

// ── Construction ────────────────────────────────────────────────────────────────

/**
 * Create a new immutable DecisionRecord. Pure — no side effects.
 * The returned record is frozen to enforce immutability at runtime.
 */
export function createDecisionRecord(input: DecisionRecordInput): DecisionRecord {
  if (!input.record_id || !input.entity_id) {
    throw new Error('DecisionRecord: record_id and entity_id are required');
  }
  if (input.decided_at_ms <= 0) {
    throw new Error('DecisionRecord: decided_at_ms must be a positive epoch timestamp');
  }
  if (!input.inputs_hash) {
    throw new Error('DecisionRecord: inputs_hash is required');
  }
  if (!input.provenance.policy_version || !input.provenance.evaluator_version) {
    throw new Error('DecisionRecord: provenance must include policy_version and evaluator_version');
  }

  const evidence = freezeDecisionEvidence(input.evidence);
  const record = {
    record_id: input.record_id,
    decision_type: input.decision_type,
    entity_id: input.entity_id,
    entity_type: input.entity_type,
    decided_at_ms: input.decided_at_ms,
    outcome: input.outcome,
    reason: input.reason,
    inputs_hash: input.inputs_hash,
    provenance: Object.freeze({ ...input.provenance }),
    preceding_record_id: input.preceding_record_id,
    is_force: input.is_force ?? false,
    is_override: input.is_override ?? false,
  };

  if (evidence) {
    return Object.freeze({ ...record, evidence });
  }
  return Object.freeze(record);
}

// ── Chain Operations ────────────────────────────────────────────────────────────

/**
 * Append a new record to an existing chain. Returns a new chain — never mutates.
 * Enforces: the new record's preceding_record_id must equal the last record's
 * record_id, and entity_id/entity_type must match the chain.
 */
export function appendDecisionRecord(
  chain: DecisionChain,
  record: DecisionRecord,
): DecisionChain {
  if (record.entity_id !== chain.entity_id) {
    throw new Error(
      `DecisionRecord: entity_id mismatch — chain is for '${chain.entity_id}', record is for '${record.entity_id}'`,
    );
  }
  if (record.entity_type !== chain.entity_type) {
    throw new Error(
      `DecisionRecord: entity_type mismatch — chain is '${chain.entity_type}', record is '${record.entity_type}'`,
    );
  }

  const last = chain.records[chain.records.length - 1];
  const expectedPreceding = last?.record_id ?? null;

  if (record.preceding_record_id !== expectedPreceding) {
    throw new Error(
      `DecisionRecord: preceding_record_id mismatch — expected '${expectedPreceding ?? 'null'}', got '${record.preceding_record_id ?? 'null'}'`,
    );
  }

  return Object.freeze({
    entity_id: chain.entity_id,
    entity_type: chain.entity_type,
    records: Object.freeze([...chain.records, record]),
  });
}

/**
 * Create a chain from an ordered set of records, validating linkage. Pure.
 */
export function buildDecisionChain(
  entity_id: string,
  entity_type: DecisionEntityType,
  records: readonly DecisionRecord[],
): DecisionChain {
  for (const r of records) {
    if (r.entity_id !== entity_id) {
      throw new Error(`DecisionRecord: record '${r.record_id}' has entity_id '${r.entity_id}', expected '${entity_id}'`);
    }
  }
  for (let i = 0; i < records.length; i++) {
    const expected = i === 0 ? null : records[i - 1]!.record_id;
    if (records[i]!.preceding_record_id !== expected) {
      throw new Error(
        `DecisionRecord: chain broken at index ${i} — expected preceding '${expected ?? 'null'}', got '${records[i]!.preceding_record_id ?? 'null'}'`,
      );
    }
  }
  return Object.freeze({
    entity_id,
    entity_type,
    records: Object.freeze([...records]),
  });
}

// ── Reconstruction ──────────────────────────────────────────────────────────────

/**
 * Reconstruct a chain from unordered records by following the linked list.
 * Returns null if the chain has gaps or multiple roots. Pure and deterministic.
 */
export function reconstructDecisionChain(
  entity_id: string,
  entity_type: DecisionEntityType,
  unordered: readonly DecisionRecord[],
): DecisionChain | null {
  const forEntity = unordered.filter(r => r.entity_id === entity_id);
  if (forEntity.length === 0) return null;

  const roots = forEntity.filter(r => r.preceding_record_id === null);
  if (roots.length !== 1) return null;

  const ordered: DecisionRecord[] = [roots[0]!];
  const byPrecedingId = new Map<string, DecisionRecord>();
  for (const r of forEntity) {
    if (r.preceding_record_id !== null) {
      byPrecedingId.set(r.preceding_record_id, r);
    }
  }

  let current = roots[0]!;
  while (true) {
    const next = byPrecedingId.get(current.record_id);
    if (!next) break;
    ordered.push(next);
    current = next;
  }

  if (ordered.length !== forEntity.length) return null;

  try {
    return buildDecisionChain(entity_id, entity_type, ordered);
  } catch {
    return null;
  }
}

// ── Integrity Verification ──────────────────────────────────────────────────────

/**
 * Verify a single record's structural invariants. Returns violation strings;
 * empty array = clean. Does not re-hash inputs (pure structural check only).
 */
export function verifyDecisionIntegrity(record: DecisionRecord): string[] {
  const v: string[] = [];
  if (!record.record_id) v.push('record_id is empty');
  if (!record.entity_id) v.push('entity_id is empty');
  if (record.decided_at_ms <= 0) v.push('decided_at_ms is not a valid epoch');
  if (!record.inputs_hash) v.push('inputs_hash is missing');
  if (!record.provenance.policy_version) v.push('provenance.policy_version is empty');
  if (!record.provenance.evaluator_version) v.push('provenance.evaluator_version is empty');
  const freshness = record.evidence?.edge_price_freshness;
  if (freshness) {
    if (freshness.freshness_threshold_ms <= 0) {
      v.push('edge_price_freshness.freshness_threshold_ms must be positive');
    }
    if (
      freshness.snapshot_age_ms !== null &&
      (freshness.snapshot_age_ms < 0 || !Number.isFinite(freshness.snapshot_age_ms))
    ) {
      v.push('edge_price_freshness.snapshot_age_ms must be null or a finite non-negative number');
    }
    if (freshness.freshness_result === 'fresh') {
      if (!freshness.price_snapshot_at) v.push('fresh edge_price_freshness requires price_snapshot_at');
      if (!freshness.price_provider_key) v.push('fresh edge_price_freshness requires price_provider_key');
      if (freshness.snapshot_age_ms === null) v.push('fresh edge_price_freshness requires snapshot_age_ms');
    }
  }
  if (record.is_force && record.provenance.authority === 'system') {
    v.push('force decision must have authority pm or operator, not system');
  }
  if (record.is_override && record.provenance.authority === 'system') {
    v.push('override decision must have authority pm or operator, not system');
  }
  return v;
}

/** Verify all records in a chain. Returns all violations; empty = clean. */
export function verifyDecisionChainIntegrity(chain: DecisionChain): string[] {
  const violations: string[] = [];
  for (let i = 0; i < chain.records.length; i++) {
    const record = chain.records[i]!;
    for (const v of verifyDecisionIntegrity(record)) {
      violations.push(`record[${i}] (${record.record_id}): ${v}`);
    }
  }
  return violations;
}

function freezeDecisionEvidence(evidence: DecisionEvidence | undefined): DecisionEvidence | undefined {
  if (!evidence) return undefined;
  const freshness = evidence.edge_price_freshness;
  if (freshness) {
    return Object.freeze({
      edge_price_freshness: Object.freeze({ ...freshness }),
    });
  }
  return Object.freeze({});
}

// ── Query Helpers ───────────────────────────────────────────────────────────────

export function latestDecision(chain: DecisionChain): DecisionRecord | null {
  return chain.records[chain.records.length - 1] ?? null;
}

export function chainHasForceDecision(chain: DecisionChain): boolean {
  return chain.records.some(r => r.is_force);
}

export function chainHasOverrideDecision(chain: DecisionChain): boolean {
  return chain.records.some(r => r.is_override);
}

export function getTracedDecisions(chain: DecisionChain): readonly DecisionRecord[] {
  return chain.records.filter(r => r.is_force || r.is_override);
}
