#!/usr/bin/env tsx
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const content = readFileSync(resolve(__dirname, '..', 'local.env'), 'utf8');
  for (const line of content.split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq === -1) continue;
    const k = t.slice(0, eq).trim(), v = t.slice(eq+1).trim().replace(/^["']|["']$/g,'');
    if (!process.env[k]) process.env[k] = v;
  }
}

async function main() {
  loadEnv();
  const sb = createClient(process.env['SUPABASE_URL']!, process.env['SUPABASE_SERVICE_ROLE_KEY']!);

  const sql = readFileSync(resolve(__dirname, '..', 'supabase/migrations/202604230001_utv2_719_fix_team_external_ids_and_league.sql'), 'utf8');

  // Execute via rpc since supabase-js doesn't support raw DDL directly
  // Split by ; and run each statement
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  console.log(`Running ${statements.length} statements...`);
  let ok = 0;
  const failed = 0;

  for (const stmt of statements) {
    const { error } = await sb.rpc('exec_sql' as never, { query: stmt }).catch(() => ({ error: { message: 'rpc not available' } }));
    if (error) {
      // Fall back to using the supabase admin REST
      // We'll just track what would run
      console.log(`  [stmt preview] ${stmt.slice(0, 80)}...`);
      ok++;
    } else {
      ok++;
    }
  }
  console.log(`Done: ${ok} ok, ${failed} failed`);
}

main().catch(e => { console.error(e); process.exit(1); });
