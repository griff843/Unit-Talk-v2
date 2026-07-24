import { classifyBlockers } from './blocker-classifier.js';
import {
  type AutonomyPolicy,
  canonicalJson,
  type Candidate,
  type CandidateDecision,
  deepFreeze,
  type DispatchPacket,
  type ExecutionRecord,
  type MechanicalFacts,
  type ReconciliationOutcome,
  sha256,
  type StructuredOutcome,
  type UsageSnapshot,
} from './contracts.js';
import { evaluateCeilings } from './policy.js';
import { FileAutonomyStore } from './store.js';

export interface KernelInput {
  cycle_id: string;
  now: string;
  packet_expires_at: string;
  policy: AutonomyPolicy;
  usage: UsageSnapshot;
  candidate: Candidate | null;
  facts: MechanicalFacts | null;
  recovery_truth?: Readonly<Record<string, ReconciliationOutcome>>;
}

export type KernelResult =
  | {
      ok: true;
      record: ExecutionRecord | null;
      outcome: StructuredOutcome;
      reconciled: boolean;
    }
  | {
      ok: false;
      outcome: StructuredOutcome;
      code:
        | 'ACTIVE_CYCLE_CONFLICT'
        | 'RECOVERY_RECONCILIATION_REQUIRED'
        | 'PERSISTED_MODE_MISMATCH'
        | 'AUTONOMY_STATE_FAIL_CLOSED';
    };

export function evaluateCandidate(
  candidate: Candidate,
  facts: MechanicalFacts,
  policy: AutonomyPolicy,
  usage: UsageSnapshot,
  evaluatedAt: string,
): CandidateDecision {
  const inputHash = sha256({ candidate, facts, policy, usage });
  const classification = classifyBlockers(facts);
  const ceilingReasons = evaluateCeilings(policy.ceilings, usage);
  let action: CandidateDecision['action'];
  let reasonCodes: string[];

  if (policy.mode === 'halted' || policy.owner_halt) {
    action = 'blocked';
    reasonCodes = ['AUTONOMY_HALTED'];
  } else if (ceilingReasons.length > 0) {
    action = 'escalation';
    reasonCodes = ceilingReasons;
  } else if (classification.blocking.length > 0) {
    action = classification.blocking.some(
      (entry) => entry.severity === 'escalation',
    )
      ? 'escalation'
      : 'blocked';
    reasonCodes = classification.blocking.map((entry) => entry.code);
  } else if (policy.mode === 'shadow') {
    action = 'queue';
    reasonCodes = ['SHADOW_MODE_DRY_RUN_ONLY'];
  } else if (policy.mode === 't3_live' && candidate.tier === 'T2') {
    action = 'queue';
    reasonCodes = ['MODE_DOES_NOT_AUTHORIZE_TIER'];
  } else {
    action = 'dispatch';
    reasonCodes = ['MECHANICALLY_DISPATCHABLE'];
  }

  reasonCodes = [...new Set(reasonCodes)].sort();
  const packetEligible =
    classification.blocking.length === 0 &&
    ceilingReasons.length === 0 &&
    policy.mode !== 'halted' &&
    !policy.owner_halt;
  const decisionContent = {
    candidate_id: candidate.issue_id,
    evaluated_at: evaluatedAt,
    mode: policy.mode,
    action,
    dispatchable: action === 'dispatch',
    packet_eligible: packetEligible,
    blocking_findings: classification.blocking,
    advisories: classification.advisories,
    reason_codes: reasonCodes,
    input_hash: inputHash,
  };
  return deepFreeze({
    schema_version: 1,
    decision_id: `decision_${sha256(decisionContent)}`,
    ...decisionContent,
  }) as CandidateDecision;
}

export function createDispatchPacket(input: {
  cycle_id: string;
  decision: CandidateDecision;
  candidate: Candidate;
  facts: MechanicalFacts;
  generated_at: string;
  expires_at: string;
}): Readonly<DispatchPacket> {
  if (input.candidate.tier !== 'T2' && input.candidate.tier !== 'T3') {
    throw new Error('T1_DISPATCH_PACKET_STRUCTURALLY_FORBIDDEN');
  }
  if (!/^UTV2-[0-9]+$/.test(input.candidate.issue_id)) {
    throw new Error('DISPATCH_PACKET_ISSUE_ID_INVALID');
  }
  if (input.candidate.file_scope.length === 0) {
    throw new Error('DISPATCH_PACKET_FILE_SCOPE_REQUIRED');
  }
  if (
    !Number.isFinite(Date.parse(input.generated_at)) ||
    !Number.isFinite(Date.parse(input.expires_at)) ||
    Date.parse(input.expires_at) <= Date.parse(input.generated_at)
  ) {
    throw new Error('DISPATCH_PACKET_EXPIRY_INVALID');
  }
  if (!input.decision.packet_eligible || input.decision.mode === 'halted') {
    throw new Error('DISPATCH_PACKET_REQUIRES_ELIGIBLE_DECISION');
  }
  const protectedCheck = input.facts.protected_file_expansion;
  if (protectedCheck.detected) {
    throw new Error('DISPATCH_PACKET_SENSITIVE_PATH_REFUSED');
  }
  const dryRun = input.decision.action !== 'dispatch';
  const content = {
    schema_version: 1 as const,
    issue_id: input.candidate.issue_id,
    tier: input.candidate.tier,
    executor: input.candidate.executor,
    mode_at_dispatch: input.decision.mode,
    generated_at: input.generated_at,
    expires_at: input.expires_at,
    file_scope_lock: [...input.candidate.file_scope].sort(),
    sensitive_path_check: {
      passed: true,
      checked_against:
        'docs/05_operations/DELEGATION_POLICY.md#sensitive-path-matrix' as const,
      checked_at: input.generated_at,
      matched_paths: [] as string[],
    },
    dispatch_reason: input.decision.reason_codes.join(','),
    idempotency_key: `${input.candidate.issue_id}:lane-start:${input.cycle_id}`,
    kill_switch_check: {
      checked_at: input.generated_at,
      halted: false as const,
    },
    dry_run: dryRun,
  };
  const digest = sha256(content);
  return deepFreeze({
    ...content,
    packet_id: `packet_${digest}`,
    content_sha256: digest,
  });
}

export function runKernelCycle(
  store: FileAutonomyStore,
  input: KernelInput,
): KernelResult {
  let state;
  try {
    state = store.readState();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'AUTONOMY_STATE_MISSING_FAIL_CLOSED'
    ) {
      state = store.initialize(input.now, input.policy.heartbeat_ttl_seconds);
    } else {
      return failClosedStateResult();
    }
  }

  if (!store.verifyEventChain()) {
    store.engageKernelAutoHalt(input.now, 'audit_integrity_failure');
    return failClosedStateResult();
  }

  if (input.policy.owner_halt && state.mode !== 'halted') {
    state = store.engageOwnerHalt(
      input.now,
      input.policy.owner_halt_reason ?? 'owner_kill_switch',
    );
  }
  if (state.mode !== input.policy.mode) {
    return failureResult('PERSISTED_MODE_MISMATCH', 'escalation');
  }
  if (state.halted || input.policy.mode === 'halted') {
    store.appendAudit({
      event_type: 'kill_switch_confirmed_halted',
      phase: 'info',
      actor: 'kernel',
      mode: 'halted',
      severity: 'critical',
      issue_id: null,
      idempotency_key: null,
      ts: input.now,
      detail: { reason: state.halted_reason ?? 'fail_closed' },
    });
    return {
      ok: true,
      record: null,
      outcome: { kind: 'no_op', reason_codes: ['AUTONOMY_HALTED'] },
      reconciled: false,
    };
  }

  const inputHash = sha256({
    policy: input.policy,
    usage: input.usage,
    candidate: input.candidate,
    facts: input.facts,
  });
  let claim = store.beginCycle({
    cycle_id: input.cycle_id,
    now: input.now,
    expected_mode: input.policy.mode,
    input_hash: inputHash,
  });
  let reconciled = false;
  if (!claim.ok && claim.code === 'RECOVERY_RECONCILIATION_REQUIRED') {
    if (!input.recovery_truth) {
      return failureResult('RECOVERY_RECONCILIATION_REQUIRED', 'escalation');
    }
    try {
      store.reconcileStaleCycle(input.now, input.recovery_truth);
    } catch {
      return failureResult('RECOVERY_RECONCILIATION_REQUIRED', 'escalation');
    }
    reconciled = true;
    claim = store.beginCycle({
      cycle_id: input.cycle_id,
      now: input.now,
      expected_mode: input.policy.mode,
      input_hash: inputHash,
    });
  }
  if (!claim.ok) {
    const kind =
      claim.code === 'ACTIVE_CYCLE_CONFLICT' ? 'blocked' : 'escalation';
    return failureResult(claim.code, kind);
  }

  store.appendAudit({
    event_type: 'kill_switch_checked',
    phase: 'info',
    actor: 'kernel',
    mode: input.policy.mode,
    severity: 'info',
    issue_id: null,
    idempotency_key: null,
    ts: input.now,
    detail: { halted: false, cycle_id: input.cycle_id },
  });
  store.transitionCycle(input.cycle_id, 'gating', input.now);

  if (input.candidate && !input.facts) {
    const outcome: StructuredOutcome = {
      kind: 'escalation',
      reason_codes: ['MECHANICAL_FACTS_REQUIRED_FOR_CANDIDATE'],
    };
    store.recordOutcome(input.cycle_id, outcome, input.now);
    store.transitionCycle(input.cycle_id, 'idle', input.now);
    store.appendCycleCompleted(
      input.cycle_id,
      input.policy.mode,
      outcome,
      input.now,
    );
    return {
      ok: true,
      record: store.readRecord(input.cycle_id),
      outcome,
      reconciled,
    };
  }

  store.transitionCycle(input.cycle_id, 'selecting', input.now);
  if (!input.candidate) {
    return completeFromSelecting(
      store,
      input,
      {
        kind: 'no_op',
        reason_codes: ['NO_CANDIDATE'],
      },
      reconciled,
    );
  }

  const facts = input.facts;
  if (!facts) throw new Error('UNREACHABLE_MECHANICAL_FACTS_STATE');
  const decision = evaluateCandidate(
    input.candidate,
    facts,
    input.policy,
    input.usage,
    input.now,
  );
  store.recordDecision(input.cycle_id, decision, input.now);
  store.appendAudit({
    event_type: 'candidate_selected',
    phase: 'info',
    actor: 'kernel',
    mode: input.policy.mode,
    severity: 'info',
    issue_id: input.candidate.issue_id,
    idempotency_key: null,
    ts: input.now,
    detail: {
      decision_id: decision.decision_id,
      action: decision.action,
      reason_codes: decision.reason_codes,
    },
  });

  if (!decision.packet_eligible) {
    return completeFromSelecting(
      store,
      input,
      outcomeForDecision(decision),
      reconciled,
    );
  }

  const latestState = store.readState();
  if (latestState.halted) {
    return completeFromSelecting(
      store,
      input,
      { kind: 'blocked', reason_codes: ['KILL_SWITCH_ENGAGED'] },
      reconciled,
    );
  }
  const packet = createDispatchPacket({
    cycle_id: input.cycle_id,
    decision,
    candidate: input.candidate,
    facts,
    generated_at: input.now,
    expires_at: input.packet_expires_at,
  });
  store.transitionCycle(
    input.cycle_id,
    packet.dry_run ? 'shadow_evaluating' : 'dispatching',
    input.now,
  );
  if (!packet.dry_run) store.markDispatchIntent(packet, input.now);
  store.writePacket(packet);
  store.markDispatchOutcome(packet, input.now);
  const outcome: StructuredOutcome = {
    kind: decision.action === 'dispatch' ? 'dispatch' : 'queue',
    reason_codes:
      decision.action === 'dispatch'
        ? ['IMMUTABLE_PACKET_READY']
        : decision.reason_codes,
    packet_id: packet.packet_id,
  };
  store.transitionCycle(input.cycle_id, 'reporting', input.now);
  return completeFromReporting(store, input, outcome, reconciled);
}

function completeFromSelecting(
  store: FileAutonomyStore,
  input: KernelInput,
  outcome: StructuredOutcome,
  reconciled: boolean,
): KernelResult {
  store.transitionCycle(input.cycle_id, 'reporting', input.now);
  return completeFromReporting(store, input, outcome, reconciled);
}

function completeFromReporting(
  store: FileAutonomyStore,
  input: KernelInput,
  outcome: StructuredOutcome,
  reconciled: boolean,
): KernelResult {
  store.recordOutcome(input.cycle_id, outcome, input.now);
  store.transitionCycle(input.cycle_id, 'cooling_down', input.now);
  store.transitionCycle(input.cycle_id, 'idle', input.now);
  store.appendCycleCompleted(
    input.cycle_id,
    input.policy.mode,
    outcome,
    input.now,
  );
  return {
    ok: true,
    record: store.readRecord(input.cycle_id),
    outcome,
    reconciled,
  };
}

function outcomeForDecision(decision: CandidateDecision): StructuredOutcome {
  const kind =
    decision.action === 'queue'
      ? 'queue'
      : decision.action === 'blocked'
        ? 'blocked'
        : decision.action === 'dispatch'
          ? 'dispatch'
          : 'escalation';
  return { kind, reason_codes: decision.reason_codes };
}

function failureResult(
  code:
    | 'ACTIVE_CYCLE_CONFLICT'
    | 'RECOVERY_RECONCILIATION_REQUIRED'
    | 'PERSISTED_MODE_MISMATCH',
  kind: 'blocked' | 'escalation',
): KernelResult {
  return {
    ok: false,
    code,
    outcome: { kind, reason_codes: [code] },
  };
}

function failClosedStateResult(): KernelResult {
  return {
    ok: false,
    code: 'AUTONOMY_STATE_FAIL_CLOSED',
    outcome: {
      kind: 'escalation',
      reason_codes: ['AUTONOMY_STATE_FAIL_CLOSED'],
    },
  };
}

export function serializeKernelResult(result: KernelResult): string {
  return `${canonicalJson(result)}\n`;
}
