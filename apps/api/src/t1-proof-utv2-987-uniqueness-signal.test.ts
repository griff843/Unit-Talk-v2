/**
 * T1 live-DB proof: UTV2-987 uniqueness real signal
 *
 * Verifies that the uniqueness score and its supporting dimensions
 * (sameSportMarketCount, selectionOverlapCount) are captured in the
 * PromotionDecisionSnapshot when promotion runs against real Supabase.
 *
 * Also verifies that computeUniquenessWithMeta labels the fallback
 * reason explicitly when no open-picks data is available.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabaseRepositoryBundle } from '@unit-talk/db';
import { processSubmission } from './submission-service.js';
import {
  evaluateAndPersistBestBetsPromotion,
} from './promotion-service.js';
import { computeUniquenessWithMeta } from '@unit-talk/domain';

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '';
const SUPABASE_SERVICE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';

const isLiveDb = SUPABASE_URL.startsWith('https://') && SUPABASE_SERVICE_KEY.length > 10;

const testWithDb = isLiveDb ? test : test.skip;

testWithDb('UTV2-987: uniquenessInputs dimensions present in snapshot (live DB)', async () => {
  const repositories = createDatabaseRepositoryBundle({
    supabaseUrl: SUPABASE_URL,
    supabaseKey: SUPABASE_SERVICE_KEY,
  });

  const ts = Date.now();

  // Submit a pick — will be evaluated with no same-market peers (unique)
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
  assert.equal(
    typeof uniquenessInputs.sameSportMarketCount,
    'number',
    'sameSportMarketCount must be a number',
  );
  assert.equal(
    typeof uniquenessInputs.selectionOverlapCount,
    'number',
    'selectionOverlapCount must be a number',
  );
  // No same-market peer for this unique market key → zero saturation
  assert.equal(
    uniquenessInputs.sameSportMarketCount,
    0,
    'sameSportMarketCount must be 0 for a unique market key with no peers',
  );
});

testWithDb('UTV2-987: computeUniquenessWithMeta fallback reason when no open-picks data', async (_t) => {
  // This tests the domain function directly — does not require DB calls.
  // Included in live-DB proof file so it runs as part of the T1 gate.

  // When activeSameSportMarketCount is undefined → fallback fires
  const fallbackResult = computeUniquenessWithMeta({ activeSameSportMarketCount: undefined });
  assert.equal(fallbackResult.score, 50, 'fallback score must be 50');
  assert.equal(fallbackResult.fallbackReason, 'no-open-picks-data', 'fallback reason must be labeled');
  assert.equal(fallbackResult.dimensions, null, 'dimensions must be null in fallback');

  // When activeSameSportMarketCount is 0 → real signal, zero saturation
  const zeroResult = computeUniquenessWithMeta({ activeSameSportMarketCount: 0 });
  assert.equal(zeroResult.score, 100, 'score must be 100 with zero saturation');
  assert.equal(zeroResult.fallbackReason, undefined, 'no fallback reason when data available');
  assert.deepEqual(
    zeroResult.dimensions,
    { sameSportMarketCount: 0, selectionOverlapCount: 0 },
    'dimensions must reflect zero counts',
  );

  // When 2 same-market picks exist → 80 saturation → score 20
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
