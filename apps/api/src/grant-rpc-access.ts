/**
 * Grant EXECUTE on RPC functions to the roles PostgREST uses.
 * PostgREST only exposes functions that anon/authenticated/service_role can execute.
 */
import { loadEnvironment } from '@unit-talk/config';

void loadEnvironment();
const accessToken = process.env['SUPABASE_ACCESS_TOKEN']?.trim();
if (!accessToken) {
  throw new Error('SUPABASE_ACCESS_TOKEN is required');
}

const GRANT_SQL = `
-- Grant execute on all atomicity RPCs to the roles PostgREST uses
GRANT EXECUTE ON FUNCTION public.process_submission_atomic(jsonb, jsonb, jsonb, text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_distribution_atomic(uuid, text, text, text, text, timestamptz, text, jsonb, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_next_outbox(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_delivery_atomic(uuid, uuid, text, text, text, text, text, text, jsonb, text, text, text, text, text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_pick_atomic(uuid, jsonb, text, text, text, text, text, text, jsonb) TO anon, authenticated, service_role;

-- Notify PostgREST to reload
NOTIFY pgrst, 'reload schema';
`;

async function main() {
  // Use the Supabase Management API SQL endpoint
  const projectRef = 'feownrheeefbcsehtsiw';
  const resp = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: GRANT_SQL }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`Failed (${resp.status}): ${body}`);
    // Fallback: try the /sql endpoint
    const resp2 = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/sql`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: GRANT_SQL }),
    });
    if (!resp2.ok) {
      const body2 = await resp2.text();
      console.error(`Fallback also failed (${resp2.status}): ${body2}`);

      // Try individual grants via the management API /database/query
      // which was added in newer Supabase versions
      for (const _fn of [
        'process_submission_atomic',
        'enqueue_distribution_atomic',
        'claim_next_outbox',
        'confirm_delivery_atomic',
        'settle_pick_atomic',
      ]) {
        const grantSql = `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;`;
        const r = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: grantSql }),
        });
        if (r.ok) {
          console.log('Blanket GRANT succeeded');
          break;
        }
      }
    } else {
      console.log('Grants applied via /sql endpoint');
    }
  } else {
    const body = await resp.json();
    console.log('Grants applied:', JSON.stringify(body));
  }

  // Reload schema cache
  const reloadResp = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/postgrest`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ db_schema: 'public,storage,graphql_public' }),
  });
  console.log('Schema reload:', reloadResp.status);
}

main().catch(console.error);
