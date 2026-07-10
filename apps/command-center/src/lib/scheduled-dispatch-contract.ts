// Contract types for a future true scheduled-dispatch capability.
//
// Current reality (verified against packages/db/src/database.types.ts):
// distribution_outbox has NO scheduled/visible_at column. The only time
// semantics are:
//   - next_attempt_at: retry backoff timestamp for failed deliveries
//   - claimed_at / claimed_by: worker claim bookkeeping
// Queued rows are picked up as soon as a worker polls — there is no
// operator-facing "dispatch at time T" primitive today.
//
// TODO(data-contract): true scheduled dispatch needs either
//   (a) a `dispatch_after` (or `visible_at`) column on distribution_outbox
//       that the worker's claim query respects, or
//   (b) a separate scheduled_dispatches table drained into the outbox.
// Until one exists, /execution/scheduled shows queued outbox rows as
// "next dispatch candidates" only.

export interface ScheduledDispatchRequest {
  pickId: string;
  target: string; // e.g. 'discord'
  /** ISO timestamp before which the outbox worker must not claim the row. */
  dispatchAfter: string;
  requestedBy: string;
  reason?: string;
}

export interface ScheduledDispatchRecord extends ScheduledDispatchRequest {
  id: string;
  status: 'scheduled' | 'released' | 'cancelled';
  createdAt: string;
  releasedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
}
