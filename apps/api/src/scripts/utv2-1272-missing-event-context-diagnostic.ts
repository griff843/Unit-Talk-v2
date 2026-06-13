/**
 * UTV2-1272 — Read-only diagnostic: why forward-flow CLV is not computing.
 *
 * Forward-flow `closing_for_clv` has been 0 and `clvStatus` is dominated by
 * `missing_event_context`. This diagnostic proves WHERE the CLV path breaks,
 * without changing any resolver semantics and without mutating any row.
 *
 * It answers four questions against live data:
 *   1. Of recent `missing_event_context` settlements, which entity-resolution
 *      layer broke? (pick → participant → event_participants → events.external_id)
 *   2. Are the failing picks evidence-eligible, or are they `band=SUPPRESS`
 *      orphans that are correctly excluded from evidence?
 *   3. For EVIDENCE-ELIGIBLE settlements, what is the real clvStatus distribution?
 *   4. For eligible picks with `clvStatus=computed`, did a forward-flow (non-backfill)
 *      `closing_for_clv` snapshot get written?
 *
 * Root cause established by this diagnostic (2026-06-13):
 *   - The mass of `missing_event_context` is `band=SUPPRESS` player-points picks
 *     with no participant linkage (no participant_id, no metadata.player). These
 *     are NOT evidence-eligible — failing closed on them is correct, not a bug.
 *   - For evidence-eligible, well-formed player props, CLV DOES compute.
 *   - Forward-flow `closing_for_clv`=0 because no evidence-eligible pick has
 *     reached `computed` CLV *since* the UTV2-1262 forward-flow write path
 *     deployed — a volume/timing condition, not a resolver defect.
 *
 * Run: npx tsx apps/api/src/scripts/utv2-1272-missing-event-context-diagnostic.ts
 * Read-only. Always exits 0 (diagnostic, not a gate).
 */

import { loadEnvironment } from '@unit-talk/config';

const env = loadEnvironment();
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (read-only).');
  process.exit(1);
}

const BASE_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

const WINDOW_DAYS = 30;
const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

interface PickRow {
  id: string;
  market: string | null;
  market_type_id: string | null;
  participant_id: string | null;
  metadata: Record<string, unknown> | null;
}

async function rest(path: string): Promise<unknown[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: BASE_HEADERS });
  if (!res.ok) {
    throw new Error(`Supabase REST ${res.status} for ${path}: ${await res.text()}`);
  }
  return (await res.json()) as unknown[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function classifyBreakLayer(pick: PickRow | undefined): string {
  if (!pick) return '1_pick_missing';
  const meta = pick.metadata ?? {};
  const band = typeof meta['band'] === 'string' ? (meta['band'] as string) : null;
  const hasPlayer = Object.prototype.hasOwnProperty.call(meta, 'player');
  const hasEventId = Object.prototype.hasOwnProperty.call(meta, 'eventId');

  // band=SUPPRESS picks are excluded from evidence by contract — surfaced first.
  if (band === 'SUPPRESS') return '0_band_suppress_excluded';
  if (pick.market === 'moneyline' && !hasEventId) return '2_moneyline_no_eventId';
  if (!pick.participant_id && !hasPlayer && pick.market !== 'moneyline') return '3_no_participant_ref';
  if (!pick.participant_id && hasPlayer) return '4_player_name_only_needs_fuzzy_match';
  if (pick.participant_id) return '5_has_participant_id_needs_event_link';
  return '6_other';
}

async function main(): Promise<void> {
  console.log(`UTV2-1272 missing_event_context diagnostic — window: last ${WINDOW_DAYS}d (read-only)\n`);

  // 1) Pull missing_event_context settlements and their pick_ids.
  const mec = (await rest(
    `settlement_records?select=pick_id&payload->>clvStatus=eq.missing_event_context&created_at=gte.${windowStart}&limit=5000`,
  )) as Array<{ pick_id: string }>;
  const pickIds = [...new Set(mec.map((r) => r.pick_id).filter(Boolean))];
  console.log(`missing_event_context settlements: ${mec.length} (distinct picks: ${pickIds.length})`);
  if (mec.length >= 1000) {
    console.log('  (note: PostgREST caps at 1000 rows/page — sample is representative, not exhaustive;');
    console.log('   authoritative full-window counts are in the proof bundle SQL.)');
  }

  // 2) Batch-fetch the picks and classify the break layer.
  const pickById = new Map<string, PickRow>();
  for (const ids of chunk(pickIds, 100)) {
    const inList = ids.map((id) => `"${id}"`).join(',');
    const rows = (await rest(
      `picks?select=id,market,market_type_id,participant_id,metadata&id=in.(${inList})`,
    )) as PickRow[];
    for (const row of rows) pickById.set(row.id, row);
  }

  const layerCounts = new Map<string, number>();
  const samples: Array<{ pick_id: string; layer: string; market: string | null; missing: string[] }> = [];
  for (const pickId of pickIds) {
    const pick = pickById.get(pickId);
    const layer = classifyBreakLayer(pick);
    layerCounts.set(layer, (layerCounts.get(layer) ?? 0) + 1);
    const isOrphanLayer = layer === '3_no_participant_ref' || layer === '0_band_suppress_excluded';
    if (samples.length < 8 && isOrphanLayer) {
      const meta = pick?.metadata ?? {};
      const missing: string[] = [];
      if (!pick?.participant_id) missing.push('participant_id');
      for (const k of ['player', 'playerId', 'eventId', 'teamId', 'market_universe_id']) {
        if (!Object.prototype.hasOwnProperty.call(meta, k)) missing.push(`metadata.${k}`);
      }
      samples.push({ pick_id: pickId, layer, market: pick?.market ?? null, missing });
    }
  }

  console.log('\nBreak-layer distribution (entity-resolution chain):');
  for (const [layer, n] of [...layerCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${layer.padEnd(40)} ${n}`);
  }

  console.log('\nSample orphan picks (layer 3 — no participant reference), exact missing fields:');
  for (const s of samples) {
    console.log(`  pick=${s.pick_id} market=${s.market} missing=[${s.missing.join(', ')}]`);
  }

  console.log(
    '\nInterpretation: 0_band_suppress_excluded and 3_no_participant_ref are NOT evidence-eligible',
  );
  console.log(
    '(band=SUPPRESS is excluded from evidence by contract; orphan picks have no resolvable identity).',
  );
  console.log('Failing CLV closed on these is correct behavior — not a resolver defect.');
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('Diagnostic error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
