import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { processShadowSubmission } from './submission-service.js';
import { getShadowModelSummaries } from './shadow-model-summary-service.js';

test('getShadowModelSummaries groups routing-shadow model picks by model and sport', async () => {
  const repositories = createInMemoryRepositoryBundle();

  const first = await processShadowSubmission(
    {
      source: 'model-driven',
      market: 'NBA spread',
      selection: 'Knicks -4.5',
      line: -4.5,
      confidence: 0.81,
      eventName: 'Knicks vs Celtics',
      metadata: { sport: 'NBA', modelName: 'nba-spread-shadow' },
    },
    repositories,
  );

  await processShadowSubmission(
    {
      source: 'model-driven',
      market: 'NBA spread',
      selection: 'Celtics +4.5',
      line: 4.5,
      confidence: 0.63,
      eventName: 'Celtics vs Heat',
      metadata: { sport: 'NBA', modelName: 'nba-spread-shadow' },
    },
    repositories,
  );

  const third = await processShadowSubmission(
    {
      source: 'model-driven',
      market: 'MLB moneyline',
      selection: 'Yankees ML',
      confidence: 0.58,
      eventName: 'Yankees vs Red Sox',
      metadata: { sport: 'MLB', modelName: 'mlb-ml-shadow' },
    },
    repositories,
  );

  await repositories.settlements.record({
    pickId: first.pick.id,
    status: 'settled',
    result: 'win',
    source: 'operator',
    confidence: 'confirmed',
    evidenceRef: 'shadow://first',
    settledBy: 'shadow-test',
    settledAt: '2026-04-03T19:00:00.000Z',
    payload: {},
  });

  await repositories.settlements.record({
    pickId: third.pick.id,
    status: 'settled',
    result: 'loss',
    source: 'operator',
    confidence: 'confirmed',
    evidenceRef: 'shadow://third',
    settledBy: 'shadow-test',
    settledAt: '2026-04-03T21:00:00.000Z',
    payload: {},
  });

  const result = await getShadowModelSummaries(repositories);

  assert.equal(result.count, 2);
  assert.equal(result.summaries[0]?.modelName, 'mlb-ml-shadow');
  assert.equal(result.summaries[0]?.sport, 'MLB');
  assert.equal(result.summaries[0]?.wins, 0);
  assert.equal(result.summaries[0]?.losses, 1);
  assert.equal(result.summaries[0]?.settledPredictions, 1);
  assert.equal(result.summaries[0]?.pendingPredictions, 0);

  const nba = result.summaries.find((summary) => summary.modelName === 'nba-spread-shadow');
  assert.ok(nba);
  assert.equal(nba.sport, 'NBA');
  assert.equal(nba.totalPredictions, 2);
  assert.equal(nba.settledPredictions, 1);
  assert.equal(nba.pendingPredictions, 1);
  assert.equal(nba.wins, 1);
  assert.equal(nba.losses, 0);
  assert.equal(nba.pushes, 0);
  assert.equal(nba.avgConfidence, 0.72);

  const ignoredLive = await repositories.picks.savePick({
    id: 'live-pick',
    submissionId: 'live-submission',
    market: 'NBA spread',
    selection: 'Lakers -2.5',
    source: 'model-driven',
    approvalStatus: 'approved',
    promotionStatus: 'qualified',
    promotionTarget: 'best-bets',
    lifecycleState: 'queued',
    metadata: {},
    createdAt: new Date('2026-04-03T12:00:00.000Z').toISOString(),
  });
  assert.ok(ignoredLive);

  const afterIgnored = await getShadowModelSummaries(repositories);
  assert.equal(afterIgnored.count, 2);
});
