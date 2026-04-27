import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { processSubmission } from './submission-service.js';
import { transitionPickLifecycle } from './lifecycle-service.js';
import { recordPickSettlement } from './settlement-service.js';

async function createPickInState(
  state: 'validated' | 'queued' | 'posted',
  overrides?: {
    source?: import('@unit-talk/contracts').PickSource;
    market?: string;
    selection?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: overrides?.source ?? 'api',
      market: overrides?.market ?? 'NBA points',
      selection: overrides?.selection ?? 'Player Over 24.5',
      metadata: overrides?.metadata,
    },
    repositories,
  );

  if (state === 'queued' || state === 'posted') {
    await transitionPickLifecycle(
      repositories.picks,
      result.pick.id,
      'queued',
      'ready for posting',
    );
  }

  let postedLifecycleEvent = null;
  if (state === 'posted') {
    postedLifecycleEvent = (
      await transitionPickLifecycle(
        repositories.picks,
        result.pick.id,
        'posted',
        'posted to channel',
        'poster',
      )
    ).lifecycleEvent;
  }

  return {
    repositories,
    submission: result.submission,
    pick: result.pick,
    postedLifecycleEvent,
  };
}

async function createPostedPick(overrides?: {
  source?: import('@unit-talk/contracts').PickSource;
  market?: string;
  selection?: string;
  metadata?: Record<string, unknown>;
}) {
  return createPickInState('posted', overrides);
}

test('recordPickSettlement settles a posted pick and records audit evidence', async () => {
  const { repositories, submission, pick, postedLifecycleEvent } = await createPostedPick();

  const result = await recordPickSettlement(
    pick.id,
    {
      status: 'settled',
      result: 'win',
      source: 'operator',
      confidence: 'confirmed',
      evidenceRef: 'boxscore://nba/game-1',
      settledBy: 'operator',
    },
    repositories,
  );

  assert.equal(submission.id.length > 0, true);
  assert.equal(postedLifecycleEvent?.to_state, 'posted');
  assert.equal(result.settlementRecord.status, 'settled');
  assert.equal(result.settlementRecord.result, 'win');
  assert.equal(result.finalLifecycleState, 'settled');
  assert.equal(result.lifecycleEvent?.to_state, 'settled');
  assert.equal(result.auditRecords[0]?.action, 'settlement.recorded');
});

test('recordPickSettlement preserves candidate and market-universe provenance in payload', async () => {
  const { repositories, pick } = await createPostedPick({
    metadata: {
      scoredCandidateId: 'candidate-754',
      marketUniverseId: 'universe-754',
    },
  });

  const result = await recordPickSettlement(
    pick.id,
    {
      status: 'settled',
      result: 'win',
      source: 'operator',
      confidence: 'confirmed',
      evidenceRef: 'boxscore://mlb/provenance',
      settledBy: 'operator',
    },
    repositories,
  );

  const payload = result.settlementRecord.payload as Record<string, unknown>;
  assert.equal(payload['scoredCandidateId'], 'candidate-754');
  assert.equal(payload['marketUniverseId'], 'universe-754');
});

test('recordPickSettlement rejects invalid settlement requests without writes', async () => {
  const { repositories, pick } = await createPostedPick();

  await assert.rejects(
    () =>
      recordPickSettlement(
        pick.id,
        {
          status: 'settled',
          source: 'operator',
          confidence: 'confirmed',
          evidenceRef: '',
          settledBy: '',
        },
        repositories,
      ),
    /INVALID_SETTLEMENT_REQUEST|result must be one of|evidenceRef is required|settledBy is required/,
  );

  const settlements = await repositories.settlements.listRecent();
  assert.equal(settlements.length, 0);
});

test('recordPickSettlement creates manual-review record for ambiguous settlement and keeps pick posted', async () => {
  const { repositories, pick } = await createPostedPick();

  const result = await recordPickSettlement(
    pick.id,
    {
      status: 'manual_review',
      source: 'operator',
      confidence: 'pending',
      evidenceRef: 'screenshot://ambiguous-final-score',
      reviewReason: 'conflicting box score sources',
      settledBy: 'operator',
    },
    repositories,
  );

  assert.equal(result.settlementRecord.status, 'manual_review');
  assert.equal(result.settlementRecord.result, null);
  assert.ok(result.lifecycleEvent !== null, 'manual review must write a lifecycle row');
  assert.equal(result.lifecycleEvent?.to_state, 'posted');
  assert.equal(result.finalLifecycleState, 'posted');
  assert.equal(result.auditRecords[0]?.action, 'settlement.manual_review');
});

test('recordPickSettlement creates additive correction record for already-settled pick', async () => {
  const { repositories, pick } = await createPostedPick();

  const first = await recordPickSettlement(
    pick.id,
    {
      status: 'settled',
      result: 'loss',
      source: 'operator',
      confidence: 'confirmed',
      evidenceRef: 'boxscore://initial',
      settledBy: 'operator',
    },
    repositories,
  );

  const correction = await recordPickSettlement(
    pick.id,
    {
      status: 'settled',
      result: 'win',
      source: 'operator',
      confidence: 'confirmed',
      evidenceRef: 'boxscore://corrected',
      notes: 'stat correction after review',
      settledBy: 'operator',
    },
    repositories,
  );

  assert.equal(first.finalLifecycleState, 'settled');
  assert.equal(correction.finalLifecycleState, 'settled');
  assert.equal(correction.settlementRecord.corrects_id, first.settlementRecord.id);
  assert.ok(correction.lifecycleEvent !== null, 'correction must write a lifecycle row');
  assert.equal(correction.lifecycleEvent?.to_state, 'settled');
  assert.equal(correction.auditRecords[0]?.action, 'settlement.corrected');
});

test('recordPickSettlement returns effective downstream settlement truth for corrections', async () => {
  const { repositories, pick } = await createPostedPick();

  await recordPickSettlement(
    pick.id,
    {
      status: 'settled',
      result: 'loss',
      source: 'operator',
      confidence: 'confirmed',
      evidenceRef: 'proof://initial-loss',
      settledBy: 'operator',
    },
    repositories,
  );

  const correction = await recordPickSettlement(
    pick.id,
    {
      status: 'settled',
      result: 'win',
      source: 'operator',
      confidence: 'confirmed',
      evidenceRef: 'proof://corrected-win',
      settledBy: 'operator',
    },
    repositories,
  );

  assert.equal(
    correction.downstream.effectiveSettlement?.effective_record_id,
    correction.settlementRecord.id,
  );
  assert.equal(correction.downstream.effectiveSettlement?.result, 'win');
  assert.equal(correction.downstream.effectiveSettlement?.correction_depth, 1);
  assert.equal(correction.downstream.settlementSummary.total_records, 2);
  assert.equal(correction.downstream.settlementSummary.correction_count, 1);
  assert.equal(correction.downstream.settlementSummary.hit_rate_pct, 100);
  assert.ok(correction.downstream.settlementSummary.flat_bet_roi.roi_pct > 0);
});

test('recordPickSettlement rejects settlement when pick is still validated', async () => {
  const { repositories, pick } = await createPickInState('validated');

  await assert.rejects(
    () =>
      recordPickSettlement(
        pick.id,
        {
          status: 'settled',
          result: 'win',
          source: 'operator',
          confidence: 'confirmed',
          evidenceRef: 'proof://validated',
          settledBy: 'operator',
        },
        repositories,
      ),
    /must be in posted or settled state; found validated/,
  );
});

test('recordPickSettlement rejects settlement when pick is still queued', async () => {
  const { repositories, pick } = await createPickInState('queued');

  await assert.rejects(
    () =>
      recordPickSettlement(
        pick.id,
        {
          status: 'settled',
          result: 'win',
          source: 'operator',
          confidence: 'confirmed',
          evidenceRef: 'proof://queued',
          settledBy: 'operator',
        },
        repositories,
      ),
    /must be in posted or settled state; found queued/,
  );
});

test('recordPickSettlement rejects settlement when pick does not exist', async () => {
  const repositories = createInMemoryRepositoryBundle();

  await assert.rejects(
    () =>
      recordPickSettlement(
        'missing-pick-id',
        {
          status: 'settled',
          result: 'win',
          source: 'operator',
          confidence: 'confirmed',
          evidenceRef: 'proof://missing',
          settledBy: 'operator',
        },
        repositories,
      ),
    /PICK_NOT_FOUND|Pick not found: missing-pick-id/,
  );
});

test('recordPickSettlement rejects manual_review requests without reviewReason', async () => {
  const { repositories, pick } = await createPostedPick();

  await assert.rejects(
    () =>
      recordPickSettlement(
        pick.id,
        {
          status: 'manual_review',
          source: 'operator',
          confidence: 'pending',
          evidenceRef: 'proof://manual-review-missing-reason',
          settledBy: 'operator',
        },
        repositories,
      ),
    /reviewReason is required for manual_review/,
  );
});

test('recordPickSettlement blocks automated feed settlement input without writes', async () => {
  const { repositories, pick } = await createPostedPick();

  await assert.rejects(
    () =>
      recordPickSettlement(
        pick.id,
        {
          status: 'settled',
          result: 'win',
          source: 'feed',
          confidence: 'confirmed',
          evidenceRef: 'feed://settlement',
          settledBy: 'feed-bridge',
        },
        repositories,
      ),
    /AUTOMATED_SETTLEMENT_NOT_ALLOWED|Automated settlement input is blocked/,
  );

  const settlements = await repositories.settlements.listRecent();
  assert.equal(settlements.length, 0);
});

test('recordPickSettlement classifies confirmed losses for downstream consumers', async () => {
  const { repositories, pick } = await createPostedPick({
    metadata: {
      lossAttribution: {
        ev: 5.2,
        clvAtBet: -4.1,
        clvAtClose: -3.8,
        hasFeatureSnapshot: true,
      },
    },
  });

  const result = await recordPickSettlement(
    pick.id,
    {
      status: 'settled',
      result: 'loss',
      source: 'operator',
      confidence: 'confirmed',
      evidenceRef: 'proof://classified-loss',
      settledBy: 'operator',
    },
    repositories,
  );

  assert.equal(result.downstream.lossAttribution?.classification, 'PRICE_MISS');
  assert.equal(
    result.downstream.lossAttributionSummary?.top_category,
    'PRICE_MISS',
  );
});

test('manual_review can be followed by settlement with two additive records and no mutation', async () => {
  const { repositories, pick } = await createPostedPick();

  const manualReview = await recordPickSettlement(
    pick.id,
    {
      status: 'manual_review',
      source: 'operator',
      confidence: 'pending',
      evidenceRef: 'proof://manual-review',
      reviewReason: 'ambiguous final score',
      settledBy: 'operator',
    },
    repositories,
  );

  const settled = await recordPickSettlement(
    pick.id,
    {
      status: 'settled',
      result: 'win',
      source: 'operator',
      confidence: 'confirmed',
      evidenceRef: 'proof://resolved',
      settledBy: 'operator',
    },
    repositories,
  );

  const allSettlements = await repositories.settlements.listRecent(10);
  const pickSettlements = allSettlements.filter((row) => row.pick_id === pick.id);
  const manualReviewAfter = pickSettlements.find((row) => row.id === manualReview.settlementRecord.id);

  assert.equal(pickSettlements.length, 2);
  assert.equal(settled.finalLifecycleState, 'settled');
  assert.equal(manualReviewAfter?.status, 'manual_review');
  assert.equal(manualReviewAfter?.review_reason, 'ambiguous final score');
  assert.equal(manualReviewAfter?.result, null);
  assert.equal(manualReviewAfter?.corrects_id, null);
});

test('original settlement record fields remain unchanged after a correction is applied', async () => {
  const { repositories, pick } = await createPostedPick();

  const original = await recordPickSettlement(
    pick.id,
    {
      status: 'settled',
      result: 'loss',
      source: 'operator',
      confidence: 'confirmed',
      evidenceRef: 'proof://initial',
      notes: 'initial ruling',
      settledBy: 'operator',
    },
    repositories,
  );

  await recordPickSettlement(
    pick.id,
    {
      status: 'settled',
      result: 'win',
      source: 'operator',
      confidence: 'confirmed',
      evidenceRef: 'proof://correction',
      notes: 'corrected after stat adjustment',
      settledBy: 'operator',
    },
    repositories,
  );

  const allSettlements = await repositories.settlements.listRecent(10);
  const originalAfter = allSettlements.find((row) => row.id === original.settlementRecord.id);

  assert.equal(originalAfter?.result, 'loss');
  assert.equal(originalAfter?.notes, 'initial ruling');
  assert.equal(originalAfter?.corrects_id, null);
  assert.equal(originalAfter?.status, 'settled');
});

test('correcting a correction preserves a three-record additive chain', async () => {
  const { repositories, pick } = await createPostedPick();

  const first = await recordPickSettlement(
    pick.id,
    {
      status: 'settled',
      result: 'loss',
      source: 'operator',
      confidence: 'confirmed',
      evidenceRef: 'proof://first',
      settledBy: 'operator',
    },
    repositories,
  );

  const second = await recordPickSettlement(
    pick.id,
    {
      status: 'settled',
      result: 'push',
      source: 'operator',
      confidence: 'confirmed',
      evidenceRef: 'proof://second',
      notes: 'first correction',
      settledBy: 'operator',
    },
    repositories,
  );

  const third = await recordPickSettlement(
    pick.id,
    {
      status: 'settled',
      result: 'win',
      source: 'operator',
      confidence: 'confirmed',
      evidenceRef: 'proof://third',
      notes: 'second correction',
      settledBy: 'operator',
    },
    repositories,
  );

  const pickSettlements = (await repositories.settlements.listRecent(10)).filter(
    (row) => row.pick_id === pick.id,
  );
  const firstAfter = pickSettlements.find((row) => row.id === first.settlementRecord.id);
  const secondAfter = pickSettlements.find((row) => row.id === second.settlementRecord.id);
  const thirdAfter = pickSettlements.find((row) => row.id === third.settlementRecord.id);

  assert.equal(pickSettlements.length, 3);
  assert.equal(secondAfter?.corrects_id, first.settlementRecord.id);
  assert.equal(thirdAfter?.corrects_id, second.settlementRecord.id);
  assert.equal(firstAfter?.result, 'loss');
  assert.equal(secondAfter?.result, 'push');
  assert.equal(thirdAfter?.result, 'win');
});
