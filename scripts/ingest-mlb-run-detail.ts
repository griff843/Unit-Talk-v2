import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Get the most recent successful MLB ingest run details
  const { data: mlbRuns } = await db.from('system_runs')
    .select('id, status, details, created_at, completed_at')
    .eq('run_type', 'ingestor.cycle')
    .eq('status', 'succeeded')
    .order('created_at', { ascending: false })
    .limit(20);

  const mlbFiltered = (mlbRuns ?? []).filter(r => {
    const d = (r.details ?? {}) as Record<string, unknown>;
    return d.league === 'MLB';
  });
  console.log(`Recent successful MLB runs: ${mlbFiltered.length}`);
  for (const r of mlbFiltered.slice(0, 5)) {
    const d = (r.details ?? {}) as Record<string, unknown>;
    console.log(`\n  run=${r.id.slice(0,8)} created=${r.created_at?.slice(0,19)}`);
    console.log(`  events=${d.eventsCount} resultsEvents=${d.resultsEventsCount} insertedResults=${d.insertedResultsCount}`);
    console.log(`  snapshotAt=${d.snapshotAt}`);
  }

  // What events did the most recent MLB run mark as completed?
  // Find events that were updated around the MLB run time
  const recentMLBRun = mlbFiltered[0];
  if (recentMLBRun) {
    const runTime = recentMLBRun.created_at;
    const _d = (recentMLBRun.details ?? {}) as Record<string, unknown>;
    const runId = recentMLBRun.id;
    console.log(`\n=== Events with ingestionCycleRunId = ${runId.slice(0,8)} ===`);
    const { data: runEvents } = await db.from('events')
      .select('id, event_name, status, metadata, updated_at')
      .filter('metadata->>ingestionCycleRunId', 'eq', runId)
      .order('updated_at', { ascending: false });
    console.log(`Events tagged with this run: ${runEvents?.length ?? 0}`);
    for (const e of (runEvents ?? []).slice(0, 5)) {
      console.log(`  ${e.id.slice(0,8)} "${e.event_name}" status=${e.status} updated=${e.updated_at?.slice(11,19)}`);
    }

    // Events updated around the run time
    const oneHourBefore = new Date(new Date(runTime).getTime() - 3600000).toISOString();
    const oneHourAfter = new Date(new Date(runTime).getTime() + 3600000).toISOString();
    const { data: timeEvents } = await db.from('events')
      .select('id, event_name, status, metadata, updated_at')
      .eq('status', 'completed')
      .gte('updated_at', oneHourBefore)
      .lte('updated_at', oneHourAfter)
      .ilike('event_name', '% vs. %')
      .order('updated_at', { ascending: false })
      .limit(15);
    console.log(`\nCompleted events near run time (±1h): ${timeEvents?.length ?? 0}`);
    for (const e of timeEvents ?? []) {
      const m = (e.metadata ?? {}) as Record<string, unknown>;
      const cycleId = m.ingestionCycleRunId ? String(m.ingestionCycleRunId).slice(0,8) : 'null';
      console.log(`  ${e.id.slice(0,8)} "${e.event_name}" runId=${cycleId} updated=${e.updated_at?.slice(11,19)}`);
    }
  }

  // Check the Dodgers-Rockies event (673d1ff7) status history via pick_lifecycle events
  // And look at MLB completed events from April 18
  const { data: mlbCompleted } = await db.from('events')
    .select('id, event_name, status, external_id, metadata, event_date, updated_at')
    .eq('status', 'completed')
    .gte('event_date', '2026-04-17')
    .lte('event_date', '2026-04-18')
    .ilike('event_name', '% vs. %')
    .order('updated_at', { ascending: false })
    .limit(20);
  console.log(`\nCompleted MLB/any events on Apr 17-18: ${mlbCompleted?.length ?? 0}`);
  for (const e of mlbCompleted ?? []) {
    const m = (e.metadata ?? {}) as Record<string, unknown>;
    const hasProviderKey = !!m.providerKey;
    console.log(`  ${e.id.slice(0,8)} "${e.event_name}" hasProviderKey=${hasProviderKey} updated=${e.updated_at?.slice(11,19)}`);
  }
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
