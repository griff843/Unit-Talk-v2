#!/usr/bin/env tsx
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type AutonomyMode,
  type AutonomyPolicy,
  type Candidate,
  type MechanicalFacts,
  type StructuredOutcome,
} from './contracts.js';
import { runKernelCycle } from './kernel.js';
import { CONTRACT_MAXIMA, resolvePolicy } from './policy.js';
import { FileAutonomyStore } from './store.js';

const NOW = '2026-07-23T18:00:00.000Z';
const LATER = '2026-07-23T18:10:00.000Z';
const HEAD = 'a'.repeat(40);

function policy(mode: AutonomyMode): AutonomyPolicy {
  return {
    schema_version: 1,
    mode,
    owner_halt: false,
    owner_halt_reason: null,
    heartbeat_ttl_seconds: CONTRACT_MAXIMA.heartbeat_ttl_seconds,
    ceilings: {
      max_cycles: 1,
      max_duration_ms: CONTRACT_MAXIMA.max_duration_ms,
      max_operation_duration_ms: CONTRACT_MAXIMA.max_operation_duration_ms,
      max_dispatches_per_cycle: CONTRACT_MAXIMA.max_dispatches_per_cycle,
      max_merges_per_cycle: CONTRACT_MAXIMA.max_merges_per_cycle,
      max_retries_per_operation: CONTRACT_MAXIMA.max_retries_per_operation,
      max_token_budget: 100_000,
      max_cost_micros: 1_000_000,
    },
  };
}

const CANDIDATE: Candidate = {
  issue_id: 'UTV2-1578',
  tier: 'T3',
  branch: 'codex/utv2-1578-autonomy-control-plane-kernel',
  base_branch: 'main',
  executor: 'codex-cli',
  file_scope: ['schemas/autonomy/**', 'scripts/autonomy/**'],
};

function facts(overrides: Partial<MechanicalFacts> = {}): MechanicalFacts {
  return {
    head_sha: HEAD,
    observed_at: NOW,
    checks: [
      {
        name: 'Verify',
        required: true,
        status: 'completed',
        conclusion: 'success',
        sha: HEAD,
      },
    ],
    executor_result: {
      required: false,
      present: false,
      status: null,
      head_sha: null,
      expires_at: null,
      authenticated: false,
    },
    pm_verdict: {
      required: false,
      present: false,
      status: null,
      head_sha: null,
      expires_at: null,
      authenticated: false,
    },
    scope_override: {
      required: false,
      present: false,
      status: null,
      head_sha: null,
      expires_at: null,
      authenticated: false,
    },
    unresolved_review_threads: 0,
    required_labels: ['tier:T3'],
    labels: ['tier:T3'],
    behind_by: 0,
    merge_conflicts: false,
    locks_and_leases: [],
    current_session_id: 'proof-stable-session',
    protected_file_expansion: {
      detected: false,
      paths: [],
      authorized: false,
      authenticated: false,
    },
    environment: { required: false, approved: false, state: 'unknown' },
    github_mergeable: 'MERGEABLE',
    github_merge_state_status: 'CLEAN',
    ...overrides,
  };
}

function promote(store: FileAutonomyStore, mode: AutonomyMode): void {
  store.initialize(NOW);
  if (mode === 'halted') return;
  store.setModeByOwner('shadow', NOW, 'proof_owner_promotion');
  if (mode === 'shadow') return;
  store.setModeByOwner('t3_live', NOW, 'proof_owner_promotion');
  if (mode === 't2t3_live') {
    store.setModeByOwner('t2t3_live', NOW, 'proof_owner_promotion');
  }
}

function executeScenario(
  root: string,
  cycleId: string,
  mode: AutonomyMode,
  candidate: Candidate | null,
  mechanicalFacts: MechanicalFacts | null,
  retries = 0,
): {
  outcome: StructuredOutcome;
  final_cycle_state: string;
  event_chain_valid: boolean;
  packet_integrity_valid: boolean;
} {
  const store = new FileAutonomyStore(path.join(root, cycleId));
  promote(store, mode);
  const result = runKernelCycle(store, {
    cycle_id: cycleId,
    now: NOW,
    packet_expires_at: LATER,
    policy: policy(mode),
    usage: {
      cycles: 0,
      elapsed_ms: 0,
      operation_elapsed_ms: 0,
      retries_for_operation: retries,
      tokens_used: 0,
      cost_micros: 0,
      dispatches: 0,
      merges: 0,
    },
    candidate,
    facts: mechanicalFacts,
  });
  if (!result.ok) throw new Error(`${cycleId}:${result.code}`);
  if (result.outcome.packet_id) store.readPacket(result.outcome.packet_id);
  return {
    outcome: result.outcome,
    final_cycle_state: store.readState().cycle_state,
    event_chain_valid: store.verifyEventChain(),
    packet_integrity_valid: result.outcome.packet_id
      ? Boolean(store.readPacket(result.outcome.packet_id))
      : true,
  };
}

export function runRuntimeProof(): Record<string, unknown> {
  const proofRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'utv2-1578-runtime-proof-'),
  );
  try {
    const failClosed = resolvePolicy({});
    const scenarios = {
      no_op: executeScenario(proofRoot, 'proof-noop', 't3_live', null, null),
      queue: executeScenario(
        proofRoot,
        'proof-queue',
        'shadow',
        CANDIDATE,
        facts(),
      ),
      dispatch: executeScenario(
        proofRoot,
        'proof-dispatch',
        't3_live',
        CANDIDATE,
        facts(),
      ),
      blocked: executeScenario(
        proofRoot,
        'proof-blocked',
        't3_live',
        CANDIDATE,
        facts({ merge_conflicts: true }),
      ),
      escalation: executeScenario(
        proofRoot,
        'proof-escalation',
        't3_live',
        CANDIDATE,
        facts(),
        2,
      ),
    };
    const expected: Record<string, StructuredOutcome['kind']> = {
      no_op: 'no_op',
      queue: 'queue',
      dispatch: 'dispatch',
      blocked: 'blocked',
      escalation: 'escalation',
    };
    const outcomeKindsValid = Object.entries(scenarios).every(
      ([name, scenario]) => scenario.outcome.kind === expected[name],
    );
    const logsValid = Object.values(scenarios).every(
      (scenario) => scenario.event_chain_valid,
    );
    const packetsValid = Object.values(scenarios).every(
      (scenario) => scenario.packet_integrity_valid,
    );
    const cyclesIdle = Object.values(scenarios).every(
      (scenario) => scenario.final_cycle_state === 'idle',
    );
    const verdict =
      failClosed.policy.mode === 'halted' &&
      !failClosed.valid &&
      outcomeKindsValid &&
      logsValid &&
      packetsValid &&
      cyclesIdle
        ? 'PASS'
        : 'FAIL';
    return {
      schema_version: 1,
      issue_id: 'UTV2-1578',
      proof: 'autonomy-kernel-runtime',
      run_at: new Date().toISOString(),
      contract_source:
        'AUT-1 PR #1302 head 43257000a016fc3bc96d9fde51a86d5d0be4d4d5',
      fail_closed_default: {
        mode: failClosed.policy.mode,
        valid: failClosed.valid,
        reason_codes: failClosed.reason_codes,
      },
      scenarios,
      outcome_kinds_valid: outcomeKindsValid,
      event_chains_valid: logsValid,
      dispatch_packets_valid: packetsValid,
      cycles_returned_idle: cyclesIdle,
      t1_packet_tier_representable: false,
      verdict,
    };
  } finally {
    fs.rmSync(proofRoot, { recursive: true, force: true });
  }
}

function main(): void {
  const proof = runRuntimeProof();
  const outputFlagIndex = process.argv.indexOf('--output');
  if (outputFlagIndex >= 0) {
    const outputPath = process.argv[outputFlagIndex + 1];
    if (!outputPath) throw new Error('RUNTIME_PROOF_OUTPUT_PATH_REQUIRED');
    const resolved = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
  if (proof['verdict'] !== 'PASS') process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
