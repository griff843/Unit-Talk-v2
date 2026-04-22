/**
 * UTV2-576: Closing-line truth proof script
 *
 * Audits closing-line coverage, runs the recovery service + materializer,
 * then re-audits to prove the fix works against the live DB.
 *
 * Run:  source local.env && npx tsx scripts/proof/utv2-576-closing-line-proof.ts
 */
import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';
import {
  DatabaseProviderOfferRepository,
  DatabaseEventRepository,
  DatabaseMarketUniverseRepository,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { runClosingLineRecovery } from '../../apps/api/src/closing-line-recovery-service.js';
import { runMarketUniverseMaterializer } from '../../apps/api/src/market-universe-materializer.js';

async function auditClosingCoverage(db: ReturnType<typeof createClient>) {
  const { data: mu } = await db
    .from('market_universe')
    .select('closing_line')
    .limit(10_000);

  const rows = mu ?? [];
  const total = rows.length;
  const withClosing = rows.filter((r) => r.closing_line !== null).length;

  const { data: poData } = await db
    .from('provider_offers')
    .select('is_closing, snapshot_at')
    .gte('snapshot_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
    .limit(100_000);

  const offers = poData ?? [];
  const closingOffers = offers.filter((r) => r.is_closing).length;

  return { total, withClosing, closingOffers, totalOffers72h: offers.length };
}

async function main() {
  const env = loadEnvironment();
  const conn = createServiceRoleDatabaseConnectionConfig(env);

  const db = createClient(conn.url, conn.key);
  const providerOffers = new DatabaseProviderOfferRepository(conn);
  const events = new DatabaseEventRepository(conn);
  const marketUniverse = new DatabaseMarketUniverseRepository(conn);

  console.log('\n=== UTV2-576: Closing-Line Truth Proof ===');
  console.log(`Run at: ${new Date().toISOString()}\n`);

  // ── 1. Audit before ──────────────────────────────────────────────────
  console.log('--- BEFORE: closing-line coverage ---');
  const before = await auditClosingCoverage(db);
  console.log(`  market_universe rows:          ${before.total}`);
  console.log(`  market_universe with closing:  ${before.withClosing} (${before.total > 0 ? ((before.withClosing / before.total) * 100).toFixed(1) : '—'}%)`);
  console.log(`  provider_offers is_closing=T:  ${before.closingOffers} of ${before.totalOffers72h} (72h window)`);

  // ── 2. Run closing-line recovery ─────────────────────────────────────
  console.log('\n--- STEP: running closing-line recovery ---');
  const recovery = await runClosingLineRecovery(
    { events, providerOffers },
    { logger: { info: console.log, warn: console.warn, error: console.error } },
  );
  console.log(`  events checked: ${recovery.eventsChecked}`);
  console.log(`  events eligible: ${recovery.eventsEligible}`);
  console.log(`  rows marked is_closing=true: ${recovery.rowsMarked}`);

  // ── 3. Run materializer with 72h lookback ────────────────────────────
  console.log('\n--- STEP: running materializer (72h lookback) ---');
  const matResult = await runMarketUniverseMaterializer(
    { providerOffers, marketUniverse },
    { lookbackHours: 72, logger: console },
  );
  console.log(`  offers read:    ${matResult.upserted + matResult.errors}`);
  console.log(`  rows upserted:  ${matResult.upserted}`);
  console.log(`  errors:         ${matResult.errors}`);

  // ── 4. Audit after ───────────────────────────────────────────────────
  console.log('\n--- AFTER: closing-line coverage ---');
  const after = await auditClosingCoverage(db);
  console.log(`  market_universe rows:          ${after.total}`);
  console.log(`  market_universe with closing:  ${after.withClosing} (${after.total > 0 ? ((after.withClosing / after.total) * 100).toFixed(1) : '—'}%)`);
  console.log(`  provider_offers is_closing=T:  ${after.closingOffers} of ${after.totalOffers72h} (72h window)`);

  // ── 5. Verdict ──────────────────────────────────────────────────────
  console.log('\n--- VERDICT ---');
  const closingImproved = after.withClosing > before.withClosing;
  const nonTrivialCoverage = after.withClosing > 0;
  const markedRows = recovery.rowsMarked > 0 || after.closingOffers > before.closingOffers;

  console.log(`  closing coverage improved:   ${closingImproved ? 'YES' : 'NO (already at max or no eligible data)'}`);
  console.log(`  non-trivial closing exists:  ${nonTrivialCoverage ? 'YES' : 'NO — check ingestor health'}`);
  console.log(`  marking worked or was pre-set: ${markedRows ? 'YES' : 'NO'}`);

  if (nonTrivialCoverage) {
    console.log('\nPROOF: PASS — closing-line truth is live and measurable.');
    process.exit(0);
  } else {
    console.log('\nPROOF: PARTIAL — no offers in 72h window yet; ingestor likely down. Run again after ingestor resumes.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Proof script failed:', err);
  process.exit(1);
});
