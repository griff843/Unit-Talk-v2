import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSubmissionPayload } from '@unit-talk/contracts';
import { handleSubmitPick } from './handlers/index.js';
import { applyPromotionOverride } from './promotion-service.js';
import { recordDistributionReceipt } from './distribution-receipt-service.js';
import { enqueueDistributionWork } from './distribution-service.js';
import {
  claimDistributionWork,
  completeDistributionWork,
  failDistributionWork,
} from './distribution-worker-service.js';
import { transitionPickLifecycle } from './lifecycle-service.js';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { enqueueDistributionWithRunTracking } from './run-audit-service.js';
import { processSubmission } from './submission-service.js';
import type { SubmitPickControllerResult } from './controllers/submit-pick-controller.js';

// ─── Enqueue-gap fix tests ────────────────────────────────────────────────────

test('handleSubmitPick auto-enqueues a qualified pick and returns outboxEnqueued:true', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const response = await handleSubmitPick(
    {
      body: {
        source: 'enqueue-gap-test',
        market: 'NFL passing yards',
        selection: 'QB Over 287.5',
        line: 287.5,
        odds: -115,
        stakeUnits: 1.5,
        confidence: 0.75,
        eventName: 'NFL Proof Game',
        metadata: {
          sport: 'NFL',
          promotionScores: { edge: 92, trust: 88, readiness: 85, uniqueness: 85, boardFit: 90 },
        },
      },
    },
    repositories,
  );

  assert.equal(response.status, 201);
  if (!response.body.ok) throw new Error('expected ok response');

  const data = response.body.data as SubmitPickControllerResult;

  // Promotion should have qualified for trader-insights (edge≥85, trust≥85, score≥80).
  assert.equal(data.promotionStatus, 'qualified');
  assert.equal(data.promotionTarget, 'trader-insights');
  assert.equal(data.outboxEnqueued, true);

  // Lifecycle state must be 'queued' — enqueue transitions validated → queued.
  assert.equal(data.lifecycleState, 'queued');

  // Outbox entry must exist and be pending.
  const claimed = await claimDistributionWork(
    repositories.outbox,
    'discord:trader-insights',
    'test-worker',
  );
  assert.ok(claimed.outboxRecord, 'outbox entry must exist after auto-enqueue');
  assert.equal(claimed.outboxRecord?.pick_id, data.pickId);
  assert.equal(claimed.outboxRecord?.target, 'discord:trader-insights');

  // Pick must be in 'queued' state in the DB.
  const stored = await repositories.picks.findPickById(data.pickId);
  assert.equal(stored?.status, 'queued');
});

test('handleSubmitPick does not enqueue a not-eligible pick and returns outboxEnqueued:false', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const response = await handleSubmitPick(
    {
      body: {
        source: 'enqueue-gap-test',
        market: 'NBA points',
        selection: 'Player Over 18.5',
        // No confidence, no promotionScores → confidenceFloor fails → not_eligible
      },
    },
    repositories,
  );

  assert.equal(response.status, 201);
  if (!response.body.ok) throw new Error('expected ok response');

  const data = response.body.data as SubmitPickControllerResult;

  assert.equal(data.promotionStatus, 'not_eligible');
  assert.equal(data.promotionTarget, null);
  assert.equal(data.outboxEnqueued, false);
  assert.equal(data.lifecycleState, 'validated');

  // No outbox entry should exist.
  const claimed = await claimDistributionWork(
    repositories.outbox,
    'discord:best-bets',
    'test-worker-2',
  );
  assert.equal(claimed.outboxRecord, null);
});

test('handleSubmitPick qualified for best-bets enqueues to discord:best-bets', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const response = await handleSubmitPick(
    {
      body: {
        source: 'enqueue-gap-test',
        market: 'NBA assists',
        selection: 'Player Over 8.5',
        confidence: 0.9,
        metadata: {
          sport: 'NBA',
          eventName: 'Suns vs Nuggets',
          // edge=78 < 85 → trader-insights suppressed; bb qualifies (score ≥ 70).
          promotionScores: { edge: 78, trust: 79, readiness: 88, uniqueness: 82, boardFit: 90 },
        },
      },
    },
    repositories,
  );

  assert.equal(response.status, 201);
  if (!response.body.ok) throw new Error('expected ok response');

  const data = response.body.data as SubmitPickControllerResult;

  assert.equal(data.promotionStatus, 'qualified');
  assert.equal(data.promotionTarget, 'best-bets');
  assert.equal(data.outboxEnqueued, true);
  assert.equal(data.lifecycleState, 'queued');

  const claimed = await claimDistributionWork(
    repositories.outbox,
    'discord:best-bets',
    'test-worker-3',
  );
  assert.ok(claimed.outboxRecord);
  assert.equal(claimed.outboxRecord?.target, 'discord:best-bets');
});

// ─── End enqueue-gap fix tests ────────────────────────────────────────────────

test('validateSubmissionPayload rejects empty required fields', () => {
  const result = validateSubmissionPayload({
    source: '',
    market: '',
    selection: '',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    'source is required',
    'market is required',
    'selection is required',
  ]);
});

test('processSubmission materializes canonical records and submission event', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'test',
      submittedBy: 'tester',
      market: 'NBA assists',
      selection: 'Player Over 7.5',
      line: 7.5,
      odds: -115,
    },
    repositories,
  );

  assert.equal(result.submissionRecord.status, 'validated');
  assert.equal(result.submissionEventRecord.event_name, 'submission.accepted');
  assert.equal(result.pickRecord.approval_status, 'approved');
  assert.equal(result.pickRecord.promotion_status, 'not_eligible');
  assert.equal(result.pickRecord.status, 'validated');
  assert.equal(result.lifecycleEventRecord.to_state, 'validated');
});

test('transitionPickLifecycle allows valid transitions', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA rebounds',
      selection: 'Player Under 10.5',
    },
    repositories,
  );

  const transitioned = await transitionPickLifecycle(
    repositories.picks,
    result.pick.id,
    'queued',
    'queue for posting',
  );

  assert.equal(transitioned.lifecycleState, 'queued');
  assert.equal(transitioned.lifecycleEvent.from_state, 'validated');
  assert.equal(transitioned.lifecycleEvent.to_state, 'queued');
});

test('transitionPickLifecycle rejects invalid transitions', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA threes',
      selection: 'Player Over 2.5',
    },
    repositories,
  );

  await assert.rejects(
    () =>
      transitionPickLifecycle(
        repositories.picks,
        result.pick.id,
        'settled',
        'invalid skip',
      ),
    /Invalid lifecycle transition: validated -> settled/,
  );
});

test('enqueueDistributionWork creates an outbox record with idempotency key', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA steals',
      selection: 'Player Over 1.5',
    },
    repositories,
  );

  const queued = await transitionPickLifecycle(
    repositories.picks,
    result.pick.id,
    'queued',
    'ready for downstream distribution',
  );

  const distribution = await enqueueDistributionWork(
    {
      ...result.pick,
      lifecycleState: queued.lifecycleState,
    },
    repositories.outbox,
    'discord:free-picks',
  );

  assert.equal(distribution.outboxRecord.pick_id, result.pick.id);
  assert.equal(distribution.outboxRecord.target, 'discord:free-picks');
  assert.equal(distribution.outboxRecord.status, 'pending');
  assert.equal(
    distribution.outboxRecord.idempotency_key,
    `${result.pick.id}:discord:free-picks:distribution`,
  );
});

test('handleSubmitPick returns success payload for valid requests', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const response = await handleSubmitPick(
    {
      body: {
        source: 'handler-test',
        market: 'NBA points',
        selection: 'Player Over 22.5',
      },
    },
    repositories,
  );

  assert.equal(response.status, 201);
  assert.equal(response.body.ok, true);
  if (response.body.ok) {
    assert.equal(response.body.data.lifecycleState, 'validated');
  }
});

test('handleSubmitPick returns typed error payload for invalid requests', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const response = await handleSubmitPick(
    {
      body: {
        source: '',
        market: '',
        selection: '',
      },
    },
    repositories,
  );

  assert.equal(response.status, 400);
  assert.equal(response.body.ok, false);
  if (!response.body.ok) {
    assert.equal(response.body.error.code, 'BAD_REQUEST');
  }
});

test('enqueueDistributionWithRunTracking records run and audit metadata', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA blocks',
      selection: 'Player Over 1.5',
    },
    repositories,
  );

  const queued = await transitionPickLifecycle(
    repositories.picks,
    result.pick.id,
    'queued',
    'ready for tracked enqueue',
  );

  const tracked = await enqueueDistributionWithRunTracking(
    {
      ...result.pick,
      lifecycleState: queued.lifecycleState,
    },
    'discord:premium-picks',
    'api',
    repositories.picks,
    repositories.outbox,
    repositories.runs,
    repositories.audit,
  );

  assert.equal(tracked.run.run_type, 'distribution.enqueue');
  assert.equal(tracked.run.status, 'succeeded');
  assert.ok(tracked.run.finished_at != null, 'finished_at must be set on succeeded run');
  assert.ok(
    new Date(tracked.run.finished_at) >= new Date(tracked.run.started_at),
    `finished_at must not be earlier than started_at (clock skew regression)`,
  );
  assert.equal(tracked.audit.action, 'distribution.enqueue');
  assert.equal(tracked.audit.entity_type, 'distribution_outbox');
  const updatedPick = await repositories.picks.findPickById(result.pick.id);
  assert.equal(updatedPick?.status, 'queued');
});

test('claimDistributionWork claims the next pending outbox record for a worker', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA rebounds',
      selection: 'Player Over 11.5',
    },
    repositories,
  );

  await enqueueDistributionWork(
    result.pick,
    repositories.outbox,
    'discord:worker-queue',
  );

  const claimed = await claimDistributionWork(
    repositories.outbox,
    'discord:worker-queue',
    'worker-1',
  );

  assert.ok(claimed.outboxRecord);
  assert.equal(claimed.outboxRecord?.status, 'processing');
  assert.equal(claimed.outboxRecord?.claimed_by, 'worker-1');
});

test('failDistributionWork marks claimed work failed and increments attempt count', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA assists',
      selection: 'Player Under 6.5',
    },
    repositories,
  );

  await enqueueDistributionWork(
    result.pick,
    repositories.outbox,
    'discord:retry-queue',
  );

  const claimed = await claimDistributionWork(
    repositories.outbox,
    'discord:retry-queue',
    'worker-2',
  );

  assert.ok(claimed.outboxRecord);

  const failed = await failDistributionWork(
    repositories.outbox,
    claimed.outboxRecord!.id,
    'discord unavailable',
  );

  assert.equal(failed.status, 'failed');
  assert.equal(failed.attempt_count, 1);
  assert.equal(failed.last_error, 'discord unavailable');
  assert.equal(failed.claimed_by, null);
});

test('completeDistributionWork marks claimed work sent', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA threes',
      selection: 'Player Under 3.5',
    },
    repositories,
  );

  await enqueueDistributionWork(
    result.pick,
    repositories.outbox,
    'discord:sent-queue',
  );

  const claimed = await claimDistributionWork(
    repositories.outbox,
    'discord:sent-queue',
    'worker-3',
  );

  assert.ok(claimed.outboxRecord);

  const sent = await completeDistributionWork(
    repositories.outbox,
    claimed.outboxRecord!.id,
  );

  assert.equal(sent.status, 'sent');
});

test('recordDistributionReceipt stores a first-class delivery receipt', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA points',
      selection: 'Player Under 25.5',
    },
    repositories,
  );

  await enqueueDistributionWork(
    result.pick,
    repositories.outbox,
    'discord:receipts',
  );

  const claimed = await claimDistributionWork(
    repositories.outbox,
    'discord:receipts',
    'worker-4',
  );

  assert.ok(claimed.outboxRecord);

  await completeDistributionWork(
    repositories.outbox,
    claimed.outboxRecord!.id,
  );

  const receiptResult = await recordDistributionReceipt(repositories.receipts, {
    outboxId: claimed.outboxRecord!.id,
    receiptType: 'discord.message',
    status: 'sent',
    channel: 'discord:#picks-general',
    externalId: 'discord-message-123',
    payload: {
      provider: 'discord',
      messageId: 'discord-message-123',
    },
  });

  assert.equal(receiptResult.receipt.outbox_id, claimed.outboxRecord!.id);
  assert.equal(receiptResult.receipt.receipt_type, 'discord.message');
  assert.equal(receiptResult.receipt.status, 'sent');
  assert.equal(receiptResult.receipt.channel, 'discord:#picks-general');
});

test('approval does not imply best-bets promotion in runtime', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA points',
      selection: 'Player Over 23.5',
      confidence: 0.82,
      metadata: {
        sport: 'NBA',
        eventName: 'Knicks vs Heat',
        promotionScores: {
          edge: 92,
          trust: 88,
          readiness: 84,
          uniqueness: 76,
          boardFit: 90,
        },
      },
    },
    repositories,
  );

  assert.equal(result.pickRecord.approval_status, 'approved');
  // With eager eval at submission, edge=92 trust=88 qualify for trader-insights (higher priority).
  // picks.promotion_target = 'trader-insights', not 'best-bets'.
  assert.equal(result.pickRecord.promotion_status, 'qualified');
  assert.equal(result.pickRecord.promotion_target, 'trader-insights');

  await assert.rejects(
    () =>
      enqueueDistributionWork(
        result.pick,
        repositories.outbox,
        'discord:best-bets',
      ),
    /Best Bets routing is blocked/,
  );
});

test('non-qualified picks are blocked from best-bets enqueue during tracked runtime flow', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA rebounds',
      selection: 'Player Over 11.5',
      confidence: 0.42,
      metadata: {
        sport: 'NBA',
        eventName: 'Celtics vs Bucks',
        promotionScores: {
          edge: 45,
          trust: 44,
          readiness: 55,
          uniqueness: 50,
          boardFit: 48,
        },
      },
    },
    repositories,
  );

  await assert.rejects(
    () =>
      enqueueDistributionWithRunTracking(
        result.pick,
        'discord:best-bets',
        'api',
        repositories.picks,
        repositories.outbox,
        repositories.runs,
        repositories.audit,
      ),
    /Best Bets routing is blocked/,
  );

  const stored = await repositories.picks.findPickById(result.pick.id);
  assert.equal(stored?.promotion_status, 'not_eligible');
  assert.equal(stored?.promotion_target, null);
  assert.match(stored?.promotion_reason ?? '', /below threshold|confidence|blocked|duplicate/i);

  const claimed = await claimDistributionWork(
    repositories.outbox,
    'discord:best-bets',
    'worker-promo-blocked',
  );
  assert.equal(claimed.outboxRecord, null);
});

test('qualified picks are allowed to route to best-bets', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // edge=78 < 85 → trader-insights suppressed; bb qualifies → promotion_target = 'best-bets'.
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA assists',
      selection: 'Player Over 8.5',
      confidence: 0.9,
      metadata: {
        sport: 'NBA',
        eventName: 'Suns vs Nuggets',
        promotionScores: {
          edge: 78,
          trust: 79,
          readiness: 88,
          uniqueness: 82,
          boardFit: 90,
        },
      },
    },
    repositories,
  );

  const tracked = await enqueueDistributionWithRunTracking(
    result.pick,
    'discord:best-bets',
    'api',
    repositories.picks,
    repositories.outbox,
    repositories.runs,
    repositories.audit,
  );

  const stored = await repositories.picks.findPickById(result.pick.id);
  assert.equal(stored?.promotion_status, 'qualified');
  assert.equal(stored?.promotion_target, 'best-bets');
  assert.equal(tracked.target, 'discord:best-bets');
});

test('force-promote override persists and allows best-bets routing', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA steals',
      selection: 'Player Over 1.5',
      confidence: 0.31,
      metadata: {
        sport: 'NBA',
        eventName: 'Magic vs Pistons',
        promotionScores: {
          edge: 30,
          trust: 35,
          readiness: 38,
          uniqueness: 60,
          boardFit: 55,
        },
      },
    },
    repositories,
  );

  const override = await applyPromotionOverride(
    {
      pickId: result.pick.id,
      actor: 'operator',
      action: 'force_promote',
      reason: 'operator selected as marquee board play',
    },
    repositories.picks,
    repositories.audit,
  );

  assert.equal(override.pickRecord.promotion_status, 'qualified');
  assert.equal(override.history.override_action, 'force_promote');
  assert.equal(override.audit.action, 'promotion.force_promote');

  const tracked = await enqueueDistributionWithRunTracking(
    override.pick,
    'discord:best-bets',
    'api',
    repositories.picks,
    repositories.outbox,
    repositories.runs,
    repositories.audit,
  );

  assert.equal(tracked.target, 'discord:best-bets');
});

test('suppression override persists and blocks best-bets routing', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA threes',
      selection: 'Player Over 2.5',
      confidence: 0.88,
      metadata: {
        sport: 'NBA',
        eventName: 'Mavs vs Kings',
        promotionScores: {
          edge: 92,
          trust: 91,
          readiness: 90,
          uniqueness: 80,
          boardFit: 89,
        },
      },
    },
    repositories,
  );

  const override = await applyPromotionOverride(
    {
      pickId: result.pick.id,
      actor: 'operator',
      action: 'suppress_from_best_bets',
      reason: 'duplicate thesis reserved for later slate',
    },
    repositories.picks,
    repositories.audit,
  );

  assert.equal(override.pickRecord.promotion_status, 'not_eligible');
  assert.equal(override.history.override_action, 'suppress_from_best_bets');
  assert.match(override.pickRecord.promotion_reason ?? '', /duplicate thesis reserved/i);

  await assert.rejects(
    () =>
      enqueueDistributionWithRunTracking(
        override.pick,
        'discord:best-bets',
        'api',
        repositories.picks,
        repositories.outbox,
        repositories.runs,
        repositories.audit,
      ),
    /Best Bets routing is blocked/,
  );
});

test('qualified picks are allowed to route to trader-insights', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA assists',
      selection: 'Player Over 9.5',
      confidence: 0.93,
      metadata: {
        sport: 'NBA',
        eventName: 'Bulls vs Knicks',
        promotionScores: {
          edge: 91,
          trust: 90,
          readiness: 88,
          uniqueness: 84,
          boardFit: 89,
        },
      },
    },
    repositories,
  );

  const tracked = await enqueueDistributionWithRunTracking(
    result.pick,
    'discord:trader-insights',
    'api',
    repositories.picks,
    repositories.outbox,
    repositories.runs,
    repositories.audit,
  );

  const stored = await repositories.picks.findPickById(result.pick.id);
  assert.equal(stored?.promotion_status, 'qualified');
  assert.equal(stored?.promotion_target, 'trader-insights');
  assert.equal(stored?.promotion_version, 'trader-insights-v1');
  assert.equal(tracked.target, 'discord:trader-insights');
});

test('trader-insights blocks picks below minimum score', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA assists',
      selection: 'Player Over 8.5',
      confidence: 0.9,
      metadata: {
        sport: 'NBA',
        eventName: 'Jazz vs Pelicans',
        promotionScores: {
          edge: 84,
          trust: 84,
          readiness: 84,
          uniqueness: 84,
          boardFit: 84,
        },
      },
    },
    repositories,
  );

  await assert.rejects(
    () =>
      enqueueDistributionWithRunTracking(
        result.pick,
        'discord:trader-insights',
        'api',
        repositories.picks,
        repositories.outbox,
        repositories.runs,
        repositories.audit,
      ),
    /Trader Insights routing is blocked/,
  );

  // edge=84 < 85 → trader-insights suppressed; bb qualifies (score 84 ≥ 70).
  // picks.promotion_target = 'best-bets'; ti suppression reason is in history row only.
  const stored = await repositories.picks.findPickById(result.pick.id);
  assert.equal(stored?.promotion_target, 'best-bets');
  assert.equal(stored?.promotion_status, 'qualified');
});

test('trader-insights blocks picks below edge threshold', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA points',
      selection: 'Player Over 21.5',
      confidence: 0.92,
      metadata: {
        sport: 'NBA',
        eventName: 'Spurs vs Rockets',
        promotionScores: {
          edge: 82,
          trust: 92,
          readiness: 90,
          uniqueness: 88,
          boardFit: 91,
        },
      },
    },
    repositories,
  );

  await assert.rejects(
    () =>
      enqueueDistributionWithRunTracking(
        result.pick,
        'discord:trader-insights',
        'api',
        repositories.picks,
        repositories.outbox,
        repositories.runs,
        repositories.audit,
      ),
    /Trader Insights routing is blocked/,
  );

  // edge=82 < 85 → trader-insights suppressed; bb qualifies (score 87.60 ≥ 70).
  // picks.promotion_target = 'best-bets'; ti edge suppression reason is in history row only.
  const stored = await repositories.picks.findPickById(result.pick.id);
  assert.equal(stored?.promotion_target, 'best-bets');
  assert.equal(stored?.promotion_status, 'qualified');
});

test('trader-insights blocks picks below trust threshold', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA rebounds',
      selection: 'Player Over 10.5',
      confidence: 0.92,
      metadata: {
        sport: 'NBA',
        eventName: 'Heat vs Sixers',
        promotionScores: {
          edge: 90,
          trust: 80,
          readiness: 92,
          uniqueness: 88,
          boardFit: 91,
        },
      },
    },
    repositories,
  );

  await assert.rejects(
    () =>
      enqueueDistributionWithRunTracking(
        result.pick,
        'discord:trader-insights',
        'api',
        repositories.picks,
        repositories.outbox,
        repositories.runs,
        repositories.audit,
      ),
    /Trader Insights routing is blocked/,
  );

  // trust=80 < 85 → trader-insights suppressed; bb qualifies (score 87.80 ≥ 70).
  // picks.promotion_target = 'best-bets'; ti trust suppression reason is in history row only.
  const stored = await repositories.picks.findPickById(result.pick.id);
  assert.equal(stored?.promotion_target, 'best-bets');
  assert.equal(stored?.promotion_status, 'qualified');
});

test('best-bets qualified pick does not automatically qualify for trader-insights', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA points',
      selection: 'Player Over 24.5',
      confidence: 0.88,
      metadata: {
        sport: 'NBA',
        eventName: 'Nets vs Cavs',
        promotionScores: {
          edge: 78,
          trust: 79,
          readiness: 89,
          uniqueness: 87,
          boardFit: 88,
        },
      },
    },
    repositories,
  );

  const bestBets = await enqueueDistributionWithRunTracking(
    result.pick,
    'discord:best-bets',
    'api',
    repositories.picks,
    repositories.outbox,
    repositories.runs,
    repositories.audit,
  );
  assert.equal(bestBets.target, 'discord:best-bets');

  await assert.rejects(
    () =>
      enqueueDistributionWithRunTracking(
        result.pick,
        'discord:trader-insights',
        'api',
        repositories.picks,
        repositories.outbox,
        repositories.runs,
        repositories.audit,
      ),
    /Trader Insights routing is blocked/,
  );
});

test('force-promote override persists and allows trader-insights routing', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA steals',
      selection: 'Player Over 1.5',
      confidence: 0.35,
      metadata: {
        sport: 'NBA',
        eventName: 'Hornets vs Hawks',
        promotionScores: {
          edge: 45,
          trust: 44,
          readiness: 50,
          uniqueness: 60,
          boardFit: 58,
        },
      },
    },
    repositories,
  );

  const override = await applyPromotionOverride(
    {
      pickId: result.pick.id,
      actor: 'operator',
      action: 'force_promote',
      reason: 'operator escalated market-alert play',
      target: 'trader-insights',
    },
    repositories.picks,
    repositories.audit,
  );

  assert.equal(override.pickRecord.promotion_target, 'trader-insights');
  assert.equal(override.pickRecord.promotion_status, 'qualified');

  const tracked = await enqueueDistributionWithRunTracking(
    override.pick,
    'discord:trader-insights',
    'api',
    repositories.picks,
    repositories.outbox,
    repositories.runs,
    repositories.audit,
  );

  assert.equal(tracked.target, 'discord:trader-insights');
});

test('generic suppression override persists and blocks trader-insights routing', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA threes',
      selection: 'Player Over 3.5',
      confidence: 0.94,
      metadata: {
        sport: 'NBA',
        eventName: 'Pacers vs Bucks',
        promotionScores: {
          edge: 92,
          trust: 91,
          readiness: 90,
          uniqueness: 87,
          boardFit: 92,
        },
      },
    },
    repositories,
  );

  const override = await applyPromotionOverride(
    {
      pickId: result.pick.id,
      actor: 'operator',
      action: 'suppress',
      reason: 'trader-insights reserved for a different market thesis',
      target: 'trader-insights',
    },
    repositories.picks,
    repositories.audit,
  );

  assert.equal(override.pickRecord.promotion_status, 'not_eligible');
  assert.equal(override.pickRecord.promotion_target, null);
  assert.equal(override.history.override_action, 'suppress');

  await assert.rejects(
    () =>
      enqueueDistributionWithRunTracking(
        override.pick,
        'discord:trader-insights',
        'api',
        repositories.picks,
        repositories.outbox,
        repositories.runs,
        repositories.audit,
      ),
    /Trader Insights routing is blocked/,
  );
});

test('board cap suppresses otherwise qualified best-bets candidates', async () => {
  const repositories = createInMemoryRepositoryBundle();
  for (let index = 0; index < 5; index += 1) {
    const seeded = await processSubmission(
      {
        source: 'test',
        market: `NBA points ${index}`,
        selection: `Player Over ${20 + index}.5`,
        confidence: 0.95,
        metadata: {
          sport: 'NBA',
          eventName: `Game ${index}`,
          promotionScores: {
            edge: 95,
            trust: 94,
            readiness: 90,
            uniqueness: 90,
            boardFit: 92,
          },
        },
      },
      repositories,
    );

    await applyPromotionOverride(
      {
        pickId: seeded.pick.id,
        actor: 'operator',
        action: 'force_promote',
        reason: 'seed board state',
      },
      repositories.picks,
      repositories.audit,
    );
  }

  // edge=78 < 85 → trader-insights suppressed; bb hits the board cap of 5.
  // Neither qualifies; bb's suppression data (board cap) is persisted on picks.
  const candidate = await processSubmission(
    {
      source: 'test',
      market: 'NBA rebounds',
      selection: 'Player Over 9.5',
      confidence: 0.92,
      metadata: {
        sport: 'NBA',
        eventName: 'Late Game',
        promotionScores: {
          edge: 78,
          trust: 79,
          readiness: 90,
          uniqueness: 88,
          boardFit: 90,
        },
      },
    },
    repositories,
  );

  await assert.rejects(
    () =>
      enqueueDistributionWithRunTracking(
        candidate.pick,
        'discord:best-bets',
        'api',
        repositories.picks,
        repositories.outbox,
        repositories.runs,
        repositories.audit,
      ),
    /Best Bets routing is blocked/,
  );

  const stored = await repositories.picks.findPickById(candidate.pick.id);
  assert.match(stored?.promotion_reason ?? '', /board cap/i);
});

test('settled best-bets picks do not consume board capacity', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const seededPickIds: string[] = [];
  const seededSports = ['NBA', 'NFL', 'NHL', 'MLB', 'NCAAB'];

  for (let index = 0; index < 5; index += 1) {
    const seeded = await processSubmission(
      {
        source: 'test',
        market: `NBA points ${index}`,
        selection: `Player Over ${20 + index}.5`,
        confidence: 0.95,
        metadata: {
          sport: seededSports[index],
          eventName: `Game ${index}`,
          promotionScores: {
            edge: 95,
            trust: 94,
            readiness: 90,
            uniqueness: 90,
            boardFit: 92,
          },
        },
      },
      repositories,
    );

    await applyPromotionOverride(
      {
        pickId: seeded.pick.id,
        actor: 'operator',
        action: 'force_promote',
        reason: 'seed board state',
      },
      repositories.picks,
      repositories.audit,
    );

    seededPickIds.push(seeded.pick.id);
  }

  const settledPickId = seededPickIds[0];
  assert.ok(settledPickId);

  await transitionPickLifecycle(
    repositories.picks,
    settledPickId,
    'queued',
    'seed board slot queued',
  );
  await transitionPickLifecycle(
    repositories.picks,
    settledPickId,
    'posted',
    'seed board slot posted',
  );
  await transitionPickLifecycle(
    repositories.picks,
    settledPickId,
    'settled',
    'seed board slot settled',
  );

  const candidate = await processSubmission(
    {
      source: 'test',
      market: 'NBA rebounds',
      selection: 'Player Over 9.5',
      confidence: 0.92,
      metadata: {
        sport: 'NBA',
        eventName: 'Late Game',
        promotionScores: {
          edge: 78,
          trust: 79,
          readiness: 90,
          uniqueness: 88,
          boardFit: 90,
        },
      },
    },
    repositories,
  );

  assert.equal(candidate.pick.promotionStatus, 'qualified');
  assert.equal(candidate.pick.promotionTarget, 'best-bets');

  const boardState = await repositories.picks.getPromotionBoardState({
    target: 'best-bets',
    sport: 'NBA',
    eventName: 'Late Game',
    market: 'NBA rebounds',
    selection: 'Player Over 9.5',
  });

  assert.equal(boardState.currentBoardCount, 5);
  assert.equal(boardState.sameSportCount, 1);
  assert.equal(boardState.sameGameCount, 1);
  assert.equal(boardState.duplicateCount, 1);
});

test('duplicate suppression blocks repeated best-bets thesis', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // edge=78 < 85 → trader-insights suppressed for both picks; bb sees the duplicate.
  const first = await processSubmission(
    {
      source: 'test',
      market: 'NBA points',
      selection: 'Player Over 27.5',
      confidence: 0.94,
      metadata: {
        sport: 'NBA',
        eventName: 'Warriors vs Lakers',
        promotionScores: {
          edge: 78,
          trust: 79,
          readiness: 91,
          uniqueness: 93,
          boardFit: 92,
        },
      },
    },
    repositories,
  );

  await applyPromotionOverride(
    {
      pickId: first.pick.id,
      actor: 'operator',
      action: 'force_promote',
      reason: 'seed duplicate check',
    },
    repositories.picks,
    repositories.audit,
  );

  const duplicate = await processSubmission(
    {
      source: 'test',
      market: 'NBA points',
      selection: 'Player Over 27.5',
      confidence: 0.94,
      metadata: {
        sport: 'NBA',
        eventName: 'Warriors vs Lakers',
        promotionScores: {
          edge: 78,
          trust: 79,
          readiness: 91,
          uniqueness: 93,
          boardFit: 92,
        },
      },
    },
    repositories,
  );

  await assert.rejects(
    () =>
      enqueueDistributionWithRunTracking(
        duplicate.pick,
        'discord:best-bets',
        'api',
        repositories.picks,
        repositories.outbox,
        repositories.runs,
        repositories.audit,
      ),
    /Best Bets routing is blocked/,
  );

  const stored = await repositories.picks.findPickById(duplicate.pick.id);
  assert.match(stored?.promotion_reason ?? '', /duplicate/i);
});

// A8: dual-qualifying pick routes exclusively to trader-insights
test('dual-qualifying pick routes exclusively to trader-insights and is blocked from best-bets', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // Scores clear both trader-insights (edge ≥ 85, trust ≥ 85, overall ≥ 80) and
  // best-bets (overall ≥ 70) thresholds. Priority order: trader-insights wins.
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA points',
      selection: 'Player Over 30.5',
      confidence: 0.95,
      metadata: {
        sport: 'NBA',
        eventName: 'Lakers vs Celtics',
        promotionScores: {
          edge: 90,
          trust: 88,
          readiness: 91,
          uniqueness: 87,
          boardFit: 92,
        },
      },
    },
    repositories,
  );

  // After eager eval: trader-insights wins (both qualify, ti has higher priority).
  assert.equal(result.pick.promotionTarget, 'trader-insights');
  assert.equal(result.pick.promotionStatus, 'qualified');

  // Routes successfully to trader-insights.
  const tiTracked = await enqueueDistributionWithRunTracking(
    result.pick,
    'discord:trader-insights',
    'api',
    repositories.picks,
    repositories.outbox,
    repositories.runs,
    repositories.audit,
  );
  assert.equal(tiTracked.target, 'discord:trader-insights');

  // Best-bets routing is blocked even though the pick would qualify on score alone.
  await assert.rejects(
    () =>
      enqueueDistributionWithRunTracking(
        result.pick,
        'discord:best-bets',
        'api',
        repositories.picks,
        repositories.outbox,
        repositories.runs,
        repositories.audit,
      ),
    /Best Bets routing is blocked/,
  );
});

// A3: best-bets with absent/null edge+trust scores still qualifies (thresholds are 0)
test('best-bets qualified pick with absent edge and trust scores still qualifies', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // No edge/trust in promotionScores. best-bets minimumEdge=0, minimumTrust=0 so
  // absent scores (fallback to confidence-based score) satisfy the threshold.
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA assists',
      selection: 'Player Over 6.5',
      confidence: 0.85,
      metadata: {
        sport: 'NBA',
        eventName: 'Hawks vs Celtics',
        promotionScores: {
          readiness: 82,
          uniqueness: 80,
          boardFit: 78,
          // edge and trust intentionally absent
        },
      },
    },
    repositories,
  );

  // confidence=0.85 → fallback score for edge/trust = 85 (passes threshold of 0).
  // overall = 85*0.35 + 85*0.25 + 82*0.2 + 80*0.1 + 78*0.1 = 29.75 + 21.25 + 16.4 + 8 + 7.8 = 83.2 ≥ 70.
  // trader-insights: edge=85 ≥ 85, trust=85 ≥ 85, overall=83.2 ≥ 80 → also qualifies → ti wins.
  assert.equal(result.pick.promotionTarget, 'trader-insights');
  assert.equal(result.pick.promotionStatus, 'qualified');

  // Can route to trader-insights.
  const tiTracked = await enqueueDistributionWithRunTracking(
    result.pick,
    'discord:trader-insights',
    'api',
    repositories.picks,
    repositories.outbox,
    repositories.runs,
    repositories.audit,
  );
  assert.equal(tiTracked.target, 'discord:trader-insights');
});
