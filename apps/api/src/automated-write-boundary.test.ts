import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PickSource, SubmissionPayload } from '@unit-talk/contracts';
import { createInMemoryRepositoryBundle } from '@unit-talk/db';
import {
  assertEveryAutomatedSourceIsBraked,
  AutomatedWriteBoundaryError,
  detectAutomatedDirectToValidatedWrite,
  isAutomatedProducerSubmission,
  prepareAutomatedSubmission,
} from './automated-write-boundary.js';
import { isGovernanceBrakeSource } from './distribution-service.js';
import { submitPickController } from './controllers/submit-pick-controller.js';
import { processSubmission } from './submission-service.js';

// This file is a standalone node:test module so that it is executable from a
// package script. It used to export a register function that only ran when
// another suite imported it, which meant it never ran under `pnpm verify`.
const register = test;

function automatedBoardPayload(overrides: Partial<SubmissionPayload> = {}): SubmissionPayload {
  return {
    source: 'board-construction',
    submittedBy: 'scheduler:board-pick-writer',
    market: 'player_points_ou',
    selection: 'Automated Boundary Over 24.5',
    line: 24.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 0.55,
    metadata: {
      systemGenerated: true,
      marketUniverseId: 'universe-boundary-1',
      providerKey: 'sgo',
      providerMarketKey: 'points-all-game-ou',
      snapshot_at: new Date().toISOString(),
      sportKey: 'nba',
    },
    ...overrides,
  };
}

register('automated write boundary materializes a board pick directly into awaiting_approval', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(automatedBoardPayload(), repositories);

  assert.equal(result.pick.lifecycleState, 'awaiting_approval');
  assert.equal(result.pickRecord.status, 'awaiting_approval');
  assert.equal(result.lifecycleEvent.toState, 'awaiting_approval');
  assert.equal(result.lifecycleEvent.writerRole, 'promoter');
  assert.match(result.lifecycleEvent.reason, /scheduler:board-pick-writer requires operator approval/);

  const metadata = result.pickRecord.metadata as Record<string, unknown>;
  const boundary = metadata['automatedWriteBoundary'] as Record<string, unknown>;
  assert.equal(boundary['producer'], 'scheduler:board-pick-writer');
  assert.equal(boundary['source'], 'board-construction');
  assert.equal(boundary['requiredState'], 'awaiting_approval');
  assert.equal(boundary['transitionActor'], 'scheduler:board-pick-writer');
  assert.equal(typeof boundary['sourceSnapshotAgeMs'], 'number');
});

register('a source-only automated submission is left to the Phase 7A source brake', async () => {
  // Minimal source-only fixtures carry no producer identity and no market
  // evidence. They are governed by GOVERNANCE_BRAKE_SOURCES in
  // distribution-service.ts, not by this boundary, and
  // t1-proof-awaiting-approval.test.ts asserts that path end to end. This
  // boundary must not claim them, or that ratified proof breaks.
  const payload = automatedBoardPayload({
    source: 'system-pick-scanner' as PickSource,
    selection: 'Source Only Belongs To The Phase 7A Brake',
    metadata: { proof_fixture_id: 'boundary-source-only' },
  });

  assert.equal(isAutomatedProducerSubmission(payload), false);
  const decision = prepareAutomatedSubmission(payload);
  assert.equal(decision.automated, false);
  assert.equal(decision.initialLifecycleState, undefined);
});

register('automated write boundary preserves the human/manual validated path', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'smart-form',
      submittedBy: 'capper:test',
      market: 'player_points_ou',
      selection: 'Human Boundary Over 24.5',
      line: 24.5,
      odds: -110,
      stakeUnits: 1,
    },
    repositories,
  );

  assert.equal(result.pick.lifecycleState, 'validated');
  assert.equal(result.pickRecord.status, 'validated');
  assert.equal(result.lifecycleEvent.toState, 'validated');
});

register('synthetic future system producer cannot bypass the governed boundary', async () => {
  const futureSource = 'syndicate-machine-v2' as PickSource;
  const payload = automatedBoardPayload({
    source: futureSource,
    submittedBy: 'system:syndicate-machine-v2',
    selection: 'Synthetic Future Producer Over 24.5',
    metadata: {
      systemGenerated: true,
      marketUniverseId: 'universe-future-producer',
      providerKey: 'sgo',
      providerMarketKey: 'points-all-game-ou',
      snapshot_at: new Date().toISOString(),
      sportKey: 'nba',
    },
  });

  assert.equal(isAutomatedProducerSubmission(payload), true);

  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(payload, repositories);

  assert.equal(result.pick.lifecycleState, 'awaiting_approval');
  assert.equal(result.pickRecord.status, 'awaiting_approval');
  assert.equal(result.lifecycleEvent.toState, 'awaiting_approval');
  const metadata = result.pickRecord.metadata as Record<string, unknown>;
  const boundary = metadata['automatedWriteBoundary'] as Record<string, unknown>;
  assert.equal(boundary['source'], futureSource);
  assert.equal(boundary['requiredState'], 'awaiting_approval');
});

register('automated write boundary rejects missing market evidence before persistence', () => {
  const payload = automatedBoardPayload({
    metadata: {
      systemGenerated: true,
      marketUniverseId: 'universe-boundary-1',
      providerKey: 'sgo',
      snapshot_at: new Date().toISOString(),
    },
  });

  assert.throws(
    () => prepareAutomatedSubmission(payload),
    (error: unknown) =>
      error instanceof AutomatedWriteBoundaryError &&
      error.code === 'MISSING_PROVIDER_MARKET_KEY',
  );
});

register('automated write boundary rejects a stale source snapshot before persistence', () => {
  const payload = automatedBoardPayload({
    metadata: {
      ...(automatedBoardPayload().metadata ?? {}),
      snapshot_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    },
  });

  assert.throws(
    () => prepareAutomatedSubmission(payload),
    (error: unknown) =>
      error instanceof AutomatedWriteBoundaryError && error.code === 'STALE_PRICE_SNAPSHOT',
  );
});

register('readiness detects an automated direct-to-validated write', () => {
  assert.deepEqual(
    detectAutomatedDirectToValidatedWrite({
      source: 'board-construction',
      status: 'validated',
      metadata: { systemGenerated: true },
    }),
    {
      code: 'AUTOMATED_DIRECT_TO_VALIDATED',
      source: 'board-construction',
      status: 'validated',
    },
  );
  assert.equal(
    detectAutomatedDirectToValidatedWrite({
      source: 'smart-form',
      status: 'validated',
      metadata: {},
    }),
    null,
  );

  const futureSource = 'syndicate-machine-v2' as PickSource;
  assert.deepEqual(
    detectAutomatedDirectToValidatedWrite({
      source: futureSource,
      status: 'validated',
      metadata: { systemGenerated: true },
    }),
    {
      code: 'AUTOMATED_DIRECT_TO_VALIDATED',
      source: futureSource,
      status: 'validated',
    },
  );
});

// ---------------------------------------------------------------------------
// UTV2-1611 acceptance regressions
//
// Each test below fails against the pre-correction implementation and passes
// after it. They drive the real production path (processSubmission /
// submitPickController against in-memory repositories) and assert the
// PERSISTED row, not a decision object.
// ---------------------------------------------------------------------------

function unmarkedBoardPayload(overrides: Partial<SubmissionPayload> = {}): SubmissionPayload {
  // Deliberately carries NO `systemGenerated` marker while carrying complete,
  // valid market evidence. This is the exact bypass shape.
  return automatedBoardPayload({
    selection: 'Unmarked Board Production Over 24.5',
    metadata: {
      marketUniverseId: 'universe-unmarked-1',
      providerKey: 'sgo',
      providerMarketKey: 'points-all-game-ou',
      snapshot_at: new Date().toISOString(),
      sportKey: 'nba',
    },
    ...overrides,
  });
}

register('REGRESSION UTV2-1611: an unmarked board-construction production never persists as validated', async () => {
  const payload = unmarkedBoardPayload();
  assert.equal(payload.metadata?.['systemGenerated'], undefined, 'fixture must carry no marker');

  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(payload, repositories);

  assert.equal(
    result.pickRecord.status,
    'awaiting_approval',
    `persisted status was "${result.pickRecord.status}" — board-construction has no direct-to-validated release class`,
  );
  assert.equal(result.pick.lifecycleState, 'awaiting_approval');
  assert.equal(result.lifecycleEvent.toState, 'awaiting_approval');
  assert.equal(result.lifecycleEvent.writerRole, 'promoter');
});

register('REGRESSION UTV2-1611: an unmarked board production without producer identity fails closed', async () => {
  const repositories = createInMemoryRepositoryBundle();

  await assert.rejects(
    () => processSubmission(unmarkedBoardPayload({ submittedBy: '   ' }), repositories),
    (error: unknown) =>
      error instanceof AutomatedWriteBoundaryError &&
      error.code === 'MISSING_AUTOMATED_PRODUCER',
    'a board production with no producer identity must fail closed, not persist',
  );
});

register('REGRESSION UTV2-1611: an unmarked board production without market evidence fails closed', () => {
  assert.throws(
    () =>
      prepareAutomatedSubmission(
        unmarkedBoardPayload({
          metadata: {
            providerKey: 'sgo',
            providerMarketKey: 'points-all-game-ou',
            snapshot_at: new Date().toISOString(),
            sportKey: 'nba',
          },
        }),
      ),
    (error: unknown) =>
      error instanceof AutomatedWriteBoundaryError &&
      error.code === 'MISSING_MARKET_UNIVERSE_ID',
  );
});

register('REGRESSION UTV2-1611: board-construction carries a source-keyed fallback brake', () => {
  // Governance safety must not depend on a producer remembering to stamp the
  // marker. The source itself is braked, so even a submission that never
  // reaches the boundary cannot auto-enqueue.
  assert.equal(isGovernanceBrakeSource('board-construction'), true);
  assert.equal(isAutomatedProducerSubmission(unmarkedBoardPayload()), true);
});

register('REGRESSION UTV2-1611: the submit controller does not re-apply awaiting_approval after atomic materialization', async () => {
  const repositories = createInMemoryRepositoryBundle();

  // Count every lifecycle transition attempt made after the atomic birth write.
  const picks = repositories.picks as unknown as {
    transitionPickLifecycleAtomic: (input: unknown) => Promise<unknown>;
  };
  const originalAtomic = picks.transitionPickLifecycleAtomic.bind(repositories.picks);
  let postBirthTransitionAttempts = 0;
  picks.transitionPickLifecycleAtomic = async (input: unknown) => {
    postBirthTransitionAttempts += 1;
    return originalAtomic(input);
  };

  const response = await submitPickController(
    automatedBoardPayload({ selection: 'Controller Double Brake Over 24.5' }),
    repositories,
  );

  assert.equal(response.status, 201);
  assert.ok(response.body.ok);
  if (!response.body.ok) return;
  assert.equal(response.body.data.lifecycleState, 'awaiting_approval');
  assert.equal(response.body.data.governanceBrake, true);
  assert.equal(response.body.data.outboxEnqueued, false);
  assert.equal(
    postBirthTransitionAttempts,
    0,
    'the pick was already born in awaiting_approval; re-applying the brake is an invalid awaiting_approval -> awaiting_approval transition',
  );

  const persisted = await repositories.picks.findPickById(response.body.data.pickId);
  assert.equal(persisted?.status, 'awaiting_approval');
});

register('REGRESSION UTV2-1611: the source-only Phase 7A brake path is still governed by the controller', async () => {
  // A source-only fixture carries no producer identity and no market evidence.
  // It must NOT be claimed by the boundary (it would fail closed and drop a
  // ratified governed path), and the controller brake must still park it.
  const repositories = createInMemoryRepositoryBundle();
  const response = await submitPickController(
    {
      source: 'system-pick-scanner',
      market: 'NBA points',
      selection: 'Source Only Brake Over 18.5',
      line: 18.5,
      odds: -110,
      stakeUnits: 1,
      confidence: 0.7,
    },
    repositories,
  );

  assert.ok(response.body.ok);
  if (!response.body.ok) return;
  assert.equal(response.body.data.lifecycleState, 'awaiting_approval');
  assert.equal(response.body.data.governanceBrake, true);
  const persisted = await repositories.picks.findPickById(response.body.data.pickId);
  assert.equal(persisted?.status, 'awaiting_approval');
});

register('REGRESSION UTV2-1611: the live proof cleans up through the lifecycle FSM, not a direct status PATCH', () => {
  const proofPath = fileURLToPath(
    new URL('./t1-proof-utv2-1611-board-write-boundary.test.ts', import.meta.url),
  );
  const source = readFileSync(proofPath, 'utf8');

  assert.equal(
    /method:\s*'PATCH'/.test(source),
    false,
    'live proof cleanup must not write picks.status directly — it bypasses the FSM and writes no pick_lifecycle audit row',
  );
  assert.match(
    source,
    /transitionPickLifecycle\(/,
    'live proof cleanup must void fixtures through transitionPickLifecycle',
  );
});

register('REGRESSION UTV2-1611: the automated/braked drift invariant fails on the condition it names', () => {
  // Presence of a guard proves nothing; this drives it down the failing path.
  // A source classified as automated but missing from GOVERNANCE_BRAKE_SOURCES
  // is exactly the state board-construction was in, and must not be reachable.
  assert.throws(
    () =>
      assertEveryAutomatedSourceIsBraked(
        { 'board-construction': 'boundary-required' },
        new Set(['system-pick-scanner']),
      ),
    /absent from GOVERNANCE_BRAKE_SOURCES/,
  );
  assert.throws(
    () =>
      assertEveryAutomatedSourceIsBraked(
        { 'system-pick-scanner': 'boundary-when-marked' },
        new Set<string>(),
      ),
    /absent from GOVERNANCE_BRAKE_SOURCES/,
  );
  // A human-ingress source needs no brake membership.
  assertEveryAutomatedSourceIsBraked({ 'smart-form': 'human-ingress' }, new Set<string>());
  // And the live configuration satisfies it — importing this module already
  // ran the same assertion against the real policy and the real brake set.
  assert.equal(isGovernanceBrakeSource('board-construction'), true);
});

register('REGRESSION UTV2-1611: validated is a legal transient for a marker-less Phase 7A brake source', () => {
  // The source brake moves these validated -> awaiting_approval, so a
  // marker-less row observed in validated is in flight, not a violation.
  assert.equal(
    detectAutomatedDirectToValidatedWrite({
      source: 'system-pick-scanner',
      status: 'validated',
      metadata: {},
    }),
    null,
  );
  // The same source WITH the marker is a genuine automated production and must
  // never rest in validated.
  assert.deepEqual(
    detectAutomatedDirectToValidatedWrite({
      source: 'system-pick-scanner',
      status: 'validated',
      metadata: { systemGenerated: true },
    }),
    {
      code: 'AUTOMATED_DIRECT_TO_VALIDATED',
      source: 'system-pick-scanner',
      status: 'validated',
    },
  );
  // board-construction is flagged by source alone — it has no legal validated
  // state at all, marker or not.
  assert.deepEqual(
    detectAutomatedDirectToValidatedWrite({
      source: 'board-construction',
      status: 'validated',
      metadata: {},
    }),
    {
      code: 'AUTOMATED_DIRECT_TO_VALIDATED',
      source: 'board-construction',
      status: 'validated',
    },
  );
});
