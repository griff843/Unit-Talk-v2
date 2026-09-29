/**
 * WORK-2026092901: the dispatch ledger for member-facing human-capper delivery.
 *
 * A Discord post is not a database write. Discord can accept a message while
 * the worker records a failure -- a fetch abort after the request left, a 5xx
 * after the message was created, a watchdog timeout, an exception in the
 * confirm step, a worker crash before confirm. The outbox row then returns to
 * `pending`, the next claim posts again, and a member sees the same pick twice.
 * The receipt's unique idempotency key cannot prevent that: the failed attempt
 * never wrote its receipt.
 *
 * The ledger closes that window by recording, on the outbox row's audit trail,
 * what is known about every dispatch BEFORE and AFTER the network call:
 *
 *   - `started`     written before the POST; if it cannot be written, nothing is posted;
 *   - `not_created` Discord definitively did not create a message (no request
 *                   was sent, or it answered 4xx/429);
 *   - `delivered`   Discord returned the created message; the receipt data is
 *                   kept so a later claim can confirm WITHOUT posting again;
 *   - `reconciled`  an operator attested, through the audited retry route,
 *                   that no message exists for the attempts up to `throughAttempt`.
 *
 * A `started` attempt with none of the three resolutions is AMBIGUOUS: the
 * message may exist. An ambiguous row is never posted again automatically; it
 * is dead-lettered for an operator to reconcile against the channel. This is
 * at-most-once delivery with an explicit, audited exception path -- the only
 * honest guarantee when the far side cannot be queried by idempotency key.
 *
 * Pure: no I/O. Callers read the audit rows and pass them in.
 */

export const dispatchLedgerActions = {
  started: 'distribution.dispatch_started',
  notCreated: 'distribution.dispatch_not_created',
  delivered: 'distribution.dispatch_delivered',
  reconciled: 'distribution.dispatch_reconciled',
  ambiguous: 'distribution.dispatch_ambiguous',
} as const;

/** What an adapter knows about whether its request created a message. */
export type DispatchOutcome = 'not-sent' | 'rejected' | 'ambiguous' | 'delivered';

export interface DispatchLedgerRow {
  action: string;
  payload: unknown;
}

export interface DispatchLedgerReceipt {
  receiptType: string;
  channel: string;
  externalId: string;
  idempotencyKey: string | null;
  payload: Record<string, unknown>;
}

export interface DispatchLedgerState {
  /** Highest attempt number recorded as started (0 when none). */
  lastAttempt: number;
  /** The attempt number the next dispatch must record. */
  nextAttempt: number;
  /** Started attempts with no recorded resolution. Non-empty means the message may exist. */
  unresolvedAttempts: number[];
  /** A recorded successful dispatch, if any: the message exists and must not be posted again. */
  delivered: { attempt: number; receipt: DispatchLedgerReceipt } | null;
  /** Ledger rows whose shape could not be read. Any of these makes the state ambiguous. */
  malformed: number;
}

export function readDispatchLedger(rows: readonly DispatchLedgerRow[]): DispatchLedgerState {
  const started = new Set<number>();
  const resolved = new Set<number>();
  let reconciledThrough = 0;
  let delivered: DispatchLedgerState['delivered'] = null;
  let malformed = 0;

  for (const row of rows) {
    const payload = isRecord(row.payload) ? row.payload : {};
    switch (row.action) {
      case dispatchLedgerActions.started: {
        const attempt = readAttempt(payload['attempt']);
        if (attempt === null) malformed += 1;
        else started.add(attempt);
        break;
      }
      case dispatchLedgerActions.notCreated: {
        const attempt = readAttempt(payload['attempt']);
        if (attempt === null) malformed += 1;
        else resolved.add(attempt);
        break;
      }
      case dispatchLedgerActions.delivered: {
        const attempt = readAttempt(payload['attempt']);
        const receipt = readReceipt(payload['receipt']);
        if (attempt === null || receipt === null) {
          malformed += 1;
        } else {
          resolved.add(attempt);
          if (delivered === null || attempt > delivered.attempt) {
            delivered = { attempt, receipt };
          }
        }
        break;
      }
      case dispatchLedgerActions.reconciled: {
        const through = readAttempt(payload['throughAttempt']);
        if (through === null) malformed += 1;
        else reconciledThrough = Math.max(reconciledThrough, through);
        break;
      }
      default:
        break;
    }
  }

  const lastAttempt = started.size === 0 ? 0 : Math.max(...started);
  const unresolvedAttempts = [...started]
    .filter((attempt) => !resolved.has(attempt) && attempt > reconciledThrough)
    .sort((left, right) => left - right);

  return {
    lastAttempt,
    nextAttempt: lastAttempt + 1,
    unresolvedAttempts,
    delivered,
    malformed,
  };
}

/** Whether the ledger forbids another automatic dispatch without an operator. */
export function isDispatchAmbiguous(state: DispatchLedgerState): boolean {
  return state.delivered === null && (state.unresolvedAttempts.length > 0 || state.malformed > 0);
}

/**
 * Discord's message `nonce` (at most 25 characters) for an outbox row. With
 * `enforce_nonce: true`, Discord returns the already-created message instead of
 * creating a second one when the same author reuses the nonce within its
 * de-duplication window. Defence in depth under the ledger, not a substitute
 * for it: the window is minutes, and a worker crash can outlast it.
 */
export function discordMessageNonce(outboxId: string): string {
  return outboxId.replace(/-/g, '').slice(0, 25);
}

function readAttempt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function readReceipt(value: unknown): DispatchLedgerReceipt | null {
  if (!isRecord(value)) return null;
  const receiptType = value['receiptType'];
  const channel = value['channel'];
  const externalId = value['externalId'];
  const idempotencyKey = value['idempotencyKey'];
  const payload = value['payload'];
  if (typeof receiptType !== 'string' || typeof channel !== 'string') return null;
  if (typeof externalId !== 'string' || externalId.length === 0) return null;
  return {
    receiptType,
    channel,
    externalId,
    idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : null,
    payload: isRecord(payload) ? payload : {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
