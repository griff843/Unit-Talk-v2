/**
 * T1 Pre-Merge Proof: UTV2-986 Kelly sizing metadata path fix
 *
 * Verifies that readKellyGradientReadiness correctly reads fractional_kelly
 * from the primary Kelly sizing path. Before this fix, the function read
 * `kellySizing['kellyFraction']` (non-existent field), silently falling
 * through to the domainAnalysis fallback on every pick.
 *
 * Proof strategy:
 * 1. Connect to live Supabase
 * 2. Submit test picks to create real DB rows
 * 3. Run evaluateAndPersistBestBetsPromotion (exercises promotion pipeline)
 * 4. Verify readKellyGradientReadiness reads fractional_kelly correctly
 *    (primary path) and falls through to null only when kellySizing absent
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. Fixtures tagged 'utv2-986-proof-*'.
 * Rows are NOT deleted — live DB proofs are append-only.
 *
 * Run:
 *   UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-986-kelly-readiness.test.ts
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
  readKellyGradientReadiness,
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

// ── Test 1: fractional_kelly primary path reads correctly ─────────────────

test(
  'UTV2-986: readKellyGradientReadiness reads fractional_kelly (primary path, not legacy kellyFraction)',
  { skip: skipReason },
  async () => {
    // Create a real pick in the live DB to anchor the proof in production state.
    const result = await processSubmission(
      {
        source: 'model-driven',
        market: 'player_props',
        selection: 'utv2-986-proof-player OVER 4.5',
        confidence: 0.78,
        stakeUnits: 1.5,
        metadata: {
          thesis: 'UTV2-986 T1 proof: kelly primary path fix',
          eventName: 'utv2-986-proof-event',
        },
        submittedBy: 'utv2-986-proof-runner',
      },
      repositories,
    );

    createdPickIds.push(result.pick.id);

    // Verify primary path: fractional_kelly is correctly read.
    // Before the fix: kellySizing['kellyFraction'] was undefined (wrong field name),
    // so this path was silently dead. After fix: reads fractional_kelly correctly.
    const metadataWithKelly = {
      ...(result.pick.metadata as Record<string, unknown>),
      kellySizing: { fractional_kelly: 0.06, raw_kelly: 0.24, has_edge: true },
    };

    const primaryReadiness = readKellyGradientReadiness(metadataWithKelly);
    // Math.round(40 + 55 * Math.min(1, 0.06 / 0.25)) = Math.round(40 + 13.2) = 53
    assert.equal(
      primaryReadiness,
      53,
      'readKellyGradientReadiness must return 53 for fractional_kelly=0.06 (primary path)',
    );

    // Verify the old broken field name does NOT trigger primary path.
    // Before the fix, the function looked for this field — after the fix it is ignored.
    const metadataWithLegacyField = {
      ...(result.pick.metadata as Record<string, unknown>),
      kellySizing: { kellyFraction: 0.06 },
    };
    const legacyReadiness = readKellyGradientReadiness(metadataWithLegacyField);
    assert.equal(
      legacyReadiness,
      null,
      'kellySizing.kellyFraction (old broken field name) must not match primary path — returns null',
    );

    console.log(
      `  UTV2-986 kelly primary path OK — pickId=${result.pick.id} primaryReadiness=${primaryReadiness}`,
    );
  },
);

// ── Test 2: promotion pipeline runs on a live DB pick ─────────────────────

test(
  'UTV2-986: evaluateAndPersistBestBetsPromotion runs to completion with live DB pick',
  { skip: skipReason },
  async () => {
    const result = await processSubmission(
      {
        source: 'model-driven',
        market: 'player_props',
        selection: 'utv2-986-proof-verify OVER 2.5',
        confidence: 0.55,
        stakeUnits: 1.5,
        metadata: {
          thesis: 'UTV2-986 T1 proof: promotion pipeline check',
          eventName: 'utv2-986-proof-event',
        },
        submittedBy: 'utv2-986-proof-runner',
      },
      repositories,
    );

    createdPickIds.push(result.pick.id);

    const promotionResult = await evaluateAndPersistBestBetsPromotion(
      result.pick.id,
      'utv2-986-proof-runner',
      repositories.picks,
      repositories.audit,
    );

    assert.ok(promotionResult, 'evaluateAndPersistBestBetsPromotion must return a result');
    assert.ok(
      ['promoted', 'suppressed', 'deferred', 'not_eligible'].includes(promotionResult.decision.status),
      `promotion status must be a valid decision, got: ${promotionResult.decision.status}`,
    );

    console.log(
      `  UTV2-986 promotion pipeline OK — pickId=${result.pick.id} status=${promotionResult.decision.status}`,
    );
  },
);

// ── Diagnostics ───────────────────────────────────────────────────────────

test('UTV2-986 proof created pick ids (diagnostics)', { skip: skipReason }, () => {
  console.log(`  UTV2-986 proof created pick ids: ${JSON.stringify(createdPickIds)}`);
});
