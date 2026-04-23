#!/usr/bin/env tsx
/**
 * UTV2-738 post-merge proof: run the materializer against live Supabase and
 * confirm MLB market_universe.closing_line is non-zero after the fix.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import type { DatabaseConnectionConfig } from '../packages/db/src/client.js';
import {
  DatabaseProviderOfferRepository,
  DatabaseMarketUniverseRepository,
} from '../packages/db/src/runtime-repositories.js';
import { runMarketUniverseMaterializer } from '../apps/api/src/market-universe-materializer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function loadEnv() {
  for (const p of ['local.env', '.env']) {
    try {
      const content = readFileSync(resolve(REPO_ROOT, p), 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
      break;
    } catch { /* skip */ }
  }
}

async function main() {
  loadEnv();

  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');

  const client = createClient(url, key, { auth: { persistSession: false } });
  const connection: DatabaseConnectionConfig = { url, key, role: 'service_role' };

  console.log('\n=== PRE-RUN: market_universe closing_line by sport ===');
  const { data: before, error: e1 } = await client
    .from('market_universe')
    .select('sport_key, closing_line')
    .gte('last_offer_snapshot_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString());
  if (e1) throw new Error(e1.message);

  const beforeStats = summarise(before ?? []);
  console.table(beforeStats);

  console.log('\n=== RUNNING MATERIALIZER (72h lookback, 5000 recent cap) ===');
  const t0 = Date.now();
  const result = await runMarketUniverseMaterializer(
    {
      providerOffers: new DatabaseProviderOfferRepository(connection),
      marketUniverse: new DatabaseMarketUniverseRepository(connection),
    },
    { lookbackHours: 72, maxRows: 5000, logger: console },
  );
  console.log(`Materializer done in ${Date.now() - t0}ms:`, result);

  console.log('\n=== POST-RUN: market_universe closing_line by sport ===');
  const { data: after, error: e2 } = await client
    .from('market_universe')
    .select('sport_key, closing_line')
    .gte('last_offer_snapshot_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString());
  if (e2) throw new Error(e2.message);

  const afterStats = summarise(after ?? []);
  console.table(afterStats);

  console.log('\n=== VERDICT ===');
  const mlbAfter = afterStats.find((r) => r.sport_key === 'MLB');
  if (!mlbAfter) {
    console.error('FAIL: no MLB rows found in market_universe');
    process.exit(1);
  }
  if (mlbAfter.rows_with_closing_line === 0) {
    console.error('FAIL: MLB closing_line still 0 after materializer run');
    process.exit(1);
  }
  console.log(`PASS: MLB has ${mlbAfter.rows_with_closing_line} rows with closing_line non-null/non-zero`);
  console.log('UTV2-738 fix confirmed on live Supabase.');
}

function summarise(rows: Array<{ sport_key: string; closing_line: number | null }>) {
  const map = new Map<string, { total: number; with_closing: number }>();
  for (const r of rows) {
    const k = r.sport_key ?? 'unknown';
    const s = map.get(k) ?? { total: 0, with_closing: 0 };
    s.total++;
    if (r.closing_line !== null && r.closing_line !== 0) s.with_closing++;
    map.set(k, s);
  }
  return Array.from(map.entries())
    .map(([sport_key, s]) => ({
      sport_key,
      total_rows: s.total,
      rows_with_closing_line: s.with_closing,
      pct: s.total ? `${((s.with_closing / s.total) * 100).toFixed(1)}%` : '0%',
    }))
    .sort((a, b) => a.sport_key.localeCompare(b.sport_key));
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
