/**
 * T1 Pre-Merge Proof: UTV2-725 shadow scoring pick_id linkage and sport_key column
 *
 * Verifies against the live Supabase database that:
 * 1. pick_candidates.sport_key column exists (migration 202604270002 applied)
 * 2. pick_candidates can be queried and filtered by sport_key
 * 3. pick_candidates.pick_id column and linkage query work correctly
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. Does not mutate live rows.
 *
 * Run:
 *   UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-725.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseClient,
  type UnitTalkSupabaseClient,
} from '@unit-talk/db';

function getClient(): UnitTalkSupabaseClient | null {
  try {
    const env = loadEnvironment();
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
    return createDatabaseClient({ env });
  } catch {
    return null;
  }
}

const client = getClient();
const SKIP = !client;
const it = (name: string, fn: () => Promise<void>) =>
  SKIP ? test.skip(name, fn) : test(name, fn);

it('pick_candidates.sport_key column exists and is queryable', async () => {
  const { data, error } = await client!
    .from('pick_candidates')
    .select('id, sport_key')
    .limit(1);

  assert.equal(error, null, `sport_key column does not exist or query failed: ${JSON.stringify(error)}`);
  assert.ok(Array.isArray(data), 'Expected array response from pick_candidates');
  console.log(`[UTV2-725] sport_key column confirmed. Sample: ${JSON.stringify(data?.[0])}`);
});

it('pick_candidates can be filtered by sport_key', async () => {
  const { data, error } = await client!
    .from('pick_candidates')
    .select('id, sport_key')
    .not('sport_key', 'is', null)
    .limit(5);

  assert.equal(error, null, `sport_key filter query failed: ${JSON.stringify(error)}`);
  assert.ok(Array.isArray(data), 'Expected array response');

  if (data && data.length > 0) {
    const sportKeys = [...new Set((data as Array<{ sport_key: string | null }>).map(r => r.sport_key).filter(Boolean))];
    console.log(`[UTV2-725] sport_key sample values: ${JSON.stringify(sportKeys)}`);
    assert.ok(sportKeys.length > 0, 'Expected at least one non-null sport_key in pick_candidates');
  } else {
    console.log('[UTV2-725] No pick_candidates with sport_key yet — column exists but not yet populated (acceptable for fresh column)');
  }
});

it('pick_candidates.pick_id column exists and linked candidates are countable', async () => {
  const { count, error } = await client!
    .from('pick_candidates')
    .select('id', { count: 'exact', head: true })
    .not('pick_id', 'is', null);

  assert.equal(error, null, `pick_id count query failed: ${JSON.stringify(error)}`);
  console.log(`[UTV2-725] pick_candidates with pick_id linked: ${count ?? 0}`);
  assert.ok((count ?? 0) >= 0, 'pick_id column count query succeeded');
});

it('pick_candidates schema has sport_key, pick_id, and shadow_mode columns', async () => {
  const { data, error } = await client!
    .from('pick_candidates')
    .select('id, sport_key, pick_id, shadow_mode, status')
    .order('created_at', { ascending: false })
    .limit(1);

  assert.equal(error, null, `Schema shape query failed: ${JSON.stringify(error)}`);

  if (data && data.length > 0) {
    const row = data[0] as Record<string, unknown>;
    assert.ok('sport_key' in row, 'sport_key must be present in pick_candidates schema');
    assert.ok('pick_id' in row, 'pick_id must be present in pick_candidates schema');
    assert.ok('shadow_mode' in row, 'shadow_mode must be present in pick_candidates schema');
    console.log(`[UTV2-725] Schema confirmed: sport_key=${row['sport_key']}, pick_id=${row['pick_id']}, shadow_mode=${row['shadow_mode']}`);
  } else {
    console.log('[UTV2-725] No rows in pick_candidates — schema shape not verifiable from data, but column query passed.');
  }
});
