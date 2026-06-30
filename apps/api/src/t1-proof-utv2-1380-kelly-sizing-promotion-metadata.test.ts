/**
 * T1 proof: UTV2-1380 — Kelly sizing wired into promotion metadata
 *
 * Asserts the five behavioural invariants required by PM verdict:
 *   1. Promotion-time enrichment produces metadata.kellySizing when
 *      market-backed realEdge + marketProbability are present.
 *   2. The Kelly metadata is included in the promotion metadataPatch
 *      (enrichPickAtPromotionTime sets it on the scoring pick; buildPromotionMetadataPatch
 *      copies it to the patch when absent on the base pick).
 *   3. confidence-delta realEdgeSource never produces Kelly sizing.
 *   4. Missing odds or missing market-backed probability returns null / fail-closed.
 *   5. Existing metadata.kellySizing is not overwritten (idempotent).
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY for the live-DB schema assertion.
 * Live reads only — no mutations.
 *
 * Run:
 *   UNIT_TALK_APP_ENV=local npx tsx --test \
 *     apps/api/src/t1-proof-utv2-1380-kelly-sizing-promotion-metadata.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import type { CanonicalPick } from '@unit-talk/contracts'
import { enrichPickAtPromotionTime } from './promotion-service.js'
import { loadEnvironment } from '@unit-talk/config'
import {
  createDatabaseClientFromConnection,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db'

// ── Live DB guard ──────────────────────────────────────────────────────────

const isLiveDb = (): boolean => {
  try {
    const env = loadEnvironment(process.cwd()) as unknown as Record<string, unknown>
    return Boolean(env['SUPABASE_URL'] && env['SUPABASE_SERVICE_ROLE_KEY'])
  } catch {
    return false
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeBasePick(
  metadata: Record<string, unknown> = {},
  odds?: number,
): CanonicalPick {
  return {
    id: 'test-pick-1380',
    submissionId: 'test-submission-1380',
    market: 'player.passing_yards',
    selection: 'QB Over 287.5',
    line: 287.5,
    odds,
    stakeUnits: 1,
    confidence: 0.62,
    source: 'system',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'validated',
    createdAt: '2026-06-30T00:00:00.000Z',
    metadata,
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

// ── Assertion 1: market-backed realEdge + marketProbability → kellySizing ──

test(
  'UTV2-1380: enrichPickAtPromotionTime produces kellySizing from market-backed realEdge + marketProbability',
  () => {
    const pick = makeBasePick(
      {
        domainAnalysis: {
          realEdge: 0.04,
          realEdgeSource: 'devig-power',
          marketProbability: 0.55,
          hasRealEdge: true,
        },
      },
      -120,
    )

    const enriched = enrichPickAtPromotionTime(pick)

    assert.ok(
      isRecord(enriched.metadata['kellySizing']),
      'kellySizing must be a record after enrichment',
    )
    const ks = enriched.metadata['kellySizing'] as Record<string, unknown>
    assert.equal(typeof ks['fractional_kelly'], 'number', 'fractional_kelly must be a number')
    assert.ok(
      typeof ks['recommended_units'] === 'number',
      'recommended_units must be a number',
    )
    assert.equal(typeof ks['has_edge'], 'boolean', 'has_edge must be a boolean')
  },
)

// ── Assertion 2: Kelly metadata included in the promotion metadataPatch ────
//
// buildPromotionMetadataPatch (promotion-service.ts:177) is private. The patch
// logic copies scoringPick.metadata.kellySizing into the patch whenever the
// base pick lacks it. This test proves the invariant by showing:
//   (a) the base pick has no kellySizing,
//   (b) enrichPickAtPromotionTime (which produces the scoringPick) populates it,
//   (c) therefore the patch would contain it — the conditional at line 187
//       `basePick.metadata['kellySizing'] == null && scoringPick.metadata['kellySizing'] != null`
//       is true.

test(
  'UTV2-1380: kellySizing absent on base pick → enriched scoring pick carries it, so metadataPatch includes it',
  () => {
    const basePick = makeBasePick(
      {
        domainAnalysis: {
          realEdge: 0.06,
          realEdgeSource: 'devig-power',
          marketProbability: 0.58,
          hasRealEdge: true,
        },
      },
      -110,
    )

    assert.equal(
      basePick.metadata['kellySizing'],
      undefined,
      'base pick must start with no kellySizing',
    )

    const scoringPick = enrichPickAtPromotionTime(basePick)

    assert.ok(
      isRecord(scoringPick.metadata['kellySizing']),
      'scoringPick must have kellySizing after enrichment',
    )

    // buildPromotionMetadataPatch condition satisfied:
    // basePick.metadata['kellySizing'] == null && scoringPick.metadata['kellySizing'] != null
    const baseAbsent = basePick.metadata['kellySizing'] == null
    const scoringPresent = scoringPick.metadata['kellySizing'] != null
    assert.ok(baseAbsent && scoringPresent, 'patch condition met: kellySizing will be copied into metadataPatch')
  },
)

// ── Assertion 3: confidence-delta never produces Kelly sizing ──────────────

test(
  'UTV2-1380: confidence-delta realEdgeSource → no kellySizing (fail-closed)',
  () => {
    const pick = makeBasePick(
      {
        domainAnalysis: {
          realEdge: 0.08,
          realEdgeSource: 'confidence-delta',
          marketProbability: 0.55,
          hasRealEdge: false,
        },
      },
      -110,
    )

    const enriched = enrichPickAtPromotionTime(pick)

    assert.equal(
      enriched.metadata['kellySizing'],
      undefined,
      'confidence-delta must not produce kellySizing',
    )
  },
)

// ── Assertion 4a: missing odds → null Kelly sizing ─────────────────────────

test(
  'UTV2-1380: missing odds → no kellySizing (fail-closed)',
  () => {
    const pick = makeBasePick(
      {
        domainAnalysis: {
          realEdge: 0.05,
          realEdgeSource: 'devig-power',
          marketProbability: 0.56,
          hasRealEdge: true,
        },
      },
      // odds omitted
    )

    const enriched = enrichPickAtPromotionTime(pick)

    assert.equal(
      enriched.metadata['kellySizing'],
      undefined,
      'missing odds must not produce kellySizing',
    )
  },
)

// ── Assertion 4b: missing marketProbability → no Kelly sizing ─────────────

test(
  'UTV2-1380: missing marketProbability → no kellySizing (fail-closed)',
  () => {
    const pick = makeBasePick(
      {
        domainAnalysis: {
          realEdge: 0.05,
          realEdgeSource: 'devig-power',
          // marketProbability intentionally absent
          hasRealEdge: true,
        },
      },
      -120,
    )

    const enriched = enrichPickAtPromotionTime(pick)

    assert.equal(
      enriched.metadata['kellySizing'],
      undefined,
      'missing marketProbability must not produce kellySizing',
    )
  },
)

// ── Assertion 5: idempotency — existing kellySizing is not overwritten ─────

test(
  'UTV2-1380: existing metadata.kellySizing is not overwritten by enrichPickAtPromotionTime',
  () => {
    const existingKelly = {
      fractional_kelly: 0.04,
      recommended_units: 0.4,
      recommended_fraction: 0.04,
      raw_kelly: 0.08,
      capped: false,
      cap_reason: null,
      has_edge: true,
    }

    const pick = makeBasePick(
      {
        kellySizing: existingKelly,
        domainAnalysis: {
          realEdge: 0.10,
          realEdgeSource: 'devig-power',
          marketProbability: 0.60,
          hasRealEdge: true,
        },
      },
      -120,
    )

    const enriched = enrichPickAtPromotionTime(pick)

    assert.deepEqual(
      enriched.metadata['kellySizing'],
      existingKelly,
      'enrichPickAtPromotionTime must not overwrite an existing kellySizing',
    )
    // pick reference unchanged when metadata already complete
    assert.strictEqual(
      enriched,
      pick,
      'must return the same pick reference when no enrichment is needed',
    )
  },
)

// ── Assertion 6: missing realEdge → no Kelly sizing ───────────────────────

test(
  'UTV2-1380: missing realEdge in domainAnalysis → no kellySizing (fail-closed)',
  () => {
    const pick = makeBasePick(
      {
        domainAnalysis: {
          // realEdge intentionally absent
          realEdgeSource: 'devig-power',
          marketProbability: 0.55,
          hasRealEdge: false,
        },
      },
      -120,
    )

    const enriched = enrichPickAtPromotionTime(pick)

    assert.equal(
      enriched.metadata['kellySizing'],
      undefined,
      'missing realEdge must not produce kellySizing',
    )
  },
)

// ── Live DB: schema assertion ──────────────────────────────────────────────
//
// Reads recent picks from live Supabase and:
//   1. Confirms the picks.metadata column is readable and returns records.
//   2. For any pick that already has metadata.kellySizing, validates the shape.
//   3. Runs enrichPickAtPromotionTime against a real pick shape to confirm
//      no crash on production data (no mutations).

test(
  'UTV2-1380 live DB: picks.metadata readable; kellySizing shape valid where present',
  async () => {
    if (!isLiveDb()) {
      console.log('[SKIP] UTV2-1380 live DB assertion skipped — no Supabase credentials')
      return
    }

    const env = loadEnvironment(process.cwd())
    const connection = createServiceRoleDatabaseConnectionConfig(env)
    const supabase = createDatabaseClientFromConnection(connection)

    // Read recent picks with metadata
    const { data: rows, error } = await supabase
      .from('picks')
      .select('id, odds, confidence, metadata, source, created_at')
      .order('created_at', { ascending: false })
      .limit(50)

    assert.ok(!error, `picks query failed: ${String(error?.message)}`)
    assert.ok(Array.isArray(rows), 'picks query must return an array')
    assert.ok(rows.length > 0, 'Expected at least 1 pick row in the database')

    let enrichmentRan = 0
    let kellySizingPresentCount = 0

    for (const row of rows) {
      const meta: Record<string, unknown> = isRecord(row['metadata']) ? row['metadata'] : {}

      // Count picks already having kellySizing (promoted after UTV2-1380 deployed)
      if (isRecord(meta['kellySizing'])) {
        kellySizingPresentCount++
        const ks = meta['kellySizing'] as Record<string, unknown>
        assert.equal(
          typeof ks['fractional_kelly'],
          'number',
          `pick ${row['id']}: kellySizing.fractional_kelly must be a number`,
        )
        assert.equal(
          typeof ks['has_edge'],
          'boolean',
          `pick ${row['id']}: kellySizing.has_edge must be a boolean`,
        )
      }

      // Run enrichPickAtPromotionTime against the real pick shape — read only, no mutations
      if (enrichmentRan < 5) {
        const fakePick: CanonicalPick = {
          id: String(row['id']),
          submissionId: String(row['id']),
          market: 'live-db-schema-check',
          selection: 'live-db-schema-check',
          odds: typeof row['odds'] === 'number' ? row['odds'] : undefined,
          confidence: typeof row['confidence'] === 'number' ? row['confidence'] : undefined,
          source: 'system',
          approvalStatus: 'approved',
          promotionStatus: 'not_eligible',
          lifecycleState: 'validated',
          createdAt: String(row['created_at']),
          metadata: meta,
        }

        // Must not throw on real production pick shapes
        const enriched = enrichPickAtPromotionTime(fakePick)
        assert.ok(isRecord(enriched.metadata), 'enrichPickAtPromotionTime must return a metadata record')
        enrichmentRan++
      }
    }

    console.log(
      `[UTV2-1380 live DB] rows=${rows.length} picks with kellySizing=${kellySizingPresentCount} enrichment-runs=${enrichmentRan}`,
    )

    assert.ok(enrichmentRan > 0, 'Expected to run enrichPickAtPromotionTime against at least one live pick')
  },
)
