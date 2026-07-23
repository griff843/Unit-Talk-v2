import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { classifyBlockers } from './blocker-classifier.js';
import {
  type AutonomyPolicy,
  type Candidate,
  type CheckFact,
  type EvidenceFact,
  type ExecutionRecord,
  type MechanicalFacts,
  sha256,
  type UsageSnapshot,
} from './contracts.js';
import {
  createDispatchPacket,
  evaluateCandidate,
  runKernelCycle,
} from './kernel.js';
import { evaluateCeilings, resolvePolicy } from './policy.js';
import {
  ALLOWED_TRANSITIONS,
  assertTransition,
  canTransition,
} from './state-machine.js';
import { FileAutonomyStore } from './store.js';

const NOW = '2026-07-23T18:00:00.000Z';
const LATER = '2026-07-23T19:00:00.000Z';
const HEAD = 'a'.repeat(40);
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

const POLICY: AutonomyPolicy = {
  schema_version: 1,
  mode: 't2-t3-live',
  owner_halt: false,
  owner_halt_reason: null,
  ceilings: {
    max_cycles: 10,
    max_duration_ms: 60_000,
    max_retries_per_candidate: 2,
    max_token_budget: 100_000,
    max_cost_micros: 1_000_000,
  },
};

const USAGE: UsageSnapshot = {
  cycles: 0,
  elapsed_ms: 0,
  retries_for_candidate: 0,
  tokens_used: 0,
  cost_micros: 0,
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
    current_session_id: 'session-a',
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

function withTempStore<T>(
  callback: (store: FileAutonomyStore, root: string) => T,
): T {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-autonomy-test-'));
  try {
    return callback(new FileAutonomyStore(root), root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('mode and owner halt evaluation fail closed when configuration is absent', () => {
  const resolution = resolvePolicy({});
  assert.equal(resolution.valid, false);
  assert.equal(resolution.policy.mode, 'halted');
  assert.equal(resolution.policy.owner_halt, true);
  assert.deepEqual(resolution.reason_codes, [
    'AUTONOMY_CEILINGS_MISSING',
    'AUTONOMY_MODE_MISSING',
    'OWNER_HALT_SIGNAL_MISSING',
  ]);
});

test('valid explicit configuration selects live mode and owner halt always wins', () => {
  const live = resolvePolicy({
    mode: 't3-live',
    owner_halt: false,
    ceilings: POLICY.ceilings,
  });
  assert.equal(live.valid, true);
  assert.equal(live.policy.mode, 't3-live');

  const halted = resolvePolicy({
    mode: 't2-t3-live',
    owner_halt: true,
    owner_halt_reason: 'operator kill switch',
    ceilings: POLICY.ceilings,
  });
  assert.equal(halted.policy.mode, 'halted');
  assert.deepEqual(halted.reason_codes, ['OWNER_HALT_ACTIVE']);
});

test('cycle, duration, retry, token, and cost ceilings are exact and deterministic', () => {
  assert.deepEqual(
    evaluateCeilings(POLICY.ceilings, {
      cycles: 10,
      elapsed_ms: 60_000,
      retries_for_candidate: 3,
      tokens_used: 100_000,
      cost_micros: 1_000_000,
    }),
    [
      'MAX_COST_REACHED',
      'MAX_CYCLES_REACHED',
      'MAX_DURATION_REACHED',
      'MAX_RETRIES_EXCEEDED',
      'MAX_TOKEN_BUDGET_REACHED',
    ],
  );
  assert.deepEqual(evaluateCeilings(POLICY.ceilings, USAGE), []);
});

test('blocker classifier accepts clean mechanical facts and keeps advisory failures non-blocking', () => {
  const facts = cleanFacts({
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
  });
  const result = classifyBlockers(facts);
  assert.equal(result.mechanically_dispatchable, true);
  assert.deepEqual(result.blocking, []);
  assert.deepEqual(
    result.advisories.map((entry) => entry.code),
    ['ADVISORY_WORKFLOW_FAILURE'],
  );
});

test('blocker classifier emits the exact required blocker taxonomy', () => {
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
      facts: cleanFacts({
        required_labels: ['tier:T3', 'executor-result-valid'],
      }),
      code: 'MISSING_REQUIRED_LABEL',
    },
    {
      name: 'branch behind base',
      facts: cleanFacts({ behind_by: 1 }),
      code: 'BRANCH_BEHIND_BASE',
    },
    {
      name: 'merge conflicts',
      facts: cleanFacts({ merge_conflicts: true }),
      code: 'MERGE_CONFLICTS_PRESENT',
    },
    {
      name: 'active locks and leases',
      facts: cleanFacts({
        locks_and_leases: [
          {
            kind: 'lease',
            resource: 'schemas/autonomy/**',
            status: 'active',
            owner_session_id: 'session-b',
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
      name: 'environment approval',
      facts: cleanFacts({
        environment: { required: true, approved: false, state: 'pending' },
      }),
      code: 'ENVIRONMENT_APPROVAL_REQUIRED',
    },
    {
      name: 'GitHub mergeability state',
      facts: cleanFacts({ github_mergeability: 'UNKNOWN' }),
      code: 'GITHUB_MERGEABILITY_UNKNOWN',
    },
  ];
  for (const fixture of cases) {
    const result = classifyBlockers(fixture.facts);
    assert.equal(result.mechanically_dispatchable, false, fixture.name);
    assert.ok(
      result.blocking.some((entry) => entry.code === fixture.code),
      `${fixture.name}: expected ${fixture.code}, got ${JSON.stringify(result.blocking)}`,
    );
  }
});

test('stable-session ownership resumes across PID changes and never self-classifies as orphaned', () => {
  withTempStore((store) => {
    const first = store.claimRun({
      run_id: 'run-stable',
      session_id: 'stable-session',
      now: NOW,
      expires_at: LATER,
      process_id: 111,
    });
    const second = store.claimRun({
      run_id: 'run-stable',
      session_id: 'stable-session',
      now: NOW,
      expires_at: LATER,
      process_id: 222,
    });
    assert.equal(first.ok && first.code, 'claimed');
    assert.equal(second.ok && second.code, 'resumed');
    if (second.ok) assert.equal(second.lease.process_id, 111);
  });
});

test('single-run concurrency blocks other sessions and requires explicit reclaim after expiry', () => {
  withTempStore((store) => {
    store.claimRun({
      run_id: 'run-owner',
      session_id: 'session-owner',
      now: NOW,
      expires_at: LATER,
    });
    const conflict = store.claimRun({
      run_id: 'run-other',
      session_id: 'session-other',
      now: NOW,
      expires_at: LATER,
    });
    const expired = store.claimRun({
      run_id: 'run-other',
      session_id: 'session-other',
      now: '2026-07-23T20:00:00.000Z',
      expires_at: '2026-07-23T21:00:00.000Z',
    });
    assert.equal(!conflict.ok && conflict.code, 'active_run_conflict');
    assert.equal(!expired.ok && expired.code, 'explicit_reclaim_required');
  });
});

test('every state-machine transition is explicitly accepted or rejected', () => {
  const states = Object.keys(ALLOWED_TRANSITIONS) as Array<
    keyof typeof ALLOWED_TRANSITIONS
  >;
  let accepted = 0;
  let rejected = 0;
  for (const from of states) {
    for (const to of states) {
      const expected = ALLOWED_TRANSITIONS[from].includes(to);
      assert.equal(canTransition(from, to), expected, `${from}->${to}`);
      if (expected) {
        assert.doesNotThrow(() => assertTransition(from, to));
        accepted += 1;
      } else {
        assert.throws(
          () => assertTransition(from, to),
          /INVALID_AUTONOMY_TRANSITION/,
        );
        rejected += 1;
      }
    }
  }
  assert.equal(accepted, 12);
  assert.equal(rejected, 69);
});

test('candidate decisions enforce halted, shadow, tier, blocker, and ceiling rules', () => {
  const halted = evaluateCandidate(
    CANDIDATE,
    cleanFacts(),
    { ...POLICY, mode: 'halted', owner_halt: true },
    USAGE,
    NOW,
  );
  const shadow = evaluateCandidate(
    CANDIDATE,
    cleanFacts(),
    { ...POLICY, mode: 'shadow' },
    USAGE,
    NOW,
  );
  const t1 = evaluateCandidate(
    { ...CANDIDATE, tier: 'T1' },
    cleanFacts(),
    POLICY,
    USAGE,
    NOW,
  );
  const blocked = evaluateCandidate(
    CANDIDATE,
    cleanFacts({ merge_conflicts: true }),
    POLICY,
    USAGE,
    NOW,
  );
  const ceiling = evaluateCandidate(
    CANDIDATE,
    cleanFacts(),
    POLICY,
    { ...USAGE, cycles: 10 },
    NOW,
  );
  assert.equal(halted.action, 'blocked');
  assert.equal(shadow.action, 'queue');
  assert.equal(t1.action, 'queue');
  assert.equal(blocked.action, 'blocked');
  assert.equal(ceiling.action, 'escalation');
});

test('candidate decision and immutable dispatch packet are content-addressed and deterministic', () => {
  const decisionA = evaluateCandidate(
    CANDIDATE,
    cleanFacts(),
    POLICY,
    USAGE,
    NOW,
  );
  const decisionB = evaluateCandidate(
    CANDIDATE,
    cleanFacts(),
    POLICY,
    USAGE,
    NOW,
  );
  assert.deepEqual(decisionA, decisionB);
  assert.equal(decisionA.action, 'dispatch');
  const packet = createDispatchPacket(
    'run-packet',
    decisionA,
    { ...CANDIDATE, file_scope: ['z/**', 'a/**'] },
    NOW,
  );
  assert.equal(Object.isFrozen(packet), true);
  assert.deepEqual(packet.candidate.file_scope, ['a/**', 'z/**']);
  assert.equal(packet.packet_id, `packet_${packet.content_sha256}`);
});

test('kernel returns structured no-op, queue, dispatch, blocked, and escalation outcomes', () => {
  const scenarios: Array<{
    run: string;
    candidate: Candidate | null;
    facts: MechanicalFacts | null;
    policy: AutonomyPolicy;
    usage: UsageSnapshot;
    expected: string;
  }> = [
    {
      run: 'run-noop',
      candidate: null,
      facts: null,
      policy: POLICY,
      usage: USAGE,
      expected: 'no_op',
    },
    {
      run: 'run-queue',
      candidate: { ...CANDIDATE, tier: 'T1' },
      facts: cleanFacts(),
      policy: POLICY,
      usage: USAGE,
      expected: 'queue',
    },
    {
      run: 'run-dispatch',
      candidate: CANDIDATE,
      facts: cleanFacts(),
      policy: POLICY,
      usage: USAGE,
      expected: 'dispatch',
    },
    {
      run: 'run-blocked',
      candidate: CANDIDATE,
      facts: cleanFacts({ merge_conflicts: true }),
      policy: POLICY,
      usage: USAGE,
      expected: 'blocked',
    },
    {
      run: 'run-escalation',
      candidate: CANDIDATE,
      facts: cleanFacts(),
      policy: POLICY,
      usage: { ...USAGE, retries_for_candidate: 3 },
      expected: 'escalation',
    },
  ];
  for (const scenario of scenarios) {
    withTempStore((store) => {
      const result = runKernelCycle(store, {
        run_id: scenario.run,
        session_id: 'session-a',
        now: NOW,
        lease_expires_at: LATER,
        policy: scenario.policy,
        usage: scenario.usage,
        candidate: scenario.candidate,
        facts: scenario.facts,
      });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.outcome.kind, scenario.expected);
        assert.equal(store.verifyEventChain(), true);
      }
    });
  }
});

test('crash-safe resume continues a packet-ready run under the same stable session', () => {
  withTempStore((store) => {
    const input = {
      run_id: 'run-resume',
      session_id: 'stable-session',
      now: NOW,
      lease_expires_at: LATER,
      policy: POLICY,
      usage: USAGE,
      candidate: CANDIDATE,
      facts: cleanFacts({ current_session_id: 'stable-session' }),
    };
    const inputHash = sha256({
      policy: input.policy,
      usage: input.usage,
      candidate: input.candidate,
      facts: input.facts,
    });
    store.claimRun({
      run_id: input.run_id,
      session_id: input.session_id,
      now: input.now,
      expires_at: input.lease_expires_at,
      process_id: 111,
    });
    const created: ExecutionRecord = {
      schema_version: 1,
      run_id: input.run_id,
      session_id: input.session_id,
      state: 'created',
      input_hash: inputHash,
      created_at: NOW,
      updated_at: NOW,
      cycle: 0,
      retry_count: 0,
      transition_sequence: 0,
    };
    store.createRecord(created);
    const evaluating: ExecutionRecord = {
      ...created,
      state: 'evaluating',
      transition_sequence: 1,
    };
    store.transition(input.run_id, evaluating, 'state.transitioned', {});
    const decision = evaluateCandidate(
      input.candidate,
      input.facts,
      POLICY,
      USAGE,
      NOW,
    );
    const packet = createDispatchPacket(
      input.run_id,
      decision,
      input.candidate,
      NOW,
    );
    store.writePacket(packet);
    const packetReady: ExecutionRecord = {
      ...evaluating,
      state: 'packet_ready',
      transition_sequence: 2,
      decision,
      packet_id: packet.packet_id,
    };
    store.transition(input.run_id, packetReady, 'packet.created', {
      packet_id: packet.packet_id,
    });

    const resumed = runKernelCycle(store, input);
    assert.equal(resumed.ok, true);
    if (resumed.ok) {
      assert.equal(resumed.resumed, true);
      assert.equal(resumed.record.state, 'dispatched');
      assert.equal(resumed.outcome.packet_id, packet.packet_id);
    }
    assert.equal(store.verifyEventChain(), true);
    assert.ok(
      store.readEvents().some((event) => event.event_type === 'run.resumed'),
    );
  });
});

test('resume fails closed when the caller changes immutable run input', () => {
  withTempStore((store) => {
    const first = runKernelCycle(store, {
      run_id: 'run-drift',
      session_id: 'session-a',
      now: NOW,
      lease_expires_at: LATER,
      policy: POLICY,
      usage: USAGE,
      candidate: { ...CANDIDATE, tier: 'T1' },
      facts: cleanFacts(),
    });
    assert.equal(first.ok, true);

    const second = runKernelCycle(store, {
      run_id: 'run-drift',
      session_id: 'session-a',
      now: NOW,
      lease_expires_at: LATER,
      policy: POLICY,
      usage: USAGE,
      candidate: CANDIDATE,
      facts: cleanFacts(),
    });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, 'INPUT_DRIFT_ON_RESUME');
  });
});

test('terminal run replay is idempotent and does not reacquire the single-run lease', () => {
  withTempStore((store) => {
    const input = {
      run_id: 'run-idempotent',
      session_id: 'session-a',
      now: NOW,
      lease_expires_at: LATER,
      policy: POLICY,
      usage: USAGE,
      candidate: null,
      facts: null,
    };
    const first = runKernelCycle(store, input);
    const replay = runKernelCycle(store, input);
    assert.equal(first.ok, true);
    assert.equal(replay.ok, true);
    if (first.ok && replay.ok) {
      assert.deepEqual(replay.outcome, first.outcome);
      assert.equal(replay.resumed, true);
    }
    const next = store.claimRun({
      run_id: 'run-next',
      session_id: 'session-b',
      now: NOW,
      expires_at: LATER,
    });
    assert.equal(next.ok && next.code, 'claimed');
  });
});

test('append-only event log is hash chained and detects tampering', () => {
  withTempStore((store, root) => {
    const result = runKernelCycle(store, {
      run_id: 'run-events',
      session_id: 'session-a',
      now: NOW,
      lease_expires_at: LATER,
      policy: POLICY,
      usage: USAGE,
      candidate: null,
      facts: null,
    });
    assert.equal(result.ok, true);
    assert.equal(store.verifyEventChain(), true);
    const eventPath = path.join(root, 'events.ndjson');
    const events = fs
      .readFileSync(eventPath, 'utf8')
      .replace('NO_CANDIDATE', 'TAMPERED');
    fs.writeFileSync(eventPath, events, 'utf8');
    assert.equal(store.verifyEventChain(), false);
  });
});

test('all autonomy JSON schemas parse and expose closed top-level contracts', () => {
  const schemaDir = path.join(ROOT, 'schemas', 'autonomy');
  const files = fs
    .readdirSync(schemaDir)
    .filter((entry) => entry.endsWith('.schema.json'))
    .sort();
  assert.deepEqual(files, [
    'audit-event.schema.json',
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
    };
    assert.equal(schema.additionalProperties, false, file);
    assert.ok((schema.required?.length ?? 0) > 0, file);
  }
});
