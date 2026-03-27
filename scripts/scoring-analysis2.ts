import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Correct column names for promotion_history: target, status, score, reason, version
  // Correct settlement result column: result

  // 1. All settlements with result
  const { data: settlements } = await db
    .from('settlement_records')
    .select('id, pick_id, result, source, created_at')
    .order('created_at', { ascending: true });

  const resultCounts: Record<string, number> = {};
  for (const s of settlements ?? []) {
    resultCounts[s.result ?? 'null'] = (resultCounts[s.result ?? 'null'] ?? 0) + 1;
  }
  console.log('=== Settlement Results ===');
  console.log(resultCounts);
  console.log(`Total: ${settlements?.length ?? 0}`);

  // 2. All picks — lifecycle states, promotion scores
  const { data: allPicks } = await db
    .from('picks')
    .select('id, status, market, odds, confidence, promotion_score, promotion_status, promotion_target, metadata, created_at')
    .order('created_at', { ascending: false });
  console.log(`\n=== All Picks (${allPicks?.length ?? 0}) ===`);
  const pickStatusCounts: Record<string, number> = {};
  for (const p of allPicks ?? []) {
    pickStatusCounts[p.status] = (pickStatusCounts[p.status] ?? 0) + 1;
  }
  console.log('Status distribution:', pickStatusCounts);

  const withPromoScore = (allPicks ?? []).filter(p => p.promotion_score !== null);
  console.log(`With promotion_score: ${withPromoScore.length}`);
  if (withPromoScore.length > 0) {
    for (const p of withPromoScore.slice(0, 5)) {
      const meta = p.metadata as Record<string, unknown> | null;
      const scores = meta?.promotionScores as Record<string, number> | null;
      console.log(`  ${p.id.slice(0,8)} promo_score=${p.promotion_score} promo_status=${p.promotion_status} target=${p.promotion_target}`);
      if (scores) console.log(`    edge=${scores.edge} trust=${scores.trust} readiness=${scores.readiness} uniqueness=${scores.uniqueness} boardFit=${scores.boardFit}`);
    }
  }

  // 3. Promotion history with correct column names
  const { data: ph } = await db
    .from('pick_promotion_history')
    .select('id, pick_id, target, status, score, reason, version, decided_at, payload')
    .order('decided_at', { ascending: false })
    .limit(20);
  console.log(`\n=== Promotion History (${ph?.length ?? 0}) ===`);
  const phStatusCounts: Record<string, number> = {};
  const phTargetCounts: Record<string, number> = {};
  for (const row of ph ?? []) {
    phStatusCounts[row.status ?? 'null'] = (phStatusCounts[row.status ?? 'null'] ?? 0) + 1;
    phTargetCounts[row.target ?? 'null'] = (phTargetCounts[row.target ?? 'null'] ?? 0) + 1;
  }
  console.log('Status:', phStatusCounts);
  console.log('Target:', phTargetCounts);

  // Sample rows
  for (const row of (ph ?? []).slice(0, 5)) {
    const payload = row.payload as Record<string,unknown> | null;
    console.log(`  ${row.id?.slice(0,8)} pick=${row.pick_id?.slice(0,8)} target=${row.target} status=${row.status} score=${row.score}`);
    if (payload) console.log(`    payload keys: [${Object.keys(payload).join(', ')}]`);
  }

  // 4. Check audit log for promotion events
  const { data: auditRows } = await db
    .from('audit_log')
    .select('id, event_name, entity_ref, payload, created_at')
    .like('event_name', 'promotion%')
    .order('created_at', { ascending: false })
    .limit(10);
  console.log(`\n=== Promotion Audit Events (${auditRows?.length ?? 0}) ===`);
  const auditEventCounts: Record<string, number> = {};
  for (const row of auditRows ?? []) {
    auditEventCounts[row.event_name] = (auditEventCounts[row.event_name] ?? 0) + 1;
  }
  console.log(auditEventCounts);

  // 5. Join settled picks with their promotion scores from metadata
  console.log('\n=== Settled Picks + Promo Scores from metadata ===');
  const settledPickIds = (settlements ?? []).map(s => s.pick_id).filter(Boolean);
  const { data: settledPicks } = await db
    .from('picks')
    .select('id, market, selection, odds, confidence, promotion_score, metadata')
    .in('id', settledPickIds);
  for (const p of settledPicks ?? []) {
    const s = (settlements ?? []).find(x => x.pick_id === p.id);
    const meta = p.metadata as Record<string, unknown> | null;
    const scores = meta?.promotionScores as Record<string, number> | null;
    const result = s?.result;
    console.log(`  ${p.id.slice(0,8)} result=${result} odds=${p.odds} conf=${p.confidence} promo_score=${p.promotion_score}`);
    if (scores) {
      const composite = scores.edge * 0.2 + scores.trust * 0.2 + scores.readiness * 0.2 + scores.uniqueness * 0.2 + scores.boardFit * 0.2;
      console.log(`    edge=${scores.edge} trust=${scores.trust} readiness=${scores.readiness} uniqueness=${scores.uniqueness} boardFit=${scores.boardFit} → composite≈${composite.toFixed(1)}`);
    }
  }
}

main().catch(e => { console.error(String(e)); process.exit(1); });
