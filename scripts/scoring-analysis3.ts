import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Full promotion history with payload
  const { data: ph } = await db
    .from('pick_promotion_history')
    .select('id, pick_id, target, status, score, reason, version, payload')
    .order('score', { ascending: false });

  console.log('=== Promotion History — Score Distribution ===\n');
  const qualified = (ph ?? []).filter(r => r.status === 'qualified');
  const notEligible = (ph ?? []).filter(r => r.status === 'not_eligible');
  console.log(`Qualified: ${qualified.length}`);
  console.log(`Not eligible: ${notEligible.length}`);

  console.log('\n--- All rows by score (desc) ---');
  for (const row of ph ?? []) {
    const p = row.payload as Record<string,unknown> | null;
    const explanation = p?.explanation as string | null;
    const boardState = p?.boardState as Record<string,unknown> | null;
    const scoreInputs = p?.scoreInputs as Record<string,unknown> | null;
    console.log(`  ${row.score?.toFixed(1).padStart(5)} ${row.target?.padEnd(16)} ${row.status?.padEnd(14)} pick=${row.pick_id?.slice(0,8)}`);
    if (explanation) console.log(`    reason: ${explanation}`);
    if (boardState) console.log(`    boardState: ${JSON.stringify(boardState)}`);
    if (scoreInputs?.confidence !== undefined) console.log(`    confidence: ${scoreInputs.confidence}`);
  }

  // All picks: score vs promotion status
  const { data: allPicks } = await db
    .from('picks')
    .select('id, promotion_score, promotion_status, promotion_target, status, confidence, metadata, odds, created_at')
    .not('promotion_score', 'is', null)
    .order('promotion_score', { ascending: false });

  console.log(`\n=== All Picks with promotion_score (${allPicks?.length ?? 0}) ===`);
  
  // Score histogram
  const buckets: Record<string, number> = { '<65': 0, '65-70': 0, '70-75': 0, '75-80': 0, '80-85': 0, '85-90': 0, '90-95': 0, '95+': 0 };
  for (const p of allPicks ?? []) {
    const score = Number(p.promotion_score);
    if (score < 65) buckets['<65']++;
    else if (score < 70) buckets['65-70']++;
    else if (score < 75) buckets['70-75']++;
    else if (score < 80) buckets['75-80']++;
    else if (score < 85) buckets['80-85']++;
    else if (score < 90) buckets['85-90']++;
    else if (score < 95) buckets['90-95']++;
    else buckets['95+']++;
  }
  console.log('\nScore histogram:');
  for (const [bucket, count] of Object.entries(buckets)) {
    console.log(`  ${bucket.padEnd(8)}: ${'█'.repeat(count)} (${count})`);
  }

  // Promotion status distribution
  const statusCounts: Record<string, number> = {};
  const targetCounts: Record<string, number> = {};
  for (const p of allPicks ?? []) {
    statusCounts[p.promotion_status ?? 'null'] = (statusCounts[p.promotion_status ?? 'null'] ?? 0) + 1;
    targetCounts[p.promotion_target ?? 'none'] = (targetCounts[p.promotion_target ?? 'none'] ?? 0) + 1;
  }
  console.log('\nPromotion status:', statusCounts);
  console.log('Promotion target:', targetCounts);

  // Check picks above threshold that are not qualified
  const aboveThreshold = (allPicks ?? []).filter(p => Number(p.promotion_score) >= 70 && p.promotion_status !== 'qualified');
  console.log(`\nPicks scoring ≥70 but NOT qualified: ${aboveThreshold.length}`);
  for (const p of aboveThreshold.slice(0, 8)) {
    console.log(`  ${p.id.slice(0,8)} score=${p.promotion_score} status=${p.promotion_status} target=${p.promotion_target} pickStatus=${p.status}`);
  }

  // Confidence analysis
  const withConf = (allPicks ?? []).filter(p => p.confidence !== null);
  const withoutConf = (allPicks ?? []).filter(p => p.confidence === null);
  const avgScoreWithConf = withConf.length ? withConf.reduce((s, p) => s + Number(p.promotion_score), 0) / withConf.length : 0;
  const avgScoreWithoutConf = withoutConf.length ? withoutConf.reduce((s, p) => s + Number(p.promotion_score), 0) / withoutConf.length : 0;
  console.log(`\n=== Confidence Field Impact (UTV2-49 fix) ===`);
  console.log(`Picks WITH confidence (n=${withConf.length}): avg score = ${avgScoreWithConf.toFixed(1)}`);
  console.log(`Picks WITHOUT confidence (n=${withoutConf.length}): avg score = ${avgScoreWithoutConf.toFixed(1)}`);
}

main().catch(e => { console.error(String(e)); process.exit(1); });
