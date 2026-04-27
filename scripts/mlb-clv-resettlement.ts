/**
 * UTV2-752 / UNI-49 Gate 3: MLB CLV Re-settlement
 * Re-computes CLV for MLB settlement_records with clvUnavailableReason='missing_closing_line'
 * and patches their payload with the computed values.
 *
 * Run: tsx scripts/mlb-clv-resettlement.ts
 */
import { createClient, type SupabaseClient } from '../packages/db/node_modules/@supabase/supabase-js/dist/index.mjs';
import { loadEnvironment } from '@unit-talk/config';

type Side = 'over' | 'under';

type SrRow = { id: string; pick_id: string; payload: Record<string, unknown> };
type PickRow = {
  id: string; market: string | null; market_type_id: string | null;
  odds: number | null; selection: string | null; sport_id: string | null;
  participant_id: string | null; metadata: unknown; created_at: string;
};
type EventRow = { id: string; external_id: string | null; event_date: string | null; metadata: unknown };
type EpRow = { event_id: string };

const PARTICIPANT_FORBIDDEN = new Set(['game_total_ou', '1h_total_ou', '2h_total_ou']);

function americanToImplied(odds: number): number {
  if (!Number.isFinite(odds)) return NaN;
  return odds > 0 ? 100 / (odds + 100) : (-odds) / (-odds + 100);
}

function inferSide(selection: string): Side | null {
  const s = selection.toLowerCase();
  if (/\bover\b/.test(s) || /\bO\s+\d/.test(selection)) return 'over';
  if (/\bunder\b/.test(s) || /\bU\s+\d/.test(selection)) return 'under';
  return null;
}

function round(n: number, dp: number) {
  const m = 10 ** dp;
  return Math.round(n * m) / m;
}

interface ClosingData {
  line: number | null;
  over_odds: number;
  under_odds: number;
}

async function findClosingLine(
  db: SupabaseClient,
  providerEventId: string,
  resolvedKey: string,
  providerParticipantId: string | null,
): Promise<ClosingData | null> {
  // Try provider_offers first (is_closing=true)
  let poQuery = db
    .from('provider_offers')
    .select('line, over_odds, under_odds')
    .eq('provider_key', 'sgo')
    .eq('provider_event_id', providerEventId)
    .eq('provider_market_key', resolvedKey)
    .eq('is_closing', true)
    .not('over_odds', 'is', null)
    .not('under_odds', 'is', null)
    .order('snapshot_at', { ascending: false })
    .limit(1);

  if (providerParticipantId) {
    poQuery = poQuery.eq('provider_participant_id', providerParticipantId);
  } else {
    poQuery = poQuery.is('provider_participant_id', null);
  }

  const { data: poRows } = await poQuery;
  if (poRows?.length) {
    return { line: poRows[0].line, over_odds: poRows[0].over_odds, under_odds: poRows[0].under_odds };
  }

  // Fallback: market_universe closing snapshot
  let muQuery = db
    .from('market_universe')
    .select('closing_line, closing_over_odds, closing_under_odds')
    .eq('provider_key', 'sgo')
    .eq('provider_event_id', providerEventId)
    .eq('provider_market_key', resolvedKey)
    .not('closing_line', 'is', null)
    .not('closing_over_odds', 'is', null)
    .not('closing_under_odds', 'is', null)
    .limit(1);

  if (providerParticipantId) {
    muQuery = muQuery.eq('provider_participant_id', providerParticipantId);
  } else {
    muQuery = muQuery.is('provider_participant_id', null);
  }

  const { data: muRows } = await muQuery;
  if (muRows?.length) {
    return {
      line: muRows[0].closing_line,
      over_odds: muRows[0].closing_over_odds,
      under_odds: muRows[0].closing_under_odds,
    };
  }

  return null;
}

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Fetch all MLB settlement records with missing CLV, including pick data
  const { data: srRows, error: fetchErr } = await db
    .from('settlement_records')
    .select('id, pick_id, payload')
    .limit(500);

  if (fetchErr) { console.error('Fetch settlements error:', fetchErr.message); process.exit(1); }

  // Filter to MLB picks with missing CLV
  const pickIds = (srRows ?? [])
    .filter((r: SrRow) => r.payload?.clvUnavailableReason === 'missing_closing_line')
    .map((r: SrRow) => r.pick_id);

  if (!pickIds.length) { console.log('No affected records found.'); process.exit(0); }

  const { data: picks, error: pickErr } = await db
    .from('picks')
    .select('id, market, market_type_id, odds, selection, sport_id, participant_id, metadata, created_at')
    .in('id', pickIds)
    .eq('sport_id', 'MLB');

  if (pickErr) { console.error('Fetch picks error:', pickErr.message); process.exit(1); }

  const pickMap = new Map((picks ?? []).map((p: PickRow) => [p.id, p]));
  const affected = (srRows ?? []).filter((r: SrRow) =>
    r.payload?.clvUnavailableReason === 'missing_closing_line' && pickMap.has(r.pick_id),
  );

  console.log(`\n[resettlement] Processing ${affected.length} MLB settlement records\n`);

  let computed = 0, stillFailed = 0;
  const failReasons: Record<string, number> = {};

  // Pre-load alias table for SGO MLB
  const { data: aliases } = await db
    .from('provider_market_aliases')
    .select('market_type_id, provider_market_key, sport_id')
    .eq('provider', 'sgo');

  const aliasMap = new Map<string, string>();
  for (const a of aliases ?? []) {
    // sport-specific takes precedence
    const key = `${a.market_type_id}:${a.sport_id ?? ''}`;
    if (!aliasMap.has(key)) aliasMap.set(key, a.provider_market_key);
  }

  function resolveProviderKey(canonicalKey: string, sportId: string): string {
    return aliasMap.get(`${canonicalKey}:${sportId}`)
      ?? aliasMap.get(`${canonicalKey}:`)
      ?? canonicalKey;
  }

  for (const srRow of affected) {
    const pick = pickMap.get(srRow.pick_id);
    if (!pick) continue;

    const canonicalKey = pick.market_type_id ?? pick.market;
    const isForbidden = PARTICIPANT_FORBIDDEN.has(canonicalKey);

    // Infer selection side
    const side = inferSide(pick.selection ?? '');
    if (!side) {
      failReasons['missing_selection_side'] = (failReasons['missing_selection_side'] ?? 0) + 1;
      stillFailed++;
      continue;
    }

    // Resolve event context
    let providerEventId: string | null = null;
    let participantExternalId: string | null = null;

    // Try metadata.eventId path (team/game picks)
    const meta = typeof pick.metadata === 'object' && pick.metadata ? pick.metadata as Record<string, unknown> : {};
    if (meta.eventId) {
      const { data: evt } = await db
        .from('events')
        .select('external_id, event_date, metadata')
        .eq('id', meta.eventId)
        .single();
      if (evt?.external_id) {
        providerEventId = evt.external_id;
      }
    }

    // Try participant_id path
    if (!providerEventId && pick.participant_id) {
      const { data: part } = await db
        .from('participants')
        .select('external_id')
        .eq('id', pick.participant_id)
        .single();
      participantExternalId = part?.external_id ?? null;

      const { data: epRows } = await db
        .from('event_participants')
        .select('event_id')
        .eq('participant_id', pick.participant_id)
        .limit(10);

      if (epRows?.length) {
        const eventIds = epRows.map((ep: EpRow) => ep.event_id);
        const { data: events } = await db
          .from('events')
          .select('id, external_id, event_date, metadata')
          .in('id', eventIds)
          .not('external_id', 'is', null);

        if (events?.length) {
          // Pick closest to pick.created_at
          const pickTs = new Date(pick.created_at).getTime();
          const sorted = events.sort((a: EventRow, b: EventRow) => {
            const aMeta = typeof a.metadata === 'object' && a.metadata ? a.metadata as Record<string, unknown> : {};
            const bMeta = typeof b.metadata === 'object' && b.metadata ? b.metadata as Record<string, unknown> : {};
            const aTs = new Date(aMeta.starts_at ?? `${a.event_date}T23:59:59Z`).getTime();
            const bTs = new Date(bMeta.starts_at ?? `${b.event_date}T23:59:59Z`).getTime();
            return Math.abs(aTs - pickTs) - Math.abs(bTs - pickTs);
          });
          providerEventId = sorted[0]?.external_id ?? null;
        }
      }
    }

    if (!providerEventId) {
      failReasons['missing_event_context'] = (failReasons['missing_event_context'] ?? 0) + 1;
      stillFailed++;
      continue;
    }

    // Resolve provider market key
    const resolvedKey = resolveProviderKey(canonicalKey, pick.sport_id);
    const providerParticipantId = (isForbidden || !participantExternalId) ? null : participantExternalId;

    // Find closing line
    const closingData = await findClosingLine(db, providerEventId, resolvedKey, providerParticipantId);
    if (!closingData) {
      failReasons['missing_closing_line'] = (failReasons['missing_closing_line'] ?? 0) + 1;
      stillFailed++;
      continue;
    }

    // Compute CLV
    const pickImplied = americanToImplied(Number(pick.odds));
    const overImplied = americanToImplied(Number(closingData.over_odds));
    const underImplied = americanToImplied(Number(closingData.under_odds));

    if (!Number.isFinite(pickImplied) || !Number.isFinite(overImplied) || !Number.isFinite(underImplied)) {
      failReasons['devig_failed'] = (failReasons['devig_failed'] ?? 0) + 1;
      stillFailed++;
      continue;
    }

    const sum = overImplied + underImplied;
    const overFair = overImplied / sum;
    const underFair = underImplied / sum;
    const closingFair = side === 'over' ? overFair : underFair;
    const closingOddsRaw = side === 'over' ? closingData.over_odds : closingData.under_odds;

    const clvRaw = round(pickImplied - closingFair, 6);
    const clvPercent = round(clvRaw * 100, 4);

    // Patch settlement_records.payload — read + merge + write
    const existingPayload = (srRow.payload as Record<string, unknown>) ?? {};
    const newPayload: Record<string, unknown> = {
      ...existingPayload,
      clvPercent,
      clvRaw,
      closingOdds: closingOddsRaw,
      closingLine: closingData.line,
      beatsClosingLine: clvRaw > 0,
      providerKey: 'sgo',
    };
    delete newPayload['clvUnavailableReason'];

    const { error: updateErr } = await db
      .from('settlement_records')
      .update({ payload: newPayload })
      .eq('id', srRow.id);

    if (updateErr) {
      console.warn(`  [FAIL] sr=${srRow.id.slice(0,8)}: ${updateErr.message}`);
      failReasons['update_failed'] = (failReasons['update_failed'] ?? 0) + 1;
      stillFailed++;
      continue;
    }

    computed++;
    console.log(`  [OK]   sr=${srRow.id.slice(0,8)} pick=${pick.id.slice(0,8)} market=${canonicalKey} side=${side} clvPercent=${clvPercent.toFixed(4)}`);
  }

  console.log('\n====================================');
  console.log('        Re-settlement Summary');
  console.log('====================================');
  console.log(`Total processed:      ${affected.length}`);
  console.log(`Successfully computed:${computed}`);
  console.log(`Still failed:         ${stillFailed}`);
  if (Object.keys(failReasons).length) {
    console.log('Failure reasons:');
    for (const [reason, count] of Object.entries(failReasons)) {
      console.log(`  ${reason}: ${count}`);
    }
  }

  // Final coverage check
  const { data: finalRows } = await db
    .from('settlement_records')
    .select('payload, picks!inner(sport_id)')
    .eq('picks.sport_id', 'MLB')
    .limit(500);

  if (finalRows) {
    let withClv = 0, withoutClv = 0;
    for (const row of finalRows) {
      const p = row.payload as Record<string, unknown>;
      if (p?.clvPercent != null) withClv++;
      else withoutClv++;
    }
    const total = withClv + withoutClv;
    const pct = total > 0 ? ((withClv / total) * 100).toFixed(1) : '0.0';
    console.log('\n====================================');
    console.log('  Final MLB CLV Coverage');
    console.log('====================================');
    console.log(`With CLV:    ${withClv} / ${total} (${pct}%)`);
    console.log(`Without CLV: ${withoutClv} / ${total}`);
    console.log(`Target ≥70%: ${parseFloat(pct) >= 70 ? '✅ PASS' : '❌ BELOW TARGET (need re-settlement after PR #495 merge for game_total_ou picks)'}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
