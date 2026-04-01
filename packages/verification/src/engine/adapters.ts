/**
 * VERIFICATION & SIMULATION CONTROL PLANE — Adapter Contracts
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R1
 *
 * Adapter interfaces for mode-safe side-effect routing.
 *
 * Design law:
 *   - All external side effects flow through adapters
 *   - Adapters are selected by ExecutionMode at run initialisation
 *   - Production adapters must refuse instantiation in non-production modes
 *   - Non-production adapters must never call production infrastructure
 *   - All adapters in a manifest must agree on ExecutionMode
 */

import type { ClockProvider } from './clock.js';

// ─────────────────────────────────────────────────────────────
// EXECUTION MODE
// ─────────────────────────────────────────────────────────────

/**
 * Governs which clock, data sources, and side-effect targets are active.
 *
 * production  — real clock, live feeds, real Discord/notifications
 * replay      — virtual clock, historical event store, no-op side effects
 * shadow      — real clock, live feeds, captured (not emitted) side effects
 * fault       — virtual clock, synthetic events + fault triggers, no-op side effects
 * simulation  — virtual clock, historical + execution model, no-op side effects
 */
export type ExecutionMode = 'production' | 'replay' | 'shadow' | 'fault' | 'simulation';

/** Returns true for the production execution mode. */
export function isProductionMode(mode: ExecutionMode): boolean {
  return mode === 'production';
}

/** Returns true for any non-production execution mode. */
export function isNonProductionMode(mode: ExecutionMode): boolean {
  return mode !== 'production';
}

// ─────────────────────────────────────────────────────────────
// PUBLISH ADAPTER — Discord / distribution
// ─────────────────────────────────────────────────────────────

/**
 * Evidence that a pick was (or was attempted to be) published.
 * synthetic=true means the receipt was fabricated by a non-production adapter.
 */
export interface PublishReceipt {
  receiptId: string;
  pickId: string;
  channelId?: string;
  timestamp: string;
  mode: ExecutionMode;
  /** true when this receipt was generated synthetically (non-production modes). */
  synthetic: boolean;
}

/**
 * Governs pick distribution to external channels.
 *
 * production: posts to real Discord channels, returns Discord snowflake receipt.
 * all other:  records the payload, returns synthetic receipt, no external call.
 */
export interface PublishAdapter {
  readonly mode: ExecutionMode;
  publish(pickId: string, payload: Record<string, unknown>): Promise<PublishReceipt>;
}

// ─────────────────────────────────────────────────────────────
// NOTIFICATION ADAPTER — alerts / freeze / escalation
// ─────────────────────────────────────────────────────────────

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface NotificationAlert {
  severity: AlertSeverity;
  message: string;
  context: Record<string, unknown>;
  timestamp: string;
}

/**
 * Governs operator alerts, freeze notifications, and incident escalations.
 *
 * production: routes to Discord webhooks and operator channels.
 * all other:  records alert without emitting to any external target.
 */
export interface NotificationAdapter {
  readonly mode: ExecutionMode;
  alert(alert: NotificationAlert): Promise<void>;
}

// ─────────────────────────────────────────────────────────────
// FEED ADAPTER — data ingestion
// ─────────────────────────────────────────────────────────────

/** A single event from the data feed. */
export interface FeedEvent {
  eventId: string;
  eventType: string;
  timestamp: string;
  payload: Record<string, unknown>;
  /** Monotonic ordering key for deterministic replay. */
  sequenceNumber?: number;
  /** Content hash for integrity validation. */
  sourceHash?: string | undefined;
}

/**
 * Governs data ingestion from external sources.
 *
 * production:            connects to live sportsbook APIs and bridge_outbox.
 * replay/fault/simulation: reads from EventStore or synthetic sources.
 */
export interface FeedAdapter {
  readonly mode: ExecutionMode;
  poll(clock: ClockProvider): Promise<FeedEvent[]>;
}

// ─────────────────────────────────────────────────────────────
// SETTLEMENT ADAPTER — outcome resolution
// ─────────────────────────────────────────────────────────────

/** Settlement outcome for a pick. */
export interface SettlementData {
  pickId: string;
  result: 'win' | 'loss' | 'push' | 'void';
  settledAt: string;
  source: string;
  /** true when this data was retrieved from historical records, not live. */
  synthetic: boolean;
}

/**
 * Governs outcome resolution for picks.
 *
 * production: queries live data providers and odds APIs.
 * replay:     returns historical settlement records.
 * fault:      may return missing/conflicting data per scenario definition.
 */
export interface SettlementAdapter {
  readonly mode: ExecutionMode;
  checkSettlement(pickId: string, clock: ClockProvider): Promise<SettlementData | null>;
}

// ─────────────────────────────────────────────────────────────
// RECAP ADAPTER — performance summaries
// ─────────────────────────────────────────────────────────────

export type RecapPeriod = 'daily' | 'weekly' | 'monthly';

/** Output from a recap generation run. */
export interface RecapOutput {
  period: RecapPeriod;
  generatedAt: string;
  mode: ExecutionMode;
  content: Record<string, unknown>;
  /** true when the recap was delivered to an external channel. */
  delivered: boolean;
}

/**
 * Governs performance summary generation and delivery.
 *
 * production: generates and delivers recaps to Discord channels.
 * all other:  generates but captures output, does not deliver.
 */
export interface RecapAdapter {
  readonly mode: ExecutionMode;
  generate(period: RecapPeriod, clock: ClockProvider): Promise<RecapOutput>;
}

// ─────────────────────────────────────────────────────────────
// ADAPTER MANIFEST — full set for one run
// ─────────────────────────────────────────────────────────────

/**
 * Complete set of adapters for an execution run.
 * All adapters must agree on ExecutionMode.
 */
export interface AdapterManifest {
  mode: ExecutionMode;
  publish: PublishAdapter;
  notification: NotificationAdapter;
  feed: FeedAdapter;
  settlement: SettlementAdapter;
  recap: RecapAdapter;
}

/**
 * Validates that all adapters in a manifest agree on execution mode.
 * Throws an Error if any adapter reports a mismatching mode.
 *
 * Call this during RunController initialisation before any work begins.
 */
export function assertManifestConsistency(manifest: AdapterManifest): void {
  const entries: Array<[string, { mode: ExecutionMode }]> = [
    ['publish', manifest.publish],
    ['notification', manifest.notification],
    ['feed', manifest.feed],
    ['settlement', manifest.settlement],
    ['recap', manifest.recap],
  ];

  for (const [name, adapter] of entries) {
    if (adapter.mode !== manifest.mode) {
      throw new Error(
        `AdapterManifest: mode mismatch on '${name}'. ` +
          `manifest.mode='${manifest.mode}' but ${name}.mode='${adapter.mode}'. ` +
          `All adapters must agree on execution mode.`
      );
    }
  }
}
