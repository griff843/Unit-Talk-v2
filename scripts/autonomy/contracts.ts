import { createHash } from 'node:crypto';

export type AutonomyMode = 'halted' | 'shadow' | 't3_live' | 't2t3_live';
export type CandidateTier = 'T2' | 'T3';
export type Executor = 'claude' | 'codex-cli' | 'codex-cloud';

export interface AutonomyCeilings {
  max_cycles: number;
  max_duration_ms: number;
  max_operation_duration_ms: number;
  max_dispatches_per_cycle: number;
  max_merges_per_cycle: number;
  max_retries_per_operation: number;
  max_token_budget: number;
  max_cost_micros: number;
}

export interface AutonomyPolicy {
  schema_version: 1;
  mode: AutonomyMode;
  owner_halt: boolean;
  owner_halt_reason: string | null;
  heartbeat_ttl_seconds: number;
  ceilings: AutonomyCeilings;
}

export interface UsageSnapshot {
  cycles: number;
  elapsed_ms: number;
  operation_elapsed_ms: number;
  retries_for_operation: number;
  tokens_used: number;
  cost_micros: number;
  dispatches: number;
  merges: number;
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
  github_mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  github_merge_state_status:
    | 'CLEAN'
    | 'BLOCKED'
    | 'BEHIND'
    | 'DIRTY'
    | 'DRAFT'
    | 'HAS_HOOKS'
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
  packet_eligible: boolean;
  blocking_findings: BlockerFinding[];
  advisories: BlockerFinding[];
  reason_codes: string[];
  input_hash: string;
}

export interface DispatchPacket {
  schema_version: 1;
  packet_id: string;
  issue_id: string;
  tier: CandidateTier;
  executor: Executor;
  mode_at_dispatch: Exclude<AutonomyMode, 'halted'>;
  generated_at: string;
  expires_at: string;
  file_scope_lock: string[];
  sensitive_path_check: {
    passed: boolean;
    checked_against: 'docs/05_operations/DELEGATION_POLICY.md#sensitive-path-matrix';
    checked_at: string;
    matched_paths: string[];
  };
  dispatch_reason: string;
  idempotency_key: string;
  kill_switch_check: { checked_at: string; halted: false };
  dry_run: boolean;
  content_sha256: string;
  concurrency_snapshot_ref?: string;
}

export type CycleState =
  | 'idle'
  | 'waking'
  | 'gating'
  | 'selecting'
  | 'dispatching'
  | 'shadow_evaluating'
  | 'reporting'
  | 'cooling_down';

export interface ModeHistoryEntry {
  at: string;
  from: AutonomyMode;
  to: AutonomyMode;
  trigger: string;
  actor: 'owner' | 'kernel_auto_rollback' | 'kernel_auto_halt';
}

export interface KernelExecutionState {
  schema_version: 1;
  mode: AutonomyMode;
  cycle_state: CycleState;
  halted: boolean;
  halted_reason: string | null;
  current_cycle_id: string | null;
  last_cycle_started_at: string | null;
  last_cycle_completed_at: string | null;
  last_heartbeat_at: string;
  heartbeat_ttl_seconds: number;
  owner_pid: number | null;
  consecutive_infra_failures: number;
  consecutive_rollback_triggers: number;
  cost_counters: {
    window_started_at: string;
    window_tokens_used: number;
    window_dispatch_count: number;
  };
  active_dispatch_ids: string[];
  mode_history: ModeHistoryEntry[];
}

export interface StateTransitionRecord {
  sequence: number;
  from: CycleState;
  to: CycleState;
  at: string;
}

export interface ExecutionRecord {
  schema_version: 1;
  cycle_id: string;
  mode: AutonomyMode;
  input_hash: string;
  created_at: string;
  updated_at: string;
  transitions: StateTransitionRecord[];
  decision?: CandidateDecision;
  packet_id?: string;
  outcome?: StructuredOutcome;
}

export interface StructuredOutcome {
  kind: 'no_op' | 'queue' | 'dispatch' | 'blocked' | 'escalation';
  reason_codes: string[];
  packet_id?: string;
}

export type AuditEventType =
  | 'cycle_started'
  | 'cycle_completed'
  | 'kill_switch_checked'
  | 'kill_switch_engaged'
  | 'kill_switch_confirmed_halted'
  | 'gate_result'
  | 'candidate_selected'
  | 'candidate_refused_sensitive_path'
  | 'candidate_refused_t1_excluded'
  | 'candidate_refused_concurrency'
  | 'dispatch_intent'
  | 'dispatch_outcome'
  | 'shadow_decision'
  | 'mode_promoted'
  | 'mode_rolled_back'
  | 'auto_halt_triggered'
  | 'crash_recovery_reconciled'
  | 'audit_integrity_failure';

export interface AuditEvent {
  schema_version: 1;
  event_id: string;
  sequence: number;
  ts: string;
  event_type: AuditEventType;
  phase: 'intent' | 'outcome' | 'info';
  actor: 'kernel' | 'owner' | 'claude' | 'codex';
  mode: AutonomyMode;
  severity: 'debug' | 'info' | 'medium' | 'high' | 'critical';
  issue_id: string | null;
  idempotency_key: string | null;
  prev_event_hash: string | null;
  event_hash: string;
  detail: Record<string, unknown>;
}

export type ReconciliationOutcome =
  | 'confirmed_done'
  | 'confirmed_not_done'
  | 'confirmed_in_progress_externally_unblocked';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
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
