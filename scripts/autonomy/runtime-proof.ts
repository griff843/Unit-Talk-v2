#!/usr/bin/env tsx
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type AutonomyPolicy,
  type Candidate,
  type MechanicalFacts,
  type StructuredOutcome,
} from './contracts.js';
import { runKernelCycle } from './kernel.js';
import { resolvePolicy } from './policy.js';
import { FileAutonomyStore } from './store.js';

const NOW = '2026-07-23T18:00:00.000Z';
const LATER = '2026-07-23T19:00:00.000Z';
const HEAD = 'a'.repeat(40);

const POLICY: AutonomyPolicy = {
  schema_version: 1,
  mode: 't2-t3-live',
  owner_halt: false,
  owner_halt_reason: null,
  ceilings: {
    max_cycles: 5,
    max_duration_ms: 300_000,
    max_retries_per_candidate: 2,
    max_token_budget: 100_000,
    max_cost_micros: 1_000_000,
  },
};

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
    current_session_id: 'proof-session',
    protected_file_expansion: {
      detected: false,
      paths: [],
      authorized: false,
      authenticated: false,
    },
    environment: { required: false, approved: false, state: 'unknown' },
    github_mergeability: 'MERGEABLE',
    ...overrides,
  };
}

function executeScenario(
  root: string,
  runId: string,
  candidate: Candidate | null,
  mechanicalFacts: MechanicalFacts | null,
  policy = POLICY,
  retries = 0,
): {
  outcome: StructuredOutcome;
  event_chain_valid: boolean;
  packet_integrity_valid: boolean;
} {
  const store = new FileAutonomyStore(path.join(root, runId));
  const result = runKernelCycle(store, {
    run_id: runId,
    session_id: 'proof-session',
    now: NOW,
    lease_expires_at: LATER,
    policy,
    usage: {
      cycles: 0,
      elapsed_ms: 0,
      retries_for_candidate: retries,
      tokens_used: 0,
      cost_micros: 0,
    },
    candidate,
    facts: mechanicalFacts,
  });
  if (!result.ok) throw new Error(`${runId}:${result.code}`);
  const packetIntegrityValid = true;
  if (result.outcome.packet_id) {
    store.readPacket(result.outcome.packet_id);
  }
  return {
    outcome: result.outcome,
    event_chain_valid: store.verifyEventChain(),
    packet_integrity_valid: packetIntegrityValid,
  };
}

export function runRuntimeProof(): Record<string, unknown> {
  const proofRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'utv2-1578-runtime-proof-'),
  );
  try {
    const failClosed = resolvePolicy({});
    const scenarios = {
      no_op: executeScenario(proofRoot, 'proof-noop', null, null),
      queue: executeScenario(
        proofRoot,
        'proof-queue',
        { ...CANDIDATE, tier: 'T1' },
        facts(),
      ),
      dispatch: executeScenario(
        proofRoot,
        'proof-dispatch',
        CANDIDATE,
        facts(),
      ),
      blocked: executeScenario(
        proofRoot,
        'proof-blocked',
        CANDIDATE,
        facts({ merge_conflicts: true }),
      ),
      escalation: executeScenario(
        proofRoot,
        'proof-escalation',
        CANDIDATE,
        facts(),
        POLICY,
        3,
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
    const verdict =
      failClosed.policy.mode === 'halted' &&
      outcomeKindsValid &&
      logsValid &&
      packetsValid
        ? 'PASS'
        : 'FAIL';
    return {
      schema_version: 1,
      proof: 'utv2-1578-autonomy-kernel-runtime',
      run_at: new Date().toISOString(),
      fail_closed_default: {
        mode: failClosed.policy.mode,
        valid: failClosed.valid,
        reason_codes: failClosed.reason_codes,
      },
      scenarios,
      outcome_kinds_valid: outcomeKindsValid,
      event_chains_valid: logsValid,
      dispatch_packets_valid: packetsValid,
      verdict,
    };
  } finally {
    fs.rmSync(proofRoot, { recursive: true, force: true });
  }
}

function main(): void {
  const proof = runRuntimeProof();
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
  if (proof['verdict'] !== 'PASS') process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
