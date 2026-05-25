/**
 * VERIFICATION & SIMULATION CONTROL PLANE — Full-Pipeline Replay Types
 * UTV2-1091: INIT-1.2.1 — Isolated Full-Pipeline Replay Harness
 *
 * Type definitions for the full-pipeline replay system.
 *
 * Design law:
 *   - ReplayStoreMode encodes the isolation invariant at the type level
 *   - ReplayRun.production_write_count must always be 0 after a valid run
 *   - ReplaySnapshot.data is readonly after creation — mutation is forbidden
 */

// ─────────────────────────────────────────────────────────────
// STORE MODE
// ─────────────────────────────────────────────────────────────

/**
 * Governs which store a replay run may write to.
 *
 * 'isolated' — all writes go to the in-memory isolated store only
 * 'production' — NEVER used by replay; present in the type to make
 *               the prohibition explicit and enforceable at the type level
 *
 * The IsolatedReplayStore only accepts mode='isolated'.
 * Any attempt to construct with mode='production' throws at runtime.
 */
export type ReplayStoreMode = 'isolated' | 'production';

// ─────────────────────────────────────────────────────────────
// PIPELINE STAGES
// ─────────────────────────────────────────────────────────────

/**
 * The four pipeline stages that the full-pipeline replay harness exercises.
 * Each stage is represented in the ReplayRun output for auditability.
 */
export type PipelineStage = 'ingestion' | 'scoring' | 'promotion' | 'distribution';

// ─────────────────────────────────────────────────────────────
// REPLAY RUN
// ─────────────────────────────────────────────────────────────

/**
 * Represents a full-pipeline replay execution.
 *
 * Critical invariants:
 *   - production_write_count MUST be 0 after a valid run
 *   - mode MUST be 'isolated' (never 'production')
 *   - pipeline_stages MUST include all four stages for a complete run
 */
export interface ReplayRun {
  run_id: string;
  started_at: string;
  completed_at?: string;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  /** All four pipeline stages must appear for a complete run. */
  pipeline_stages: PipelineStage[];
  /** Must always be 0 — any non-zero value indicates a broken isolation invariant. */
  production_write_count: number;
  /** True when a divergence between replay output and expected output was detected. */
  divergence_detected: boolean;
  /** Immutable input snapshot references consumed by this run. */
  snapshot_ids: string[];
  /** Store mode — always 'isolated' for valid replay runs. */
  mode: ReplayStoreMode;
}

// ─────────────────────────────────────────────────────────────
// REPLAY SNAPSHOT
// ─────────────────────────────────────────────────────────────

/**
 * A point-in-time snapshot of data for one pipeline stage.
 *
 * Invariants:
 *   - data is readonly after creation — any mutation attempt must throw
 *   - snapshot_id uniquely identifies this snapshot within a run
 *   - captured_at is an ISO 8601 timestamp
 */
export interface ReplaySnapshot {
  snapshot_id: string;
  captured_at: string;
  stage: PipelineStage;
  /** Immutable — frozen at creation time. Mutation attempts throw at runtime. */
  readonly data: Readonly<Record<string, unknown>>;
}

// ─────────────────────────────────────────────────────────────
// STAGE RESULT
// ─────────────────────────────────────────────────────────────

/**
 * Result of executing a single pipeline stage during replay.
 */
export interface StageReplayResult {
  stage: PipelineStage;
  status: 'completed' | 'failed' | 'skipped';
  items_processed: number;
  error?: string;
  started_at: string;
  completed_at: string;
}
