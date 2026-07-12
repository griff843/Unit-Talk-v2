// Approvals cockpit — pure classification model. No I/O.

import type { InternalLabel } from '@/components/ui';

export type ApprovalLabel = Extract<InternalLabel, 'Approvalable' | 'Needs PM' | 'Blocked' | 'Needs Review'>;

export type ApprovalQueueSource = 'awaiting_approval' | 'held' | 'review';

export interface ApprovalRowInput {
  id: string;
  queue: ApprovalQueueSource;
  status: string | null;
  approvalStatus?: string | null;
  governanceQueueState?: string | null;
  holdReason?: string | null;
  createdAt: string | null;
}

export interface ApprovalClassification {
  label: ApprovalLabel;
  reason: string;
}

const TERMINAL_STATUSES = new Set(['voided', 'rejected', 'expired', 'settled', 'graded']);

/**
 * One clear label per row:
 * - Blocked: terminal/contradictory state — approving would be invalid.
 * - Approvalable: governance-brake awaiting_approval — PM can act right now.
 * - Needs PM: operator-held picks requiring a PM decision to release.
 * - Needs Review: legacy pending-review queue rows.
 */
export function classifyApproval(row: ApprovalRowInput): ApprovalClassification {
  const status = row.status?.trim().toLowerCase() ?? '';
  const approvalStatus = row.approvalStatus?.trim().toLowerCase() ?? '';
  const governanceState = row.governanceQueueState?.trim().toLowerCase() ?? '';

  if (TERMINAL_STATUSES.has(status)) {
    return { label: 'Blocked', reason: `Lifecycle status "${status}" is terminal — cannot approve.` };
  }
  if (approvalStatus === 'denied' || approvalStatus === 'rejected') {
    return { label: 'Blocked', reason: `Approval status already "${approvalStatus}".` };
  }
  if (status === 'awaiting_approval' || governanceState === 'awaiting_approval') {
    return { label: 'Approvalable', reason: 'Governance brake: pick is awaiting PM approval.' };
  }
  if (row.queue === 'held') {
    return {
      label: 'Needs PM',
      reason: row.holdReason ? `Held: ${row.holdReason}` : 'Held by operator — needs PM decision.',
    };
  }
  return { label: 'Needs Review', reason: 'In the review queue pending an approve/deny decision.' };
}

export function ageHoursFrom(createdAt: string | null, nowMs: number): number | null {
  if (!createdAt) return null;
  const then = Date.parse(createdAt);
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((nowMs - then) / 3_600_000));
}

const LABEL_ORDER: Record<ApprovalLabel, number> = {
  Approvalable: 0,
  'Needs PM': 1,
  'Needs Review': 2,
  Blocked: 3,
};

export function compareApprovalLabels(a: ApprovalLabel, b: ApprovalLabel): number {
  return LABEL_ORDER[a] - LABEL_ORDER[b];
}

// ── Age humanization + urgency (UTV2-1522) ────────────────────────────────────

export type AgeUrgency = 'fresh' | 'aging' | 'stale' | 'critical';

/** "61d ago" / "5h ago" / "just now" — never raw hour counts or ISO strings. */
export function humanizeAgeHours(ageHours: number | null): string {
  if (ageHours === null) return '—';
  if (ageHours < 1) return 'just now';
  if (ageHours < 48) return `${ageHours}h ago`;
  return `${Math.floor(ageHours / 24)}d ago`;
}

/** Urgency tier for visual triage: <4h fresh, <48h aging, <7d stale, else critical. */
export function ageUrgency(ageHours: number | null): AgeUrgency {
  if (ageHours === null || ageHours < 4) return 'fresh';
  if (ageHours < 48) return 'aging';
  if (ageHours < 24 * 7) return 'stale';
  return 'critical';
}
