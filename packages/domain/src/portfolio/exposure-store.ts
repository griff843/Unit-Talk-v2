/**
 * PortfolioExposure Store — INIT-3.5.1
 *
 * Append-only ledger of portfolio exposure events. Reconstructs current
 * exposure state deterministically from the event log.
 *
 * Constitutional guarantees:
 *  1. Append-only: events are never mutated or removed.
 *  2. Replay-safe: current state is fully reconstructable from the log.
 *  3. Fail closed: ambiguous or missing data produces zero-exposure, not phantom exposure.
 *  4. No capital deployment, treasury, or scaling runtime is activated here.
 *  5. No Program 4 activation. No DB writes from this module.
 *
 * Pure — no I/O, no DB, no env reads.
 */

// ── Event types ────────────────────────────────────────────────────────────────

export type ExposureEventType = 'opened' | 'closed' | 'voided';

export interface ExposureEvent {
  readonly event_id: string;
  readonly event_type: ExposureEventType;
  readonly pick_id: string;
  readonly recorded_at_ms: number;
  readonly sport: string;
  readonly market_family: 'game-line' | 'player-prop' | 'team-prop' | 'unknown';
  readonly participant_id: string | null;
  readonly team_id: string | null;
  /** Normalised stake weight 0–1 representing this pick's share of the portfolio. */
  readonly stake_weight: number;
}

// ── Exposure snapshot ──────────────────────────────────────────────────────────

export interface ExposureEntry {
  readonly pick_id: string;
  readonly sport: string;
  readonly market_family: 'game-line' | 'player-prop' | 'team-prop' | 'unknown';
  readonly participant_id: string | null;
  readonly team_id: string | null;
  readonly stake_weight: number;
  readonly opened_at_ms: number;
}

export interface PortfolioExposureSnapshot {
  /** Deterministically ordered open positions at reconstruction time. */
  readonly open_picks: readonly ExposureEntry[];
  /** Total stake weight across all open positions (may exceed 1 in multi-pick boards). */
  readonly total_stake_weight: number;
  /** Number of events consumed to produce this snapshot. */
  readonly event_count: number;
  /** Reconstruction is valid only when this is true. */
  readonly is_valid: boolean;
  /** Reason reconstruction failed, if is_valid === false. */
  readonly invalid_reason: string | null;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export class PortfolioExposureStore {
  private readonly _events: ExposureEvent[] = [];

  /** Append an exposure event. Events are immutable once appended. */
  append(event: ExposureEvent): void {
    if (!isValidEvent(event)) {
      // Fail closed: reject malformed events rather than silently accepting them.
      throw new Error(
        `PortfolioExposureStore: invalid event — pick_id=${event.pick_id} type=${event.event_type}`,
      );
    }
    this._events.push(Object.freeze({ ...event }));
  }

  /** Read-only frozen view of the full event log (replay surface). */
  get events(): readonly ExposureEvent[] {
    return Object.freeze([...this._events]);
  }

  /**
   * Reconstruct current exposure snapshot from the append-only log.
   *
   * Deterministic: the same event sequence always produces the same snapshot.
   * Fail closed: any structural ambiguity yields is_valid=false.
   */
  reconstruct(): PortfolioExposureSnapshot {
    return reconstructFromEvents(this._events);
  }
}

// ── Pure reconstruction (exported for replay testing) ─────────────────────────

export function reconstructFromEvents(
  events: readonly ExposureEvent[],
): PortfolioExposureSnapshot {
  if (events.length === 0) {
    return {
      open_picks: [],
      total_stake_weight: 0,
      event_count: 0,
      is_valid: true,
      invalid_reason: null,
    };
  }

  // Sort by recorded_at_ms ascending for deterministic replay order.
  const sorted = [...events].sort((a, b) => a.recorded_at_ms - b.recorded_at_ms);

  const openedMap = new Map<string, ExposureEntry>();
  const closedOrVoided = new Set<string>();

  for (const event of sorted) {
    switch (event.event_type) {
      case 'opened': {
        if (closedOrVoided.has(event.pick_id)) {
          // A pick that was already closed/voided cannot be re-opened.
          return failClosed(
            `pick ${event.pick_id} opened after close/void`,
            sorted.length,
          );
        }
        openedMap.set(event.pick_id, {
          pick_id: event.pick_id,
          sport: event.sport,
          market_family: event.market_family,
          participant_id: event.participant_id,
          team_id: event.team_id,
          stake_weight: event.stake_weight,
          opened_at_ms: event.recorded_at_ms,
        });
        break;
      }
      case 'closed':
      case 'voided': {
        if (!openedMap.has(event.pick_id)) {
          // Closing a pick that was never opened is ambiguous — fail closed.
          return failClosed(
            `pick ${event.pick_id} closed/voided without prior open`,
            sorted.length,
          );
        }
        openedMap.delete(event.pick_id);
        closedOrVoided.add(event.pick_id);
        break;
      }
    }
  }

  // Deterministic ordering: sort open picks by pick_id for replay stability.
  const open_picks = [...openedMap.values()].sort((a, b) =>
    a.pick_id < b.pick_id ? -1 : a.pick_id > b.pick_id ? 1 : 0,
  );

  const total_stake_weight = open_picks.reduce((sum, p) => sum + p.stake_weight, 0);

  return {
    open_picks,
    total_stake_weight,
    event_count: sorted.length,
    is_valid: true,
    invalid_reason: null,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function failClosed(reason: string, event_count: number): PortfolioExposureSnapshot {
  return {
    open_picks: [],
    total_stake_weight: 0,
    event_count,
    is_valid: false,
    invalid_reason: reason,
  };
}

function isValidEvent(event: ExposureEvent): boolean {
  if (!event.pick_id || event.pick_id.trim() === '') return false;
  if (!event.event_id || event.event_id.trim() === '') return false;
  if (!['opened', 'closed', 'voided'].includes(event.event_type)) return false;
  if (typeof event.recorded_at_ms !== 'number' || event.recorded_at_ms <= 0) return false;
  if (event.event_type === 'opened') {
    if (typeof event.stake_weight !== 'number') return false;
    if (event.stake_weight < 0 || event.stake_weight > 1) return false;
  }
  return true;
}
