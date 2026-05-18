/**
 * T1 live-DB proof: UTV2-987 uniqueness real signal
 *
 * Verifies that the uniqueness score and its supporting dimensions
 * (sameSportMarketCount, selectionOverlapCount) are captured in the
 * PromotionDecisionSnapshot when promotion runs against real Supabase.
 *
 * Also verifies that computeUniquenessWithMeta labels the fallback
 * reason explicitly when no open-picks data is available.
 *
 * Run:
 *   UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-987-uniqueness-signal.test.ts
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type RepositoryBundle,
} from '@unit-talk/db';
import { computeUniquenessWithMeta } from '@unit-talk/domain';
import { processSubmission } from './submission-service.js';
import { evaluateAndPersistBestBetsPromotion } from './promotion-service.js';

function hasSupabaseSmokeEnvironment() {
  try {
    const env = loadEnvironment();
    return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  } catch {
    return false;
  }
}

const skipReason = hasSupabaseSmokeEnvironment()
  ? false
  : 'SUPABASE_SERVICE_ROLE_KEY not configured — skipping live DB proof';

let repositories: RepositoryBundle;

before(() => {
  if (skipReason) return;
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  repositories = createDatabaseRepositoryBundle(connection);
});

const testWithDb = skipReason ? test.skip : test;

testWithDb('UTV2-987: uniquenessInputs dimensions present in snapshot (live DB)', async () => {
  const ts = Date.now();

  const result = await processSubmission(
    {
      source: 'model-driven',
      market: `utv2-987-proof-market-${ts}`,
      selection: `ProofPlayer OVER 5.5`,
      confidence: 0.65,
      stakeUnits: 1.5,
      metadata: {
        sport: 'NBA',
        eventName: `UTV2-987 proof game ${ts}`,
      },
    },
    repositories,
  );

  assert.ok(result.pick.id, 'pick must be created');

  const promotionResult = await evaluateAndPersistBestBetsPromotion(
    result.pick.id,
    'utv2-987-proof',
    repositories.picks,
    repositories.audit,
  );

  assert.ok(promotionResult.snapshot, 'snapshot must be present');
  const scoreInputs = promotionResult.snapshot.scoreInputs as Record<string, unknown>;

  // uniquenessInputs must be present (openPicks is always an array in the pipeline)
  const uniquenessInputs = scoreInputs['uniquenessInputs'] as
    | { sameSportMarketCount: number; selectionOverlapCount: number }
    | undefined;
  assert.ok(
    uniquenessInputs !== undefined,
    'uniquenessInputs must be present in snapshot when promotion runs via DB',
  );
  assert.equal(typeof uniquenessInputs.sameSportMarketCount, 'number', 'sameSportMarketCount must be a number');
  assert.equal(typeof uniquenessInputs.selectionOverlapCount, 'number', 'selectionOverlapCount must be a number');
});

testWithDb('UTV2-987: computeUniquenessWithMeta fallback reason when no open-picks data', async (_t) => {
  // Domain function tests — included here so they run as part of the T1 gate

  const fallbackResult = computeUniquenessWithMeta({ activeSameSportMarketCount: undefined });
  assert.equal(fallbackResult.score, 50, 'fallback score must be 50');
  assert.equal(fallbackResult.fallbackReason, 'no-open-picks-data', 'fallback reason must be labeled');
  assert.equal(fallbackResult.dimensions, null, 'dimensions must be null in fallback');

  const zeroResult = computeUniquenessWithMeta({ activeSameSportMarketCount: 0 });
  assert.equal(zeroResult.score, 100, 'score must be 100 with zero saturation');
  assert.equal(zeroResult.fallbackReason, undefined, 'no fallback reason when data available');
  assert.deepEqual(
    zeroResult.dimensions,
    { sameSportMarketCount: 0, selectionOverlapCount: 0 },
    'dimensions must reflect zero counts',
  );

  const saturatedResult = computeUniquenessWithMeta({
    activeSameSportMarketCount: 2,
    activeSelectionOverlapCount: 0,
  });
  assert.equal(saturatedResult.score, 80, 'score must be 80 with 2 same-market peers (100 - 20)');
  assert.deepEqual(
    saturatedResult.dimensions,
    { sameSportMarketCount: 2, selectionOverlapCount: 0 },
    'dimensions must reflect two-peer saturation',
  );
});
