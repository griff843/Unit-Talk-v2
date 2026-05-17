/**
 * T1 Pre-Merge Proof: UTV2-985 edge provenance wiring and fail-closed promotion
 *
 * Exercises the fail-closed promotion path against the live Supabase database:
 * 1. Submits a confidence-delta pick (no odds) — expects edgeProvenance.method === 'confidence-delta'
 *    and promotionStatus === 'suppressed' (edge = 0 contribution, score below threshold).
 * 2. Reads readMarketBackedEdgeScore() result directly from pick metadata — expects null for
 *    confidence-delta picks.
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. Fixtures are tagged with prefix `utv2-985-proof-*`.
 * Rows are NOT deleted — live DB proofs are append-only.
 *
 * Run:
 *   UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-985-edge-provenance.test.ts
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type RepositoryBundle,
} from '@unit-talk/db';
import { processSubmission } from './submission-service.js';
import {
  evaluateAndPersistBestBetsPromotion,
  readMarketBackedEdgeScore,
} from './promotion-service.js';

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
const createdPickIds: string[] = [];

before(() => {
  if (skipReason) return;
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  repositories = createDatabaseRepositoryBundle(connection);
});

// ── Test 1: confidence-delta pick is fail-closed ──────────────────────────

test(
  'UTV2-985: confidence-delta pick (no odds) gets edgeProvenance.method=confidence-delta and is suppressed in promotion',
  { skip: skipReason },
  async () => {
    const result = await processSubmission(
      {
        source: 'model-driven',
        market: 'player_props',
        selection: 'utv2-985-proof-player OVER 5.5',
        confidence: 0.82,
        // No odds — forces confidence-delta path
        metadata: {
          thesis: 'UTV2-985 T1 proof: confidence-delta fail-closed',
          eventName: 'utv2-985-proof-event',
        },
        submittedBy: 'utv2-985-proof-runner',
      },
      repositories,
    );

    createdPickIds.push(result.pick.id);
    const metadata = result.pick.metadata as Record<string, unknown>;

    // edgeProvenance must be present with confidence-delta method
    const edgeProvenance = metadata['edgeProvenance'] as Record<string, unknown> | undefined;
    assert.ok(edgeProvenance, 'edgeProvenance must be written to pick.metadata');
    assert.equal(
      edgeProvenance['method'],
      'confidence-delta',
      'pick without odds must have method=confidence-delta',
    );
    assert.equal(
      edgeProvenance['providerCoverageState'],
      'none',
      'pick without odds must have providerCoverageState=none',
    );
    assert.ok(
      typeof edgeProvenance['fallbackReason'] === 'string',
      'pick without odds must have a fallbackReason',
    );

    // readMarketBackedEdgeScore must return null (fail-closed)
    const marketBacked = readMarketBackedEdgeScore(metadata);
    assert.equal(
      marketBacked,
      null,
      'readMarketBackedEdgeScore must return null for confidence-delta pick',
    );

    // Evaluate promotion — should be suppressed
    const promotionResult = await evaluateAndPersistBestBetsPromotion(
      result.pick.id,
      'utv2-985-proof-runner',
      repositories.picks,
      repositories.audit,
    );

    assert.ok(promotionResult, 'evaluateAndPersistBestBetsPromotion must return a result');
    assert.equal(
      promotionResult.decision.status,
      'suppressed',
      'confidence-delta pick must be suppressed in fail-closed promotion (edge = 0)',
    );
    assert.ok(
      !promotionResult.decision.target,
      'suppressed pick must have no promotion target',
    );

    console.log(
      `  UTV2-985 fail-closed OK — pickId=${result.pick.id} status=${promotionResult.decision.status}`,
    );
  },
);

// ── Diagnostics ───────────────────────────────────────────────────────────

test('UTV2-985 proof created pick ids (diagnostics)', { skip: skipReason }, () => {
  console.log(`  UTV2-985 proof created pick ids: ${JSON.stringify(createdPickIds)}`);
});
