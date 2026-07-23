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
  sha256,
  type StructuredOutcome,
  type UsageSnapshot,
} from './contracts.js';
import { evaluateCeilings } from './policy.js';
import { isTerminal } from './state-machine.js';
import { FileAutonomyStore } from './store.js';

export interface KernelInput {
  run_id: string;
  session_id: string;
  now: string;
  lease_expires_at: string;
  policy: AutonomyPolicy;
  usage: UsageSnapshot;
  candidate: Candidate | null;
  facts: MechanicalFacts | null;
}

export type KernelResult =
  | {
      ok: true;
      record: ExecutionRecord;
      outcome: StructuredOutcome;
      resumed: boolean;
    }
  | {
      ok: false;
      outcome: StructuredOutcome;
      code:
        | 'ACTIVE_RUN_CONFLICT'
        | 'EXPLICIT_RECLAIM_REQUIRED'
        | 'INPUT_DRIFT_ON_RESUME';
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
  } else if (candidate.tier === 'T1') {
    action = 'queue';
    reasonCodes = ['T1_REQUIRES_HUMAN_GOVERNANCE'];
  } else if (policy.mode === 'shadow') {
    action = 'queue';
    reasonCodes = ['SHADOW_MODE_NO_LIVE_DISPATCH'];
  } else if (policy.mode === 't3-live' && candidate.tier !== 'T3') {
    action = 'queue';
    reasonCodes = ['MODE_DOES_NOT_AUTHORIZE_TIER'];
  } else {
    action = 'dispatch';
    reasonCodes = ['MECHANICALLY_DISPATCHABLE'];
  }

  reasonCodes = [...new Set(reasonCodes)].sort();
  const decisionContent = {
    candidate_id: candidate.issue_id,
    evaluated_at: evaluatedAt,
    mode: policy.mode,
    action,
    dispatchable: action === 'dispatch',
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

export function createDispatchPacket(
  runId: string,
  decision: CandidateDecision,
  candidate: Candidate,
  createdAt: string,
): Readonly<DispatchPacket> {
  if (!decision.dispatchable || decision.action !== 'dispatch') {
    throw new Error('DISPATCH_PACKET_REQUIRES_DISPATCH_DECISION');
  }
  const content = {
    schema_version: 1 as const,
    run_id: runId,
    decision_id: decision.decision_id,
    candidate: {
      ...candidate,
      file_scope: [...candidate.file_scope].sort(),
    },
    created_at: createdAt,
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
  const inputHash = sha256({
    policy: input.policy,
    usage: input.usage,
    candidate: input.candidate,
    facts: input.facts,
  });
  let record = store.readRecord(input.run_id);
  if (record && record.input_hash !== inputHash) {
    return {
      ok: false,
      code: 'INPUT_DRIFT_ON_RESUME',
      outcome: { kind: 'escalation', reason_codes: ['INPUT_DRIFT_ON_RESUME'] },
    };
  }
  if (record && isTerminal(record.state)) {
    if (!record.outcome) throw new Error('TERMINAL_RECORD_MISSING_OUTCOME');
    return { ok: true, record, outcome: record.outcome, resumed: true };
  }

  const claim = store.claimRun({
    run_id: input.run_id,
    session_id: input.session_id,
    now: input.now,
    expires_at: input.lease_expires_at,
  });
  if (!claim.ok) {
    const reclaim = claim.code === 'explicit_reclaim_required';
    return {
      ok: false,
      code: reclaim ? 'EXPLICIT_RECLAIM_REQUIRED' : 'ACTIVE_RUN_CONFLICT',
      outcome: {
        kind: reclaim ? 'escalation' : 'blocked',
        reason_codes: [
          reclaim ? 'EXPLICIT_RECLAIM_REQUIRED' : 'ACTIVE_RUN_CONFLICT',
        ],
      },
    };
  }

  const resumed = claim.code === 'resumed' && record !== null;
  if (!record) {
    record = {
      schema_version: 1,
      run_id: input.run_id,
      session_id: input.session_id,
      state: 'created',
      input_hash: inputHash,
      created_at: input.now,
      updated_at: input.now,
      cycle: input.usage.cycles,
      retry_count: input.usage.retries_for_candidate,
      transition_sequence: 0,
    };
    store.createRecord(record);
  } else {
    store.appendResumeEvent(input.run_id, input.now);
  }

  if (record.state === 'created') {
    record = transitionRecord(record, 'evaluating', input.now);
    store.transition(input.run_id, record, 'state.transitioned', {});
  }

  if (record.state === 'evaluating') {
    if (!input.candidate) {
      const outcome: StructuredOutcome = {
        kind: 'no_op',
        reason_codes: ['NO_CANDIDATE'],
      };
      record = transitionRecord(record, 'no_op', input.now, { outcome });
      store.transition(input.run_id, record, 'run.completed', { outcome });
      store.releaseRun(input.run_id, input.session_id, input.now);
      return { ok: true, record, outcome, resumed };
    }
    if (!input.facts)
      throw new Error('MECHANICAL_FACTS_REQUIRED_FOR_CANDIDATE');
    const decision = evaluateCandidate(
      input.candidate,
      input.facts,
      input.policy,
      input.usage,
      input.now,
    );
    if (decision.action !== 'dispatch') {
      const outcome = outcomeForDecision(decision);
      const state =
        decision.action === 'queue'
          ? 'queued'
          : decision.action === 'blocked'
            ? 'blocked'
            : 'escalated';
      record = transitionRecord(record, state, input.now, {
        decision,
        outcome,
      });
      store.transition(input.run_id, record, 'run.completed', {
        decision_id: decision.decision_id,
        outcome,
      });
      store.releaseRun(input.run_id, input.session_id, input.now);
      return { ok: true, record, outcome, resumed };
    }
    const packet = createDispatchPacket(
      input.run_id,
      decision,
      input.candidate,
      input.now,
    );
    store.writePacket(packet);
    record = transitionRecord(record, 'packet_ready', input.now, {
      decision,
      packet_id: packet.packet_id,
    });
    store.transition(input.run_id, record, 'packet.created', {
      decision_id: decision.decision_id,
      packet_id: packet.packet_id,
    });
  }

  if (record.state === 'packet_ready') {
    if (!record.packet_id)
      throw new Error('PACKET_READY_RECORD_MISSING_PACKET');
    store.readPacket(record.packet_id);
    record = transitionRecord(record, 'dispatching', input.now);
    store.transition(input.run_id, record, 'state.transitioned', {
      packet_id: record.packet_id,
    });
  }

  if (record.state !== 'dispatching' || !record.packet_id) {
    throw new Error(`UNRESUMABLE_EXECUTION_STATE:${record.state}`);
  }
  store.readPacket(record.packet_id);
  const outcome: StructuredOutcome = {
    kind: 'dispatch',
    reason_codes: ['IMMUTABLE_PACKET_READY'],
    packet_id: record.packet_id,
  };
  record = transitionRecord(record, 'dispatched', input.now, { outcome });
  store.transition(input.run_id, record, 'run.completed', { outcome });
  store.releaseRun(input.run_id, input.session_id, input.now);
  return { ok: true, record, outcome, resumed };
}

function outcomeForDecision(decision: CandidateDecision): StructuredOutcome {
  const kind =
    decision.action === 'queue'
      ? 'queue'
      : decision.action === 'blocked'
        ? 'blocked'
        : 'escalation';
  return { kind, reason_codes: decision.reason_codes };
}

function transitionRecord(
  record: ExecutionRecord,
  state: ExecutionRecord['state'],
  updatedAt: string,
  patch: Partial<ExecutionRecord> = {},
): ExecutionRecord {
  return {
    ...record,
    ...patch,
    state,
    updated_at: updatedAt,
    transition_sequence: record.transition_sequence + 1,
  };
}

export function serializeKernelResult(result: KernelResult): string {
  return `${canonicalJson(result)}\n`;
}
