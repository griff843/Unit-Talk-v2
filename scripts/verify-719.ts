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

  const { data: stats } = await sb.from('participants')
    .select('external_id, league, participant_type')
    .eq('participant_type', 'team')
    .limit(500);

  const total = stats?.length ?? 0;
  const nullLeague = stats?.filter(r => !r.league).length ?? 0;
  const oldFormat = stats?.filter(r => r.external_id?.startsWith('team:')).length ?? 0;
  const newFormat = stats?.filter(r => !r.external_id?.startsWith('team:') && r.external_id?.includes('_')).length ?? 0;

  console.log('=== Team participants post-migration ===');
  console.log(`total: ${total} | null league: ${nullLeague} | old format: ${oldFormat} | new format: ${newFormat}`);

  // Player→team join
  const { data: players } = await sb.from('participants')
    .select('display_name, metadata, sport')
    .eq('participant_type', 'player')
    .not('metadata->team_external_id', 'is', null)
    .limit(200);

  let joinHits = 0, joinMisses = 0;
  const missedIds = new Set<string>();
  for (const p of (players ?? [])) {
    const teamExtId = (p.metadata as Record<string,unknown>)?.['team_external_id'] as string;
    if (!teamExtId) continue;
    const hit = stats?.find(t => t.external_id === teamExtId);
    if (hit) joinHits++;
    else { joinMisses++; missedIds.add(teamExtId); }
  }
  console.log(`\nPlayer→team join: ${joinHits} resolve ✓, ${joinMisses} still broken ✗`);
  if (missedIds.size > 0) {
    console.log('Unresolved team_external_ids:');
    for (const id of [...missedIds].slice(0, 10)) console.log(`  ${id}`);
  }

  // Event→team join (spot check)
  const { data: events } = await sb.from('events').select('event_name, metadata').limit(50);
  let evtHits = 0, evtMisses = 0;
  for (const e of (events ?? [])) {
    const meta = (e.metadata as Record<string,unknown>) ?? {};
    const home = meta['home_team_external_id'] as string;
    const away = meta['away_team_external_id'] as string;
    if (home) { if (stats?.find(t => t.external_id === home)) evtHits++; else evtMisses++; }
    if (away) { if (stats?.find(t => t.external_id === away)) evtHits++; else evtMisses++; }
  }
  console.log(`\nEvent→team join (50 events): ${evtHits} ✓, ${evtMisses} ✗`);

  // Sample new format
  console.log('\n=== Sample teams (new format) ===');
  for (const t of (stats ?? []).filter(r => r.external_id?.includes('_')).slice(0, 5)) {
    console.log(`  ${t.external_id} [league=${t.league}]`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
