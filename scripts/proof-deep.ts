/**
 * Deep probe: new settlement pick details + event completion status
 */
import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // 1. The new settlement created after API restart
  const { data: newS } = await db
    .from('settlement_records')
    .select('id, pick_id, result, source, payload, created_at')
    .eq('source', 'grading')
    .gte('created_at', '2026-04-18T19:22:00Z')
    .order('created_at', { ascending: false });

  console.log('\n=== New Settlements (post-restart) ===');
  for (const s of newS ?? []) {
    const { data: pick } = await db.from('picks').select('id, status, market, selection, participant_id, metadata').eq('id', s.pick_id).single();
    const payload = asRecord(s.payload);
    const gradCtx = asRecord(payload.gradingContext);
    console.log(`pick=${s.pick_id.slice(0,8)}`);
    console.log(`  selection: "${pick?.selection}"`);
    console.log(`  market:    ${pick?.market}`);
    console.log(`  result:    ${s.result}`);
    console.log(`  clvRaw:    ${payload.clvRaw ?? null}`);
    console.log(`  skipReason: ${payload.clvSkipReason ?? '(none)'}`);
    console.log(`  gradingEventId: ${gradCtx.eventId ?? null}`);
    // Verify event used
    if (gradCtx.eventId) {
      const { data: ev } = await db.from('events').select('id, event_name, metadata').eq('id', gradCtx.eventId as string).single();
      const evMeta = asRecord(ev?.metadata);
      console.log(`  event: "${ev?.event_name}" starts=${evMeta.starts_at}`);
    }
    const meta = asRecord(pick?.metadata);
    console.log(`  pick.meta.eventStartTime: ${meta.eventStartTime ?? meta.eventTime ?? '(none)'}`);
  }

  // 2. Event completion status for picked games
  const pickEventNames = [
    { id: 'bb113f9a', name: 'Cincinnati Reds vs. Minnesota Twins' },
    { id: '93402562', name: 'Los Angeles Dodgers vs. Colorado Rockies' },
    { id: 'ba6db799', name: 'Toronto Raptors vs. Cleveland Cavaliers' },
    { id: '60d78792', name: 'Toronto Raptors vs. Cleveland Cavaliers' },
  ];

  console.log('\n=== Event Completion Status for Posted Picks ===');
  for (const pe of pickEventNames) {
    const { data: pick } = await db.from('picks').select('id, status, market, selection, participant_id, metadata').eq('id', pe.id).single();
    const _meta = asRecord(pick?.metadata);
    // Find event by participant linkage
    if (pick?.participant_id) {
      const { data: links } = await db.from('event_participants').select('event_id').eq('participant_id', pick.participant_id);
      console.log(`\nPick ${pe.id.slice(0,8)} "${pick.selection}"`);
      console.log(`  participant_id: ${pick.participant_id?.slice(0,8)}`);
      console.log(`  linked events: ${links?.length ?? 0}`);
      for (const link of links ?? []) {
        const { data: ev } = await db.from('events').select('id, event_name, status, metadata').eq('id', link.event_id).single();
        const evMeta = asRecord(ev?.metadata);
        console.log(`    event=${ev?.id.slice(0,8)} "${ev?.event_name}" status=${ev?.status} starts=${evMeta.starts_at}`);
      }
    }
  }

  // 3. Check if CLV fix is active — test inferSelectionSide via import
  console.log('\n=== CLV Fix Active? ===');
  console.log('Checking via settlement skip reason on new settlement...');
  console.log('If skipReason = "Selection doesn\'t contain \'over\' or \'under\'" → OLD code');
  console.log('If skipReason = anything else (or clvRaw present) → NEW code');
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
