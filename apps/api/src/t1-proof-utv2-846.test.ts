/**
 * T1 Pre-Merge Proof: UTV2-846 board-scan candidate materialization
 *
 * Exercises the board-scan runtime path against live Supabase repositories.
 * This proves the DatabasePickCandidateRepository payload boundary and the
 * board-scan schema-cache fallback can materialize pick_candidates rows when
 * PostgREST schema cache truth diverges from intended DB schema.
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. This intentionally leaves candidate rows
 * in place, tagged by scan_run_id, because T1 proof should be auditable.
 *
 * Run:
 *   UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-846.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseClient,
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type UnitTalkSupabaseClient,
} from '@unit-talk/db';
import { runBoardScan } from './board-scan-service.js';

function getLiveContext():
  | {
      client: UnitTalkSupabaseClient;
      repositories: ReturnType<typeof createDatabaseRepositoryBundle>;
    }
  | null {
  try {
    const env = loadEnvironment();
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
    return {
      client: createDatabaseClient({ env, useServiceRole: true }),
      repositories: createDatabaseRepositoryBundle(createServiceRoleDatabaseConnectionConfig(env)),
    };
  } catch {
    return null;
  }
}

const live = getLiveContext();
const skipReason = live
  ? false
  : 'SUPABASE_SERVICE_ROLE_KEY not configured; skipping live DB proof';

test('UTV2-846 board scan writes fresh pick_candidates through live repositories', { skip: skipReason }, async () => {
  const messages: string[] = [];
  const result = await runBoardScan(
    {
      marketUniverse: live!.repositories.marketUniverse,
      pickCandidates: live!.repositories.pickCandidates,
      events: live!.repositories.events,
    },
    {
      enabled: true,
      maxRows: 25,
      logger: {
        info(message: string) {
          messages.push(message);
        },
        warn(message: string) {
          messages.push(message);
        },
        error(message: string) {
          messages.push(message);
        },
      },
    },
  );

  assert.ok(result.scanned > 0, 'live market_universe must provide rows for board scan proof');
  assert.equal(
    result.qualified + result.rejected,
    result.scanned,
    'board scan must preserve qualified and rejected counts',
  );

  const { count, error } = await live!.client
    .from('pick_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('scan_run_id', result.scanRunId);

  console.log(`[UTV2-846] board-scan messages: ${JSON.stringify(messages)}`);

  assert.equal(error, null, `pick_candidates scan_run_id count failed: ${JSON.stringify(error)}`);
  assert.equal(
    count,
    result.scanned,
    `expected ${result.scanned} candidates tagged with scan_run_id=${result.scanRunId}; messages=${JSON.stringify(messages)}`,
  );

  const sawFallback = messages.some((message) =>
    message.includes('"event":"schema_cache_drift_fallback"'),
  );
  console.log(
    `[UTV2-846] board-scan proof scanRunId=${result.scanRunId} scanned=${result.scanned} qualified=${result.qualified} rejected=${result.rejected} schemaCacheFallback=${sawFallback}`,
  );
});
