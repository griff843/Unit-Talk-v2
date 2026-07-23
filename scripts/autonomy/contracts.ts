import { createHash } from 'node:crypto';

export type AutonomyMode = 'halted' | 'shadow' | 't3-live' | 't2-t3-live';
export type CandidateTier = 'T1' | 'T2' | 'T3';
export type Executor = 'claude' | 'codex-cli' | 'codex-cloud';

export interface AutonomyCeilings {
  max_cycles: number;
  max_duration_ms: number;
  max_retries_per_candidate: number;
  max_token_budget: number;
  max_cost_micros: number;
}

export interface AutonomyPolicy {
  schema_version: 1;
  mode: AutonomyMode;
  owner_halt: boolean;
  owner_halt_reason: string | null;
  ceilings: AutonomyCeilings;
}

export interface UsageSnapshot {
  cycles: number;
  elapsed_ms: number;
  retries_for_candidate: number;
  tokens_used: number;
  cost_micros: number;
}

export interface Candidate {
  issue_id: string;
  tier: CandidateTier;
  branch: string;
  base_branch: string;
  executor: Executor;
  file_scope: string[];
}

export type BlockerCategory =
  | 'required_checks'
  | 'executor_result'
  | 'pm_verdict'
  | 'scope_override'
  | 'review_threads'
  | 'labels'
  | 'branch_base'
  | 'merge_conflicts'
  | 'locks_leases'
  | 'protected_files'
  | 'environment_approval'
  | 'github_mergeability'
  | 'advisory_workflow';

export interface BlockerFinding {
  category: BlockerCategory;
  code: string;
  severity: 'blocker' | 'escalation' | 'advisory';
  source: string;
  detail: string;
}

export interface CheckFact {
  name: string;
  required: boolean;
  status: 'queued' | 'in_progress' | 'completed' | 'missing';
  conclusion:
    | 'success'
    | 'neutral'
    | 'skipped'
    | 'failure'
    | 'cancelled'
    | 'timed_out'
    | null;
  sha: string | null;
}

export interface EvidenceFact {
  required: boolean;
  present: boolean;
  status: 'approved' | 'valid' | 'rejected' | 'invalid' | 'pending' | null;
  head_sha: string | null;
  expires_at: string | null;
  authenticated: boolean;
}

export interface LockLeaseFact {
  kind: 'lock' | 'lease';
  resource: string;
  status: 'active' | 'stale_reclaim_required' | 'released';
  owner_session_id: string;
  expires_at: string;
}

export interface MechanicalFacts {
  head_sha: string;
  observed_at: string;
  checks: CheckFact[];
  executor_result: EvidenceFact;
  pm_verdict: EvidenceFact;
  scope_override: EvidenceFact;
  unresolved_review_threads: number;
  required_labels: string[];
  labels: string[];
  behind_by: number;
  merge_conflicts: boolean;
  locks_and_leases: LockLeaseFact[];
  current_session_id: string;
  protected_file_expansion: {
    detected: boolean;
    paths: string[];
    authorized: boolean;
    authenticated: boolean;
  };
  environment: {
    required: boolean;
    approved: boolean;
    state: 'approved' | 'pending' | 'rejected' | 'unknown';
  };
  github_mergeability:
    | 'MERGEABLE'
    | 'CONFLICTING'
    | 'BLOCKED'
    | 'UNKNOWN'
    | 'UNSTABLE';
}

export interface CandidateDecision {
  schema_version: 1;
  decision_id: string;
  candidate_id: string;
  evaluated_at: string;
  mode: AutonomyMode;
  action: 'queue' | 'dispatch' | 'blocked' | 'escalation';
  dispatchable: boolean;
  blocking_findings: BlockerFinding[];
  advisories: BlockerFinding[];
  reason_codes: string[];
  input_hash: string;
}

export interface DispatchPacket {
  schema_version: 1;
  packet_id: string;
  run_id: string;
  decision_id: string;
  candidate: Candidate;
  created_at: string;
  content_sha256: string;
}

export type ExecutionState =
  | 'created'
  | 'evaluating'
  | 'packet_ready'
  | 'dispatching'
  | 'no_op'
  | 'queued'
  | 'dispatched'
  | 'blocked'
  | 'escalated';

export interface StructuredOutcome {
  kind: 'no_op' | 'queue' | 'dispatch' | 'blocked' | 'escalation';
  reason_codes: string[];
  packet_id?: string;
}

export interface ExecutionRecord {
  schema_version: 1;
  run_id: string;
  session_id: string;
  state: ExecutionState;
  input_hash: string;
  created_at: string;
  updated_at: string;
  cycle: number;
  retry_count: number;
  transition_sequence: number;
  decision?: CandidateDecision;
  packet_id?: string;
  outcome?: StructuredOutcome;
}

export interface AuditEvent {
  schema_version: 1;
  event_id: string;
  run_id: string;
  sequence: number;
  event_type:
    | 'run.created'
    | 'run.resumed'
    | 'state.transitioned'
    | 'decision.recorded'
    | 'packet.created'
    | 'run.completed'
    | 'lease.released';
  occurred_at: string;
  previous_hash: string | null;
  event_hash: string;
  payload: Record<string, unknown>;
}

export const TERMINAL_STATES: ReadonlySet<ExecutionState> = new Set([
  'no_op',
  'queued',
  'dispatched',
  'blocked',
  'escalated',
]);

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(',')}}`;
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
