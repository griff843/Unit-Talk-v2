import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRepositoryBundle, InMemoryPickOfferSnapshotRepository } from './persistence.js';
import { processSubmission } from './submission-service.js';
import { transitionPickLifecycle } from './lifecycle-service.js';
import { recordPickSettlement, recordEvidenceSettlement } from './settlement-service.js';

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
      stakeUnits: 1,
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
  assert.equal(payload['stakeUnitsStatus'], 'canonical');
});

test('recordPickSettlement classifies historical unknown stake rows and omits fake profit/loss', async () => {
  const { repositories, pick } = await createPostedPick();
  const stored = await repositories.picks.findPickById(pick.id);
  assert.ok(stored);
  stored!.stake_units = null;

  const result = await recordPickSettlement(
    pick.id,
    {
      status: 'settled',
      result: 'win',
      source: 'operator',
      confidence: 'confirmed',
      evidenceRef: 'proof://historical-unknown-stake',
      settledBy: 'operator',
    },
    repositories,
  );

  const payload = result.settlementRecord.payload as Record<string, unknown>;
  assert.equal(payload['stakeUnitsStatus'], 'historical_unknown');
  assert.equal(payload['stakeUnitsHistoricalUnknown'], true);
  assert.equal('profitLossUnits' in payload, false);
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

test('recordPickSettlement rethrows atomic transition failures without sequential settlement fallback', async () => {
  const { repositories, pick } = await createPostedPick();
  repositories.settlements.settlePickAtomic = async () => {
    throw new Error(
      `settle_pick_atomic failed: INVALID_SETTLEMENT_TRANSITION pick_id=${pick.id} expected_state=posted actual_state=validated attempted_state=settled`,
    );
  };

  await assert.rejects(
    () =>
      recordPickSettlement(
        pick.id,
        {
          status: 'settled',
          result: 'win',
          source: 'operator',
          confidence: 'confirmed',
          evidenceRef: 'boxscore://atomic-rejection',
          settledBy: 'operator',
        },
        repositories,
      ),
    /INVALID_SETTLEMENT_TRANSITION/,
  );

  const settlements = await repositories.settlements.listRecent();
  const savedPick = await repositories.picks.findPickById(pick.id);
  assert.equal(settlements.length, 0);
  assert.equal(savedPick?.status, 'posted');
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

// ---------------------------------------------------------------------------
// UTV2-1251: Evidence-plane settlement tests
// ---------------------------------------------------------------------------

async function createPickInAwaitingApproval() {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'system-pick-scanner',
      market: 'player_prop_ou',
      selection: 'Player Over 24.5',
      stakeUnits: 1,
      metadata: {},
    },
    repositories,
  );
  // Transition to awaiting_approval (governance brake for system sources)
  await transitionPickLifecycle(
    repositories.picks,
    result.pick.id,
    'awaiting_approval',
    'governance brake applied',
  );
  return { repositories, pick: result.pick };
}

const EVIDENCE_GRADING_CONTEXT = {
  actualValue: 27,
  marketKey: 'player_prop_ou',
  eventId: 'event-001',
  gameResultId: 'game-result-001',
};

test('recordEvidenceSettlement records outcome for awaiting_approval pick without status transition', async () => {
  const { repositories, pick } = await createPickInAwaitingApproval();

  const result = await recordEvidenceSettlement(
    pick.id,
    'win',
    EVIDENCE_GRADING_CONTEXT,
    repositories,
  );

  // Pick status must remain awaiting_approval — delivery gate is preserved
  const afterPick = await repositories.picks.findPickById(pick.id);
  assert.equal(afterPick?.status, 'awaiting_approval', 'picks.status must stay awaiting_approval');

  // Settlement record must exist and capture the outcome
  assert.equal(result.settlementRecord.result, 'win');
  assert.equal(result.settlementRecord.source, 'grading');
  assert.equal(result.finalLifecycleState, 'awaiting_approval');
  assert.equal(result.lifecycleEvent, null, 'no lifecycle transition should occur');

  // Audit record must flag evidence plane
  assert.ok(result.auditRecords.length > 0);
  assert.equal(result.auditRecords[0]!.action, 'settlement.evidence_graded');
  const auditPayload = result.auditRecords[0]!.payload as Record<string, unknown>;
  assert.equal(auditPayload['evidencePlane'], true);
});

test('recordEvidenceSettlement settlement record is visible to settlement repository', async () => {
  const { repositories, pick } = await createPickInAwaitingApproval();

  await recordEvidenceSettlement(pick.id, 'loss', EVIDENCE_GRADING_CONTEXT, repositories);

  const records = await repositories.settlements.listByPick(pick.id);
  assert.equal(records.length, 1);
  assert.equal(records[0]!.result, 'loss');
  assert.equal(records[0]!.status, 'settled');
});

test('recordEvidenceSettlement rejects non-awaiting_approval pick', async () => {
  const { repositories, pick } = await createPostedPick();

  await assert.rejects(
    () =>
      recordEvidenceSettlement(pick.id, 'win', EVIDENCE_GRADING_CONTEXT, repositories),
    /Evidence settlement requires awaiting_approval state/,
  );
});

// Note: deduplication via unique constraint (settlement_records_pick_source_idx)
// is enforced at the DB layer only; InMemory repos do not enforce it.
// The isDuplicateSettlementError path is covered by production integration tests.

test('recordPickSettlement still requires posted state (delivery path unchanged)', async () => {
  const { repositories, pick } = await createPickInAwaitingApproval();

  await assert.rejects(
    () =>
      recordPickSettlement(
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
      ),
    /posted or settled state/,
  );

  // Pick status must remain awaiting_approval
  const afterPick = await repositories.picks.findPickById(pick.id);
  assert.equal(afterPick?.status, 'awaiting_approval');
});

// UTV2-1262: closing_for_clv snapshot persistence tests

test('recordEvidenceSettlement succeeds even when pickOfferSnapshots.insert throws (fail-open)', async () => {
  const { repositories, pick } = await createPickInAwaitingApproval();
  // Inject a failing snapshot repo to verify settlement is not affected
  const failingRepo: import('@unit-talk/db').PickOfferSnapshotRepository = {
    insert: async () => { throw new Error('simulated DB failure'); },
    existsForPick: async () => false,
    countByKind: async () => 0,
  };
  repositories.pickOfferSnapshots = failingRepo;

  const result = await recordEvidenceSettlement(
    pick.id,
    'win',
    EVIDENCE_GRADING_CONTEXT,
    repositories,
  );

  // Settlement must succeed regardless of snapshot write failure
  assert.equal(result.settlementRecord.result, 'win');
  assert.equal(result.finalLifecycleState, 'awaiting_approval');
});

test('recordEvidenceSettlement does not write snapshot when no closing line resolved', async () => {
  const { repositories, pick } = await createPickInAwaitingApproval();
  // InMemory repos have no seeded closing line data → CLV returns null → no snapshot
  const snapshotRepo = new InMemoryPickOfferSnapshotRepository();
  repositories.pickOfferSnapshots = snapshotRepo;

  await recordEvidenceSettlement(pick.id, 'win', EVIDENCE_GRADING_CONTEXT, repositories);

  // No snapshot written because CLV could not resolve a closing line
  const count = await snapshotRepo.countByKind('closing_for_clv');
  assert.equal(count, 0, 'no snapshot should be written when CLV cannot resolve closing line');
});

test('InMemoryPickOfferSnapshotRepository insert and existsForPick work correctly', async () => {
  const repo = new InMemoryPickOfferSnapshotRepository();

  const before = await repo.existsForPick('pick-abc', 'closing_for_clv');
  assert.equal(before, false);

  await repo.insert({
    pick_id: 'pick-abc',
    settlement_record_id: 'sr-001',
    snapshot_kind: 'closing_for_clv',
    provider_key: 'sgo',
    provider_event_id: 'evt-001',
    provider_market_key: 'turnovers-all-game-ou',
    provider_participant_id: null,
    bookmaker_key: 'pinnacle',
    line: 3.5,
    over_odds: -110,
    under_odds: -110,
    captured_at: '2026-06-01T22:00:00Z',
    identity_key: 'sgo:evt-001:turnovers-all-game-ou:null:pinnacle:closing_for_clv',
    devig_mode: 'proportional',
    payload: { writer: 'test', issue: 'UTV2-1262' },
  });

  const after = await repo.existsForPick('pick-abc', 'closing_for_clv');
  assert.equal(after, true);

  const count = await repo.countByKind('closing_for_clv');
  assert.equal(count, 1);

  // Different pick → not found
  const other = await repo.existsForPick('pick-xyz', 'closing_for_clv');
  assert.equal(other, false);
});

test('InMemoryPickOfferSnapshotRepository countByKind returns 0 for unknown kind', async () => {
  const repo = new InMemoryPickOfferSnapshotRepository();
  const count = await repo.countByKind('closing_for_clv');
  assert.equal(count, 0);
});
