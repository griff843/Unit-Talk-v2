// WORK-2026092705: pure Queue Movement evaluation for scripts/runtime-health.ts.
//
// The script used to read the whole outbox in one unordered request, so
// PostgREST's 1000-row cap handed it an arbitrary sample, and it kept its own
// copy of the dead-letter rule. It now reads every non-sent row in pages
// (`readAllPages`) and counts `sent` exactly; this module judges what it read.

import { partitionDeadLetters, type DeadLetterRowLike } from './pipeline-health-classification.js';

export type QueueState = 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'UNKNOWN';

export interface QueueRow extends DeadLetterRowLike {
  id: string;
  status: string;
  claimed_at?: string | null;
}

export interface QueueThresholds {
  outboxMaxPendingWarn: number;
  outboxMaxPendingCrit: number;
  outboxStuckProcMin: number;
  outboxDeadLetterCrit: number;
}

export interface QueueMovementInput {
  /** Every non-sent row the paged read returned. */
  rows: readonly QueueRow[];
  /** Exact count of non-sent rows, or null when the count could not be read. */
  nonSentCount: number | null;
  /** Exact count of sent rows, or null when the count could not be read. */
  sentCount: number | null;
  now: Date;
  thresholds: QueueThresholds;
}

export interface QueueMovementResult {
  state: QueueState;
  value: string;
  detail: string;
  issues: string[];
  counts: {
    pending: number;
    stuckProcessing: number;
    trueDeadLetter: number;
    governanceHold: number;
    unattemptedUnclassified: number;
    nonSentRead: number;
    nonSentExact: number | null;
    sent: number | null;
  };
}

/**
 * A partial read is never healthy: when the rows read do not match the exact
 * non-sent count, or either count is unreadable, the state is UNKNOWN and no
 * other verdict is drawn from the sample.
 *
 * Dead letters use the readiness gate's rule (`partitionDeadLetters`): true
 * failures are FAILED at the threshold; governance holds and unattempted,
 * unclassified rows are named and DEGRADED.
 */
export function evaluateQueueMovement(input: QueueMovementInput): QueueMovementResult {
  const { rows, nonSentCount, sentCount, now, thresholds: T } = input;
  const dead = partitionDeadLetters(rows);
  const pending = rows.filter((r) => r.status === 'pending');
  const stuckProc = rows.filter(
    (r) =>
      r.status === 'processing' &&
      typeof r.claimed_at === 'string' &&
      (now.getTime() - new Date(r.claimed_at).getTime()) / 60_000 > T.outboxStuckProcMin,
  );
  const counts = {
    pending: pending.length,
    stuckProcessing: stuckProc.length,
    trueDeadLetter: dead.trueFailure.length,
    governanceHold: dead.governanceHold.length,
    unattemptedUnclassified: dead.unattemptedUnclassified.length,
    nonSentRead: rows.length,
    nonSentExact: nonSentCount,
    sent: sentCount,
  };
  const countsDetail =
    `non_sent_read=${rows.length}; non_sent_exact=${nonSentCount ?? 'unknown'}; sent=${sentCount ?? 'unknown'}; ` +
    `pending=${counts.pending}; stuck=${counts.stuckProcessing}; true_dead_letter=${counts.trueDeadLetter}; ` +
    `governance_hold=${counts.governanceHold}; unattempted_unclassified=${counts.unattemptedUnclassified}`;

  if (typeof nonSentCount !== 'number' || nonSentCount !== rows.length || typeof sentCount !== 'number') {
    const issue =
      typeof nonSentCount !== 'number' || typeof sentCount !== 'number'
        ? 'outbox exact count unreadable'
        : `outbox read incomplete — read ${rows.length} of ${nonSentCount} non-sent rows`;
    return { state: 'UNKNOWN', value: 'partial outbox read', detail: `${countsDetail}; ${issue}`, issues: [issue], counts };
  }

  let state: QueueState = 'HEALTHY';
  const issues: string[] = [];
  if (counts.trueDeadLetter >= T.outboxDeadLetterCrit) {
    state = 'FAILED';
    issues.push(`${counts.trueDeadLetter} true dead_letter rows`);
  } else if (counts.pending > T.outboxMaxPendingCrit) {
    state = 'FAILED';
    issues.push(`${counts.pending} pending rows (>${T.outboxMaxPendingCrit})`);
  } else if (counts.pending > T.outboxMaxPendingWarn || counts.stuckProcessing > 0) {
    state = 'DEGRADED';
    if (counts.pending > T.outboxMaxPendingWarn) issues.push(`${counts.pending} pending (>${T.outboxMaxPendingWarn} warn)`);
    if (counts.stuckProcessing > 0) issues.push(`${counts.stuckProcessing} stuck processing >${T.outboxStuckProcMin}m`);
  }
  if (state === 'HEALTHY' && (counts.governanceHold > 0 || counts.unattemptedUnclassified > 0)) state = 'DEGRADED';
  if (counts.governanceHold > 0) issues.push(`${counts.governanceHold} governance-hold dead_letter row(s)`);
  if (counts.unattemptedUnclassified > 0) {
    issues.push(`${counts.unattemptedUnclassified} unattempted, unclassified dead_letter row(s)`);
  }

  return {
    state,
    value: `${counts.pending} pending, ${counts.trueDeadLetter} true dead_letter`,
    detail: `${countsDetail}; ${issues.join('; ')}`,
    issues,
    counts,
  };
}
