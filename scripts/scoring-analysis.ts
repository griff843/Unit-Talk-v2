import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // 1. Get all graded settlements with pick data
  const { data: settlements, error } = await db
    .from('settlement_records')
    .select('id, pick_id, payload, created_at')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  console.log(`Total settlement records: ${settlements?.length ?? 0}`);

  // 2. Get picks with promotion scores
  const pickIds = (settlements ?? []).map(s => s.pick_id).filter(Boolean);
  const { data: picks } = await db
    .from('picks')
    .select('id, market, selection, odds, confidence, metadata, promotion_score, promotion_status, promotion_target, status')
    .in('id', pickIds);
  console.log(`Picks found: ${picks?.length ?? 0}`);

  // 3. Get promotion history for these picks
  const { data: promoHistory } = await db
    .from('pick_promotion_history')
    .select('pick_id, promotion_target, decision, composite_score, score_breakdown, policy_version')
    .in('pick_id', pickIds);
  console.log(`Promotion history rows: ${promoHistory?.length ?? 0}`);

  // 4. Build analysis dataset
  const pickMap = new Map((picks ?? []).map(p => [p.id, p]));
  const promoMap = new Map<string, typeof promoHistory>(); 
  for (const ph of promoHistory ?? []) {
    const existing = promoMap.get(ph.pick_id) ?? [];
    existing.push(ph);
    promoMap.set(ph.pick_id, existing);
  }

  const dataset: Array<{
    settlementId: string;
    pickId: string;
    result: string | null;
    compositeScore: number | null;
    scoreBreakdown: Record<string, number> | null;
    odds: number | null;
    confidence: number | null;
    promotionDecision: string | null;
    clvRaw: number | null;
    beatsClosingLine: boolean | null;
  }> = [];

  for (const s of settlements ?? []) {
    const pick = pickMap.get(s.pick_id);
    const promos = promoMap.get(s.pick_id) ?? [];
    const payload = s.payload as Record<string, unknown> | null;
    
    // Find best-bets promo history entry
    const bbPromo = promos.find(p => p.promotion_target === 'best-bets');
    const tiPromo = promos.find(p => p.promotion_target === 'trader-insights');
    const promo = tiPromo ?? bbPromo;

    const result = (payload?.result as string) ?? null;
    const clvRaw = typeof payload?.clvRaw === 'number' ? payload.clvRaw : null;
    const beatsClosingLine = typeof payload?.beatsClosingLine === 'boolean' ? payload.beatsClosingLine : null;

    dataset.push({
      settlementId: s.id,
      pickId: s.pick_id,
      result,
      compositeScore: promo ? Number(promo.composite_score) : null,
      scoreBreakdown: promo?.score_breakdown as Record<string, number> | null,
      odds: pick ? Number(pick.odds) : null,
      confidence: pick ? Number(pick.confidence) : null,
      promotionDecision: promo?.decision ?? null,
      clvRaw,
      beatsClosingLine,
    });
  }

  console.log('\n=== Dataset Summary ===');
  console.log(`Total records: ${dataset.length}`);
  const withResult = dataset.filter(d => d.result !== null);
  const withScore = dataset.filter(d => d.compositeScore !== null);
  const withClv = dataset.filter(d => d.clvRaw !== null);
  console.log(`With result: ${withResult.length}`);
  console.log(`With composite score: ${withScore.length}`);
  console.log(`With CLV: ${withClv.length}`);

  // Result breakdown
  const resultCounts: Record<string, number> = {};
  for (const d of withResult) {
    resultCounts[d.result!] = (resultCounts[d.result!] ?? 0) + 1;
  }
  console.log('\nResult distribution:', resultCounts);

  // Score distribution for winners vs losers
  const winners = withResult.filter(d => d.result === 'win' && d.compositeScore !== null);
  const losers = withResult.filter(d => d.result === 'loss' && d.compositeScore !== null);
  
  console.log('\n=== Score vs Outcome ===');
  if (winners.length > 0) {
    const avgWinScore = winners.reduce((s, d) => s + d.compositeScore!, 0) / winners.length;
    console.log(`Winners (n=${winners.length}) avg composite score: ${avgWinScore.toFixed(2)}`);
  } else {
    console.log('Winners with scores: 0');
  }
  if (losers.length > 0) {
    const avgLossScore = losers.reduce((s, d) => s + d.compositeScore!, 0) / losers.length;
    console.log(`Losers (n=${losers.length}) avg composite score: ${avgLossScore.toFixed(2)}`);
  } else {
    console.log('Losers with scores: 0');
  }

  // Full dataset dump for inspection
  console.log('\n=== All Records ===');
  for (const d of dataset) {
    console.log(`  ${d.settlementId.slice(0,8)} result=${d.result ?? 'null'} score=${d.compositeScore ?? 'null'} odds=${d.odds} clvRaw=${d.clvRaw ?? 'null'} promo=${d.promotionDecision ?? 'none'}`);
    if (d.scoreBreakdown) {
      const sb = d.scoreBreakdown;
      console.log(`    breakdown: edge=${sb.edge} trust=${sb.trust} readiness=${sb.readiness} uniqueness=${sb.uniqueness} boardFit=${sb.boardFit}`);
    }
  }
}

main().catch(e => { console.error(String(e)); process.exit(1); });
