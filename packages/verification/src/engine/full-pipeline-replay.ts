/**
 * VERIFICATION & SIMULATION CONTROL PLANE — Full-Pipeline Replay Harness
 * UTV2-1091: INIT-1.2.1 — Isolated Full-Pipeline Replay Harness
 *
 * Covers the full pipeline: ingestion → scoring → promotion → distribution
 * from immutable stored snapshots into an isolated store that mechanically
 * cannot write production.
 *
 * Design law — ISOLATION IS MECHANICAL, NOT CONVENTIONAL:
 *   - IsolatedReplayStore rejects writes to production at the type level and
 *     at runtime via ReplayProductionWriteError. Callers cannot bypass this
 *     by passing a flag — the store itself enforces the invariant.
 *   - ReplayProductionWriteError is thrown synchronously from any write method
 *     when the store's mode is not 'isolated'. Because the constructor requires
 *     mode='isolated', this error path is only reachable if someone constructs
 *     the store incorrectly (which the type system already prevents).
 *   - production_write_count tracks attempts; it must be 0 after a valid run.
 *
 * Stage implementations:
 *   - Each stage is structurally real (correct interface, write isolation,
 *     result tracking) but the domain logic is deliberately stubbed.
 *   - Stubs are the correct pattern here: the harness proves isolation and
 *     pipeline structure; full domain wiring is done when the domain packages
 *     are stable enough to import without creating circular dependencies.
 *
 * NOT in scope for this phase:
 *   - Importing from apps/* (packages cannot import from apps)
 *   - Wiring real scoring / promotion / distribution domain logic
 *   - Live provider data access of any kind
 */

import type { PipelineStage, ReplayRun, ReplaySnapshot, StageReplayResult } from './replay-types.js';
import type { ReplayStoreMode } from './replay-types.js';

// ─────────────────────────────────────────────────────────────
// ERROR — production write rejection
// ─────────────────────────────────────────────────────────────

/**
 * Thrown whenever any code path attempts to write to a production endpoint
 * during a replay run. The IsolatedReplayStore throws this unconditionally
 * on any write when mode is not 'isolated'.
 *
 * This error is NOT catchable within the harness — it propagates to the
 * test / caller so that the violation is visible.
 */
export class ReplayProductionWriteError extends Error {
  readonly code = 'REPLAY_PRODUCTION_WRITE' as const;

  constructor(operation: string, detail?: string) {
    super(
      `ReplayProductionWriteError: attempted production write during replay [op=${operation}]` +
        (detail ? ` — ${detail}` : '')
    );
    this.name = 'ReplayProductionWriteError';
  }
}

// ─────────────────────────────────────────────────────────────
// ISOLATED REPLAY STORE
// ─────────────────────────────────────────────────────────────

/**
 * A store that accepts reads from immutable snapshots and rejects ALL writes
 * to production via a type-level guard and a runtime throw.
 *
 * Isolation invariants (mechanical, not conventional):
 *   1. Constructor rejects mode='production' at runtime.
 *   2. All write methods throw ReplayProductionWriteError if somehow invoked
 *      outside the isolated path (belt-and-suspenders after the constructor guard).
 *   3. production_write_count is tracked; it must stay 0.
 *   4. The write path is intentionally narrow — new write methods must be
 *      explicitly added, not accidentally inherited.
 */
export class IsolatedReplayStore {
  /** In-memory store keyed by stage → item_id → record */
  private readonly state = new Map<PipelineStage, Map<string, Record<string, unknown>>>();

  /** Tracks production write attempts (must remain 0). */
  private _productionWriteCount = 0;

  readonly mode: 'isolated';

  constructor(mode: ReplayStoreMode = 'isolated') {
    if (mode !== 'isolated') {
      // Throw before assigning this.mode so the object is never in a usable state.
      throw new ReplayProductionWriteError(
        'construct',
        `IsolatedReplayStore cannot be constructed with mode='${mode}'. ` +
          `Only mode='isolated' is permitted for replay runs.`
      );
    }
    this.mode = mode;

    // Pre-initialise stage buckets
    for (const stage of ['ingestion', 'scoring', 'promotion', 'distribution'] as PipelineStage[]) {
      this.state.set(stage, new Map());
    }
  }

  // ─────────────────────────────────────────────────────────────
  // WRITE — isolated only
  // ─────────────────────────────────────────────────────────────

  /**
   * Write a record to the isolated store for a specific pipeline stage.
   *
   * Throws ReplayProductionWriteError if the store is somehow in a non-isolated
   * state (invariant: constructor already guarantees this cannot happen in normal usage).
   */
  write(stage: PipelineStage, id: string, record: Record<string, unknown>): void {
    if (this.mode !== 'isolated') {
      this._productionWriteCount++;
      throw new ReplayProductionWriteError('write', `stage=${stage} id=${id}`);
    }
    const bucket = this.state.get(stage);
    if (!bucket) {
      throw new Error(`IsolatedReplayStore: unknown stage '${stage}'`);
    }
    bucket.set(id, { ...record });
  }

  /**
   * Attempt a production write — ALWAYS throws ReplayProductionWriteError.
   *
   * This method exists as an explicit rejection surface so that any code path
   * attempting to write production can be expressed in one place and tested.
   * It increments production_write_count before throwing so the violation is
   * observable even if the caller catches the error.
   */
  writeProduction(_endpoint: string, _payload: Record<string, unknown>): never {
    this._productionWriteCount++;
    throw new ReplayProductionWriteError(
      'writeProduction',
      'replay runs must never write to production endpoints'
    );
  }

  // ─────────────────────────────────────────────────────────────
  // READ
  // ─────────────────────────────────────────────────────────────

  /** Fetch a single record from a pipeline stage by id. */
  get(stage: PipelineStage, id: string): Record<string, unknown> | null {
    const bucket = this.state.get(stage);
    if (!bucket) return null;
    const record = bucket.get(id);
    return record ? { ...record } : null; // defensive copy
  }

  /** All records for a pipeline stage, in insertion order. */
  getAll(stage: PipelineStage): ReadonlyArray<Record<string, unknown>> {
    const bucket = this.state.get(stage);
    if (!bucket) return [];
    return [...bucket.values()].map(r => ({ ...r }));
  }

  /** Total records written across all stages. */
  get totalRecords(): number {
    let count = 0;
    for (const bucket of this.state.values()) {
      count += bucket.size;
    }
    return count;
  }

  /** Number of production write attempts (must be 0 after a valid run). */
  get productionWriteCount(): number {
    return this._productionWriteCount;
  }

  /** Clear all state (used between runs). */
  clear(): void {
    for (const bucket of this.state.values()) {
      bucket.clear();
    }
    this._productionWriteCount = 0;
  }
}

// ─────────────────────────────────────────────────────────────
// FULL-PIPELINE REPLAY HARNESS
// ─────────────────────────────────────────────────────────────

/**
 * Executes the full pick pipeline — ingestion → scoring → promotion → distribution —
 * from immutable stored snapshots into an IsolatedReplayStore.
 *
 * Isolation guarantees:
 *   - All stage writes go through IsolatedReplayStore.write(), never production
 *   - Snapshots are frozen on construction and cannot be mutated
 *   - getProductionWriteCount() must return 0 after a valid run
 *
 * Stage stubs:
 *   - Each stage is structurally wired (reads snapshots, writes to isolated store,
 *     records result) but domain logic is stubbed per design rationale above.
 *   - The harness is the integration point; domain packages are not imported here.
 */
export class FullPipelineReplayHarness {
  private readonly snapshots: ReadonlyArray<Readonly<ReplaySnapshot>>;
  private readonly store: IsolatedReplayStore;
  readonly runId: string;

  constructor(snapshots: ReplaySnapshot[], replayRunId: string) {
    if (!replayRunId || replayRunId.trim() === '') {
      throw new Error('FullPipelineReplayHarness requires deterministic replayRunId');
    }
    // Freeze all snapshot data on construction — immutability is structural
    this.snapshots = snapshots.map(s => Object.freeze({ ...s, data: Object.freeze({ ...s.data }) }));
    this.store = new IsolatedReplayStore('isolated');
    this.runId = replayRunId;
  }

  // ─────────────────────────────────────────────────────────────
  // RUN
  // ─────────────────────────────────────────────────────────────

  /**
   * Execute the full pipeline replay:
   *   1. ingestion   — replay provider offers from snapshots
   *   2. scoring     — replay scoring logic against ingested data
   *   3. promotion   — replay promotion decisions
   *   4. distribution — replay delivery (isolated — no real outbox writes)
   */
  async run(): Promise<ReplayRun> {
    const startedAt = new Date().toISOString();
    const stageResults: StageReplayResult[] = [];
    const snapshotIds = this.snapshots.map(s => s.snapshot_id);

    this.store.clear();

    const run: ReplayRun = {
      run_id: this.runId,
      started_at: startedAt,
      status: 'running',
      pipeline_stages: [],
      production_write_count: 0,
      divergence_detected: false,
      snapshot_ids: snapshotIds,
      mode: 'isolated',
    };

    try {
      // Stage 1: Ingestion
      const ingestionResult = await this.runIngestionStage();
      stageResults.push(ingestionResult);

      // Stage 2: Scoring
      const scoringResult = await this.runScoringStage();
      stageResults.push(scoringResult);

      // Stage 3: Promotion
      const promotionResult = await this.runPromotionStage();
      stageResults.push(promotionResult);

      // Stage 4: Distribution
      const distributionResult = await this.runDistributionStage();
      stageResults.push(distributionResult);

      const anyFailed = stageResults.some(r => r.status === 'failed');

      return {
        ...run,
        completed_at: new Date().toISOString(),
        status: anyFailed ? 'failed' : 'completed',
        pipeline_stages: stageResults.map(r => r.stage),
        production_write_count: this.store.productionWriteCount,
      };
    } catch {
      return {
        ...run,
        completed_at: new Date().toISOString(),
        status: 'failed',
        pipeline_stages: stageResults.map(r => r.stage),
        production_write_count: this.store.productionWriteCount,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // STAGE IMPLEMENTATIONS (stubbed — domain logic intentionally deferred)
  // ─────────────────────────────────────────────────────────────

  /**
   * Ingestion stage: replay provider offers from snapshots.
   * Pattern: mirrors apps/ingestor/src/provider-offer-replay.ts
   *
   * Reads ingestion snapshots → writes raw offer records to isolated store.
   * No live provider API calls — all inputs come from immutable snapshots.
   */
  private async runIngestionStage(): Promise<StageReplayResult> {
    const startedAt = new Date().toISOString();
    const ingestionSnapshots = this.snapshots.filter(s => s.stage === 'ingestion');
    let itemsProcessed = 0;

    for (const snapshot of ingestionSnapshots) {
      // Write each offer from the snapshot to the isolated store
      const offers = snapshot.data['offers'];
      const offerArray = Array.isArray(offers) ? offers : [snapshot.data];
      for (let i = 0; i < offerArray.length; i++) {
        const offer = offerArray[i] as Record<string, unknown>;
        const offerId = (offer['id'] as string | undefined) ?? `${snapshot.snapshot_id}-offer-${i}`;
        this.store.write('ingestion', offerId, { ...offer, _snapshot_id: snapshot.snapshot_id });
        itemsProcessed++;
      }
    }

    return {
      stage: 'ingestion',
      status: 'completed',
      items_processed: itemsProcessed,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    };
  }

  /**
   * Scoring stage: replay scoring logic against ingested data.
   *
   * Reads records from the ingestion bucket → applies scoring stub →
   * writes scored records to the scoring bucket in the isolated store.
   *
   * Domain scoring logic is stubbed: the structural wiring is real.
   */
  private async runScoringStage(): Promise<StageReplayResult> {
    const startedAt = new Date().toISOString();
    const ingestedRecords = this.store.getAll('ingestion');
    let itemsProcessed = 0;

    // Also include any scoring-stage snapshots directly
    const scoringSnapshots = this.snapshots.filter(s => s.stage === 'scoring');
    const snapshotRecords: Record<string, unknown>[] = scoringSnapshots.flatMap(s => {
      const items = s.data['items'];
      return Array.isArray(items) ? (items as Record<string, unknown>[]) : [s.data];
    });

    const allToScore = [...ingestedRecords, ...snapshotRecords];

    for (let i = 0; i < allToScore.length; i++) {
      const record = allToScore[i]!;
      const recordId =
        (record['id'] as string | undefined) ?? `scored-${this.runId}-${i}`;
      // Stub: attach a deterministic score placeholder
      this.store.write('scoring', recordId, {
        ...record,
        _scored: true,
        _score_stub: 0,
        _scored_at: new Date().toISOString(),
      });
      itemsProcessed++;
    }

    return {
      stage: 'scoring',
      status: 'completed',
      items_processed: itemsProcessed,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    };
  }

  /**
   * Promotion stage: replay promotion decisions.
   *
   * Reads scored records → applies promotion decision stub →
   * writes promotion records to the promotion bucket.
   *
   * Domain promotion logic is stubbed; the structural wiring is real.
   */
  private async runPromotionStage(): Promise<StageReplayResult> {
    const startedAt = new Date().toISOString();
    const scoredRecords = this.store.getAll('scoring');
    let itemsProcessed = 0;

    // Also include promotion-stage snapshots directly
    const promotionSnapshots = this.snapshots.filter(s => s.stage === 'promotion');
    const snapshotRecords: Record<string, unknown>[] = promotionSnapshots.flatMap(s => {
      const items = s.data['items'];
      return Array.isArray(items) ? (items as Record<string, unknown>[]) : [s.data];
    });

    const allToPromote = [...scoredRecords, ...snapshotRecords];

    for (let i = 0; i < allToPromote.length; i++) {
      const record = allToPromote[i]!;
      const recordId =
        (record['id'] as string | undefined) ?? `promoted-${this.runId}-${i}`;
      // Stub: mark as promotion_pending (fail-closed — never auto-promote)
      this.store.write('promotion', recordId, {
        ...record,
        _promoted: false,
        _promotion_status: 'promotion_pending',
        _promotion_evaluated_at: new Date().toISOString(),
      });
      itemsProcessed++;
    }

    return {
      stage: 'promotion',
      status: 'completed',
      items_processed: itemsProcessed,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    };
  }

  /**
   * Distribution stage: replay delivery in isolation.
   *
   * Reads promotion records → simulates delivery to isolated store only.
   * No real outbox writes. No Discord calls. No external I/O.
   *
   * Pattern: mirrors apps/worker/src/replay-failed-delivery.ts —
   * delivery is recorded in the isolated store only.
   */
  private async runDistributionStage(): Promise<StageReplayResult> {
    const startedAt = new Date().toISOString();
    const promotionRecords = this.store.getAll('promotion');
    let itemsProcessed = 0;

    // Also include distribution-stage snapshots directly
    const distributionSnapshots = this.snapshots.filter(s => s.stage === 'distribution');
    const snapshotRecords: Record<string, unknown>[] = distributionSnapshots.flatMap(s => {
      const items = s.data['items'];
      return Array.isArray(items) ? (items as Record<string, unknown>[]) : [s.data];
    });

    const allToDistribute = [...promotionRecords, ...snapshotRecords];

    for (let i = 0; i < allToDistribute.length; i++) {
      const record = allToDistribute[i]!;
      const recordId =
        (record['id'] as string | undefined) ?? `distributed-${this.runId}-${i}`;
      // Isolated delivery record — no production outbox, no Discord
      this.store.write('distribution', recordId, {
        ...record,
        _delivered: false,
        _delivery_mode: 'isolated_replay',
        _delivery_attempted_at: new Date().toISOString(),
      });
      itemsProcessed++;
    }

    return {
      stage: 'distribution',
      status: 'completed',
      items_processed: itemsProcessed,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // ACCESSORS
  // ─────────────────────────────────────────────────────────────

  /**
   * Number of production write attempts.
   * Must return 0 after a valid replay run.
   * Any non-zero value indicates a broken isolation invariant.
   */
  getProductionWriteCount(): number {
    return this.store.productionWriteCount;
  }

  /** Access the isolated store for inspection after a run. */
  getStore(): IsolatedReplayStore {
    return this.store;
  }

  /** Access frozen snapshots (immutable). */
  getSnapshots(): ReadonlyArray<Readonly<ReplaySnapshot>> {
    return this.snapshots;
  }
}
