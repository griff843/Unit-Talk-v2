/**
 * VERIFICATION & SIMULATION CONTROL PLANE — JournalEventStore
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R2
 *
 * JSONL-backed event store for deterministic replay.
 *
 * Design:
 *   - Events are appended as newline-delimited JSON to a .jsonl file
 *   - Events are ordered by sequenceNumber (monotonic, assigned at append)
 *   - getEventsBetween() returns events in [start, end] window
 *   - The store is append-only (no updates, no deletes)
 *   - In-memory cache is maintained for the lifetime of the process
 *   - Pass filePath=null for a pure in-memory store (no disk I/O)
 *
 * Production events carry producedAt (wall clock when recorded).
 * Lifecycle-critical timestamps (timestamp field) come from the event payload
 * and drive VirtualEventClock advancement during replay.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname } from 'path';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export type ReplayEventType =
  | 'PICK_SUBMITTED'
  | 'PICK_GRADED'
  | 'PICK_POSTED'
  | 'PICK_SETTLED'
  | 'RECAP_TRIGGERED';

export interface ReplayEvent {
  /** UUID identifying this event. */
  eventId: string;

  /** What occurred. */
  eventType: ReplayEventType;

  /** Primary pick identifier (absent for RECAP_TRIGGERED). */
  pickId?: string | undefined;

  /**
   * Virtual clock position when this event occurred.
   * ISO 8601. This drives VirtualEventClock advancement during replay.
   */
  timestamp: string;

  /**
   * Monotonic ordering key. Assigned by the store at append time.
   * Guarantees deterministic ordering when timestamps collide.
   */
  sequenceNumber: number;

  /** Event-specific data. */
  payload: Record<string, unknown>;

  /**
   * Wall clock time when this event was recorded into the store.
   * For audit only — never used for lifecycle timestamps.
   */
  producedAt: string; // WALL-CLOCK-ALLOWED: event record timestamp, non-lifecycle
}

// ─────────────────────────────────────────────────────────────
// STORE
// ─────────────────────────────────────────────────────────────

/**
 * Append-only, JSONL-backed event store.
 *
 * Pass filePath=null for pure in-memory mode (tests, transient replay runs).
 * Pass an absolute file path for persistent storage.
 *
 * Acceptable for R2 (correctness + determinism over scale).
 */
export class JournalEventStore {
  private readonly filePath: string | null;
  private readonly events: ReplayEvent[] = [];
  private nextSeq: number = 1;

  constructor(filePath: string | null) {
    this.filePath = filePath;

    if (filePath !== null) {
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      if (existsSync(filePath)) {
        this.loadFromDisk(filePath);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // WRITE
  // ─────────────────────────────────────────────────────────────

  /**
   * Append a new event to the store.
   * Assigns sequenceNumber and producedAt automatically.
   * I/O errors are logged to stderr but never thrown (fail-open for recorder usage).
   */
  appendEvent(partial: Omit<ReplayEvent, 'sequenceNumber' | 'producedAt'>): ReplayEvent {
    const event: ReplayEvent = {
      ...partial,
      sequenceNumber: this.nextSeq++,
      producedAt: new Date().toISOString(), // WALL-CLOCK-ALLOWED: event record timestamp, non-lifecycle
    };

    this.events.push(event);

    if (this.filePath !== null) {
      try {
        appendFileSync(this.filePath, JSON.stringify(event) + '\n', 'utf8');
      } catch (err) {
        process.stderr.write(
          `[JournalEventStore] appendEvent I/O error: ${(err as Error).message}\n`
        );
      }
    }

    return event;
  }

  // ─────────────────────────────────────────────────────────────
  // READ
  // ─────────────────────────────────────────────────────────────

  /** All events ordered by sequenceNumber. */
  getAllEvents(): ReadonlyArray<ReplayEvent> {
    return this.events;
  }

  /**
   * Events whose timestamp falls in [start, end] (inclusive).
   * Returned in sequenceNumber order (deterministic).
   */
  getEventsBetween(start: Date, end: Date): ReadonlyArray<ReplayEvent> {
    const startMs = start.getTime();
    const endMs = end.getTime();
    return this.events.filter(e => {
      const t = new Date(e.timestamp).getTime();
      return t >= startMs && t <= endMs;
    });
  }

  /**
   * Events tagged with a specific runId in their payload.
   * Returns all events when runId is omitted.
   */
  getEventsForReplay(runId?: string): ReadonlyArray<ReplayEvent> {
    if (!runId) return this.events;
    return this.events.filter(e => (e.payload['runId'] as string | undefined) === runId);
  }

  /** Total number of events in the store. */
  get size(): number {
    return this.events.length;
  }

  // ─────────────────────────────────────────────────────────────
  // STATIC FACTORIES
  // ─────────────────────────────────────────────────────────────

  /** Pure in-memory store — no disk I/O. Used in tests and transient replay runs. */
  static createInMemory(): JournalEventStore {
    return new JournalEventStore(null);
  }

  /** Load a persistent store from an existing JSONL file. */
  static loadFromFile(filePath: string): JournalEventStore {
    return new JournalEventStore(filePath);
  }

  // ─────────────────────────────────────────────────────────────
  // PRIVATE
  // ─────────────────────────────────────────────────────────────

  private loadFromDisk(filePath: string): void {
    try {
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim().length > 0);
      for (const line of lines) {
        const event = JSON.parse(line) as ReplayEvent;
        this.events.push(event);
        if (event.sequenceNumber >= this.nextSeq) {
          this.nextSeq = event.sequenceNumber + 1;
        }
      }
    } catch (err) {
      process.stderr.write(`[JournalEventStore] loadFromDisk error: ${(err as Error).message}\n`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Parse a JSONL string into an in-memory JournalEventStore.
 * Used to load test fixtures without disk access.
 */
export function storeFromJsonl(jsonl: string): JournalEventStore {
  const store = JournalEventStore.createInMemory();
  const lines = jsonl.split('\n').filter(l => l.trim().length > 0);
  for (const line of lines) {
    const raw = JSON.parse(line) as Omit<ReplayEvent, 'sequenceNumber' | 'producedAt'>;
    store.appendEvent(raw);
  }
  return store;
}
