import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // 1. Full pick lifecycle — where are picks stuck?
  const { data: picks } = await db
    .from('picks')
    .select('id, status, market, selection, odds, source, promotion_status, promotion_target, promotion_score, created_at, posted_at, settled_at')
    .order('created_at', { ascending: false });

  const statusCounts: Record<string, number> = {};
  for (const p of picks ?? []) statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;
  console.log('=== Pick Lifecycle State ===');
  console.log(statusCounts);

  // 2. What are the validated picks — why haven't they advanced?
  const validated = (picks ?? []).filter(p => p.status === 'validated');
  console.log(`\n=== Validated picks (${validated.length}) — not yet posted ===`);
  for (const p of validated) {
    console.log(`  ${p.id.slice(0,8)} score=${p.promotion_score?.toFixed(1)} promoStatus=${p.promotion_status} target=${p.promotion_target ?? 'none'} source=${p.source} created=${p.created_at?.slice(0,10)}`);
  }

  // 3. Posted picks — what's on the board right now?
  const posted = (picks ?? []).filter(p => p.status === 'posted');
  console.log(`\n=== Posted picks (${posted.length}) — current board ===`);
  for (const p of posted) {
    console.log(`  ${p.id.slice(0,8)} market="${p.market}" sel="${p.selection}" odds=${p.odds} target=${p.promotion_target ?? 'none'} posted=${p.posted_at?.slice(0,16)}`);
  }

  // 4. Distribution outbox — what's queued/claimed/failed?
  const { data: outbox } = await db
    .from('distribution_outbox')
    .select('id, pick_id, target, status, claimed_at, created_at')
    .order('created_at', { ascending: false })
    .limit(20);
  const outboxCounts: Record<string, number> = {};
  for (const o of outbox ?? []) outboxCounts[o.status] = (outboxCounts[o.status] ?? 0) + 1;
  console.log(`\n=== Distribution Outbox (${outbox?.length ?? 0} recent) ===`);
  console.log('Status:', outboxCounts);
  for (const o of (outbox ?? []).slice(0, 8)) {
    console.log(`  ${o.id.slice(0,8)} pick=${o.pick_id?.slice(0,8)} target=${o.target} status=${o.status} created=${o.created_at?.slice(0,16)}`);
  }

  // 5. Check promotion policy — what does boardFit actually gate on?
  // Look at best-bets qualified picks' boardState to understand the cap
  const { data: ph } = await db
    .from('pick_promotion_history')
    .select('pick_id, target, status, score, payload')
    .eq('status', 'qualified')
    .order('score', { ascending: false });
  console.log(`\n=== Qualified Promotion History (${ph?.length ?? 0}) ===`);
  for (const row of ph ?? []) {
    const p = row.payload as Record<string,unknown> | null;
    const bs = p?.boardState as Record<string,unknown> | null;
    console.log(`  ${row.pick_id?.slice(0,8)} target=${row.target} score=${row.score} boardCount=${bs?.currentBoardCount}`);
  }

  // 6. Check if validated+qualified picks are in outbox
  const qualifiedPickIds = new Set((ph ?? []).map(r => r.pick_id));
  const validatedQualified = validated.filter(p => qualifiedPickIds.has(p.id));
  console.log(`\n=== Validated picks that ARE qualified (${validatedQualified.length}) ===`);
  for (const p of validatedQualified) {
    const inOutbox = (outbox ?? []).find(o => o.pick_id === p.id);
    console.log(`  ${p.id.slice(0,8)} score=${p.promotion_score} target=${p.promotion_target} in_outbox=${!!inOutbox}`);
  }
}

main().catch(e => { console.error(String(e)); process.exit(1); });
