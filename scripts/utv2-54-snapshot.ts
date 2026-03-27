import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';
import { createSnapshotFromRows } from '../apps/operator-web/src/server.js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const [runsRes, outboxRes, receiptsRes, settlementsRes, picksRes, auditRes] = await Promise.all([
    db.from('system_runs').select('*').order('started_at', { ascending: false }).limit(20),
    db.from('distribution_outbox').select('*').order('created_at', { ascending: false }).limit(20),
    db.from('distribution_receipts').select('*').order('recorded_at', { ascending: false }).limit(5),
    db.from('settlement_records').select('*').order('settled_at', { ascending: false }).limit(10),
    db.from('picks').select('*').order('created_at', { ascending: false }).limit(10),
    db.from('audit_log').select('*').order('created_at', { ascending: false }).limit(10),
  ]);

  const snapshot = createSnapshotFromRows({
    persistenceMode: 'database',
    recentRuns: runsRes.data ?? [],
    recentOutbox: outboxRes.data ?? [],
    recentReceipts: receiptsRes.data ?? [],
    recentSettlements: settlementsRes.data ?? [],
    recentPicks: picksRes.data ?? [],
    recentAudit: auditRes.data ?? [],
  });

  console.log('AC-1 ingestorHealth:', JSON.stringify(snapshot.ingestorHealth, null, 2));
  console.log('status field present:', 'status' in snapshot.ingestorHealth);
  console.log('lastRunAt field present:', 'lastRunAt' in snapshot.ingestorHealth);
  console.log('runCount field present:', 'runCount' in snapshot.ingestorHealth);
}

main().catch(e => { console.error(String(e)); process.exit(1); });
