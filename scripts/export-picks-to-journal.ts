/**
 * STEP-3: Live Pick Export — Production Event Stream into R1–R5 Verification Lab
 *
 * Reads settled production picks from Supabase (READ-ONLY) and reconstructs
 * their lifecycle event streams as JournalEventStore-compatible JSONL.
 *
 * Output artifacts:
 *   out/live-exports/{exportRunId}/picks-export.jsonl
 *   out/live-exports/{exportRunId}/export-manifest.json
 *   out/live-exports/{exportRunId}/skip-report.json
 *
 * Safety rules:
 *   - No Supabase writes of any kind
 *   - No PII: participant_id, submission_id, player_id excluded
 *   - No CLV extraction
 *   - All output goes to out/ (gitignored)
 *   - Credentials never written to any file
 *
 * Env vars required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Run:
 *   npx tsx scripts/export-picks-to-journal.ts [--days 90] [--limit 250] [--sport-id <id>] [--out out/live-exports]
 *   (or with local.env: node --env-file=local.env --import tsx/esm scripts/export-picks-to-journal.ts)
 *
 * Authority: SIMULATION_MODE_CONTRACT.md (docs/05_operations/)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '../packages/db/node_modules/@supabase/supabase-js/dist/index.mjs';

// ─────────────────────────────────────────────────────────────
// REPO ROOT
// ─────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

// ─────────────────────────────────────────────────────────────
// ENV LOADER (reads local.env if SUPABASE_URL not in environment)
// ─────────────────────────────────────────────────────────────

function loadLocalEnv(): void {
  if (process.env['SUPABASE_URL']) return; // already set
  const envPath = join(REPO_ROOT, 'local.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// CLI ARGS
// ─────────────────────────────────────────────────────────────

interface CliArgs {
  days: number;
  limit: number;
  sportId: string | null;
  out: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let days = 90;
  let limit = 250;
  let sportId: string | null = null;
  let out = join(REPO_ROOT, 'out', 'live-exports');

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--days' && args[i + 1]) days = parseInt(args[++i]!, 10);
    else if (a === '--limit' && args[i + 1]) limit = parseInt(args[++i]!, 10);
    else if (a === '--sport-id' && args[i + 1]) sportId = args[++i]!;
    else if (a === '--out' && args[i + 1]) out = resolve(args[++i]!);
  }

  return { days, limit, sportId, out };
}

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

interface PickRow {
  id: string;
  status: string;
  market: string;
  selection: string;
  line: number | null;
  odds: number | null;
  confidence: number | null;
  source: string;
  metadata: Record<string, unknown> | null;
  promotion_status: string | null;
  promotion_score: number | null;
  promotion_version: string | null;
  promotion_decided_at: string | null;
  posted_at: string | null;
  created_at: string;
  sport_id: string | null;
}

interface SettlementRow {
  pick_id: string;
  result: string | null;
  source: string;
  confidence: string;
  status: string;
  settled_at: string;
}

interface PromotionRow {
  pick_id: string;
  target: string;
  status: string;
  score: number | null;
  version: string;
  decided_at: string;
}

interface LifecycleRow {
  pick_id: string;
  to_state: string;
  created_at: string;
}

interface ExportEvent {
  eventId: string;
  eventType: 'PICK_SUBMITTED' | 'PICK_GRADED' | 'PICK_POSTED' | 'PICK_SETTLED';
  pickId: string;
  timestamp: string;
  sequenceNumber: number;
  payload: Record<string, unknown>;
  producedAt: string;
}

interface SkipRecord {
  pickId: string;
  reason: string;
}

// ─────────────────────────────────────────────────────────────
// BATCH QUERY HELPER
// ─────────────────────────────────────────────────────────────

async function queryInBatches<T>(
  supabase: SupabaseClient,
  table: string,
  select: string,
  pickIds: string[],
  extraFilter?: (query: ReturnType<SupabaseClient['from']>) => ReturnType<SupabaseClient['from']>
): Promise<T[]> {
  const BATCH = 100;
  const results: T[] = [];
  for (let i = 0; i < pickIds.length; i += BATCH) {
    const batch = pickIds.slice(i, i + BATCH);
    let query = supabase.from(table).select(select).in('pick_id', batch);
    if (extraFilter) query = extraFilter(query) as typeof query;
    const { data, error } = await query;
    if (error) {
      process.stderr.write(`[export] batch query ${table} error: ${error.message}\n`);
    } else if (data) {
      results.push(...(data as T[]));
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────
// EVENT RECONSTRUCTION PER PICK
// ─────────────────────────────────────────────────────────────

interface ReconstructResult {
  events: Array<Omit<ExportEvent, 'sequenceNumber'>>;
  fallbacks: number;
  skipReason: string | null;
}

function reconstructPickEvents(
  pick: PickRow,
  settlement: SettlementRow | undefined,
  promotions: PromotionRow[],
  postedAt: string | null,
  exportedAt: string
): ReconstructResult {
  let fallbacks = 0;

  // ── eligibility ──────────────────────────────────────────────
  if (!settlement) {
    return { events: [], fallbacks: 0, skipReason: 'no confirmed settlement record' };
  }
  if (!settlement.result) {
    return { events: [], fallbacks: 0, skipReason: 'settlement result is null (manual_review)' };
  }

  const T0 = pick.created_at;                              // PICK_SUBMITTED
  const T1 = pick.promotion_decided_at ?? null;            // PICK_GRADED (primary)
  const T2post = postedAt ?? pick.posted_at ?? null;       // PICK_POSTED (from lifecycle or picks.posted_at)
  const T3 = settlement.settled_at;                        // PICK_SETTLED

  // Build timestamp for PICK_GRADED
  let tGraded: string;
  if (T1 && new Date(T1) > new Date(T0)) {
    tGraded = T1;
  } else {
    // Fallback: T0 + 60s
    tGraded = new Date(new Date(T0).getTime() + 60_000).toISOString();
    fallbacks++;
  }

  // Build timestamp for PICK_POSTED
  let tPosted: string;
  if (T2post && new Date(T2post) > new Date(tGraded)) {
    tPosted = T2post;
  } else {
    // Fallback: settlement time - 1 hour (ensures ordering: graded < posted < settled)
    const settledMs = new Date(T3).getTime();
    const candidateMs = Math.max(
      new Date(tGraded).getTime() + 60_000,
      settledMs - 60 * 60_000
    );
    tPosted = new Date(candidateMs).toISOString();
    fallbacks++;
  }

  // Clock inversion guard: all four timestamps must be non-decreasing
  const times = [T0, tGraded, tPosted, T3].map(t => new Date(t).getTime());
  for (let i = 1; i < times.length; i++) {
    if (times[i]! < times[i - 1]!) {
      return {
        events: [],
        fallbacks,
        skipReason: `clock inversion at step ${i} (${[T0, tGraded, tPosted, T3][i - 1]} > ${[T0, tGraded, tPosted, T3][i]})`,
      };
    }
  }

  const events: Array<Omit<ExportEvent, 'sequenceNumber'>> = [];
  const p = pick.id;

  // ── PICK_SUBMITTED ───────────────────────────────────────────
  events.push({
    eventId: `export-${p}-submitted`,
    eventType: 'PICK_SUBMITTED',
    pickId: p,
    timestamp: T0,
    producedAt: exportedAt,
    payload: {
      pick: {
        id: p,
        status: 'draft',
        market: pick.market,
        selection: pick.selection,
        line: pick.line ?? null,
        odds: pick.odds ?? null,
        confidence: pick.confidence ?? null,
        source: pick.source,
        sport: pick.sport_id ?? null,
        posted_to_discord: false,
        created_at: T0,
        placed_at: T0,
        meta: {
          ...(pick.metadata ?? {}),
          // Ensure meta.confidence is set for kelly staking sizing
          ...(pick.confidence !== null && pick.confidence !== undefined
            ? { confidence: pick.confidence }
            : {}),
        },
      },
    },
  });

  // ── PICK_GRADED (one per promotion history row, or synthetic if none) ───────
  const sortedPromos = [...promotions].sort(
    (a, b) => new Date(a.decided_at).getTime() - new Date(b.decided_at).getTime()
  );

  if (sortedPromos.length > 0) {
    for (let i = 0; i < sortedPromos.length; i++) {
      const promo = sortedPromos[i]!;
      // Use decided_at if it's after T0; otherwise advance from T0
      const tg =
        new Date(promo.decided_at) > new Date(T0)
          ? promo.decided_at
          : new Date(new Date(T0).getTime() + 60_000 * (i + 1)).toISOString();
      events.push({
        eventId: `export-${p}-graded-${i}`,
        eventType: 'PICK_GRADED',
        pickId: p,
        timestamp: tg,
        producedAt: exportedAt,
        payload: {
          gradingData: {
            promotion_status: promo.status,
            promotion_score: promo.score,
            promotion_version: promo.version,
            promotion_target: promo.target,
            promotion_decided_at: promo.decided_at,
          },
        },
      });
    }
  } else {
    // Synthetic PICK_GRADED from picks table fields
    events.push({
      eventId: `export-${p}-graded-0`,
      eventType: 'PICK_GRADED',
      pickId: p,
      timestamp: tGraded,
      producedAt: exportedAt,
      payload: {
        gradingData: {
          promotion_status: pick.promotion_status ?? 'promoted',
          promotion_score: pick.promotion_score,
          promotion_version: pick.promotion_version,
          promotion_decided_at: pick.promotion_decided_at,
        },
      },
    });
    if (!pick.promotion_decided_at) fallbacks++;
  }

  // ── PICK_POSTED ──────────────────────────────────────────────
  events.push({
    eventId: `export-${p}-posted`,
    eventType: 'PICK_POSTED',
    pickId: p,
    timestamp: tPosted,
    producedAt: exportedAt,
    payload: {
      posting: {
        channel: 'best-bets',
      },
    },
  });

  // ── PICK_SETTLED ─────────────────────────────────────────────
  events.push({
    eventId: `export-${p}-settled`,
    eventType: 'PICK_SETTLED',
    pickId: p,
    timestamp: T3,
    producedAt: exportedAt,
    payload: {
      result: settlement.result as 'win' | 'loss' | 'push' | 'void',
      source: settlement.source,
      confidence: settlement.confidence,
    },
  });

  return { events, fallbacks, skipReason: null };
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadLocalEnv();
  const args = parseArgs();
  const exportedAt = new Date().toISOString();
  const exportRunId = `live-export-${exportedAt.replace(/[:.]/g, '-').slice(0, 19)}`;

  process.stdout.write(`\n# STEP-3: Live Pick Export\n`);
  process.stdout.write(`Export run ID: ${exportRunId}\n`);
  process.stdout.write(`Query: settled picks, last ${args.days} days, limit ${args.limit}\n`);
  if (args.sportId) process.stdout.write(`Sport filter: ${args.sportId}\n`);
  process.stdout.write(`Output: ${join(args.out, exportRunId)}\n\n`);

  // ── Validate credentials ─────────────────────────────────────
  const supabaseUrl = process.env['SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl || !serviceRoleKey) {
    process.stderr.write(
      '[export] FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n'
    );
    process.exit(1);
  }

  // ── Connect (read-only: no writes in this script) ─────────────
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  process.stdout.write(`[export] Connected to Supabase (service role, read-only)\n`);

  // ── Query picks ──────────────────────────────────────────────
  const cutoff = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000).toISOString();
  process.stdout.write(`[export] Querying picks (status=settled, created_at >= ${cutoff.slice(0, 10)})...\n`);

  let picksQuery = supabase
    .from('picks')
    .select(
      'id, status, market, selection, line, odds, confidence, source, metadata, ' +
      'promotion_status, promotion_score, promotion_version, promotion_decided_at, ' +
      'posted_at, created_at, sport_id'
    )
    .eq('status', 'settled')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(args.limit);

  if (args.sportId) {
    picksQuery = picksQuery.eq('sport_id', args.sportId);
  }

  const { data: picksRaw, error: picksError } = await picksQuery;
  if (picksError) {
    process.stderr.write(`[export] FATAL: picks query failed: ${picksError.message}\n`);
    process.exit(1);
  }

  const picks = (picksRaw ?? []) as PickRow[];
  process.stdout.write(`[export] Picks queried: ${picks.length}\n`);

  if (picks.length === 0) {
    process.stdout.write(`[export] WARN: No settled picks found in window. Widening to ${args.days * 2} days is recommended.\n`);
    process.exit(0);
  }

  const pickIds = picks.map(p => p.id);

  // ── Query settlement_records ─────────────────────────────────
  process.stdout.write(`[export] Querying settlement_records...\n`);
  const settlements = await queryInBatches<SettlementRow>(
    supabase,
    'settlement_records',
    'pick_id, result, source, confidence, status, settled_at',
    pickIds,
    q => q.eq('status', 'settled').not('result', 'is', null)
  );
  process.stdout.write(`[export] Settlement records: ${settlements.length}\n`);

  // Build lookup: pickId → first confirmed settlement
  const settlementByPick = new Map<string, SettlementRow>();
  for (const s of settlements) {
    if (!settlementByPick.has(s.pick_id)) {
      settlementByPick.set(s.pick_id, s);
    }
  }

  // ── Query pick_promotion_history ─────────────────────────────
  process.stdout.write(`[export] Querying pick_promotion_history...\n`);
  const promotions = await queryInBatches<PromotionRow>(
    supabase,
    'pick_promotion_history',
    'pick_id, target, status, score, version, decided_at',
    pickIds,
    q => q.order('decided_at', { ascending: true })
  );
  process.stdout.write(`[export] Promotion history rows: ${promotions.length}\n`);

  // Build lookup: pickId → PromotionRow[]
  const promotionsByPick = new Map<string, PromotionRow[]>();
  for (const pr of promotions) {
    if (!promotionsByPick.has(pr.pick_id)) promotionsByPick.set(pr.pick_id, []);
    promotionsByPick.get(pr.pick_id)!.push(pr);
  }

  // ── Query pick_lifecycle for posted events ────────────────────
  process.stdout.write(`[export] Querying pick_lifecycle (posted events)...\n`);
  const postedAtByPick = new Map<string, string>();
  {
    // Try to_state column first; fallback to lifecycle_state
    const { data: lcData, error: lcError } = await supabase
      .from('pick_lifecycle')
      .select('pick_id, to_state, created_at')
      .in('pick_id', pickIds.slice(0, 100)) // probe with first batch
      .eq('to_state', 'posted')
      .order('created_at', { ascending: true });

    if (!lcError && lcData) {
      // to_state column exists — query all batches
      const allLc = await queryInBatches<LifecycleRow>(
        supabase,
        'pick_lifecycle',
        'pick_id, to_state, created_at',
        pickIds,
        q => q.eq('to_state', 'posted').order('created_at', { ascending: true })
      );
      for (const row of allLc) {
        if (!postedAtByPick.has(row.pick_id)) {
          postedAtByPick.set(row.pick_id, row.created_at);
        }
      }
      process.stdout.write(`[export] Lifecycle posted events: ${postedAtByPick.size}\n`);
    } else {
      // Try lifecycle_state column (older schema)
      const { data: altData, error: altError } = await supabase
        .from('pick_lifecycle')
        .select('pick_id, lifecycle_state, created_at')
        .in('pick_id', pickIds.slice(0, 100))
        .eq('lifecycle_state', 'posted');

      if (!altError && altData) {
        // lifecycle_state column exists — query all batches
        const allLcAlt = await queryInBatches<{ pick_id: string; lifecycle_state: string; created_at: string }>(
          supabase,
          'pick_lifecycle',
          'pick_id, lifecycle_state, created_at',
          pickIds,
          q => q.eq('lifecycle_state', 'posted').order('created_at', { ascending: true })
        );
        for (const row of allLcAlt) {
          if (!postedAtByPick.has(row.pick_id)) {
            postedAtByPick.set(row.pick_id, row.created_at);
          }
        }
        process.stdout.write(`[export] Lifecycle posted events (alt schema): ${postedAtByPick.size}\n`);
      } else {
        process.stdout.write(`[export] WARN: pick_lifecycle query failed — will infer posted timestamps from picks.posted_at\n`);
      }
    }
  }

  // ── Reconstruct events per pick ───────────────────────────────
  process.stdout.write(`\n[export] Reconstructing event streams...\n`);

  const allEvents: Array<Omit<ExportEvent, 'sequenceNumber'>> = [];
  const skipReport: SkipRecord[] = [];
  let totalFallbacks = 0;
  const settlementBreakdown: Record<string, number> = {};
  const sportBreakdown: Record<string, number> = {};
  let eligibleCount = 0;

  for (const pick of picks) {
    const settlement = settlementByPick.get(pick.id);
    const pickPromos = promotionsByPick.get(pick.id) ?? [];
    const postedAt = postedAtByPick.get(pick.id) ?? null;

    const { events, fallbacks, skipReason } = reconstructPickEvents(
      pick,
      settlement,
      pickPromos,
      postedAt,
      exportedAt
    );

    if (skipReason) {
      skipReport.push({ pickId: pick.id, reason: skipReason });
      continue;
    }

    eligibleCount++;
    totalFallbacks += fallbacks;
    allEvents.push(...events);

    // Track breakdown
    const result = settlement!.result!;
    settlementBreakdown[result] = (settlementBreakdown[result] ?? 0) + 1;
    const sport = pick.sport_id ?? 'unknown';
    sportBreakdown[sport] = (sportBreakdown[sport] ?? 0) + 1;
  }

  process.stdout.write(`[export] Eligible picks: ${eligibleCount}\n`);
  process.stdout.write(`[export] Skipped picks: ${skipReport.length}\n`);
  process.stdout.write(`[export] Reconstruction fallbacks: ${totalFallbacks}\n`);
  process.stdout.write(`[export] Events total: ${allEvents.length}\n`);

  if (eligibleCount < 50) {
    process.stdout.write(`[export] WARN: Only ${eligibleCount} eligible picks — consider widening date range.\n`);
  }

  // ── Sort globally by timestamp, assign sequence numbers ────────
  allEvents.sort((a, b) => {
    const tA = new Date(a.timestamp).getTime();
    const tB = new Date(b.timestamp).getTime();
    if (tA !== tB) return tA - tB;
    // Tiebreak: pickId then eventType for determinism
    if (a.pickId !== b.pickId) return (a.pickId ?? '').localeCompare(b.pickId ?? '');
    return a.eventType.localeCompare(b.eventType);
  });

  const sequencedEvents: ExportEvent[] = allEvents.map((e, i) => ({
    ...e,
    sequenceNumber: i + 1,
  }));

  // ── Compute date range ────────────────────────────────────────
  const timestamps = allEvents.map(e => e.timestamp).sort();
  const dateRange = {
    earliest: timestamps[0] ?? exportedAt,
    latest: timestamps[timestamps.length - 1] ?? exportedAt,
  };

  // ── Write artifacts ────────────────────────────────────────────
  const outDir = join(args.out, exportRunId);
  mkdirSync(outDir, { recursive: true });

  const jsonlPath = join(outDir, 'picks-export.jsonl');
  const manifestPath = join(outDir, 'export-manifest.json');
  const skipPath = join(outDir, 'skip-report.json');

  // picks-export.jsonl — one event per line
  writeFileSync(
    jsonlPath,
    sequencedEvents.map(e => JSON.stringify(e)).join('\n') + '\n',
    'utf-8'
  );

  // export-manifest.json — metadata (no credentials)
  const manifest = {
    exportRunId,
    exportedAt,
    supabaseUrlBase: supabaseUrl.replace(/\/+$/, '').split('/').slice(0, 3).join('/'), // scheme+host only
    queryWindowDays: args.days,
    sportIdFilter: args.sportId,
    picksQueried: picks.length,
    picksEligible: eligibleCount,
    picksSkipped: skipReport.length,
    eventsTotal: sequencedEvents.length,
    dateRange,
    sportBreakdown,
    settlementBreakdown,
    reconstructionFallbacks: totalFallbacks,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  // skip-report.json
  writeFileSync(skipPath, JSON.stringify(skipReport, null, 2), 'utf-8');

  // ── Print summary ─────────────────────────────────────────────
  process.stdout.write(`\n## Export Summary\n`);
  process.stdout.write(`export_run_id:       ${exportRunId}\n`);
  process.stdout.write(`picks_queried:       ${picks.length}\n`);
  process.stdout.write(`picks_eligible:      ${eligibleCount}\n`);
  process.stdout.write(`picks_skipped:       ${skipReport.length}\n`);
  process.stdout.write(`events_total:        ${sequencedEvents.length}\n`);
  process.stdout.write(`fallbacks:           ${totalFallbacks}\n`);
  process.stdout.write(`date_range:          ${dateRange.earliest.slice(0, 10)} → ${dateRange.latest.slice(0, 10)}\n`);
  process.stdout.write(`settlement_breakdown: ${JSON.stringify(settlementBreakdown)}\n`);
  process.stdout.write(`sport_breakdown:     ${JSON.stringify(sportBreakdown)}\n`);
  process.stdout.write(`\nArtifacts:\n`);
  process.stdout.write(`  ${jsonlPath}\n`);
  process.stdout.write(`  ${manifestPath}\n`);
  process.stdout.write(`  ${skipPath}\n`);
  process.stdout.write(`\nNext: npx tsx scripts/live-data-lab-runner.ts --events "${jsonlPath}"\n\n`);
}

void main().catch((err: unknown) => {
  process.stderr.write(
    `[export-picks-to-journal] fatal: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
