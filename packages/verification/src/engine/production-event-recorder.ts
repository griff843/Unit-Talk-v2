/**
 * VERIFICATION & SIMULATION CONTROL PLANE — ProductionEventRecorder
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R2
 *
 * Fail-open middleware for recording production pipeline events into
 * a JournalEventStore for later replay.
 *
 * Design law:
 *   - NEVER throws: production flow must never be interrupted by recording failure
 *   - NEVER blocks: recording is best-effort; I/O errors are swallowed
 *   - NEVER modifies the event payload (read-only observer)
 *   - Timestamps for lifecycle fields come from the caller (already captured)
 *   - producedAt is assigned by JournalEventStore at append time
 *
 * Usage: Wrap production agent actions with the recorder methods.
 * The recorder is an opt-in observer — agents continue to function
 * identically whether or not a recorder is attached.
 */

import { randomUUID } from 'crypto';

import type { JournalEventStore } from './event-store.js';

/** Minimal grading result for PICK_GRADED events. */
export interface GradingSnapshot {
  tier?: string;
  confidence?: number;
  promotion_status?: string;
  promotion_queued_at?: string;
  meta?: Record<string, unknown>;
}

/** Minimal posting result for PICK_POSTED events. */
export interface PostingSnapshot {
  channel?: string;
  discord_message_id?: string;
  promotion_posted_at?: string;
  posted_to_discord?: boolean;
}

/** Minimal settlement result for PICK_SETTLED events. */
export interface SettlementSnapshot {
  settlement_result: 'win' | 'loss' | 'push' | 'void';
  settlement_status?: string;
  settled_at?: string;
  source?: string;
}

export class ProductionEventRecorder {
  private readonly store: JournalEventStore;

  constructor(store: JournalEventStore) {
    this.store = store;
  }

  /**
   * Record a PICK_SUBMITTED event.
   * Call after successful lifecycleInsert.
   * Fail-open: errors are swallowed.
   */
  recordPickSubmitted(
    pickId: string,
    betSlipId: string | undefined,
    pickSnapshot: Record<string, unknown>,
    virtualTimestamp: string
  ): void {
    this.record({
      eventId: randomUUID(),
      eventType: 'PICK_SUBMITTED',
      pickId,
      timestamp: virtualTimestamp,
      payload: {
        betSlipId,
        pick: pickSnapshot,
      },
    });
  }

  /**
   * Record a PICK_GRADED event.
   * Call after successful lifecycleUpdate with writerRole='promoter'.
   * Fail-open: errors are swallowed.
   */
  recordPickGraded(pickId: string, grading: GradingSnapshot, virtualTimestamp: string): void {
    this.record({
      eventId: randomUUID(),
      eventType: 'PICK_GRADED',
      pickId,
      timestamp: virtualTimestamp,
      payload: { gradingData: grading },
    });
  }

  /**
   * Record a PICK_POSTED event.
   * Call after successful atomicClaimForPost.
   * Fail-open: errors are swallowed.
   */
  recordPickPosted(pickId: string, posting: PostingSnapshot, virtualTimestamp: string): void {
    this.record({
      eventId: randomUUID(),
      eventType: 'PICK_POSTED',
      pickId,
      timestamp: virtualTimestamp,
      payload: { posting },
    });
  }

  /**
   * Record a PICK_SETTLED event.
   * Call after successful lifecycleSettle.
   * Fail-open: errors are swallowed.
   */
  recordPickSettled(
    pickId: string,
    settlement: SettlementSnapshot,
    virtualTimestamp: string
  ): void {
    this.record({
      eventId: randomUUID(),
      eventType: 'PICK_SETTLED',
      pickId,
      timestamp: virtualTimestamp,
      payload: {
        result: settlement.settlement_result,
        source: settlement.source ?? 'production',
        settled_at: settlement.settled_at,
      },
    });
  }

  /**
   * Record a RECAP_TRIGGERED event.
   * Call when a recap cycle fires.
   * Fail-open: errors are swallowed.
   */
  recordRecapTriggered(period: 'daily' | 'weekly' | 'monthly', virtualTimestamp: string): void {
    this.record({
      eventId: randomUUID(),
      eventType: 'RECAP_TRIGGERED',
      timestamp: virtualTimestamp,
      payload: { period },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // PRIVATE
  // ─────────────────────────────────────────────────────────────

  private record(event: Parameters<JournalEventStore['appendEvent']>[0]): void {
    try {
      this.store.appendEvent(event);
    } catch {
      // Fail-open: production flow must never be interrupted by recording failure
    }
  }
}
