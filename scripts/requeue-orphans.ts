import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { requeuePickController } from '../apps/api/src/controllers/requeue-controller.js';

const ORPHAN_PREFIXES = ['d77a35b3', '3b5d9e84', '306deff8', 'd00954ec', '4701f767', '3ec17a5e'];

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Step 1: resolve full UUIDs and confirm still orphaned
  const { data: picks, error } = await db
    .from('picks')
    .select('id, promotion_status, promotion_target, status')
    .in('promotion_status', ['qualified'])
    .not('promotion_target', 'is', null);

  if (error) { console.error('DB error:', error.message); process.exit(1); }

  const candidates = (picks ?? []).filter(p =>
    ORPHAN_PREFIXES.some(prefix => p.id.startsWith(prefix))
  );

  console.log(`Found ${candidates.length} of ${ORPHAN_PREFIXES.length} orphaned picks in DB:\n`);
  for (const p of candidates) {
    console.log(`  ${p.id.slice(0,8)} status=${p.status} promo=${p.promotion_status} target=${p.promotion_target}`);
  }

  // Step 2: confirm no outbox row for each
  const pickIds = candidates.map(p => p.id);
  const { data: outboxRows } = await db
    .from('distribution_outbox')
    .select('pick_id, status, target')
    .in('pick_id', pickIds)
    .in('status', ['pending', 'processing', 'sent']);

  const alreadyQueued = new Set((outboxRows ?? []).map(r => r.pick_id));
  const toRequeue = candidates.filter(p => !alreadyQueued.has(p.id));

  console.log(`\n${toRequeue.length} still need requeueing (${alreadyQueued.size} already have outbox rows):\n`);

  if (toRequeue.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // Step 3: requeue each via controller
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  const repositories = createDatabaseRepositoryBundle(connection);

  for (const pick of toRequeue) {
    try {
      const result = await requeuePickController(pick.id, repositories);
      console.log(`${pick.id.slice(0,8)} → status=${result.status} body=${JSON.stringify(result.body)}`);
    } catch (err) {
      console.error(`${pick.id.slice(0,8)} → THREW: ${String(err)}`);
      if (err instanceof Error) console.error(err.stack);
    }
  }
}

main().catch(e => { console.error(String(e)); process.exit(1); });
