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

test('recordPickSettlement refuses a context-less settlement on an evidence-plane pick', async () => {
  const { repositories, pick } = await createPickInAwaitingApproval();

  // UTV2-1904 deliberately changed *which* refusal this produces. Before the
  // operator evidence path existed, an `awaiting_approval` pick fell through to
  // the generic `posted or settled state` error; it now reaches the evidence
  // branch and is refused there for the specific reason that applies. The
  // load-bearing assertion is unchanged and is the one below the rejection: the
  // request is still refused and the pick is still not settled.
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
    /OPERATOR_GRADING_CONTEXT_REQUIRED|requires operatorGradingContext/,
  );

  // Pick status must remain awaiting_approval, and nothing may be written.
  const afterPick = await repositories.picks.findPickById(pick.id);
  assert.equal(afterPick?.status, 'awaiting_approval');
  assert.equal(await repositories.settlements.findLatestForPick(pick.id), null);
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

// ── UTV2-1815: null-stake computation truth ─────────────────────────────────
// The NULL case is covered above. NaN is the case the old
// `stakeUnits ?? 1` guard let through: `??` only fires on null/undefined, so a
// NaN stake reached the arithmetic and produced NaN, or was coerced. Both
// fixtures must land on the same refusal.

test('UTV2-1815 recordPickSettlement refuses a NaN stake the same way it refuses NULL', async () => {
  const { repositories, pick } = await createPostedPick();
  const stored = await repositories.picks.findPickById(pick.id);
  assert.ok(stored);
  stored!.stake_units = Number.NaN;

  const result = await recordPickSettlement(
    pick.id,
    {
      status: 'settled',
      result: 'win',
      source: 'operator',
      confidence: 'confirmed',
      evidenceRef: 'proof://nan-stake',
      settledBy: 'operator',
    },
    repositories,
  );

  const payload = result.settlementRecord.payload as Record<string, unknown>;
  assert.equal(payload['stakeUnitsStatus'], 'historical_unknown');
  assert.equal(payload['stakeUnitsHistoricalUnknown'], true);
  assert.equal('profitLossUnits' in payload, false);
});

test('UTV2-1815 a real stake still produces a real profit/loss (negative control)', async () => {
  const { repositories, pick } = await createPostedPick();
  const stored = await repositories.picks.findPickById(pick.id);
  assert.ok(stored);
  stored!.stake_units = 2;
  stored!.odds = 100;

  const result = await recordPickSettlement(
    pick.id,
    {
      status: 'settled',
      result: 'win',
      source: 'operator',
      confidence: 'confirmed',
      evidenceRef: 'proof://canonical-stake',
      settledBy: 'operator',
    },
    repositories,
  );

  const payload = result.settlementRecord.payload as Record<string, unknown>;
  assert.equal(payload['stakeUnitsStatus'], 'canonical');
  assert.equal(payload['stakeUnitsHistoricalUnknown'], undefined);
  assert.equal(payload['profitLossUnits'], 2);
});

// ---------------------------------------------------------------------------
// UTV2-1904: operator settlement of an evidence-plane pick
// ---------------------------------------------------------------------------

const OPERATOR_GRADING_CONTEXT = {
  outcomeBasis: 'Final box score: Lions 24, Bears 17 — Lions -3.5 covered',
  resultSourceUrl: 'https://www.nfl.com/games/lions-at-bears-2026',
  observedAt: '2026-09-14T22:40:00.000Z',
};

function operatorSettlementRequest(
  overrides?: Partial<import('@unit-talk/contracts').SettlementRequest>,
): import('@unit-talk/contracts').SettlementRequest {
  return {
    status: 'settled',
    result: 'win',
    source: 'operator',
    confidence: 'confirmed',
    evidenceRef: 'manual:nfl-box-score',
    settledBy: 'griff843',
    operatorGradingContext: OPERATOR_GRADING_CONTEXT,
    ...overrides,
  };
}

/**
 * A Track Only pick, built the way production builds one: through
 * `processSubmission` with `distributionMode: 'track-only'`, left at
 * `validated`. That pair — and not the status alone — is what
 * `isEvidencePlanePick` keys on.
 */
async function createTrackOnlyValidatedPick() {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'smart-form',
      market: 'spread',
      selection: 'Lions -3.5',
      stakeUnits: 2,
      metadata: {
        distributionMode: 'track-only',
        capper: 'griff843',
        submittedBy: 'griff843',
      },
    },
    repositories,
  );
  // Read the row back rather than trusting the returned object: the in-memory
  // sequential fallback returns a pick with no `status` field at all, so
  // asserting on `result.pick.status` would compare against `undefined` and
  // prove nothing about the fixture.
  const persisted = await repositories.picks.findPickById(result.pick.id);
  assert.equal(
    persisted?.status,
    'validated',
    'fixture precondition: a Track Only submission stops at validated',
  );
  return { repositories, pick: result.pick };
}

test('operator settles a Track Only pick with no lifecycle transition and no delivery', async () => {
  const { repositories, pick } = await createTrackOnlyValidatedPick();

  const result = await recordPickSettlement(
    pick.id,
    operatorSettlementRequest(),
    repositories,
  );

  assert.equal(result.settlementRecord.status, 'settled');
  assert.equal(result.settlementRecord.result, 'win');
  assert.equal(
    result.settlementRecord.source,
    'operator',
    "the row must say an operator settled it, not 'grading'",
  );
  assert.equal(result.settlementRecord.settled_by, 'griff843');

  // No transition: validated -> settled is not a legal FSM edge.
  assert.equal(result.lifecycleEvent, null);
  assert.equal(result.finalLifecycleState, 'validated');
  const afterPick = await repositories.picks.findPickById(pick.id);
  assert.equal(afterPick?.status, 'validated');

  // Zero delivery, in every status rather than only 'sent'.
  const anyOutbox = await repositories.outbox.findLatestByPick(pick.id, [
    'pending',
    'claimed',
    'sent',
    'failed',
    'dead_letter',
  ]);
  assert.equal(anyOutbox, null, 'a Track Only settlement must enqueue nothing');

  const payload = result.settlementRecord.payload as Record<string, unknown>;
  assert.equal(payload['evidencePlane'], true);
  assert.equal(payload['operatorSettled'], true);
  assert.deepEqual(payload['operatorGradingContext'], OPERATOR_GRADING_CONTEXT);
  // CLV is absent because there is no event scope, and the row says which.
  assert.equal(payload['clv'], null);
  assert.equal(
    payload['clvUnavailableReason'],
    'operator_evidence_settlement_has_no_event_scope',
  );

  const auditActions = result.auditRecords.map((record) => record.action);
  assert.deepEqual(auditActions, ['settlement.operator_evidence_graded']);
});

test('operator settlement of an evidence-plane pick refuses without grading context', async () => {
  const { repositories, pick } = await createTrackOnlyValidatedPick();

  await assert.rejects(
    () =>
      recordPickSettlement(
        pick.id,
        operatorSettlementRequest({ operatorGradingContext: undefined }),
        repositories,
      ),
    /OPERATOR_GRADING_CONTEXT_REQUIRED|requires operatorGradingContext/,
  );

  // Fail closed means nothing was written, not merely that a 400 was returned.
  const settlement = await repositories.settlements.findLatestForPick(pick.id);
  assert.equal(settlement, null, 'a refused settlement must write no row');
});

test('operator settlement refuses a malformed grading context before dispatch', async () => {
  const { repositories, pick } = await createTrackOnlyValidatedPick();

  await assert.rejects(
    () =>
      recordPickSettlement(
        pick.id,
        operatorSettlementRequest({
          operatorGradingContext: { ...OPERATOR_GRADING_CONTEXT, observedAt: 'yesterday' },
        }),
        repositories,
      ),
    /observedAt must be an ISO-8601 instant/,
  );

  const settlement = await repositories.settlements.findLatestForPick(pick.id);
  assert.equal(settlement, null);
});

test("feed-sourced settlement is still refused on an evidence-plane pick", async () => {
  const { repositories, pick } = await createTrackOnlyValidatedPick();

  // The automated-settlement refusal precedes every dispatch branch, so adding
  // one must not have created a route around it.
  await assert.rejects(
    () =>
      recordPickSettlement(
        pick.id,
        operatorSettlementRequest({ source: 'feed' }),
        repositories,
      ),
    /AUTOMATED_SETTLEMENT_NOT_ALLOWED|Automated settlement input is blocked/,
  );
});

test("'grading' source is refused on the operator path", async () => {
  const { repositories, pick } = await createTrackOnlyValidatedPick();

  await assert.rejects(
    () =>
      recordPickSettlement(
        pick.id,
        operatorSettlementRequest({ source: 'grading' }),
        repositories,
      ),
    /OPERATOR_SETTLEMENT_SOURCE_INVALID|reserved for the automatic grading pass/,
  );
});

test('manual_review on a Track Only pick is still refused', async () => {
  const { repositories, pick } = await createTrackOnlyValidatedPick();

  // This is the control on the dispatch *order*. The evidence-plane branch sits
  // after the manual_review branch; if it were moved above it, this refusal
  // would silently become an acceptance.
  await assert.rejects(
    () =>
      recordPickSettlement(
        pick.id,
        operatorSettlementRequest({
          status: 'manual_review',
          result: undefined,
          reviewReason: 'score disputed',
          operatorGradingContext: undefined,
        }),
        repositories,
      ),
    /posted/,
  );
});

test('an awaiting_approval pick also settles through the operator path', async () => {
  const { repositories, pick } = await createPickInAwaitingApproval();

  const result = await recordPickSettlement(
    pick.id,
    operatorSettlementRequest({ result: 'loss' }),
    repositories,
  );

  assert.equal(result.settlementRecord.result, 'loss');
  assert.equal(result.lifecycleEvent, null);
  const afterPick = await repositories.picks.findPickById(pick.id);
  assert.equal(
    afterPick?.status,
    'awaiting_approval',
    'the governance brake is not released by an outcome',
  );
});

test('a posted pick still settles without any operator grading context', async () => {
  const { repositories, pick } = await createPostedPick();

  // The new field is optional for a reason: the posted path resolves provenance
  // from the pick's own delivery history and must be unaffected.
  const result = await recordPickSettlement(
    pick.id,
    operatorSettlementRequest({ operatorGradingContext: undefined }),
    repositories,
  );

  assert.equal(result.settlementRecord.status, 'settled');
  assert.equal(result.finalLifecycleState, 'settled');
  assert.notEqual(result.lifecycleEvent, null);
});

// ---------------------------------------------------------------------------
// UTV2-1919: an evidence-plane settlement can be corrected
//
// An evidence-plane pick keeps its status after it settles, so every later
// operator grade re-enters `recordOperatorEvidenceSettlement` rather than
// `recordSettlementCorrection`. Before this lane that wrote a second *original*
// — `corrects_id` null — which production's partial unique index
// `settlement_records_pick_source_idx (pick_id, source) WHERE corrects_id IS
// NULL` refuses with 23505, and which the handler then reported as success.
//
// In memory there is no unique index, so the pre-fix failure shows up as its
// other half instead: two root records, which `resolveEffectiveSettlement`
// refuses as MULTIPLE_ROOT_RECORDS. Both halves are asserted below.
// ---------------------------------------------------------------------------

test('UTV2-1919: a second operator grade corrects the first rather than writing a second original', async () => {
  const { repositories, pick } = await createTrackOnlyValidatedPick();

  const first = await recordPickSettlement(
    pick.id,
    operatorSettlementRequest({ result: 'win', evidenceRef: 'manual:box-score:v1' }),
    repositories,
  );

  assert.equal(first.settlementRecord.corrects_id, null, 'the first settlement is the original');
  assert.equal(
    (first.settlementRecord.payload as Record<string, unknown>)['correction'],
    false,
  );

  const second = await recordPickSettlement(
    pick.id,
    operatorSettlementRequest({ result: 'loss', evidenceRef: 'manual:box-score:v2' }),
    repositories,
  );

  // The correction is a NEW row that points at the one it supersedes.
  assert.notEqual(second.settlementRecord.id, first.settlementRecord.id);
  assert.equal(
    second.settlementRecord.corrects_id,
    first.settlementRecord.id,
    'the correction must reference the settlement it supersedes',
  );
  assert.equal(second.settlementRecord.result, 'loss');

  const secondPayload = second.settlementRecord.payload as Record<string, unknown>;
  assert.equal(secondPayload['correction'], true);
  assert.equal(secondPayload['priorSettlementRecordId'], first.settlementRecord.id);
  assert.equal(secondPayload['priorResult'], 'win');
  assert.equal(secondPayload['evidencePlane'], true);
  assert.equal(secondPayload['operatorSettled'], true);

  // The original is immutable — read it back from the repository rather than
  // trusting the object returned before the correction was written.
  const all = await repositories.settlements.listByPick(pick.id);
  assert.equal(all.length, 2, 'a correction adds a row; it never mutates one');
  const original = all.find((row) => row.id === first.settlementRecord.id);
  assert.equal(original?.result, 'win', 'the superseded settlement keeps its original result');
  assert.equal(original?.corrects_id, null);

  // Exactly one statistical contribution, and it is the corrected one.
  assert.equal(second.downstream.unresolvedReason, null);
  assert.equal(
    second.downstream.effectiveSettlement?.effective_record_id,
    second.settlementRecord.id,
  );
  assert.equal(second.downstream.effectiveSettlement?.result, 'loss');
  assert.equal(second.downstream.effectiveSettlement?.correction_depth, 1);

  assert.deepEqual(
    second.auditRecords.map((record) => record.action),
    ['settlement.operator_evidence_corrected'],
    'a correction must be auditable as a correction, not as a first grading',
  );
});

test('UTV2-1919: WIN -> LOSS -> WIN yields one contribution at each point and never two', async () => {
  const { repositories, pick } = await createTrackOnlyValidatedPick();

  const results: Array<'win' | 'loss'> = ['win', 'loss', 'win'];
  const ids: string[] = [];

  for (const [index, result] of results.entries()) {
    const settlement = await recordPickSettlement(
      pick.id,
      operatorSettlementRequest({ result, evidenceRef: `manual:box-score:v${index + 1}` }),
      repositories,
    );
    ids.push(settlement.settlementRecord.id);

    // At every point in the chain — not only at the end — the pick contributes
    // exactly one settled outcome, and it is the most recent grade.
    assert.equal(
      settlement.downstream.unresolvedReason,
      null,
      `chain must resolve after grade ${index + 1}`,
    );
    assert.equal(
      settlement.downstream.effectiveSettlement?.result,
      result,
      `the effective settlement after grade ${index + 1} must be ${result}`,
    );
    assert.equal(
      settlement.downstream.effectiveSettlement?.correction_depth,
      index,
      'correction depth must track the position in the chain',
    );
    // `total_picks` is the statistical contribution — one pick, one outcome,
    // however many times it has been regraded. `total_records` is the audit
    // trail behind it: 1 + correction_depth, so it grows with the chain while
    // the contribution does not. Asserting both is what distinguishes "the
    // correction was recorded" from "the correction was double-counted".
    assert.equal(
      settlement.downstream.settlementSummary.total_picks,
      1,
      'a corrected pick contributes one settlement to statistics, never two',
    );
    assert.equal(
      settlement.downstream.settlementSummary.total_records,
      index + 1,
      'the audit trail keeps every grade even though only one of them counts',
    );
    assert.deepEqual(
      settlement.downstream.settlementSummary.by_result,
      { [result]: 1 },
      'only the effective grade may appear in the statistical rollup',
    );
  }

  const all = await repositories.settlements.listByPick(pick.id);
  assert.equal(all.length, 3, 'three grades, three immutable rows');
  assert.deepEqual(
    all
      .slice()
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
      .map((row) => [row.result, row.corrects_id]),
    [
      ['win', null],
      ['loss', ids[0]],
      ['win', ids[1]],
    ],
    'exactly one root; each later grade points at its immediate predecessor',
  );

  // Zero delivery throughout. A correction must not become a route to a member.
  const anyOutbox = await repositories.outbox.findLatestByPick(pick.id, [
    'pending',
    'claimed',
    'sent',
    'failed',
    'dead_letter',
  ]);
  assert.equal(anyOutbox, null);
});

test('UTV2-1919: a duplicate-key race is refused, never reported as a successful settlement', async () => {
  const { repositories, pick } = await createTrackOnlyValidatedPick();

  await recordPickSettlement(pick.id, operatorSettlementRequest({ result: 'win' }), repositories);

  // Simulate the race the 23505 catch exists for: the pre-insert read finds
  // nothing, and another writer lands the canonical row before this insert.
  // The in-memory repository has no unique index, so the violation is injected
  // at the repository boundary rather than pretended at the service boundary.
  const settlements = repositories.settlements;
  const realRecord = settlements.record.bind(settlements);
  const realFindLatest = settlements.findLatestForPick.bind(settlements);
  settlements.findLatestForPick = async () => null;
  settlements.record = async () => {
    const err: Error & { code?: string } = new Error(
      'duplicate key value violates unique constraint "settlement_records_pick_source_idx"',
    );
    err.code = '23505';
    throw err;
  };

  try {
    await assert.rejects(
      () =>
        recordPickSettlement(
          pick.id,
          operatorSettlementRequest({ result: 'loss' }),
          repositories,
        ),
      /SETTLEMENT_ALREADY_RECORDED|already carries a settlement/,
      'a refused INSERT must surface as a refusal — returning the other writer\'s row told the operator their grade had persisted when a different one had',
    );
  } finally {
    settlements.record = realRecord;
    settlements.findLatestForPick = realFindLatest;
  }

  // And the refusal wrote nothing.
  const all = await realFindLatest(pick.id);
  assert.equal(all?.result, 'win', 'the pre-existing settlement is untouched by the refusal');
});
