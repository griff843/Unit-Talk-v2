/**
 * Backfill closing lines for completed events that have provider_offers but no is_closing=true rows.
 *
 * For each completed event (has game_results), finds the latest pre-commence offer per
 * (provider_market_key, provider_participant_id) combo and marks it as is_closing=true.
 *
 * Usage: npx tsx apps/api/src/scripts/backfill-closing-lines.ts [--dry-run] [--sport NBA|MLB|NHL]
 */

import {
  createDatabaseClient,
} from '@unit-talk/db';

const supabase = createDatabaseClient({ useServiceRole: true });

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sportIdx = args.indexOf('--sport');
const sportFlag = sportIdx >= 0 ? args[sportIdx + 1] : undefined;
const sportFilter = sportFlag ? [sportFlag] : ['NBA', 'MLB', 'NHL'];

async function main() {
  console.log(`Backfill closing lines — ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Sports: ${sportFilter.join(', ')}\n`);

  let totalEvents = 0;
  let totalMarked = 0;

  for (const sport of sportFilter) {
    console.log(`[${sport}] Finding completed events without closing lines...`);

    // Step 1: Get all provider_event_ids for this sport that have NO closing lines
    const { data: allEventIds, error: e1 } = await supabase
      .from('provider_offers')
      .select('provider_event_id')
      .eq('sport_key', sport)
      .eq('is_closing', false);

    if (e1) { console.error(`  Error: ${e1.message}`); continue; }

    const eventIdsWithOffers = [...new Set((allEventIds ?? []).map((r) => r.provider_event_id))];

    // Get events that already have closing lines — exclude them
    const { data: closingData } = await supabase
      .from('provider_offers')
      .select('provider_event_id')
      .eq('sport_key', sport)
      .eq('is_closing', true);

    const alreadyHasClosing = new Set((closingData ?? []).map((r) => r.provider_event_id));
    const candidateEventIds = eventIdsWithOffers.filter((id) => !alreadyHasClosing.has(id));

    // Step 2: Resolve commence times from events table
    const { data: events, error: e2 } = await supabase
      .from('events')
      .select('id, external_id, event_date, metadata')
      .in('external_id', candidateEventIds.slice(0, 500));

    if (e2) { console.error(`  Error: ${e2.message}`); continue; }

    // Step 3: Filter to events that have game_results (completed)
    const eventIds = (events ?? []).map((e) => e.id);
    const { data: grData } = await supabase
      .from('game_results')
      .select('event_id')
      .in('event_id', eventIds.slice(0, 500));

    const completedEventIds = new Set((grData ?? []).map((r) => r.event_id));

    const completedEvents = (events ?? [])
      .filter((e) => completedEventIds.has(e.id))
      .map((e) => {
        const metadata = (e.metadata ?? {}) as Record<string, unknown>;
        const startsAt = typeof metadata.starts_at === 'string'
          ? metadata.starts_at
          : `${e.event_date}T23:59:59Z`;
        return { event_id: e.id, external_id: e.external_id as string, starts_at: startsAt };
      });

    console.log(`[${sport}] ${completedEvents.length} completed events need closing line backfill`);

    // Step 4: For each event, mark the latest pre-commence offer per combo as closing
    for (const event of completedEvents) {
      const { data: offers, error: e3 } = await supabase
        .from('provider_offers')
        .select('id, provider_market_key, provider_participant_id, bookmaker_key, snapshot_at')
        .eq('provider_event_id', event.external_id)
        .eq('sport_key', sport)
        .lt('snapshot_at', event.starts_at)
        .eq('is_closing', false)
        .order('snapshot_at', { ascending: false });

      if (e3 || !offers || offers.length === 0) continue;

      // Keep latest per (market_key, participant_id, bookmaker_key) combo
      const latestByKey = new Map<string, string>();
      for (const offer of offers) {
        const key = `${offer.provider_market_key}:${offer.provider_participant_id ?? ''}:${offer.bookmaker_key ?? ''}`;
        if (!latestByKey.has(key)) {
          latestByKey.set(key, offer.id);
        }
      }

      const idsToMark = [...latestByKey.values()];
      if (idsToMark.length === 0) continue;

      if (dryRun) {
        console.log(`  ${event.external_id} → ${idsToMark.length} closing lines (would mark)`);
        totalMarked += idsToMark.length;
        continue;
      }

      // Batch update
      let eventMarked = 0;
      for (let i = 0; i < idsToMark.length; i += 200) {
        const chunk = idsToMark.slice(i, i + 200);
        const { error: updateErr } = await supabase
          .from('provider_offers')
          .update({ is_closing: true })
          .in('id', chunk);

        if (updateErr) {
          console.error(`  Error marking: ${updateErr.message}`);
          continue;
        }
        eventMarked += chunk.length;
      }

      console.log(`  ${event.external_id} → ${eventMarked} closing lines marked`);
      totalMarked += eventMarked;
    }
    totalEvents += completedEvents.length;
  }

  console.log(`\nDone. ${totalEvents} events, ${totalMarked} closing lines ${dryRun ? 'would be' : ''} marked.`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
