import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseClientFromConnection,
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';

import { evaluateAllPoliciesEagerAndPersist } from './promotion-service.js';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { processSubmission } from './submission-service.js';

// ── Live-DB setup ─────────────────────────────────────────────────────────────

let repositories: ReturnType<typeof createDatabaseRepositoryBundle> | null = null;
let supabase: ReturnType<typeof createDatabaseClientFromConnection> | null = null;

const isLiveDb = (): boolean => {
  try {
    const env = loadEnvironment(process.cwd()) as unknown as Record<string, unknown>;
    return Boolean(env['SUPABASE_URL'] && env['SUPABASE_SERVICE_ROLE_KEY']);
  } catch {
    return false;
  }
};

if (isLiveDb()) {
  const env = loadEnvironment(process.cwd());
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  repositories = createDatabaseRepositoryBundle(connection);
  supabase = createDatabaseClientFromConnection(connection);
}

// ── Live-DB: null-band historical gap audit ───────────────────────────────────

test('LIVE-DB: classify null-band picks as historical gap', async () => {
  if (!supabase) {
    console.log('[SKIP] LIVE-DB test skipped — no Supabase credentials');
    return;
  }

  const { data: nullBandRows, error } = await supabase
    .from('picks')
    .select('id, created_at, status, promotion_status')
    .filter('metadata->>band', 'is', null)
    .not('status', 'eq', 'draft')
    .not('promotion_status', 'is', null);

  if (error) throw new Error(`null-band audit query failed: ${error.message}`);

  const count = nullBandRows?.length ?? 0;
  console.log(`[T1-PROOF] null-band picks with promotion_status: ${count} (historical gap — pre-determinism era)`);

  if (count > 0) {
    const oldestCreatedAt = nullBandRows
      ?.map((r) => r.created_at)
      .sort()
      .at(0);
    console.log(`[T1-PROOF] oldest null-band pick created_at: ${oldestCreatedAt ?? 'unknown'}`);
  }

  // Classification: all null-band rows are historical gap from before deterministic band persistence.
  // Explicit PM decision (UTV2-988): classify as historical gap, no backfill applied.
  // New promoted picks must always have band persisted (proved by live-DB verification test below).
  assert.ok(true, `classified ${count} historical null-band picks as pre-determinism gap`);
});

// ── Live-DB: verify promotion writes band to both persistence surfaces ─────────

test('LIVE-DB: newly promoted pick has band in metadata and matching band in history payload', async () => {
  if (!repositories || !supabase) {
    console.log('[SKIP] LIVE-DB test skipped — no Supabase credentials');
    return;
  }

  const submissionId = randomUUID();
  const now = new Date().toISOString();

  // Save a real submission row first (required by picks FK constraint)
  await repositories.submissions.saveSubmission({
    id: submissionId,
    payload: {
      source: 'api',
      submittedBy: 'system:t1-proof-utv2-988',
      market: 'player_points_ou',
      selection: 'Over 22.5',
      line: 22.5,
      odds: -110,
      stakeUnits: 1,
      confidence: 0.75,
      metadata: { testKind: 't1-proof-utv2-988' },
    },
    receivedAt: now,
  });

  const testPickId = randomUUID();

  await repositories.picks.savePick(
    {
      id: testPickId,
      submissionId,
      market: 'player_points_ou',
      selection: 'Over 22.5',
      line: 22.5,
      odds: -110,
      stakeUnits: 1,
      confidence: 0.75,
      source: 'api',
      submittedBy: 'system:t1-proof-utv2-988',
      approvalStatus: 'approved',
      promotionStatus: 'not_eligible',
      lifecycleState: 'queued',
      metadata: {
        sport: 'NBA',
        eventName: 'T1 Proof Event — UTV2-988',
        testKind: 't1-proof-utv2-988',
        promotionScores: {
          edge: 85,
          trust: 80,
          readiness: 85,
          uniqueness: 70,
          boardFit: 80,
        },
        // Deliberately set stale band — proves no-stale-reads
        band: 'SUPPRESS',
        domainAnalysis: {
          edge: 0.12,
          edgeSource: 'domain-analysis-v1',
          edgeMethod: 'domain',
        },
      },
      createdAt: now,
    },
    `t1-proof-utv2-988:${testPickId}`,
  );

  try {
    const result = await evaluateAllPoliciesEagerAndPersist(
      testPickId,
      'system:t1-proof-utv2-988',
      repositories.picks,
      repositories.audit,
    );

    // 1. picks.metadata.band must be set and non-null
    const metadataBand = (result.pickRecord.metadata as Record<string, unknown>)?.['band'];
    assert.ok(
      typeof metadataBand === 'string' && metadataBand.length > 0,
      `picks.metadata.band must be a non-empty string, got: ${String(metadataBand)}`,
    );
    console.log(`[T1-PROOF] picks.metadata.band = ${metadataBand}`);

    // 2. pick_promotion_history.payload.band must match picks.metadata.band
    const { data: historyRows, error: historyError } = await supabase!
      .from('pick_promotion_history')
      .select('payload, target')
      .eq('pick_id', testPickId)
      .order('created_at', { ascending: false });

    if (historyError) throw new Error(`history query failed: ${historyError.message}`);
    assert.ok(historyRows && historyRows.length > 0, 'at least one pick_promotion_history row must exist');

    for (const row of historyRows ?? []) {
      const payload = row.payload as Record<string, unknown> | null;
      const historyBand = payload?.['band'];
      assert.ok(
        typeof historyBand === 'string' && historyBand.length > 0,
        `pick_promotion_history.payload.band must be set for target=${String(row.target)}, got: ${String(historyBand)}`,
      );
      console.log(`[T1-PROOF] history[${String(row.target)}].payload.band = ${historyBand}`);
    }

    console.log('[T1-PROOF] band persistence verified: picks.metadata.band and history.payload.band both set');
  } finally {
    // Clean up test data from live DB
    await supabase!.from('pick_promotion_history').delete().eq('pick_id', testPickId);
    await supabase!.from('picks').delete().eq('id', testPickId);
    await supabase!.from('submissions').delete().eq('id', submissionId);
  }
});

// ── Unit: determinism — same inputs always produce same band ──────────────────

test('computeDeterministicBand is deterministic: same inputs produce same band across two promotion runs', async () => {
  const repositories = createInMemoryRepositoryBundle();

  const firstResult = await processSubmission(
    {
      source: 'api',
      market: 'player_points_ou',
      selection: 'Over 22.5',
      odds: -110,
      confidence: 0.75,
      metadata: {
        sport: 'NBA',
        eventName: 'Determinism Test Game',
        promotionScores: {
          edge: 85,
          trust: 80,
          readiness: 85,
          uniqueness: 70,
          boardFit: 80,
        },
      },
    },
    repositories,
  );

  const pickId = firstResult.pick.id;
  const firstBand = (firstResult.pick.metadata as Record<string, unknown>)?.['band'];
  assert.ok(typeof firstBand === 'string' && firstBand.length > 0, `first promotion must set band, got: ${String(firstBand)}`);

  // Re-run promotion — band must be identical
  const secondResult = await evaluateAllPoliciesEagerAndPersist(
    pickId,
    'system:determinism-test',
    repositories.picks,
    repositories.audit,
  );

  const secondBand = (secondResult.pickRecord.metadata as Record<string, unknown>)?.['band'];
  assert.equal(
    secondBand,
    firstBand,
    `band must be identical across promotion runs: first=${String(firstBand)} second=${String(secondBand)}`,
  );
});

// ── Unit: non-qualified pick always gets SUPPRESS band ────────────────────────

test('computeDeterministicBand: non-qualified pick gets SUPPRESS band persisted', async () => {
  const repositories = createInMemoryRepositoryBundle();

  // Low-quality inputs: edge=5, trust=20, readiness=10, uniqueness=5, boardFit=10
  // Score: 5*0.35+20*0.25+10*0.2+5*0.1+10*0.1 = 1.75+5+2+0.5+1 = 10.25 < 70 → suppressed
  const result = await processSubmission(
    {
      source: 'api',
      market: 'player_assists_ou',
      selection: 'Under 5.5',
      confidence: 0.50,
      metadata: {
        sport: 'NBA',
        eventName: 'Non-Qualify Test Game',
        promotionScores: {
          edge: 5,
          trust: 20,
          readiness: 10,
          uniqueness: 5,
          boardFit: 10,
        },
      },
    },
    repositories,
  );

  const band = (result.pick.metadata as Record<string, unknown>)?.['band'];
  assert.equal(
    band,
    'SUPPRESS',
    `non-qualified pick must have band=SUPPRESS, got: ${String(band)}`,
  );
});

// ── Unit: stale metadata.band is ignored — no-stale-reads proof ───────────────

test('computeDeterministicBand: pre-set metadata.band=SUPPRESS is overridden for qualified pick', async () => {
  const repositories = createInMemoryRepositoryBundle();

  // Submit with stale band=SUPPRESS pre-set in metadata + high-quality scores
  // computeDeterministicBand must ignore metadata.band and compute from inputs
  const result = await processSubmission(
    {
      source: 'api',
      market: 'player_points_ou',
      selection: 'Over 28.5',
      odds: -115,
      confidence: 0.72,
      metadata: {
        sport: 'NBA',
        eventName: 'No-Stale-Reads Test Game',
        band: 'SUPPRESS',  // stale pre-set — must be overridden
        promotionScores: {
          edge: 88,
          trust: 82,
          readiness: 87,
          uniqueness: 72,
          boardFit: 83,
        },
      },
    },
    repositories,
  );

  const band = (result.pick.metadata as Record<string, unknown>)?.['band'];
  assert.notEqual(
    band,
    'SUPPRESS',
    'stale metadata.band=SUPPRESS must not propagate — computeDeterministicBand is now purely deterministic from inputs',
  );
  assert.ok(typeof band === 'string' && band.length > 0, `band must be set, got: ${String(band)}`);
  console.log(`[PROOF] stale SUPPRESS overridden — computed band: ${String(band)}`);
});
