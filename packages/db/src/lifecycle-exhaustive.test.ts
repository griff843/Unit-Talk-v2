/**
 * UTV2-938: Exhaustive lifecycle invariant verification
 *
 * Covers all 7x7=49 (from, to) state pairs against the canonical contracts
 * matrix. Every allowed transition must succeed; every forbidden transition
 * must throw InvalidTransitionError with the correct from/to properties.
 * No scenario gaps — state space is fully enumerated.
 *
 * Run: npx tsx --test packages/db/src/lifecycle-exhaustive.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickLifecycleTransitions,
  type PickLifecycleState,
} from '@unit-talk/contracts';
import type { CanonicalPick } from '@unit-talk/contracts';
import { InMemoryPickRepository } from './runtime-repositories.js';
import {
  transitionPickLifecycle,
  atomicClaimForTransition,
  InvalidTransitionError,
  InvalidPickStateError,
} from './lifecycle.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePick(id: string, state: PickLifecycleState): CanonicalPick {
  return {
    id,
    submissionId: `sub-${id}`,
    market: 'nba-spread',
    selection: 'Lakers -3.5',
    source: 'smart-form',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: state,
    metadata: {},
    createdAt: new Date().toISOString(),
  };
}

async function freshRepo(state: PickLifecycleState): Promise<{
  repo: InMemoryPickRepository;
  pickId: string;
}> {
  const pickId = `p-${state}-${Math.random().toString(36).slice(2, 8)}`;
  const repo = new InMemoryPickRepository();
  await repo.savePick(makePick(pickId, state));
  return { repo, pickId };
}

const allStates = Object.keys(pickLifecycleTransitions) as PickLifecycleState[];

// Build expected allow/deny map from the canonical contracts matrix
const allowedSet = new Set<string>();
for (const from of allStates) {
  for (const to of pickLifecycleTransitions[from]) {
    allowedSet.add(`${from}->${to}`);
  }
}

// ---------------------------------------------------------------------------
// Exhaustive allowed-transition tests
// ---------------------------------------------------------------------------

for (const from of allStates) {
  const allowed = pickLifecycleTransitions[from] as readonly PickLifecycleState[];
  for (const to of allowed) {
    test(`[allowed] ${from} -> ${to} succeeds with correct state`, async () => {
      const { repo, pickId } = await freshRepo(from);
      const result = await transitionPickLifecycle(repo, pickId, to, 'exhaustive-test');
      assert.equal(result.lifecycleState, to, `expected state ${to} after transition`);
      assert.equal(result.pickId, pickId);
      assert.ok(result.lifecycleEvent, 'lifecycle event must be present');
      assert.equal(result.lifecycleEvent.from_state, from);
      assert.equal(result.lifecycleEvent.to_state, to);
    });
  }
}

// ---------------------------------------------------------------------------
// Exhaustive forbidden-transition tests
// ---------------------------------------------------------------------------

for (const from of allStates) {
  for (const to of allStates) {
    if (allowedSet.has(`${from}->${to}`)) continue;
    test(`[forbidden] ${from} -> ${to} throws InvalidTransitionError`, async () => {
      const { repo, pickId } = await freshRepo(from);
      await assert.rejects(
        () => transitionPickLifecycle(repo, pickId, to, 'exhaustive-test'),
        (err: unknown) => {
          assert.ok(
            err instanceof InvalidTransitionError,
            `expected InvalidTransitionError, got ${err instanceof Error ? err.constructor.name : String(err)}`,
          );
          assert.equal(err.fromState, from, `fromState must be ${from}`);
          assert.equal(err.toState, to, `toState must be ${to}`);
          return true;
        },
      );
    });
  }
}

// ---------------------------------------------------------------------------
// atomicClaimForTransition: forbidden transitions return claimed: false
// ---------------------------------------------------------------------------

for (const from of allStates) {
  for (const to of allStates) {
    if (allowedSet.has(`${from}->${to}`)) continue;
    // Only test a representative subset to keep test count manageable:
    // terminal states attempting any forward transition
    if (from !== 'settled' && from !== 'voided') continue;
    test(`[atomic-forbidden] atomicClaim ${from} -> ${to} returns claimed:false`, async () => {
      const { repo, pickId } = await freshRepo(from);
      const result = await atomicClaimForTransition(repo, pickId, from, to);
      assert.equal(result.claimed, false, `claim must be false for forbidden ${from}->${to}`);
      assert.equal(result.pickId, pickId);
    });
  }
}

// ---------------------------------------------------------------------------
// Terminal state invariant: no outbound transitions from settled or voided
// ---------------------------------------------------------------------------

test('[invariant] settled has zero allowed transitions', () => {
  assert.equal(pickLifecycleTransitions['settled'].length, 0);
});

test('[invariant] voided has zero allowed transitions', () => {
  assert.equal(pickLifecycleTransitions['voided'].length, 0);
});

test('[invariant] every non-terminal state can reach voided', () => {
  const nonTerminal = allStates.filter((s) => pickLifecycleTransitions[s].length > 0);
  for (const state of nonTerminal) {
    const canVoid = (pickLifecycleTransitions[state] as readonly string[]).includes('voided');
    assert.ok(canVoid, `${state} must have a voided path`);
  }
});

// ---------------------------------------------------------------------------
// Error type invariant: InvalidPickStateError for unknown pick
// ---------------------------------------------------------------------------

test('[invariant] all states: unknown pick throws InvalidPickStateError', async () => {
  const repo = new InMemoryPickRepository();
  for (const to of allStates) {
    await assert.rejects(
      () => transitionPickLifecycle(repo, 'no-such-pick', to, 'test'),
      (err: unknown) => {
        assert.ok(err instanceof InvalidPickStateError);
        return true;
      },
    );
  }
});

// ---------------------------------------------------------------------------
// Idempotency invariant: atomicClaim returns false after successful claim
// ---------------------------------------------------------------------------

test('[invariant] atomicClaim is idempotent — second call returns claimed:false', async () => {
  const { repo, pickId } = await freshRepo('validated');
  const first = await atomicClaimForTransition(repo, pickId, 'validated', 'queued');
  assert.equal(first.claimed, true);
  const second = await atomicClaimForTransition(repo, pickId, 'validated', 'queued');
  assert.equal(second.claimed, false, 'already transitioned — claim must be false');
});
