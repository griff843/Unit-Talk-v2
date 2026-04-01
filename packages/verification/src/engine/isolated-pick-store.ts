/**
 * VERIFICATION & SIMULATION CONTROL PLANE — IsolatedPickStore
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R2
 *
 * In-memory pick state store for replay and simulation runs.
 *
 * Replaces Supabase during non-production runs.
 * All lifecycle adapter writes target this store, not `unified_picks`.
 *
 * Design law:
 *   - NEVER writes to any external database (production isolation guarantee)
 *   - Implements the minimal query surface used by ReplayLifecycleRunner
 *   - Supports conditional updates (optimistic locking) to exercise
 *     the same ConcurrentModificationError paths as production
 *   - State snapshots are deterministic (Map iteration in insertion order)
 */

import type { LifecyclePick } from './v2-type-bridge.js';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

/** A condition clause for conditional updates. Mirrors Supabase .eq()/.is() semantics. */
export interface UpdateCondition {
  field: string;
  value: unknown;
  /** 'eq' checks strict equality; 'is_null' checks value is null/undefined. */
  op: 'eq' | 'is_null';
}

export interface InsertResult {
  id: string | null;
  error: string | null;
}

export interface GetResult {
  data: Record<string, unknown> | null;
  error: string | null;
}

export interface UpdateResult {
  /** Number of rows that matched the conditions and were updated. */
  rowsAffected: number;
  error: string | null;
}

// ─────────────────────────────────────────────────────────────
// STORE
// ─────────────────────────────────────────────────────────────

/**
 * In-memory pick state for a single replay or simulation run.
 * All state is lost when the process exits — this is intentional.
 */
export class IsolatedPickStore {
  /** Map from pick.id → pick record (insertion order preserved for determinism). */
  private readonly state = new Map<string, Record<string, unknown>>();

  // ─────────────────────────────────────────────────────────────
  // WRITE
  // ─────────────────────────────────────────────────────────────

  /**
   * Insert a new pick record.
   * Returns an error if a pick with the same id already exists.
   */
  insert(pick: Record<string, unknown>): InsertResult {
    const id = pick['id'] as string | undefined;
    if (!id) return { id: null, error: 'insert: pick must have an id field' };
    if (this.state.has(id)) return { id: null, error: `insert: pick ${id} already exists` };

    this.state.set(id, { ...pick });
    return { id, error: null };
  }

  /**
   * Conditional update. Applies `updates` only if all `conditions` match.
   * Returns rowsAffected=0 if any condition fails (optimistic lock miss).
   * Returns an error string if the pick does not exist.
   */
  update(
    id: string,
    updates: Record<string, unknown>,
    conditions: UpdateCondition[] = []
  ): UpdateResult {
    const existing = this.state.get(id);
    if (!existing) return { rowsAffected: 0, error: `update: pick ${id} not found` };

    // Evaluate conditions (mirrors Supabase .eq()/.is() WHERE clauses)
    for (const condition of conditions) {
      const actual = existing[condition.field];
      if (condition.op === 'eq') {
        if (actual !== condition.value) {
          return { rowsAffected: 0, error: null }; // Optimistic lock miss
        }
      } else if (condition.op === 'is_null') {
        if (actual !== null && actual !== undefined) {
          return { rowsAffected: 0, error: null }; // Expected null, but field has a value
        }
      }
    }

    // All conditions matched — apply updates
    this.state.set(id, { ...existing, ...updates });
    return { rowsAffected: 1, error: null };
  }

  // ─────────────────────────────────────────────────────────────
  // READ
  // ─────────────────────────────────────────────────────────────

  /** Fetch a single pick by id. */
  get(id: string): GetResult {
    const pick = this.state.get(id);
    if (!pick) return { data: null, error: `pick ${id} not found` };
    return { data: { ...pick }, error: null }; // defensive copy
  }

  /** All picks, in insertion order. Returns defensive copies. */
  getAll(): ReadonlyArray<Record<string, unknown>> {
    return [...this.state.values()].map(p => ({ ...p }));
  }

  /** All picks as a Map (pickId → snapshot). Returns defensive copies. */
  getSnapshot(): Map<string, Record<string, unknown>> {
    const snap = new Map<string, Record<string, unknown>>();
    for (const [id, pick] of this.state) {
      snap.set(id, { ...pick });
    }
    return snap;
  }

  /** Number of picks in the store. */
  get size(): number {
    return this.state.size;
  }

  /**
   * Clear all state. Used between determinism verification runs
   * to ensure the second run starts from a clean baseline.
   */
  clear(): void {
    this.state.clear();
  }

  // ─────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────

  /**
   * Cast the raw record to LifecyclePick for use in lifecycle validators.
   * The cast is safe because ReplayLifecycleRunner only inserts
   * records that conform to LifecyclePick structure.
   */
  getAsPick(id: string): LifecyclePick | null {
    const result = this.get(id);
    if (result.data === null) return null;
    return result.data as unknown as LifecyclePick;
  }
}
