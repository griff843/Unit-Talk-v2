import assert from 'node:assert/strict';
import type { SubmissionPayload } from '@unit-talk/contracts';
import { createInMemoryRepositoryBundle } from '@unit-talk/db';
import {
  AutomatedWriteBoundaryError,
  detectAutomatedDirectToValidatedWrite,
  prepareAutomatedSubmission,
} from './automated-write-boundary.js';
import { processSubmission } from './submission-service.js';

type RegisterTest = (
  name: string,
  testFunction: () => void | Promise<void>,
) => void;

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

export function registerAutomatedWriteBoundaryTests(register: RegisterTest): void {
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
});
}
