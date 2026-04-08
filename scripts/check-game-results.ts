import { createClient } from '@supabase/supabase-js';

async function main() {
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await client
    .from('game_results')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) { console.error(error); process.exit(1); }
  console.log(JSON.stringify(data, null, 2));
}
main();
