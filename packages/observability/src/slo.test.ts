import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateQueueHealth } from './index.js';
import {
  evaluateSlo,
  sloReportLogFields,
  defaultSloThresholds,
  SLO_OBJECTIVES,
} from './slo.js';

function makeHealth(overrides: Partial<Parameters<typeof evaluateQueueHealth>[0]> = {}) {
  return evaluateQueueHealth({
    observedAt: new Date().toISOString(),
    workerTargets: ['discord:canary'],
    outboxRows: [],
    ...overrides,
  });
}

test('SLO_OBJECTIVES defines expected objectives', () => {
  assert.ok('delivery_freshness' in SLO_OBJECTIVES);
  assert.ok('queue_age' in SLO_OBJECTIVES);
  assert.ok('delivery_success' in SLO_OBJECTIVES);
  assert.ok('queue_availability' in SLO_OBJECTIVES);
  assert.equal(SLO_OBJECTIVES['delivery_freshness']!.targetPercent, 99.5);
});

test('evaluateSlo: healthy empty queue → all ok, deploy risk low', () => {
  const health = makeHealth();
  const report = evaluateSlo(health);

  assert.equal(report.overallStatus, 'ok');
  assert.equal(report.deployRisk, 'low');
  assert.equal(report.violatedObjectives.length, 0);
  assert.equal(report.atRiskObjectives.length, 0);
  assert.equal(report.evaluations.length, 4);
  for (const e of report.evaluations) {
    assert.equal(e.status, 'ok');
    assert.equal(e.errorBudgetConsumedPercent, 0);
  }
});

test('evaluateSlo: stale delivery → delivery_freshness breached, deploy risk high', () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const health = evaluateQueueHealth({
    observedAt: new Date().toISOString(),
    workerTargets: ['discord:canary'],
    outboxRows: [
      { id: '1', status: 'sent', target: 'discord:canary', createdAt: twoHoursAgo, updatedAt: twoHoursAgo },
      { id: '2', status: 'pending', target: 'discord:canary', createdAt: twoHoursAgo },
    ],
  });

  const report = evaluateSlo(health);

  assert.equal(report.overallStatus, 'breached');
  assert.equal(report.deployRisk, 'high');
  assert.ok(report.violatedObjectives.includes('delivery_freshness'));
});

test('evaluateSlo: dead-letter rows → delivery_success breached', () => {
  const health = evaluateQueueHealth({
    observedAt: new Date().toISOString(),
    workerTargets: ['discord:canary'],
    outboxRows: [
      { id: '1', status: 'dead_letter', target: 'discord:canary', createdAt: new Date().toISOString() },
    ],
  });

  const report = evaluateSlo(health);

  assert.ok(report.violatedObjectives.includes('delivery_success'));
  assert.equal(report.overallStatus, 'breached');
  assert.equal(report.deployRisk, 'high');
});

test('evaluateSlo: stale pending rows → queue_age breached', () => {
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const health = evaluateQueueHealth({
    observedAt: new Date().toISOString(),
    workerTargets: ['discord:canary'],
    outboxRows: [
      { id: '1', status: 'pending', target: 'discord:canary', createdAt: threeHoursAgo },
    ],
  });

  const report = evaluateSlo(health, { queueAgeCriticalMs: 2 * 60 * 60 * 1000 });

  assert.ok(report.violatedObjectives.includes('queue_age'));
});

test('evaluateSlo: at-risk delivery age → at_risk status, deploy risk medium', () => {
  const fortyMinAgo = new Date(Date.now() - 40 * 60 * 1000).toISOString();
  const health = evaluateQueueHealth({
    observedAt: new Date().toISOString(),
    workerTargets: ['discord:canary'],
    outboxRows: [
      { id: '1', status: 'sent', target: 'discord:canary', createdAt: fortyMinAgo, updatedAt: fortyMinAgo },
      { id: '2', status: 'pending', target: 'discord:canary', createdAt: new Date().toISOString() },
    ],
  });

  const report = evaluateSlo(health, {
    deliveryFreshnessWarnMs: 30 * 60 * 1000,
    deliveryFreshnessCriticalMs: 60 * 60 * 1000,
  });

  assert.equal(report.overallStatus, 'at_risk');
  assert.equal(report.deployRisk, 'medium');
  assert.ok(report.atRiskObjectives.includes('delivery_freshness'));
  assert.equal(report.violatedObjectives.length, 0);
});

test('evaluateSlo: failed rows → delivery_success at_risk', () => {
  const health = evaluateQueueHealth({
    observedAt: new Date().toISOString(),
    workerTargets: ['discord:canary'],
    outboxRows: [
      { id: '1', status: 'failed', target: 'discord:canary', createdAt: new Date().toISOString() },
    ],
  });

  const report = evaluateSlo(health);

  assert.ok(report.atRiskObjectives.includes('delivery_success'));
  assert.equal(report.overallStatus, 'at_risk');
});

test('evaluateSlo: custom thresholds override defaults', () => {
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const health = evaluateQueueHealth({
    observedAt: new Date().toISOString(),
    workerTargets: ['discord:canary'],
    outboxRows: [
      { id: '1', status: 'sent', target: 'discord:canary', createdAt: tenMinAgo, updatedAt: tenMinAgo },
      { id: '2', status: 'pending', target: 'discord:canary', createdAt: new Date().toISOString() },
    ],
  });

  // Tight threshold: 5 min critical → 10 min old delivery should breach
  const report = evaluateSlo(health, {
    deliveryFreshnessWarnMs: 3 * 60 * 1000,
    deliveryFreshnessCriticalMs: 5 * 60 * 1000,
  });

  assert.ok(report.violatedObjectives.includes('delivery_freshness'));
});

test('evaluateSlo: defaultSloThresholds are sensible', () => {
  assert.ok(defaultSloThresholds.deliveryFreshnessCriticalMs > defaultSloThresholds.deliveryFreshnessWarnMs);
  assert.ok(defaultSloThresholds.queueAgeCriticalMs > defaultSloThresholds.queueAgeWarnMs);
});

test('sloReportLogFields returns structured log-compatible output', () => {
  const health = makeHealth();
  const report = evaluateSlo(health);
  const fields = sloReportLogFields(report);

  assert.equal(fields.sloOverallStatus, 'ok');
  assert.equal(fields.sloDeployRisk, 'low');
  assert.ok(Array.isArray(fields.sloEvaluations));
  assert.equal(fields.sloEvaluations.length, 4);
  for (const e of fields.sloEvaluations) {
    assert.ok('id' in e);
    assert.ok('status' in e);
    assert.ok('compliant' in e);
    assert.ok('errorBudgetConsumedPercent' in e);
    assert.ok('note' in e);
  }
});
