/**
 * Tests for model-performance-service.ts — UTV2-798.
 *
 * Uses node:test + node:assert/strict (project standard).
 * Uses InMemory repositories (no live DB required).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { getModelPerformanceReport } from './model-performance-service.js';
import type { CanonicalPick } from '@unit-talk/contracts';

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

type Repositories = ReturnType<typeof createInMemoryRepositoryBundle>;

interface SeedPickOptions {
  id?: string;
  lifecycleState?: CanonicalPick['lifecycleState'];
  market?: string;
  source?: CanonicalPick['source'];
  confidence?: number;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

async function seedPick(
  repos: Repositories,
  opts: SeedPickOptions = {},
): Promise<string> {
  const id = opts.id ?? `pick-${Math.random().toString(36).slice(2)}`;
  const createdAt = opts.createdAt ?? new Date().toISOString();
  await repos.picks.savePick({
    id,
    submissionId: `sub-${id}`,
    market: opts.market ?? 'nba_player_points_ou',
    selection: 'Over 22.5',
    line: 22.5,
    odds: -110,
    stakeUnits: 1,
    confidence: opts.confidence ?? undefined,
    source: opts.source ?? 'smart-form',
    approvalStatus: 'approved',
    promotionStatus: 'qualified',
    promotionTarget: 'best-bets',
    promotionScore: 80,
    promotionReason: 'qualified',
    promotionVersion: '1.0',
    promotionDecidedAt: createdAt,
    promotionDecidedBy: 'system',
    lifecycleState: opts.lifecycleState ?? 'settled',
    metadata: opts.metadata ?? {},
    createdAt,
  });
  return id;
}

interface SeedSettlementOptions {
  pickId: string;
  result?: 'win' | 'loss' | 'push';
  clvPercent?: number | null;
  settledAt?: string;
  correctsId?: string | null;
  status?: 'settled' | 'manual_review';
}

async function seedSettlement(
  repos: Repositories,
  opts: SeedSettlementOptions,
) {
  const settledAt = opts.settledAt ?? new Date().toISOString();
  return repos.settlements.record({
    pickId: opts.pickId,
    status: opts.status ?? 'settled',
    result: opts.result ?? 'win',
    source: 'grading',
    confidence: 'confirmed',
    evidenceRef: `grade-${opts.pickId}`,
    settledBy: 'system',
    settledAt,
    ...(opts.correctsId !== undefined ? { correctsId: opts.correctsId } : {}),
    payload:
      opts.clvPercent !== null && opts.clvPercent !== undefined
        ? { clvPercent: opts.clvPercent, clvRaw: opts.clvPercent / 100 }
        : {},
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('getModelPerformanceReport: basic posted→settled join returns correct tier groupings', async () => {
  const repos = createInMemoryRepositoryBundle();

  // Seed 3 picks: T1 tier (2 wins), T2 tier (1 loss)
  const p1 = await seedPick(repos, { metadata: { model_tier: 'T1', sport: 'NBA' } });
  const p2 = await seedPick(repos, { metadata: { model_tier: 'T1', sport: 'NBA' } });
  const p3 = await seedPick(repos, { metadata: { model_tier: 'T2', sport: 'NBA' } });

  await seedSettlement(repos, { pickId: p1, result: 'win', clvPercent: 2.5 });
  await seedSettlement(repos, { pickId: p2, result: 'win', clvPercent: 1.5 });
  await seedSettlement(repos, { pickId: p3, result: 'loss', clvPercent: -0.5 });

  const report = await getModelPerformanceReport({
    picks: repos.picks,
    settlements: repos.settlements,
  });

  assert.equal(report.calibrationNotice, 'CALIBRATION_EVIDENCE_ONLY');
  assert.equal(report.totalPostedPicks, 3);
  assert.equal(report.totalSettledPicks, 3);

  const t1Bucket = report.tierPerformance.find((b) => b.tier === 'T1');
  assert.ok(t1Bucket, 'T1 bucket should exist');
  assert.equal(t1Bucket!.totalPicks, 2);
  assert.equal(t1Bucket!.settledPicks, 2);
  assert.equal(t1Bucket!.wins, 2);
  assert.equal(t1Bucket!.losses, 0);
  assert.equal(t1Bucket!.winRate, 1.0);

  const t2Bucket = report.tierPerformance.find((b) => b.tier === 'T2');
  assert.ok(t2Bucket, 'T2 bucket should exist');
  assert.equal(t2Bucket!.wins, 0);
  assert.equal(t2Bucket!.losses, 1);
  assert.equal(t2Bucket!.winRate, 0);
});

test('getModelPerformanceReport: CLV linkage works when CLV data is present', async () => {
  const repos = createInMemoryRepositoryBundle();

  const p1 = await seedPick(repos, { metadata: { model_tier: 'T1' } });
  const p2 = await seedPick(repos, { metadata: { model_tier: 'T1' } });

  await seedSettlement(repos, { pickId: p1, result: 'win', clvPercent: 3.0 });
  await seedSettlement(repos, { pickId: p2, result: 'win', clvPercent: 1.0 });

  const report = await getModelPerformanceReport({
    picks: repos.picks,
    settlements: repos.settlements,
  });

  const t1Bucket = report.tierPerformance.find((b) => b.tier === 'T1');
  assert.ok(t1Bucket, 'T1 bucket should exist');
  assert.ok(t1Bucket!.avgClv !== null, 'avgClv should not be null when CLV data is present');
  // avg of 3.0 and 1.0 = 2.0
  assert.equal(t1Bucket!.avgClv, 2.0);
});

test('getModelPerformanceReport: CLV is null when no CLV data in settlement payload', async () => {
  const repos = createInMemoryRepositoryBundle();

  const p1 = await seedPick(repos, { metadata: { model_tier: 'T3' } });
  await seedSettlement(repos, { pickId: p1, result: 'win', clvPercent: null });

  const report = await getModelPerformanceReport({
    picks: repos.picks,
    settlements: repos.settlements,
  });

  const t3Bucket = report.tierPerformance.find((b) => b.tier === 'T3');
  assert.ok(t3Bucket, 'T3 bucket should exist');
  assert.equal(t3Bucket!.avgClv, null, 'avgClv should be null when no CLV payload');
});

test('getModelPerformanceReport: missing champion gaps are correctly identified', async () => {
  const repos = createInMemoryRepositoryBundle();

  // 2 picks WITH model_confidence, 3 picks WITHOUT
  await seedPick(repos, { metadata: { model_confidence: 0.85, model_tier: 'T1' } });
  await seedPick(repos, { metadata: { model_confidence: 0.70, model_tier: 'T1' } });
  await seedPick(repos, { metadata: { model_tier: 'T2' } }); // no confidence
  await seedPick(repos, { metadata: { model_tier: 'T2' } }); // no confidence
  await seedPick(repos, { metadata: {} });                    // no confidence, no tier

  const report = await getModelPerformanceReport({
    picks: repos.picks,
    settlements: repos.settlements,
  });

  assert.equal(report.championModelCoverage.totalPicks, 5);
  assert.equal(report.championModelCoverage.withModelConfidence, 2);
  assert.equal(report.championModelCoverage.withoutModelConfidence, 3);
  assert.equal(report.championModelCoverage.missingGapCount, 3);
  assert.ok(report.championModelCoverage.coverageRate !== null);
  assert.equal(report.championModelCoverage.coverageRate, 2 / 5);
});

test('getModelPerformanceReport: stale-data markers are included in stale bucket', async () => {
  const repos = createInMemoryRepositoryBundle();

  // 2 fresh picks, 1 stale pick
  const p1 = await seedPick(repos, { metadata: { data_freshness: 'fresh', sport: 'NHL' } });
  const p2 = await seedPick(repos, { metadata: { data_freshness: 'fresh', sport: 'NHL' } });
  const p3 = await seedPick(repos, { metadata: { data_freshness: 'stale', sport: 'NHL' } });

  await seedSettlement(repos, { pickId: p1, result: 'win', clvPercent: 1.0 });
  await seedSettlement(repos, { pickId: p2, result: 'loss', clvPercent: -1.0 });
  await seedSettlement(repos, { pickId: p3, result: 'win', clvPercent: 0.5 });

  const report = await getModelPerformanceReport({
    picks: repos.picks,
    settlements: repos.settlements,
  });

  assert.equal(report.staleBucket.stalePicks, 1, 'One stale pick expected');
  assert.equal(report.staleBucket.settledStalePicks, 1);
  assert.equal(report.staleBucket.wins, 1);
  assert.equal(report.staleBucket.losses, 0);
  assert.equal(report.staleBucket.winRate, 1.0);
  assert.equal(report.staleBucket.avgClv, 0.5);
});

test('getModelPerformanceReport: sport filter narrows results', async () => {
  const repos = createInMemoryRepositoryBundle();

  await seedPick(repos, { metadata: { sport: 'NBA', model_tier: 'T1' } });
  await seedPick(repos, { metadata: { sport: 'NBA', model_tier: 'T1' } });
  await seedPick(repos, { metadata: { sport: 'NHL', model_tier: 'T1' } });

  const report = await getModelPerformanceReport(
    { picks: repos.picks, settlements: repos.settlements },
    { sport: 'NBA' },
  );

  assert.equal(report.totalPostedPicks, 2);
  assert.equal(report.filters.sport, 'NBA');
});

test('getModelPerformanceReport: tier filter narrows results', async () => {
  const repos = createInMemoryRepositoryBundle();

  await seedPick(repos, { metadata: { model_tier: 'T1' } });
  await seedPick(repos, { metadata: { model_tier: 'T1' } });
  await seedPick(repos, { metadata: { model_tier: 'T2' } });

  const report = await getModelPerformanceReport(
    { picks: repos.picks, settlements: repos.settlements },
    { tier: 'T2' },
  );

  assert.equal(report.totalPostedPicks, 1);
  assert.equal(report.filters.tier, 'T2');
});

test('getModelPerformanceReport: null tier bucket for picks with no model_tier metadata', async () => {
  const repos = createInMemoryRepositoryBundle();

  // Picks with no model_tier in metadata
  await seedPick(repos, { metadata: {} });
  await seedPick(repos, { metadata: { some_other_key: 'value' } });

  const report = await getModelPerformanceReport({
    picks: repos.picks,
    settlements: repos.settlements,
  });

  const nullTierBucket = report.tierPerformance.find((b) => b.tier === null);
  assert.ok(nullTierBucket, 'null tier bucket should exist for picks without model_tier');
  assert.equal(nullTierBucket!.totalPicks, 2);
});

test('getModelPerformanceReport: sport/market breakdown groups correctly', async () => {
  const repos = createInMemoryRepositoryBundle();

  // 2 NBA player_points picks, 1 NBA player_assists pick
  const p1 = await seedPick(repos, { market: 'player_points_ou', metadata: { sport: 'NBA' } });
  const p2 = await seedPick(repos, { market: 'player_points_ou', metadata: { sport: 'NBA' } });
  const p3 = await seedPick(repos, { market: 'player_assists_ou', metadata: { sport: 'NBA' } });

  await seedSettlement(repos, { pickId: p1, result: 'win', clvPercent: 1.0 });
  await seedSettlement(repos, { pickId: p2, result: 'loss', clvPercent: -0.5 });
  await seedSettlement(repos, { pickId: p3, result: 'win', clvPercent: 2.0 });

  const report = await getModelPerformanceReport({
    picks: repos.picks,
    settlements: repos.settlements,
  });

  const pointsGroup = report.sportMarketBreakdown.find(
    (b) => b.sportKey === 'NBA' && b.marketKeyFamily === 'player_points',
  );
  assert.ok(pointsGroup, 'NBA player_points bucket should exist');
  assert.equal(pointsGroup!.totalPicks, 2);
  assert.equal(pointsGroup!.settledPicks, 2);

  const assistsGroup = report.sportMarketBreakdown.find(
    (b) => b.sportKey === 'NBA' && b.marketKeyFamily === 'player_assists',
  );
  assert.ok(assistsGroup, 'NBA player_assists bucket should exist');
  assert.equal(assistsGroup!.totalPicks, 1);
});

test('getModelPerformanceReport: a corrected pick reports the correction, not the superseded original', async () => {
  const repos = createInMemoryRepositoryBundle();
  const p1 = await seedPick(repos);

  const original = await seedSettlement(repos, { pickId: p1, result: 'win', clvPercent: 2.5 });
  await seedSettlement(repos, { pickId: p1, result: 'loss', clvPercent: -1.0, correctsId: original.id });

  const report = await getModelPerformanceReport({ picks: repos.picks, settlements: repos.settlements });

  // One pick, one contribution -- never one per record.
  assert.equal(report.totalSettledPicks, 1);
  assert.equal(report.unresolvedSettlementPickCount, 0);
  const nullBucket = report.tierPerformance.find((b) => b.tier === null);
  assert.ok(nullBucket);
  assert.equal(nullBucket.losses, 1, 'the correction is a loss');
  assert.equal(nullBucket.wins, 0, 'the superseded win must not be reported');
  assert.equal(nullBucket.avgClv, -1.0, "CLV is the correction's, not the original's");
});

test('getModelPerformanceReport: a chain whose root predates the read window is completed, not dropped', async () => {
  const repos = createInMemoryRepositoryBundle();
  const p1 = await seedPick(repos);

  const original = await seedSettlement(repos, { pickId: p1, result: 'win' });
  const correction = await seedSettlement(repos, { pickId: p1, result: 'loss', correctsId: original.id });

  // listRecent is bounded to 30 days on created_at; model the root falling
  // outside that window so the read returns only the correction.
  const settlements = Object.create(repos.settlements) as typeof repos.settlements;
  settlements.listRecent = async () => [correction];

  const report = await getModelPerformanceReport({ picks: repos.picks, settlements });

  assert.equal(report.totalSettledPicks, 1);
  assert.equal(report.unresolvedSettlementPickCount, 0);
  const nullBucket = report.tierPerformance.find((b) => b.tier === null);
  assert.ok(nullBucket);
  assert.equal(nullBucket.losses, 1);
  assert.equal(nullBucket.wins, 0);
});

test('getModelPerformanceReport: a correction whose target cannot be read is excluded and counted', async () => {
  const repos = createInMemoryRepositoryBundle();
  const p1 = await seedPick(repos);

  const original = await seedSettlement(repos, { pickId: p1, result: 'win', clvPercent: 3.0 });
  const correction = await seedSettlement(repos, {
    pickId: p1,
    result: 'loss',
    clvPercent: -1.0,
    correctsId: original.id,
  });

  // The repository guard refuses to WRITE an orphan, so model one being READ:
  // neither the window nor the pick's full history returns the chain root.
  const settlements = Object.create(repos.settlements) as typeof repos.settlements;
  settlements.listRecent = async () => [correction];
  settlements.listByPick = async () => [correction];

  const report = await getModelPerformanceReport({ picks: repos.picks, settlements });

  // An unanchored correction is not a trustworthy result -- it is neither
  // counted as settled nor silently dropped.
  assert.equal(report.totalSettledPicks, 0);
  assert.equal(report.unresolvedSettlementPickCount, 1);
});

test('getModelPerformanceReport: a chain whose tip is in manual review is not a settlement', async () => {
  const repos = createInMemoryRepositoryBundle();
  const p1 = await seedPick(repos);

  const original = await seedSettlement(repos, { pickId: p1, result: 'win' });
  await seedSettlement(repos, { pickId: p1, status: 'manual_review', correctsId: original.id });

  const report = await getModelPerformanceReport({ picks: repos.picks, settlements: repos.settlements });

  assert.equal(report.totalSettledPicks, 0);
  assert.equal(report.unresolvedSettlementPickCount, 0, 'a pending review is a known state, not a broken chain');
});
