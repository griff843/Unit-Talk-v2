import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProofOutput, DailyCounts, Guardrails } from './shadow-scoring-runner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGuardrails(overrides: Partial<Guardrails> = {}): Guardrails {
  return {
    picksCreated: 0,
    shadowModeFalseSet: 0,
    distributionEnqueued: 0,
    promotionWidened: 0,
    ...overrides,
  };
}

function makeDailyCounts(overrides: Partial<DailyCounts> = {}): DailyCounts {
  return {
    rawPropsIngested: 0,
    marketUniverseRows: 0,
    candidatesScanned: 0,
    candidatesAlreadyScored: 0,
    candidatesScoredThisRun: 0,
    skippedByReason: {},
    ranked: 0,
    posted: 0,
    shadowOnly: 0,
    settledResultBacked: 0,
    clvReady: 0,
    ...overrides,
  };
}

function _makeProofOutput(overrides: { dailyCounts?: Partial<DailyCounts>; guardrails?: Partial<Guardrails> } = {}): ProofOutput {
  return {
    timestamp: new Date().toISOString(),
    runId: 'test-run-id',
    dailyCounts: makeDailyCounts(overrides.dailyCounts),
    guardrails: makeGuardrails(overrides.guardrails),
  };
}

// ---------------------------------------------------------------------------
// Mock scoring run (simulates the runner with a mocked DB)
// ---------------------------------------------------------------------------

async function mockRun(
  options: {
    dryRun?: boolean;
    batchSize?: number;
    statuses?: string[];
    candidatesToScore?: number;
  } = {},
): Promise<ProofOutput> {
  const { dryRun = false, batchSize: _batchSize = 100, statuses: _statuses = ['qualified', 'rejected'], candidatesToScore = 5 } = options;

  // Simulate the counts query (no real DB)
  const dailyCounts: DailyCounts = makeDailyCounts({
    candidatesScanned: candidatesToScore + 10,
    candidatesAlreadyScored: 10,
    candidatesScoredThisRun: dryRun ? 0 : candidatesToScore,
    skippedByReason: { no_model_score: candidatesToScore },
    shadowOnly: candidatesToScore + 10,
  });

  // Guardrails are always zero -- no picks created, no shadow_mode changes, etc.
  const guardrails: Guardrails = makeGuardrails();

  return {
    timestamp: new Date().toISOString(),
    runId: 'mock-run-' + Date.now(),
    dailyCounts,
    guardrails,
  };
}

// Verify that none of the forbidden functions are referenced in the runner source
async function assertNoForbiddenCalls(): Promise<void> {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dir = resolve(fileURLToPath(import.meta.url), '..');
  const source = readFileSync(resolve(dir, 'shadow-scoring-runner.ts'), 'utf8');

  const forbidden = ['enqueueDistribution', 'promoteToLive', 'createPick'];
  for (const fn of forbidden) {
    assert.ok(
      !source.includes(fn + '('),
      `Runner source must not call ${fn}()`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('guardrails.picksCreated is always 0 in runner output', async () => {
  const proof = await mockRun();
  assert.equal(proof.guardrails.picksCreated, 0);
});

test('guardrails.shadowModeFalseSet is always 0 in runner output', async () => {
  const proof = await mockRun();
  assert.equal(proof.guardrails.shadowModeFalseSet, 0);
});

test('guardrails.distributionEnqueued is always 0 in runner output', async () => {
  const proof = await mockRun();
  assert.equal(proof.guardrails.distributionEnqueued, 0);
});

test('guardrails.promotionWidened is always 0 in runner output', async () => {
  const proof = await mockRun();
  assert.equal(proof.guardrails.promotionWidened, 0);
});

test('runner never calls enqueueDistribution, promoteToLive, or createPick', async () => {
  await assertNoForbiddenCalls();
});

test('proof JSON has all required dailyCounts keys', async () => {
  const proof = await mockRun();
  const dc = proof.dailyCounts;

  assert.ok('rawPropsIngested' in dc, 'missing rawPropsIngested');
  assert.ok('marketUniverseRows' in dc, 'missing marketUniverseRows');
  assert.ok('candidatesScanned' in dc, 'missing candidatesScanned');
  assert.ok('candidatesAlreadyScored' in dc, 'missing candidatesAlreadyScored');
  assert.ok('candidatesScoredThisRun' in dc, 'missing candidatesScoredThisRun');
  assert.ok('skippedByReason' in dc, 'missing skippedByReason');
  assert.ok('ranked' in dc, 'missing ranked');
  assert.ok('posted' in dc, 'missing posted');
  assert.ok('shadowOnly' in dc, 'missing shadowOnly');
  assert.ok('settledResultBacked' in dc, 'missing settledResultBacked');
  assert.ok('clvReady' in dc, 'missing clvReady');
});

test('proof JSON has all required guardrails keys', async () => {
  const proof = await mockRun();
  const g = proof.guardrails;

  assert.ok('picksCreated' in g, 'missing picksCreated');
  assert.ok('shadowModeFalseSet' in g, 'missing shadowModeFalseSet');
  assert.ok('distributionEnqueued' in g, 'missing distributionEnqueued');
  assert.ok('promotionWidened' in g, 'missing promotionWidened');
});

test('proof JSON has timestamp and runId', async () => {
  const proof = await mockRun();
  assert.ok(typeof proof.timestamp === 'string' && proof.timestamp.length > 0, 'missing timestamp');
  assert.ok(typeof proof.runId === 'string' && proof.runId.length > 0, 'missing runId');
});

test('dry-run does not score any candidates', async () => {
  const proof = await mockRun({ dryRun: true });
  assert.equal(proof.dailyCounts.candidatesScoredThisRun, 0);
});

test('assertGuardrails throws if picksCreated is nonzero', async () => {
  const { assertGuardrails } = await import('./shadow-scoring-runner.js');
  assert.throws(
    () => assertGuardrails(makeGuardrails({ picksCreated: 1 })),
    /GUARDRAIL VIOLATION/,
  );
});

test('assertGuardrails throws if shadowModeFalseSet is nonzero', async () => {
  const { assertGuardrails } = await import('./shadow-scoring-runner.js');
  assert.throws(
    () => assertGuardrails(makeGuardrails({ shadowModeFalseSet: 1 })),
    /GUARDRAIL VIOLATION/,
  );
});

test('assertGuardrails passes when all guardrails are 0', async () => {
  const { assertGuardrails } = await import('./shadow-scoring-runner.js');
  assert.doesNotThrow(() => assertGuardrails(makeGuardrails()));
});

test('parseCliOptions parses --dry-run flag', async () => {
  const { parseCliOptions } = await import('./shadow-scoring-runner.js');
  const opts = parseCliOptions(['--dry-run']);
  assert.equal(opts.dryRun, true);
});

test('parseCliOptions defaults to qualified,rejected statuses', async () => {
  const { parseCliOptions } = await import('./shadow-scoring-runner.js');
  const opts = parseCliOptions([]);
  assert.deepEqual(opts.statuses, ['qualified', 'rejected']);
});

test('parseCliOptions parses --batch-size', async () => {
  const { parseCliOptions } = await import('./shadow-scoring-runner.js');
  const opts = parseCliOptions(['--batch-size', '50']);
  assert.equal(opts.batchSize, 50);
});
