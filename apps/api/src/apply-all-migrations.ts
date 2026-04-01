import { readFileSync } from 'node:fs';
import { loadEnvironment } from '@unit-talk/config';

// Load env files before reading local.env directly for the access token.
void loadEnvironment();

// Read access token directly from process.env (loaded by local.env via dotenv or shell)
const localEnvContent = readFileSync('local.env', 'utf-8');
const accessTokenMatch = localEnvContent.match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m);
const accessToken = accessTokenMatch?.[1]?.trim();
if (!accessToken) throw new Error('SUPABASE_ACCESS_TOKEN not found in local.env');
const projectRef = 'feownrheeefbcsehtsiw';

const migrations = [
  'supabase/migrations/202604010001_submission_atomicity_rpc.sql',
  'supabase/migrations/202604010002_enqueue_atomicity_rpc.sql',
  'supabase/migrations/202604010003_delivery_idempotency_rpc.sql',
  'supabase/migrations/202604010004_settlement_atomicity_rpc.sql',
];

async function executeSql(sql: string, label: string) {
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
  );

  const body = await resp.text();
  if (!resp.ok) {
    console.error(`✗ ${label}: ${resp.status} — ${body}`);
    return false;
  }
  console.log(`✓ ${label}`);
  return true;
}

async function main() {
  console.log('Applying RPC migrations to live Supabase...\n');

  for (const path of migrations) {
    const sql = readFileSync(path, 'utf-8');
    const ok = await executeSql(sql, path.split('/').pop()!);
    if (!ok) {
      console.error('\nMigration failed — stopping.');
      process.exitCode = 1;
      return;
    }
  }

  // Grant execute to PostgREST roles
  const grantSql = `
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
    NOTIFY pgrst, 'reload schema';
  `;
  await executeSql(grantSql, 'GRANT + NOTIFY pgrst reload');

  // Reload schema cache via Management API
  const reloadResp = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/postgrest`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ db_schema: 'public,storage,graphql_public' }),
    },
  );
  console.log(`\nSchema cache reload: ${reloadResp.status}`);

  // Verify functions exist
  console.log('\nVerifying functions in pg_proc...');
  const verifyResp = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `SELECT proname FROM pg_proc WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public') AND (proname LIKE '%atomic%' OR proname LIKE 'claim_next%' OR proname LIKE 'confirm_delivery%' OR proname LIKE 'settle_pick%' OR proname LIKE 'process_submission%' OR proname LIKE 'enqueue_distribution%') ORDER BY proname`,
      }),
    },
  );
  const funcs = await verifyResp.json();
  console.log('Functions found:', JSON.stringify(funcs));
}

main().catch(console.error);
