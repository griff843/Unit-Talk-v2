import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { computeClvTrustAdjustment } from './clv-feedback.js';

async function seedSettlements(
  repositories: ReturnType<typeof createInMemoryRepositoryBundle> extends Promise<infer T> ? T : ReturnType<typeof createInMemoryRepositoryBundle>,
  source: string,
  count: number,
  avgClvPercent: number,
) {
  for (let i = 0; i < count; i++) {
    const pickId = `pick-${source}-${i}`;
    // Save the pick so it can be found by findPickById
    await repositories.picks.savePick({
      id: pickId,
      submissionId: `sub-${pickId}`,
      market: 'NBA points',
      selection: 'Player Over 18.5',
      line: 18.5,
      odds: -110,
      stakeUnits: 1,
      confidence: 0.7,
      source,
      approvalStatus: 'approved',
      promotionStatus: 'qualified',
      promotionTarget: 'best-bets',
      promotionScore: 80,
      promotionReason: 'qualified',
      promotionVersion: '1.0',
      promotionDecidedAt: new Date().toISOString(),
      promotionDecidedBy: 'system',
      lifecycleState: 'posted',
      metadata: {},
      createdAt: new Date().toISOString(),
    });

    // Add some variance around the target average
    const variance = (i % 3 - 1) * 0.5; // -0.5, 0, +0.5
    const clvPercent = avgClvPercent + variance;

    await repositories.settlements.record({
      pickId,
      status: 'settled',
      result: 'win',
      source: 'grading',
      confidence: 'confirmed',
      evidenceRef: `grade-${i}`,
      settledBy: 'system',
      settledAt: new Date().toISOString(),
      payload: {
        clvRaw: clvPercent / 100,
        clvPercent,
        beatsClosingLine: clvPercent > 0,
      },
    });
  }
}

test('computeClvTrustAdjustment returns null when insufficient data (< minSampleSize)', async () => {
  const repositories = createInMemoryRepositoryBundle();

  // Seed only 5 settlements — below default minSampleSize of 10
  await seedSettlements(repositories, 'smart-form', 5, 3.0);

  const result = await computeClvTrustAdjustment(
    'smart-form',
    repositories.settlements,
    repositories.picks,
  );

  assert.equal(result, null);
});

test('computeClvTrustAdjustment returns +10 for strong positive CLV (> 2%)', async () => {
  const repositories = createInMemoryRepositoryBundle();

  await seedSettlements(repositories, 'smart-form', 15, 4.0);

  const result = await computeClvTrustAdjustment(
    'smart-form',
    repositories.settlements,
    repositories.picks,
  );

  assert.notEqual(result, null);
  assert.equal(result!.adjustment, 10);
  assert.equal(result!.sampleSize, 15);
  assert.ok(result!.avgClvPercent > 2);
  assert.ok(result!.reason.includes('Strong positive CLV'));
});

test('computeClvTrustAdjustment returns +5 for marginally positive CLV (0-2%)', async () => {
  const repositories = createInMemoryRepositoryBundle();

  await seedSettlements(repositories, 'smart-form', 12, 1.0);

  const result = await computeClvTrustAdjustment(
    'smart-form',
    repositories.settlements,
    repositories.picks,
  );

  assert.notEqual(result, null);
  assert.equal(result!.adjustment, 5);
  assert.equal(result!.sampleSize, 12);
  assert.ok(result!.avgClvPercent > 0);
  assert.ok(result!.avgClvPercent <= 2);
  assert.ok(result!.reason.includes('Marginally positive CLV'));
});

test('computeClvTrustAdjustment returns -10 for strong negative CLV (< -2%)', async () => {
  const repositories = createInMemoryRepositoryBundle();

  await seedSettlements(repositories, 'smart-form', 12, -4.0);

  const result = await computeClvTrustAdjustment(
    'smart-form',
    repositories.settlements,
    repositories.picks,
  );

  assert.notEqual(result, null);
  assert.equal(result!.adjustment, -10);
  assert.equal(result!.sampleSize, 12);
  assert.ok(result!.avgClvPercent < -2);
  assert.ok(result!.reason.includes('Strong negative CLV'));
});

test('computeClvTrustAdjustment returns -5 for marginally negative CLV (-2% to 0%)', async () => {
  const repositories = createInMemoryRepositoryBundle();

  await seedSettlements(repositories, 'smart-form', 12, -1.0);

  const result = await computeClvTrustAdjustment(
    'smart-form',
    repositories.settlements,
    repositories.picks,
  );

  assert.notEqual(result, null);
  assert.equal(result!.adjustment, -5);
  assert.equal(result!.sampleSize, 12);
  assert.ok(result!.avgClvPercent < 0);
  assert.ok(result!.avgClvPercent >= -2);
  assert.ok(result!.reason.includes('Marginally negative CLV'));
});

test('computeClvTrustAdjustment returns 0 adjustment for exactly neutral CLV', async () => {
  const repositories = createInMemoryRepositoryBundle();

  // Seed 12 settlements all with exactly 0 clvPercent
  for (let i = 0; i < 12; i++) {
    const pickId = `pick-neutral-${i}`;
    await repositories.picks.savePick({
      id: pickId,
      submissionId: `sub-${pickId}`,
      market: 'NBA points',
      selection: 'Player Over 18.5',
      line: 18.5,
      odds: -110,
      stakeUnits: 1,
      confidence: 0.7,
      source: 'smart-form',
      approvalStatus: 'approved',
      promotionStatus: 'qualified',
      promotionTarget: 'best-bets',
      promotionScore: 80,
      promotionReason: 'qualified',
      promotionVersion: '1.0',
      promotionDecidedAt: new Date().toISOString(),
      promotionDecidedBy: 'system',
      lifecycleState: 'posted',
      metadata: {},
      createdAt: new Date().toISOString(),
    });

    await repositories.settlements.record({
      pickId,
      status: 'settled',
      result: 'win',
      source: 'grading',
      confidence: 'confirmed',
      evidenceRef: `grade-${i}`,
      settledBy: 'system',
      settledAt: new Date().toISOString(),
      payload: {
        clvRaw: 0,
        clvPercent: 0,
        beatsClosingLine: false,
      },
    });
  }

  const result = await computeClvTrustAdjustment(
    'smart-form',
    repositories.settlements,
    repositories.picks,
  );

  assert.notEqual(result, null);
  assert.equal(result!.adjustment, 0);
  assert.ok(result!.reason.includes('Neutral CLV'));
});

test('computeClvTrustAdjustment filters by source (submittedBy)', async () => {
  const repositories = createInMemoryRepositoryBundle();

  // Seed 15 settlements for 'discord' source with strong positive CLV
  await seedSettlements(repositories, 'discord', 15, 5.0);

  // Query for a different source — should have no matching settlements
  const result = await computeClvTrustAdjustment(
    'smart-form',
    repositories.settlements,
    repositories.picks,
  );

  assert.equal(result, null);
});

test('computeClvTrustAdjustment ignores non-grading settlements', async () => {
  const repositories = createInMemoryRepositoryBundle();

  // Seed picks and settlements with source !== 'grading'
  for (let i = 0; i < 15; i++) {
    const pickId = `pick-manual-${i}`;
    await repositories.picks.savePick({
      id: pickId,
      submissionId: `sub-${pickId}`,
      market: 'NBA points',
      selection: 'Player Over 18.5',
      line: 18.5,
      odds: -110,
      stakeUnits: 1,
      confidence: 0.7,
      source: 'smart-form',
      approvalStatus: 'approved',
      promotionStatus: 'qualified',
      promotionTarget: 'best-bets',
      promotionScore: 80,
      promotionReason: 'qualified',
      promotionVersion: '1.0',
      promotionDecidedAt: new Date().toISOString(),
      promotionDecidedBy: 'system',
      lifecycleState: 'posted',
      metadata: {},
      createdAt: new Date().toISOString(),
    });

    await repositories.settlements.record({
      pickId,
      status: 'settled',
      result: 'win',
      source: 'operator',  // not 'grading'
      confidence: 'confirmed',
      evidenceRef: `manual-${i}`,
      settledBy: 'operator',
      settledAt: new Date().toISOString(),
      payload: {
        clvRaw: 0.05,
        clvPercent: 5.0,
        beatsClosingLine: true,
      },
    });
  }

  const result = await computeClvTrustAdjustment(
    'smart-form',
    repositories.settlements,
    repositories.picks,
  );

  assert.equal(result, null);
});

test('computeClvTrustAdjustment respects custom minSampleSize option', async () => {
  const repositories = createInMemoryRepositoryBundle();

  await seedSettlements(repositories, 'smart-form', 5, 4.0);

  // With default minSampleSize (10), would return null
  const defaultResult = await computeClvTrustAdjustment(
    'smart-form',
    repositories.settlements,
    repositories.picks,
  );
  assert.equal(defaultResult, null);

  // With custom minSampleSize of 3, should return a result
  const customResult = await computeClvTrustAdjustment(
    'smart-form',
    repositories.settlements,
    repositories.picks,
    { minSampleSize: 3 },
  );
  assert.notEqual(customResult, null);
  assert.equal(customResult!.adjustment, 10);
});
