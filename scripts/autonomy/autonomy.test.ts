import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { classifyBlockers } from './blocker-classifier.js';
import {
  type AutonomyMode,
  type AutonomyPolicy,
  type Candidate,
  type CheckFact,
  type EvidenceFact,
  type MechanicalFacts,
  type UsageSnapshot,
} from './contracts.js';
import {
  createDispatchPacket,
  evaluateCandidate,
  runKernelCycle,
} from './kernel.js';
import { CONTRACT_MAXIMA, evaluateCeilings, resolvePolicy } from './policy.js';
import {
  ALLOWED_CYCLE_TRANSITIONS,
  assertCycleTransition,
  canTransitionCycle,
} from './state-machine.js';
import { FileAutonomyStore } from './store.js';

const NOW = '2026-07-23T18:00:00.000Z';
const LATER = '2026-07-23T18:10:00.000Z';
const EXPIRED = '2026-07-23T17:00:00.000Z';
const AFTER_TTL = '2026-07-23T18:20:00.000Z';
const HEAD = 'a'.repeat(40);
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

function policy(mode: AutonomyMode = 't2t3_live'): AutonomyPolicy {
  return {
    schema_version: 1,
    mode,
    owner_halt: mode === 'halted',
    owner_halt_reason: mode === 'halted' ? 'owner_kill_switch' : null,
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

const USAGE: UsageSnapshot = {
  cycles: 0,
  elapsed_ms: 0,
  operation_elapsed_ms: 0,
  retries_for_operation: 0,
  tokens_used: 0,
  cost_micros: 0,
  dispatches: 0,
  merges: 0,
};

const CANDIDATE: Candidate = {
  issue_id: 'UTV2-2000',
  tier: 'T3',
  branch: 'codex/utv2-2000',
  base_branch: 'main',
  executor: 'codex-cli',
  file_scope: ['scripts/example/**'],
};

function evidence(required = false): EvidenceFact {
  return {
    required,
    present: required,
    status: required ? 'valid' : null,
    head_sha: required ? HEAD : null,
    expires_at: required ? LATER : null,
    authenticated: required,
  };
}

function passingCheck(name: string, required = true): CheckFact {
  return {
    name,
    required,
    status: 'completed',
    conclusion: 'success',
    sha: HEAD,
  };
}

function cleanFacts(overrides: Partial<MechanicalFacts> = {}): MechanicalFacts {
  return {
    head_sha: HEAD,
    observed_at: NOW,
    checks: [passingCheck('Verify')],
    executor_result: evidence(false),
    pm_verdict: evidence(false),
    scope_override: evidence(false),
    unresolved_review_threads: 0,
    required_labels: ['tier:T3'],
    labels: ['tier:T3'],
    behind_by: 0,
    merge_conflicts: false,
    locks_and_leases: [],
    current_session_id: 'stable-session',
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

function withTempStore<T>(
  mode: AutonomyMode,
  callback: (store: FileAutonomyStore, root: string) => T,
): T {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-autonomy-test-'));
  try {
    const store = new FileAutonomyStore(root);
    store.initialize(NOW);
    promoteStore(store, mode);
    return callback(store, root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function promoteStore(store: FileAutonomyStore, mode: AutonomyMode): void {
  if (mode === 'halted') return;
  store.setModeByOwner('shadow', NOW, 'owner_promotion');
  if (mode === 'shadow') return;
  store.setModeByOwner('t3_live', NOW, 'owner_promotion');
  if (mode === 't2t3_live') {
    store.setModeByOwner('t2t3_live', NOW, 'owner_promotion');
  }
}

function kernelInput(
  cycleId: string,
  mode: AutonomyMode,
  candidate: Candidate | null,
  facts: MechanicalFacts | null,
) {
  return {
    cycle_id: cycleId,
    now: NOW,
    packet_expires_at: LATER,
    policy: policy(mode),
    usage: USAGE,
    candidate,
    facts,
  };
}

test('missing or invalid configuration fails closed and canonical defaults cannot be loosened', () => {
  const missing = resolvePolicy({});
  assert.equal(missing.valid, false);
  assert.equal(missing.policy.mode, 'halted');
  assert.equal(missing.policy.owner_halt, true);
  assert.deepEqual(missing.reason_codes, [
    'AUTONOMY_CEILINGS_MISSING',
    'AUTONOMY_MODE_MISSING',
    'OWNER_HALT_SIGNAL_MISSING',
  ]);

  const loosened = resolvePolicy({
    mode: 't2t3_live',
    owner_halt: false,
    ceilings: {
      ...policy().ceilings,
      max_dispatches_per_cycle: 3,
    },
  });
  assert.equal(loosened.valid, false);
  assert.equal(loosened.policy.mode, 'halted');
  assert.ok(loosened.reason_codes.includes('MAX_DISPATCHES_INVALID'));

  const looseHeartbeat = resolvePolicy({
    mode: 't3_live',
    owner_halt: false,
    heartbeat_ttl_seconds: CONTRACT_MAXIMA.heartbeat_ttl_seconds + 1,
    ceilings: policy().ceilings,
  });
  assert.equal(looseHeartbeat.valid, false);
  assert.equal(looseHeartbeat.policy.mode, 'halted');
  assert.equal(
    looseHeartbeat.policy.heartbeat_ttl_seconds,
    CONTRACT_MAXIMA.heartbeat_ttl_seconds,
  );
  assert.ok(looseHeartbeat.reason_codes.includes('HEARTBEAT_TTL_INVALID'));
});

test('mode changes require staged owner transitions and owner halt wins', () => {
  withTempStore('halted', (store) => {
    assert.throws(
      () => store.setModeByOwner('t3_live', NOW, 'skip_shadow'),
      /INVALID_OWNER_MODE_TRANSITION/,
    );
    store.setModeByOwner('shadow', NOW, 'owner_promotion');
    store.setModeByOwner('t3_live', NOW, 'owner_promotion');
    const halted = store.engageOwnerHalt(NOW, 'owner_kill_switch');
    assert.equal(halted.mode, 'halted');
    assert.equal(halted.halted, true);
    assert.equal(halted.halted_reason, 'owner_kill_switch');
  });
});

test('cycle, duration, retry, dispatch, merge, token, and cost ceilings are exact', () => {
  assert.deepEqual(
    evaluateCeilings(policy().ceilings, {
      cycles: 1,
      elapsed_ms: CONTRACT_MAXIMA.max_duration_ms,
      operation_elapsed_ms: CONTRACT_MAXIMA.max_operation_duration_ms,
      retries_for_operation: 2,
      tokens_used: 100_000,
      cost_micros: 1_000_000,
      dispatches: 2,
      merges: 3,
    }),
    [
      'MAX_COST_REACHED',
      'MAX_CYCLES_REACHED',
      'MAX_DISPATCHES_REACHED',
      'MAX_DURATION_REACHED',
      'MAX_MERGES_REACHED',
      'MAX_OPERATION_DURATION_REACHED',
      'MAX_RETRIES_EXCEEDED',
      'MAX_TOKEN_BUDGET_REACHED',
    ],
  );
  assert.deepEqual(evaluateCeilings(policy().ceilings, USAGE), []);
});

test('advisory workflow failures and GitHub UNSTABLE remain non-blocking', () => {
  const result = classifyBlockers(
    cleanFacts({
      checks: [
        passingCheck('Verify'),
        {
          name: 'Optional Preview',
          required: false,
          status: 'completed',
          conclusion: 'failure',
          sha: HEAD,
        },
      ],
      github_merge_state_status: 'UNSTABLE',
    }),
  );
  assert.equal(result.mechanically_dispatchable, true);
  assert.deepEqual(result.blocking, []);
  assert.deepEqual(
    result.advisories.map((entry) => entry.code),
    ['ADVISORY_WORKFLOW_FAILURE', 'GITHUB_UNSTABLE_ADVISORY_ONLY'],
  );
});

test('blocker classifier emits the exact required taxonomy', () => {
  const staleEvidence: EvidenceFact = {
    required: true,
    present: true,
    status: 'valid',
    head_sha: 'b'.repeat(40),
    expires_at: LATER,
    authenticated: true,
  };
  const cases: Array<{ name: string; facts: MechanicalFacts; code: string }> = [
    {
      name: 'required checks',
      facts: cleanFacts({
        checks: [{ ...passingCheck('Verify'), conclusion: 'failure' }],
      }),
      code: 'REQUIRED_CHECK_NOT_PASSING',
    },
    {
      name: 'stale executor results',
      facts: cleanFacts({ executor_result: staleEvidence }),
      code: 'STALE_EXECUTOR_RESULT',
    },
    {
      name: 'stale PM verdicts',
      facts: cleanFacts({
        pm_verdict: { ...staleEvidence, status: 'approved' },
      }),
      code: 'STALE_PM_VERDICT',
    },
    {
      name: 'stale scope overrides',
      facts: cleanFacts({ scope_override: staleEvidence }),
      code: 'STALE_SCOPE_OVERRIDE',
    },
    {
      name: 'unresolved review threads',
      facts: cleanFacts({ unresolved_review_threads: 1 }),
      code: 'UNRESOLVED_REVIEW_THREADS',
    },
    {
      name: 'missing labels',
      facts: cleanFacts({ required_labels: ['tier:T3', 'proof:valid'] }),
      code: 'MISSING_REQUIRED_LABEL',
    },
    {
      name: 'branch behind base',
      facts: cleanFacts({ behind_by: 1 }),
      code: 'BRANCH_BEHIND_BASE',
    },
    {
      name: 'merge conflicts',
      facts: cleanFacts({ github_mergeable: 'CONFLICTING' }),
      code: 'MERGE_CONFLICTS_PRESENT',
    },
    {
      name: 'active locks and leases',
      facts: cleanFacts({
        locks_and_leases: [
          {
            kind: 'lease',
            resource: 'scripts/autonomy/**',
            status: 'active',
            owner_session_id: 'other-stable-session',
            expires_at: LATER,
          },
        ],
      }),
      code: 'ACTIVE_LOCK_OR_LEASE',
    },
    {
      name: 'protected-file expansion',
      facts: cleanFacts({
        protected_file_expansion: {
          detected: true,
          paths: ['packages/contracts/src/submission.ts'],
          authorized: false,
          authenticated: false,
        },
      }),
      code: 'PROTECTED_FILE_EXPANSION_UNAUTHORIZED',
    },
    {
      name: 'protected-file expansion cannot be overridden',
      facts: cleanFacts({
        protected_file_expansion: {
          detected: true,
          paths: ['packages/contracts/src/submission.ts'],
          authorized: true,
          authenticated: true,
        },
      }),
      code: 'PROTECTED_FILE_EXPANSION_FORBIDDEN',
    },
    {
      name: 'environment approval',
      facts: cleanFacts({
        environment: { required: true, approved: false, state: 'pending' },
      }),
      code: 'ENVIRONMENT_APPROVAL_REQUIRED',
    },
    {
      name: 'GitHub mergeability',
      facts: cleanFacts({ github_mergeable: 'UNKNOWN' }),
      code: 'GITHUB_MERGEABILITY_UNKNOWN',
    },
    {
      name: 'GitHub pre-receive hooks',
      facts: cleanFacts({ github_merge_state_status: 'HAS_HOOKS' }),
      code: 'GITHUB_MERGEABILITY_NOT_READY',
    },
  ];
  for (const fixture of cases) {
    const result = classifyBlockers(fixture.facts);
    assert.equal(result.mechanically_dispatchable, false, fixture.name);
    assert.ok(
      result.blocking.some((entry) => entry.code === fixture.code),
      `${fixture.name}: ${fixture.code}`,
    );
  }
});

test('stable-session lock ownership never depends on short-lived process IDs', () => {
  const ownLease = classifyBlockers(
    cleanFacts({
      locks_and_leases: [
        {
          kind: 'lock',
          resource: 'merge',
          status: 'active',
          owner_session_id: 'stable-session',
          expires_at: LATER,
        },
      ],
    }),
  );
  assert.equal(ownLease.mechanically_dispatchable, true);
  const expiredOwnLease = classifyBlockers(
    cleanFacts({
      locks_and_leases: [
        {
          kind: 'lock',
          resource: 'merge',
          status: 'active',
          owner_session_id: 'stable-session',
          expires_at: EXPIRED,
        },
      ],
    }),
  );
  assert.ok(
    expiredOwnLease.blocking.some(
      (entry) => entry.code === 'EXPIRED_LOCK_OR_LEASE_REQUIRES_RECLAIM',
    ),
  );

  withTempStore('t3_live', (store) => {
    const first = store.beginCycle({
      cycle_id: 'cycle-owner',
      now: NOW,
      expected_mode: 't3_live',
      input_hash: HEAD,
    });
    const fresh = store.beginCycle({
      cycle_id: 'cycle-other',
      now: LATER,
      expected_mode: 't3_live',
      input_hash: HEAD,
    });
    const stale = store.beginCycle({
      cycle_id: 'cycle-other',
      now: AFTER_TTL,
      expected_mode: 't3_live',
      input_hash: HEAD,
    });
    assert.equal(first.ok, true);
    assert.equal(!fresh.ok && fresh.code, 'ACTIVE_CYCLE_CONFLICT');
    assert.equal(!stale.ok && stale.code, 'RECOVERY_RECONCILIATION_REQUIRED');
  });
});

test('a stale exclusive claim is reclaimed by timestamp without PID liveness', () => {
  withTempStore('t3_live', (store, root) => {
    fs.writeFileSync(
      path.join(root, 'cycle-claim.lock'),
      `${JSON.stringify({
        schema_version: 1,
        owner_token: 'prior-stable-session',
        acquired_at: EXPIRED,
      })}\n`,
      'utf8',
    );
    const claim = store.beginCycle({
      cycle_id: 'cycle-after-stale-claim',
      now: AFTER_TTL,
      expected_mode: 't3_live',
      input_hash: HEAD,
    });
    assert.equal(claim.ok, true);
    assert.equal(fs.existsSync(path.join(root, 'cycle-claim.lock')), false);
  });
});

test('every canonical cycle-state transition is explicitly accepted or rejected', () => {
  const states = Object.keys(ALLOWED_CYCLE_TRANSITIONS) as Array<
    keyof typeof ALLOWED_CYCLE_TRANSITIONS
  >;
  for (const from of states) {
    for (const to of states) {
      const expected = ALLOWED_CYCLE_TRANSITIONS[from].includes(to);
      assert.equal(canTransitionCycle(from, to), expected, `${from}->${to}`);
      if (expected) assert.doesNotThrow(() => assertCycleTransition(from, to));
      else {
        assert.throws(
          () => assertCycleTransition(from, to),
          /INVALID_AUTONOMY_CYCLE_TRANSITION/,
        );
      }
    }
  }
});

test('candidate decisions enforce halted, shadow, tier, blocker, and ceiling rules', () => {
  const cases = [
    evaluateCandidate(CANDIDATE, cleanFacts(), policy('halted'), USAGE, NOW),
    evaluateCandidate(CANDIDATE, cleanFacts(), policy('shadow'), USAGE, NOW),
    evaluateCandidate(
      { ...CANDIDATE, tier: 'T2' },
      cleanFacts(),
      policy('t3_live'),
      USAGE,
      NOW,
    ),
    evaluateCandidate(CANDIDATE, cleanFacts(), policy('t3_live'), USAGE, NOW),
    evaluateCandidate(
      CANDIDATE,
      cleanFacts({ merge_conflicts: true }),
      policy('t3_live'),
      USAGE,
      NOW,
    ),
    evaluateCandidate(
      CANDIDATE,
      cleanFacts(),
      policy('t3_live'),
      { ...USAGE, cycles: 1 },
      NOW,
    ),
  ];
  assert.deepEqual(
    cases.map((entry) => entry.action),
    ['blocked', 'queue', 'queue', 'dispatch', 'blocked', 'escalation'],
  );
});

test('dispatch packets are deterministic, content-addressed, dry-run aware, and T1-proof', () => {
  const shadowDecision = evaluateCandidate(
    CANDIDATE,
    cleanFacts(),
    policy('shadow'),
    USAGE,
    NOW,
  );
  const input = {
    cycle_id: 'cycle-packet',
    decision: shadowDecision,
    candidate: { ...CANDIDATE, file_scope: ['z/**', 'a/**'] },
    facts: cleanFacts(),
    generated_at: NOW,
    expires_at: LATER,
  };
  const packetA = createDispatchPacket(input);
  const packetB = createDispatchPacket(input);
  assert.deepEqual(packetA, packetB);
  assert.equal(packetA.dry_run, true);
  assert.deepEqual(packetA.file_scope_lock, ['a/**', 'z/**']);
  assert.equal(packetA.packet_id, `packet_${packetA.content_sha256}`);
  assert.equal(Object.isFrozen(packetA), true);

  assert.throws(
    () =>
      createDispatchPacket({
        ...input,
        candidate: { ...CANDIDATE, tier: 'T1' } as unknown as Candidate,
      }),
    /T1_DISPATCH_PACKET_STRUCTURALLY_FORBIDDEN/,
  );

  assert.throws(
    () =>
      createDispatchPacket({
        ...input,
        facts: cleanFacts({
          protected_file_expansion: {
            detected: true,
            paths: ['packages/contracts/src/submission.ts'],
            authorized: true,
            authenticated: true,
          },
        }),
      }),
    /DISPATCH_PACKET_SENSITIVE_PATH_REFUSED/,
  );
});

test('kernel returns structured no-op, queue, dispatch, blocked, and escalation outcomes', () => {
  const scenarios: Array<{
    mode: AutonomyMode;
    candidate: Candidate | null;
    facts: MechanicalFacts | null;
    usage?: UsageSnapshot;
    expected: string;
  }> = [
    { mode: 't3_live', candidate: null, facts: null, expected: 'no_op' },
    {
      mode: 'shadow',
      candidate: CANDIDATE,
      facts: cleanFacts(),
      expected: 'queue',
    },
    {
      mode: 't3_live',
      candidate: CANDIDATE,
      facts: cleanFacts(),
      expected: 'dispatch',
    },
    {
      mode: 't3_live',
      candidate: CANDIDATE,
      facts: cleanFacts({ merge_conflicts: true }),
      expected: 'blocked',
    },
    {
      mode: 't3_live',
      candidate: CANDIDATE,
      facts: cleanFacts(),
      usage: { ...USAGE, retries_for_operation: 2 },
      expected: 'escalation',
    },
  ];
  scenarios.forEach((scenario, index) => {
    withTempStore(scenario.mode, (store) => {
      const input = kernelInput(
        `cycle-outcome-${index}`,
        scenario.mode,
        scenario.candidate,
        scenario.facts,
      );
      const result = runKernelCycle(store, {
        ...input,
        usage: scenario.usage ?? input.usage,
      });
      assert.equal(result.ok, true);
      assert.equal(result.outcome.kind, scenario.expected);
      assert.equal(store.readState().cycle_state, 'idle');
      assert.equal(store.verifyEventChain(), true);
    });
  });
});

test('durable execution records preserve the canonical transition history', () => {
  withTempStore('t3_live', (store) => {
    const result = runKernelCycle(
      store,
      kernelInput('cycle-record', 't3_live', CANDIDATE, cleanFacts()),
    );
    assert.equal(result.ok, true);
    assert.ok(result.ok && result.record);
    if (!result.ok || !result.record) return;
    assert.deepEqual(
      result.record.transitions.map(({ from, to }) => `${from}->${to}`),
      [
        'idle->waking',
        'waking->gating',
        'gating->selecting',
        'selecting->dispatching',
        'dispatching->reporting',
        'reporting->cooling_down',
        'cooling_down->idle',
      ],
    );
    assert.equal(result.record.outcome?.kind, 'dispatch');
    assert.ok(result.record.packet_id);
  });
});

test('fresh concurrent cycles block and stale cycles never resume their persisted step', () => {
  withTempStore('t3_live', (store) => {
    const started = store.beginCycle({
      cycle_id: 'cycle-crashed',
      now: EXPIRED,
      expected_mode: 't3_live',
      input_hash: HEAD,
    });
    assert.equal(started.ok, true);
    store.transitionCycle('cycle-crashed', 'gating', EXPIRED);

    const recovered = runKernelCycle(store, {
      ...kernelInput('cycle-fresh', 't3_live', null, null),
      recovery_truth: {},
    });
    assert.equal(recovered.ok, true);
    assert.equal(recovered.ok && recovered.reconciled, true);
    assert.deepEqual(
      store
        .readRecord('cycle-crashed')
        ?.transitions.map(({ from, to }) => `${from}->${to}`),
      ['idle->waking', 'waking->gating'],
    );
    assert.equal(store.readRecord('cycle-fresh')?.outcome?.kind, 'no_op');
  });
});

test('stale active dispatches require rank-truth reconciliation before a fresh cycle', () => {
  withTempStore('t3_live', (store) => {
    store.beginCycle({
      cycle_id: 'cycle-active-action',
      now: EXPIRED,
      expected_mode: 't3_live',
      input_hash: HEAD,
    });
    store.transitionCycle('cycle-active-action', 'gating', EXPIRED);
    store.transitionCycle('cycle-active-action', 'selecting', EXPIRED);
    const decision = evaluateCandidate(
      CANDIDATE,
      cleanFacts(),
      policy('t3_live'),
      USAGE,
      EXPIRED,
    );
    const packet = createDispatchPacket({
      cycle_id: 'cycle-active-action',
      decision,
      candidate: CANDIDATE,
      facts: cleanFacts(),
      generated_at: EXPIRED,
      expires_at: NOW,
    });
    store.transitionCycle('cycle-active-action', 'dispatching', EXPIRED);
    store.markDispatchIntent(packet, EXPIRED);

    const blocked = runKernelCycle(
      store,
      kernelInput('cycle-after-crash', 't3_live', null, null),
    );
    assert.equal(blocked.ok, false);
    assert.equal(
      !blocked.ok && blocked.code,
      'RECOVERY_RECONCILIATION_REQUIRED',
    );

    const recovered = runKernelCycle(store, {
      ...kernelInput('cycle-after-crash', 't3_live', null, null),
      recovery_truth: {
        [packet.idempotency_key]: 'confirmed_in_progress_externally_unblocked',
      },
    });
    assert.equal(recovered.ok, true);
    assert.ok(
      store
        .readEvents()
        .some((event) => event.event_type === 'crash_recovery_reconciled'),
    );
  });
});

test('a corrupt execution-state file fails closed instead of assuming the last mode', () => {
  withTempStore('t3_live', (store, root) => {
    fs.writeFileSync(
      path.join(root, 'execution-state.json'),
      '{bad json',
      'utf8',
    );
    const result = runKernelCycle(
      store,
      kernelInput('cycle-corrupt', 't3_live', null, null),
    );
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.code, 'AUTONOMY_STATE_FAIL_CLOSED');
  });
});

test('persisted mode and requested policy must agree before any cycle starts', () => {
  withTempStore('shadow', (store) => {
    const result = runKernelCycle(
      store,
      kernelInput('cycle-mode-drift', 't3_live', null, null),
    );
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.code, 'PERSISTED_MODE_MISMATCH');
    assert.equal(result.outcome.kind, 'escalation');
    assert.equal(store.readState().cycle_state, 'idle');
  });
});

test('kill switch prevents a new dispatch action after a packet decision', () => {
  withTempStore('t3_live', (store) => {
    store.beginCycle({
      cycle_id: 'cycle-halt',
      now: NOW,
      expected_mode: 't3_live',
      input_hash: HEAD,
    });
    const decision = evaluateCandidate(
      CANDIDATE,
      cleanFacts(),
      policy('t3_live'),
      USAGE,
      NOW,
    );
    const packet = createDispatchPacket({
      cycle_id: 'cycle-halt',
      decision,
      candidate: CANDIDATE,
      facts: cleanFacts(),
      generated_at: NOW,
      expires_at: LATER,
    });
    store.engageOwnerHalt(NOW, 'owner_kill_switch');
    assert.throws(
      () => store.markDispatchIntent(packet, NOW),
      /KILL_SWITCH_ENGAGED_BEFORE_DISPATCH/,
    );
  });
});

test('dispatch intent and outcome records prevent duplicate action attempts', () => {
  withTempStore('t3_live', (store) => {
    store.beginCycle({
      cycle_id: 'cycle-idempotency',
      now: NOW,
      expected_mode: 't3_live',
      input_hash: HEAD,
    });
    store.transitionCycle('cycle-idempotency', 'gating', NOW);
    store.transitionCycle('cycle-idempotency', 'selecting', NOW);
    const decision = evaluateCandidate(
      CANDIDATE,
      cleanFacts(),
      policy('t3_live'),
      USAGE,
      NOW,
    );
    const packet = createDispatchPacket({
      cycle_id: 'cycle-idempotency',
      decision,
      candidate: CANDIDATE,
      facts: cleanFacts(),
      generated_at: NOW,
      expires_at: LATER,
    });
    store.transitionCycle('cycle-idempotency', 'dispatching', NOW);
    store.markDispatchIntent(packet, NOW);
    assert.throws(
      () => store.markDispatchIntent(packet, NOW),
      /DISPATCH_RECONCILIATION_REQUIRED/,
    );
    store.markDispatchOutcome(packet, NOW);
    store.markDispatchOutcome(packet, NOW);
    assert.equal(store.readState().cost_counters.window_dispatch_count, 1);
    assert.throws(
      () => store.markDispatchIntent(packet, NOW),
      /DISPATCH_ACTION_ALREADY_COMPLETED/,
    );
  });
});

test('append-only event log is gapless, hash chained, and detects tampering', () => {
  withTempStore('t3_live', (store, root) => {
    runKernelCycle(
      store,
      kernelInput('cycle-events', 't3_live', CANDIDATE, cleanFacts()),
    );
    assert.equal(store.verifyEventChain(), true);
    const eventPath = path.join(root, 'events.ndjson');
    fs.writeFileSync(
      eventPath,
      fs
        .readFileSync(eventPath, 'utf8')
        .replace('IMMUTABLE_PACKET_READY', 'TAMPERED'),
      'utf8',
    );
    assert.equal(store.verifyEventChain(), false);
    const result = runKernelCycle(
      store,
      kernelInput('cycle-after-audit-tamper', 't3_live', null, null),
    );
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.code, 'AUTONOMY_STATE_FAIL_CLOSED');
    assert.equal(store.readState().mode, 'halted');
    assert.equal(store.readState().halted_reason, 'audit_integrity_failure');
  });
});

test('all JSON schemas are closed and packets structurally exclude T1', () => {
  const schemaDir = path.join(ROOT, 'schemas', 'autonomy');
  const files = fs
    .readdirSync(schemaDir)
    .filter((entry) => entry.endsWith('.schema.json'))
    .sort();
  assert.deepEqual(files, [
    'audit-event.schema.json',
    'autonomy-execution-state.schema.json',
    'autonomy-policy.schema.json',
    'candidate-decision.schema.json',
    'dispatch-packet.schema.json',
    'execution-record.schema.json',
  ]);
  for (const file of files) {
    const schema = JSON.parse(
      fs.readFileSync(path.join(schemaDir, file), 'utf8'),
    ) as {
      additionalProperties?: boolean;
      required?: unknown[];
      properties?: Record<string, { enum?: string[] }>;
    };
    assert.equal(schema.additionalProperties, false, file);
    assert.ok((schema.required?.length ?? 0) > 0, file);
  }
  const packetSchema = JSON.parse(
    fs.readFileSync(
      path.join(schemaDir, 'dispatch-packet.schema.json'),
      'utf8',
    ),
  ) as { properties: { tier: { enum: string[] } } };
  assert.deepEqual(packetSchema.properties.tier.enum, ['T2', 'T3']);
});
