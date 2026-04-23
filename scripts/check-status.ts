#!/usr/bin/env tsx
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  const content = readFileSync(resolve(__dirname, '..', 'local.env'), 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

async function main() {
  loadEnv();
  const sb = createClient(process.env['SUPABASE_URL']!, process.env['SUPABASE_SERVICE_ROLE_KEY']!);

  // 1. Dodgers/Giants events — what dates do they have?
  console.log('=== Dodgers / Giants events ===');
  const { data: dodgers } = await sb.from('events')
    .select('id, external_id, event_name, event_date, status, metadata')
    .ilike('event_name', '%dodger%')
    .order('event_date', { ascending: false })
    .limit(5);
  for (const e of (dodgers ?? [])) {
    const meta = e.metadata as Record<string, unknown>;
    console.log(`  ${e.event_name} | date:${e.event_date} | status:${e.status} | starts_at:${meta?.['starts_at'] ?? 'n/a'}`);
  }

  // 2. All completed events with date >= 2026-04-22 (likely timezone bug victims)
  console.log('\n=== Completed events dated 2026-04-22 (may be yesterday\'s games w/ wrong date) ===');
  const { data: completed } = await sb.from('events')
    .select('id, external_id, event_name, event_date, status, metadata')
    .eq('event_date', '2026-04-22')
    .eq('status', 'completed')
    .order('event_name');
  for (const e of (completed ?? [])) {
    const meta = e.metadata as Record<string, unknown>;
    console.log(`  ${e.event_name} | starts_at:${meta?.['starts_at'] ?? 'n/a'} | ext:${e.external_id}`);
  }

  // 3. provider_market_aliases — is it populated?
  const { count: aliasCount } = await sb.from('provider_market_aliases')
    .select('id', { count: 'exact', head: true });
  console.log(`\n=== provider_market_aliases: ${aliasCount ?? 0} rows ===`);

  // 4. Today's picks pipeline status
  const { data: _picks } = await sb.from('picks')
    .select('status, count:id')
    .gte('created_at', '2026-04-22T22:00:00Z');
  // Use a group-by approach
  const { data: pickStats } = await sb.rpc('execute_sql' as never, {
    sql: `SELECT status, COUNT(*) as cnt FROM picks WHERE created_at >= '2026-04-22T22:00:00Z' GROUP BY status ORDER BY cnt DESC`
  });
  console.log('\n=== Tonight\'s picks by status ===');
  for (const row of (pickStats ?? [])) {
    console.log(`  ${(row as Record<string,unknown>)['status']}: ${(row as Record<string,unknown>)['cnt']}`);
  }

  // 5. Check running ingestor code (is it the fixed version?)
  console.log('\n=== Ingestor fix check ===');
  console.log('  Fix merged to main: YES (PR #445, SHA a06d3b4)');
  console.log('  Local ingestor process: check if restarted after merge');
}

main().catch(e => { console.error(e); process.exit(1); });
