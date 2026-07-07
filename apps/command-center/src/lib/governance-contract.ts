// Governance / lane board — DATA CONTRACT ONLY.
//
// Lane manifests live in repo files (docs/06_status/lanes/*.json) and lane
// workflow state lives in Linear. Neither is reachable from this app's data
// layer (Supabase reads only), so the /operations/governance page is a UI
// shell rendered against these types.
//
// TODO(data-contract): needs an API surface exposing lane manifests + Linear
// state (e.g. apps/api GET /api/governance/lanes) before this page can show
// real rows. Display-only: this module must never re-encode governance rules
// as logic — GitHub main / proof bundles / lane manifests remain authority.

export type LaneTier = 'T1' | 'T2' | 'T3';

export type LaneState =
  | 'preflight'
  | 'in_progress'
  | 'blocked'
  | 'in_review'
  | 'merged'
  | 'done';

export type TruthCheckStatus = 'pass' | 'fail' | 'not_run';

export type PmVerdictStatus = 'approved' | 'rejected' | 'pending' | 'not_required';

export interface LaneSummary {
  issueId: string; // e.g. "UTV2-1480"
  title: string | null;
  tier: LaneTier | null;
  laneState: LaneState;
  owner: string | null;
  branch: string | null;
  prUrl: string | null;
  mergeSha: string | null;
  truthCheck: TruthCheckStatus;
  pmVerdict: PmVerdictStatus;
  blockerReason: string | null;
  nextAction: string | null;
  updatedAt: string | null;
}

export interface GovernanceBoardSnapshot {
  observedAt: string;
  activeLanes: LaneSummary[];
  blockedLanes: LaneSummary[];
  awaitingPmVerdict: LaneSummary[];
}

/** Column definitions for the shell table so the page stays column-complete. */
export const LANE_BOARD_COLUMNS = [
  'Issue',
  'Tier',
  'Lane State',
  'PR',
  'Merge SHA',
  'Truth Check',
  'PM Verdict',
  'Blocker',
  'Next Action',
  'Updated',
] as const;
