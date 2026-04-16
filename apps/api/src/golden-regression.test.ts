import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProviderOfferInsert, SettlementRequest, SubmissionPayload } from '@unit-talk/contracts';
import type { SettlementRecord } from '@unit-talk/db';
import { transitionPickLifecycle } from './lifecycle-service.js';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { recordPickSettlement, type RecordSettlementResult } from './settlement-service.js';
import { processSubmission, type SubmissionProcessingResult } from './submission-service.js';

type GoldenScenario = {
  id: string;
  sport: 'NBA' | 'MLB' | 'NFL' | 'NHL';
  edgeCases: readonly string[];
  submission: SubmissionPayload;
  providerOffers?: ProviderOfferInsert[];
  settlementPlan: SettlementRequest[];
  expectedSubmission: {
    market: string;
    selection: string;
    odds: number | null;
    confidence: number | null;
    promotionStatus: string;
    promotionTarget: string | null;
    promotionScore: number;
    promotionReason: string;
    promotionVersion: string;
    metadata: Record<string, unknown>;
  };
  expectedSettlements: Array<{
    settlement: ReturnType<typeof normalizePersistedSettlement>;
    lifecycleToState: string | null;
    auditAction: string;
    finalLifecycleState: string;
    downstream: ReturnType<typeof normalizeDownstream>;
  }>;
  expectedPersisted: Array<ReturnType<typeof normalizePersistedSettlement>>;
};

const GOLDEN_SCENARIOS: GoldenScenario[] = [
  {
    id: 'nba-trader-insights-win',
    sport: 'NBA',
    edgeCases: ['dual-policy-promotion', 'domain-analysis', 'devig', 'kelly'],
    submission: {
      source: 'api',
      market: 'NBA assists',
      selection: 'Player Over 8.5',
      odds: 150,
      confidence: 0.65,
      eventName: 'Bulls vs Knicks',
      metadata: {
        sport: 'NBA',
        eventName: 'Bulls vs Knicks',
        promotionScores: { trust: 90, readiness: 88, uniqueness: 84, boardFit: 89 },
      },
    },
    providerOffers: [
      {
        providerKey: 'sgo',
        providerEventId: 'evt-golden-nba-1',
        providerMarketKey: 'assists-all-game-ou',
        providerParticipantId: 'player-golden-nba-1',
        sportKey: 'NBA',
        line: 8.5,
        overOdds: -115,
        underOdds: -105,
        devigMode: 'PAIRED',
        isOpening: false,
        isClosing: true,
        snapshotAt: '2026-03-28T12:00:00.000Z',
        idempotencyKey: 'golden:nba:assists',
        bookmakerKey: null,
      },
    ],
    settlementPlan: [
      { status: 'settled', result: 'win', source: 'operator', confidence: 'confirmed', evidenceRef: 'proof://nba-win', settledBy: 'operator' },
    ],
    expectedSubmission: {
      market: 'assists-all-game-ou',
      selection: 'Player Over 8.5',
      odds: 150,
      confidence: 0.65,
      promotionStatus: 'qualified',
      promotionTarget: 'exclusive-insights',
      promotionScore: 93.65,
      promotionReason: 'hard eligibility checks passed | promotion score 93.65 meets threshold 90.00',
      promotionVersion: 'exclusive-insights-v2',
      metadata: {
        sport: 'NBA',
        eventName: 'Bulls vs Knicks',
        promotionScores: { trust: 90, readiness: 88, uniqueness: 84, boardFit: 89 },
        domainAnalysis: {
          impliedProbability: 0.4,
          decimalOdds: 2.5,
          version: 'domain-analysis-v1.0.0',
          edge: 0.25,
          confidenceDelta: 0.25,
          hasPositiveEdge: true,
          kellyFraction: 0.05,
          computedAt: '<iso>',
          realEdge: 0.139166,
          marketProbability: 0.510834,
          hasRealEdge: true,
          realEdgeSource: 'sgo',
          realEdgeBookCount: 1,
        },
        deviggingResult: { providerKey: 'sgo', providerMarketKey: 'assists-all-game-ou', snapshotAt: '<iso>', line: 8.5, overOdds: -115, underOdds: -105, overImplied: 0.534884, underImplied: 0.512195, devigMethod: 'proportional', overFair: 0.510834, underFair: 0.489166, overround: 1.047079 },
        kellySizing: { raw_kelly: 0.184723, fractional_kelly: 0.046181, recommended_units: 46.18, recommended_fraction: 0.046181, capped: false, cap_reason: null, has_edge: true },
        realEdge: 0.139166,
        realEdgeSource: 'sgo',
        marketProbability: 0.510834,
        hasRealEdge: true,
        realEdgeBookCount: 1,
      },
    },
    expectedSettlements: [
      {
        settlement: { id: 'settlement_1', status: 'settled', result: 'win', source: 'operator', confidence: 'confirmed', evidenceRef: 'proof://nba-win', notes: null, reviewReason: null, settledBy: 'operator', correctsId: null, payload: { requestStatus: 'settled', correction: false, clv: null, clvStatus: 'missing_event_context', clvUnavailableReason: 'missing_event_context', clvSkipReason: 'Event could not be resolved from pick metadata', profitLossUnits: 1.5 } },
        lifecycleToState: 'settled',
        auditAction: 'settlement.recorded',
        finalLifecycleState: 'settled',
        downstream: { effectiveSettlement: { effectiveRecordId: 'settlement_1', result: 'win', status: 'settled', confidence: 'confirmed', correctionDepth: 0, isFinal: true }, settlementSummary: { totalRecords: 1, totalPicks: 1, byResult: { win: 1 }, byStatus: { settled: 1 }, byConfidence: { confirmed: 1 }, hitRatePct: 100, flatBetRoi: { roiPct: 90.9090909090909, totalWagered: 110, totalProfit: 100 }, correctionCount: 0, pendingReviewCount: 0 }, lossAttribution: null, lossAttributionSummary: null, unresolvedReason: null },
      },
    ],
    expectedPersisted: [
      { id: 'settlement_1', status: 'settled', result: 'win', source: 'operator', confidence: 'confirmed', evidenceRef: 'proof://nba-win', notes: null, reviewReason: null, settledBy: 'operator', correctsId: null, payload: { requestStatus: 'settled', correction: false, clv: null, clvStatus: 'missing_event_context', clvUnavailableReason: 'missing_event_context', clvSkipReason: 'Event could not be resolved from pick metadata', profitLossUnits: 1.5 } },
    ],
  },
  {
    id: 'mlb-best-bets-push',
    sport: 'MLB',
    edgeCases: ['explicit-edge', 'push'],
    submission: {
      source: 'api',
      market: 'MLB batting hits',
      selection: 'Player Over 1.5',
      confidence: 0.72,
      eventName: 'Dodgers vs Padres',
      metadata: {
        sport: 'MLB',
        eventName: 'Dodgers vs Padres',
        promotionScores: { edge: 78, trust: 79, readiness: 88, uniqueness: 82, boardFit: 90 },
      },
    },
    settlementPlan: [
      { status: 'settled', result: 'push', source: 'operator', confidence: 'confirmed', evidenceRef: 'proof://mlb-push', settledBy: 'operator' },
    ],
    expectedSubmission: {
      market: 'batting-hits-all-game-ou',
      selection: 'Player Over 1.5',
      odds: null,
      confidence: 0.72,
      promotionStatus: 'qualified',
      promotionTarget: 'best-bets',
      promotionScore: 81.85000000000001,
      promotionReason: 'hard eligibility checks passed | promotion score 81.85 meets threshold 70.00',
      promotionVersion: 'best-bets-v2',
      metadata: {
        sport: 'MLB',
        eventName: 'Dodgers vs Padres',
        promotionScores: { edge: 78, trust: 79, readiness: 88, uniqueness: 82, boardFit: 90 },
        kellySizing: null,
      },
    },
    expectedSettlements: [
      {
        settlement: { id: 'settlement_1', status: 'settled', result: 'push', source: 'operator', confidence: 'confirmed', evidenceRef: 'proof://mlb-push', notes: null, reviewReason: null, settledBy: 'operator', correctsId: null, payload: { requestStatus: 'settled', correction: false, clv: null, clvStatus: 'missing_pick_odds', clvUnavailableReason: 'missing_pick_odds', clvSkipReason: 'Pick has no valid odds', profitLossUnits: 0 } },
        lifecycleToState: 'settled',
        auditAction: 'settlement.recorded',
        finalLifecycleState: 'settled',
        downstream: { effectiveSettlement: { effectiveRecordId: 'settlement_1', result: 'push', status: 'settled', confidence: 'confirmed', correctionDepth: 0, isFinal: true }, settlementSummary: { totalRecords: 1, totalPicks: 1, byResult: { push: 1 }, byStatus: { settled: 1 }, byConfidence: { confirmed: 1 }, hitRatePct: 0, flatBetRoi: { roiPct: 0, totalWagered: 0, totalProfit: 0 }, correctionCount: 0, pendingReviewCount: 0 }, lossAttribution: null, lossAttributionSummary: null, unresolvedReason: null },
      },
    ],
    expectedPersisted: [
      { id: 'settlement_1', status: 'settled', result: 'push', source: 'operator', confidence: 'confirmed', evidenceRef: 'proof://mlb-push', notes: null, reviewReason: null, settledBy: 'operator', correctsId: null, payload: { requestStatus: 'settled', correction: false, clv: null, clvStatus: 'missing_pick_odds', clvUnavailableReason: 'missing_pick_odds', clvSkipReason: 'Pick has no valid odds', profitLossUnits: 0 } },
    ],
  },
  {
    id: 'nfl-suppressed-void',
    sport: 'NFL',
    edgeCases: ['negative-domain-edge', 'void'],
    submission: {
      source: 'api',
      market: 'passing-yards-all-game-ou',
      selection: 'QB Over 275.5',
      odds: -300,
      confidence: 0.6,
      eventName: 'Bills vs Jets',
      metadata: {
        sport: 'NFL',
        eventName: 'Bills vs Jets',
        promotionScores: { trust: 90, readiness: 88, uniqueness: 84, boardFit: 89 },
      },
    },
    settlementPlan: [
      { status: 'settled', result: 'void', source: 'operator', confidence: 'confirmed', evidenceRef: 'proof://nfl-void', settledBy: 'operator' },
    ],
    expectedSubmission: {
      market: 'passing-yards-all-game-ou',
      selection: 'QB Over 275.5',
      odds: -300,
      confidence: 0.6,
      promotionStatus: 'suppressed',
      promotionTarget: null,
      promotionScore: 57.4,
      promotionReason: 'promotion score 57.40 is below threshold 70.00',
      promotionVersion: 'best-bets-v2',
      metadata: {
        sport: 'NFL',
        eventName: 'Bills vs Jets',
        promotionScores: { trust: 90, readiness: 88, uniqueness: 84, boardFit: 89 },
        domainAnalysis: {
          impliedProbability: 0.75,
          decimalOdds: 1.333333,
          version: 'domain-analysis-v1.0.0',
          edge: -0.15,
          confidenceDelta: -0.15,
          hasPositiveEdge: false,
          computedAt: '<iso>',
        },
        kellySizing: null,
        realEdge: -0.15,
        realEdgeSource: 'confidence-delta',
        marketProbability: 0.75,
        hasRealEdge: false,
        realEdgeBookCount: 0,
      },
    },
    expectedSettlements: [
      {
        settlement: { id: 'settlement_1', status: 'settled', result: 'void', source: 'operator', confidence: 'confirmed', evidenceRef: 'proof://nfl-void', notes: null, reviewReason: null, settledBy: 'operator', correctsId: null, payload: { requestStatus: 'settled', correction: false, clv: null, clvStatus: 'missing_event_context', clvUnavailableReason: 'missing_event_context', clvSkipReason: 'Event could not be resolved from pick metadata' } },
        lifecycleToState: 'settled',
        auditAction: 'settlement.recorded',
        finalLifecycleState: 'settled',
        downstream: { effectiveSettlement: { effectiveRecordId: 'settlement_1', result: 'void', status: 'settled', confidence: 'confirmed', correctionDepth: 0, isFinal: true }, settlementSummary: { totalRecords: 1, totalPicks: 1, byResult: { void: 1 }, byStatus: { settled: 1 }, byConfidence: { confirmed: 1 }, hitRatePct: 0, flatBetRoi: { roiPct: 0, totalWagered: 0, totalProfit: 0 }, correctionCount: 0, pendingReviewCount: 0 }, lossAttribution: null, lossAttributionSummary: null, unresolvedReason: null },
      },
    ],
    expectedPersisted: [
      { id: 'settlement_1', status: 'settled', result: 'void', source: 'operator', confidence: 'confirmed', evidenceRef: 'proof://nfl-void', notes: null, reviewReason: null, settledBy: 'operator', correctsId: null, payload: { requestStatus: 'settled', correction: false, clv: null, clvStatus: 'missing_event_context', clvUnavailableReason: 'missing_event_context', clvSkipReason: 'Event could not be resolved from pick metadata' } },
    ],
  },
  {
    id: 'nhl-confidence-correction',
    sport: 'NHL',
    edgeCases: ['confidence-fallback', 'correction'],
    submission: {
      source: 'api',
      market: 'shots-on-goal-all-game-ou',
      selection: 'Skater Over 3.5',
      confidence: 0.9,
      eventName: 'Rangers vs Bruins',
      metadata: {
        sport: 'NHL',
        eventName: 'Rangers vs Bruins',
        promotionScores: { trust: 90, readiness: 88, uniqueness: 84, boardFit: 89 },
      },
    },
    settlementPlan: [
      { status: 'settled', result: 'loss', source: 'operator', confidence: 'confirmed', evidenceRef: 'proof://nhl-loss', settledBy: 'operator' },
      { status: 'settled', result: 'win', source: 'operator', confidence: 'confirmed', evidenceRef: 'proof://nhl-correction', settledBy: 'operator', notes: 'stat correction' },
    ],
    expectedSubmission: {
      market: 'shots-on-goal-all-game-ou',
      selection: 'Skater Over 3.5',
      odds: null,
      confidence: 0.9,
      promotionStatus: 'qualified',
      promotionTarget: 'trader-insights',
      promotionScore: 89.05000000000001,
      promotionReason: 'hard eligibility checks passed | promotion score 89.05 meets threshold 80.00',
      promotionVersion: 'trader-insights-v2',
      metadata: {
        sport: 'NHL',
        eventName: 'Rangers vs Bruins',
        promotionScores: { trust: 90, readiness: 88, uniqueness: 84, boardFit: 89 },
        kellySizing: null,
      },
    },
    expectedSettlements: [
      {
        settlement: { id: 'settlement_1', status: 'settled', result: 'loss', source: 'operator', confidence: 'confirmed', evidenceRef: 'proof://nhl-loss', notes: null, reviewReason: null, settledBy: 'operator', correctsId: null, payload: { requestStatus: 'settled', correction: false, clv: null, clvStatus: 'missing_pick_odds', clvUnavailableReason: 'missing_pick_odds', clvSkipReason: 'Pick has no valid odds', profitLossUnits: -1 } },
        lifecycleToState: 'settled',
        auditAction: 'settlement.recorded',
        finalLifecycleState: 'settled',
        downstream: { effectiveSettlement: { effectiveRecordId: 'settlement_1', result: 'loss', status: 'settled', confidence: 'confirmed', correctionDepth: 0, isFinal: true }, settlementSummary: { totalRecords: 1, totalPicks: 1, byResult: { loss: 1 }, byStatus: { settled: 1 }, byConfidence: { confirmed: 1 }, hitRatePct: 0, flatBetRoi: { roiPct: -100, totalWagered: 110, totalProfit: -110 }, correctionCount: 0, pendingReviewCount: 0 }, lossAttribution: { classification: 'UNKNOWN', notes: ['no_feature_snapshot_available'] }, lossAttributionSummary: { totalLosses: 1, byCategory: [{ category: 'UNKNOWN', count: 1, pct: 100 }], topCategory: 'UNKNOWN', actionableInsights: [{ category: 'UNKNOWN', count: 1, pct: 100, recommendation: 'Instrument feature snapshots for better attribution' }], version: 'loss-attribution-v1.0' }, unresolvedReason: null },
      },
      {
        settlement: { id: 'settlement_2', status: 'settled', result: 'win', source: 'operator', confidence: 'confirmed', evidenceRef: 'proof://nhl-correction', notes: 'stat correction', reviewReason: null, settledBy: 'operator', correctsId: 'settlement_1', payload: { requestStatus: 'settled', correction: true, priorSettlementRecordId: 'settlement_1', clv: null, clvStatus: 'missing_pick_odds', clvUnavailableReason: 'missing_pick_odds', clvSkipReason: 'Pick has no valid odds', profitLossUnits: 1 } },
        lifecycleToState: null,
        auditAction: 'settlement.corrected',
        finalLifecycleState: 'settled',
        downstream: { effectiveSettlement: { effectiveRecordId: 'settlement_2', result: 'win', status: 'settled', confidence: 'confirmed', correctionDepth: 1, isFinal: true }, settlementSummary: { totalRecords: 2, totalPicks: 1, byResult: { win: 1 }, byStatus: { settled: 1 }, byConfidence: { confirmed: 1 }, hitRatePct: 100, flatBetRoi: { roiPct: 90.9090909090909, totalWagered: 110, totalProfit: 100 }, correctionCount: 1, pendingReviewCount: 0 }, lossAttribution: null, lossAttributionSummary: null, unresolvedReason: null },
      },
    ],
    expectedPersisted: [
      { id: 'settlement_2', status: 'settled', result: 'win', source: 'operator', confidence: 'confirmed', evidenceRef: 'proof://nhl-correction', notes: 'stat correction', reviewReason: null, settledBy: 'operator', correctsId: 'settlement_1', payload: { requestStatus: 'settled', correction: true, priorSettlementRecordId: 'settlement_1', clv: null, clvStatus: 'missing_pick_odds', clvUnavailableReason: 'missing_pick_odds', clvSkipReason: 'Pick has no valid odds', profitLossUnits: 1 } },
      { id: 'settlement_1', status: 'settled', result: 'loss', source: 'operator', confidence: 'confirmed', evidenceRef: 'proof://nhl-loss', notes: null, reviewReason: null, settledBy: 'operator', correctsId: null, payload: { requestStatus: 'settled', correction: false, clv: null, clvStatus: 'missing_pick_odds', clvUnavailableReason: 'missing_pick_odds', clvSkipReason: 'Pick has no valid odds', profitLossUnits: -1 } },
    ],
  },
];

test('golden regression suite covers every required sport and edge case', () => {
  assert.deepEqual(GOLDEN_SCENARIOS.map((scenario) => scenario.sport), ['NBA', 'MLB', 'NFL', 'NHL']);
  assert.deepEqual(
    Array.from(new Set(GOLDEN_SCENARIOS.flatMap((scenario) => scenario.edgeCases))).sort(),
    ['confidence-fallback', 'correction', 'devig', 'domain-analysis', 'dual-policy-promotion', 'explicit-edge', 'kelly', 'negative-domain-edge', 'push', 'void'],
  );
});

for (const scenario of GOLDEN_SCENARIOS) {
  test(`${scenario.id} stays golden`, async () => {
    const executed = await runGoldenScenario(scenario);
    assertSubmissionGraph(executed.submissionResult);
    assert.deepEqual(normalizeSubmission(executed.submissionResult), scenario.expectedSubmission);

    assert.equal(executed.settlementResults.length, scenario.expectedSettlements.length);
    executed.settlementResults.forEach((result, index) => {
      assertSettlementGraph(result, executed.submissionResult.pick.id);
      assert.deepEqual(normalizeSettlement(result), scenario.expectedSettlements[index]);
    });

    assert.deepEqual(
      executed.persistedSettlements.map(normalizePersistedSettlement),
      scenario.expectedPersisted,
    );
  });
}

async function runGoldenScenario(scenario: GoldenScenario) {
  const repositories = createInMemoryRepositoryBundle();
  if (scenario.providerOffers?.length) {
    await repositories.providerOffers.upsertBatch(scenario.providerOffers);
  }

  const submissionResult = await processSubmission(scenario.submission, repositories);
  await transitionPickLifecycle(repositories.picks, submissionResult.pick.id, 'queued', 'queued');
  await transitionPickLifecycle(repositories.picks, submissionResult.pick.id, 'posted', 'posted', 'poster');

  const settlementResults: RecordSettlementResult[] = [];
  for (const request of scenario.settlementPlan) {
    settlementResults.push(await recordPickSettlement(submissionResult.pick.id, request, repositories));
  }

  return {
    submissionResult,
    settlementResults,
    persistedSettlements: await repositories.settlements.listByPick(submissionResult.pick.id),
  };
}

function assertSubmissionGraph(result: SubmissionProcessingResult) {
  assert.equal(result.submissionRecord.id, result.submission.id);
  assert.equal(result.submissionEventRecord!.submission_id, result.submission.id);
  assert.equal(result.pick.submissionId, result.submission.id);
  assert.equal(result.pickRecord.id, result.pick.id);
  assert.equal(result.pickRecord.submission_id, result.submission.id);
  assert.equal(result.lifecycleEvent.pickId, result.pick.id);
  assert.equal(result.lifecycleEventRecord.pick_id, result.pick.id);
  assert.match(result.submission.id, UUID_PATTERN);
  assert.match(result.pick.id, UUID_PATTERN);
  assert.match(result.submission.receivedAt, ISO_PATTERN);
  assert.match(result.pick.createdAt, ISO_PATTERN);
}

function assertSettlementGraph(result: RecordSettlementResult, pickId: string) {
  assert.equal(result.pickRecord.id, pickId);
  assert.equal(result.settlementRecord.pick_id, pickId);
  if (result.lifecycleEvent) {
    assert.equal(result.lifecycleEvent.pick_id, pickId);
  }
}

function normalizeSubmission(result: SubmissionProcessingResult) {
  return {
    market: result.pick.market,
    selection: result.pick.selection,
    odds: result.pick.odds ?? null,
    confidence: result.pick.confidence ?? null,
    promotionStatus: result.pick.promotionStatus,
    promotionTarget: result.pick.promotionTarget ?? null,
    promotionScore: result.pick.promotionScore ?? 0,
    promotionReason: result.pick.promotionReason ?? '',
    promotionVersion: result.pick.promotionVersion ?? '',
    metadata: normalizeDynamicTimestamps(result.pick.metadata),
  };
}

function normalizeSettlement(result: RecordSettlementResult) {
  return {
    settlement: normalizePersistedSettlement(result.settlementRecord),
    lifecycleToState: result.lifecycleEvent?.to_state ?? null,
    auditAction: result.auditRecords[0]?.action ?? '',
    finalLifecycleState: result.finalLifecycleState,
    downstream: normalizeDownstream(result.downstream),
  };
}

function normalizePersistedSettlement(settlement: SettlementRecord) {
  return {
    id: settlement.id,
    status: settlement.status,
    result: settlement.result,
    source: settlement.source,
    confidence: settlement.confidence,
    evidenceRef: settlement.evidence_ref,
    notes: settlement.notes,
    reviewReason: settlement.review_reason,
    settledBy: settlement.settled_by,
    correctsId: settlement.corrects_id,
    payload: settlement.payload as Record<string, unknown>,
  };
}

function normalizeDownstream(result: RecordSettlementResult['downstream']) {
  return {
    effectiveSettlement: result.effectiveSettlement
      ? {
          effectiveRecordId: result.effectiveSettlement.effective_record_id,
          result: result.effectiveSettlement.result,
          status: result.effectiveSettlement.status,
          confidence: result.effectiveSettlement.confidence,
          correctionDepth: result.effectiveSettlement.correction_depth,
          isFinal: result.effectiveSettlement.is_final,
        }
      : null,
    settlementSummary: {
      totalRecords: result.settlementSummary.total_records,
      totalPicks: result.settlementSummary.total_picks,
      byResult: result.settlementSummary.by_result,
      byStatus: result.settlementSummary.by_status,
      byConfidence: result.settlementSummary.by_confidence,
      hitRatePct: result.settlementSummary.hit_rate_pct,
      flatBetRoi: {
        roiPct: result.settlementSummary.flat_bet_roi.roi_pct,
        totalWagered: result.settlementSummary.flat_bet_roi.total_wagered,
        totalProfit: result.settlementSummary.flat_bet_roi.total_profit,
      },
      correctionCount: result.settlementSummary.correction_count,
      pendingReviewCount: result.settlementSummary.pending_review_count,
    },
    lossAttribution: result.lossAttribution ? { classification: result.lossAttribution.classification, notes: result.lossAttribution.notes } : null,
    lossAttributionSummary: result.lossAttributionSummary
      ? {
          totalLosses: result.lossAttributionSummary.total_losses,
          byCategory: result.lossAttributionSummary.by_category,
          topCategory: result.lossAttributionSummary.top_category,
          actionableInsights: result.lossAttributionSummary.actionable_insights,
          version: result.lossAttributionSummary.version,
        }
      : null,
    unresolvedReason: result.unresolvedReason,
  };
}

function normalizeDynamicTimestamps<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeDynamicTimestamps(entry)) as T;
  }
  if (value && typeof value === 'object') {
    const normalized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      normalized[key] =
        typeof entry === 'string' && ISO_PATTERN.test(entry)
          ? '<iso>'
          : normalizeDynamicTimestamps(entry);
    }
    return normalized as T;
  }
  return value;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T/;
