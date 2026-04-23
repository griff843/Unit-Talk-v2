import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseIngestorRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { runHistoricalBackfill } from '../apps/ingestor/src/historical-backfill.js';

type Client = SupabaseClient<Record<string, never>>;

interface CliOptions {
  startDate: string;
  endDate: string;
  leagues: string[];
  backfill: boolean;
  skipResults: boolean;
  outPath: string;
}

interface ProviderOfferRow {
  provider_event_id: string;
  provider_market_key: string;
  provider_participant_id: string | null;
  sport_key: string | null;
  line: number | null;
  over_odds: number | null;
  under_odds: number | null;
  is_opening: boolean;
  is_closing: boolean;
  snapshot_at: string;
  bookmaker_key: string | null;
}

interface EventRow {
  id: string;
  external_id: string | null;
  sport_id: string;
  event_date: string;
}

interface GameResultRow {
  event_id: string;
  market_key: string;
  participant_id: string | null;
}

interface ParticipantRow {
  id: string;
  external_id: string | null;
}

interface SliceCoverage {
  sport: string;
  market: string;
  bookmaker: string;
  offers: number;
  bookmakerRows: number;
  openingRows: number;
  closingRows: number;
  pairedOddsRows: number;
  resultRows: number;
  clvReadyKeys: number;
}

interface CoverageReport {
  generatedAt: string;
  window: {
    eventStartDate: string;
    eventEndDate: string;
    snapshotStart: string;
    snapshotEndExclusive: string;
  };
  leagues: string[];
  backfill: {
    attempted: boolean;
    skipResults: boolean;
    runs: Array<{
      date: string;
      league: string;
      eventsCount: number;
      pairedCount: number;
      normalizedCount: number;
      insertedCount: number;
      updatedCount: number;
      resultsEventsCount: number;
      insertedResultsCount: number;
    }>;
  };
  totals: {
    offers: number;
    events: number;
    resultRows: number;
    bookmakerRows: number;
    openingRows: number;
    closingRows: number;
    pairedOddsRows: number;
    clvReadyKeys: number;
  };
  bySportMarketBook: SliceCoverage[];
  unusable: {
    noBookmaker: number;
    missingLine: number;
    missingOdds: number;
    noOpening: number;
    noClosing: number;
    noResult: number;
  };
}

interface GroupState {
  sport: string;
  market: string;
  bookmaker: string;
  offers: number;
  bookmakerRows: number;
  openingRows: number;
  closingRows: number;
  pairedOddsRows: number;
  hasOpening: boolean;
  hasClosing: boolean;
  hasResult: boolean;
  missingLine: boolean;
  missingOdds: boolean;
}

const PAGE_SIZE = 1000;

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  const client = createClient<Record<string, never>>(connection.url, connection.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const backfillRuns: CoverageReport['backfill']['runs'] = [];
  if (options.backfill) {
    if (!env.SGO_API_KEY) {
      throw new Error('SGO_API_KEY is required when --backfill is set');
    }

    const repositories = createDatabaseIngestorRepositoryBundle(connection);
    const summary = await runHistoricalBackfill({
      repositories,
      leagues: options.leagues,
      apiKey: env.SGO_API_KEY,
      startDate: options.startDate,
      endDate: options.endDate,
      skipResults: options.skipResults,
      logger: console,
    });

    for (const run of summary.runs) {
      backfillRuns.push({
        date: run.date,
        league: run.league,
        eventsCount: run.summary.eventsCount,
        pairedCount: run.summary.pairedCount,
        normalizedCount: run.summary.normalizedCount,
        insertedCount: run.summary.insertedCount,
        updatedCount: run.summary.updatedCount,
        resultsEventsCount: run.summary.resultsEventsCount,
        insertedResultsCount: run.summary.insertedResultsCount,
      });
    }
  }

  const report = await buildCoverageReport(client, options, backfillRuns);
  await writeJson(options.outPath, report);
  printReport(report, options.outPath);
}

async function buildCoverageReport(
  client: Client,
  options: CliOptions,
  backfillRuns: CoverageReport['backfill']['runs'],
): Promise<CoverageReport> {
  const snapshotStart = toNextIsoDate(options.startDate);
  const snapshotEndExclusive = toNextIsoDate(toNextIsoDate(options.endDate).slice(0, 10));

  const offers = await fetchSgoOffers(client, snapshotStart, snapshotEndExclusive, options.leagues);
  const eventIds = unique(offers.map((offer) => offer.provider_event_id));
  const events = await fetchEvents(client, eventIds);
  const resultRows = await fetchGameResults(client, events.map((event) => event.id));
  const participants = await fetchParticipants(
    client,
    unique(resultRows.flatMap((row) => (row.participant_id ? [row.participant_id] : []))),
  );
  const eventResultKeys = buildEventResultKeys(events, resultRows, participants);
  const grouped = groupCoverage(offers, eventResultKeys);
  const bySportMarketBook = summarizeGroups(grouped);
  const unusable = summarizeUnusable(grouped);

  return {
    generatedAt: new Date().toISOString(),
    window: {
      eventStartDate: options.startDate,
      eventEndDate: options.endDate,
      snapshotStart,
      snapshotEndExclusive,
    },
    leagues: options.leagues,
    backfill: {
      attempted: options.backfill,
      skipResults: options.skipResults,
      runs: backfillRuns,
    },
    totals: {
      offers: offers.length,
      events: events.length,
      resultRows: resultRows.length,
      bookmakerRows: offers.filter((offer) => offer.bookmaker_key !== null).length,
      openingRows: offers.filter((offer) => offer.is_opening).length,
      closingRows: offers.filter((offer) => offer.is_closing).length,
      pairedOddsRows: offers.filter(hasPairedOdds).length,
      clvReadyKeys: Array.from(grouped.values()).filter(isClvReady).length,
    },
    bySportMarketBook,
    unusable,
  };
}

function groupCoverage(
  offers: ProviderOfferRow[],
  eventResultKeys: Set<string>,
): Map<string, GroupState> {
  const grouped = new Map<string, GroupState>();

  for (const offer of offers) {
    const sport = normalizeLabel(offer.sport_key);
    const market = offer.provider_market_key;
    const bookmaker = offer.bookmaker_key ?? 'consensus';
    const key = [
      offer.provider_event_id,
      market,
      offer.provider_participant_id ?? 'all',
      bookmaker,
    ].join('|');
    const state = grouped.get(key) ?? {
      sport,
      market,
      bookmaker,
      offers: 0,
      bookmakerRows: 0,
      openingRows: 0,
      closingRows: 0,
      pairedOddsRows: 0,
      hasOpening: false,
      hasClosing: false,
      hasResult: false,
      missingLine: false,
      missingOdds: false,
    };

    state.offers += 1;
    state.bookmakerRows += offer.bookmaker_key !== null ? 1 : 0;
    state.openingRows += offer.is_opening ? 1 : 0;
    state.closingRows += offer.is_closing ? 1 : 0;
    state.pairedOddsRows += hasPairedOdds(offer) ? 1 : 0;
    state.hasOpening = state.hasOpening || offer.is_opening;
    state.hasClosing = state.hasClosing || offer.is_closing;
    state.missingLine = state.missingLine || offer.line === null;
    state.missingOdds = state.missingOdds || !hasAtLeastOneOddsSide(offer);
    state.hasResult =
      state.hasResult ||
      eventResultKeys.has([
        offer.provider_event_id,
        market,
        offer.provider_participant_id ?? 'all',
      ].join('|'));
    grouped.set(key, state);
  }

  return grouped;
}

function summarizeGroups(grouped: Map<string, GroupState>): SliceCoverage[] {
  const slices = new Map<string, SliceCoverage>();
  for (const state of grouped.values()) {
    const key = [state.sport, state.market, state.bookmaker].join('|');
    const slice = slices.get(key) ?? {
      sport: state.sport,
      market: state.market,
      bookmaker: state.bookmaker,
      offers: 0,
      bookmakerRows: 0,
      openingRows: 0,
      closingRows: 0,
      pairedOddsRows: 0,
      resultRows: 0,
      clvReadyKeys: 0,
    };
    slice.offers += state.offers;
    slice.bookmakerRows += state.bookmakerRows;
    slice.openingRows += state.openingRows;
    slice.closingRows += state.closingRows;
    slice.pairedOddsRows += state.pairedOddsRows;
    slice.resultRows += state.hasResult ? 1 : 0;
    slice.clvReadyKeys += isClvReady(state) ? 1 : 0;
    slices.set(key, slice);
  }

  return Array.from(slices.values()).sort((a, b) => {
    if (b.clvReadyKeys !== a.clvReadyKeys) return b.clvReadyKeys - a.clvReadyKeys;
    if (b.offers !== a.offers) return b.offers - a.offers;
    return `${a.sport}:${a.market}:${a.bookmaker}`.localeCompare(`${b.sport}:${b.market}:${b.bookmaker}`);
  });
}

function summarizeUnusable(grouped: Map<string, GroupState>) {
  const states = Array.from(grouped.values());
  return {
    noBookmaker: states.filter((state) => state.bookmaker === 'consensus').length,
    missingLine: states.filter((state) => state.missingLine).length,
    missingOdds: states.filter((state) => state.missingOdds).length,
    noOpening: states.filter((state) => !state.hasOpening).length,
    noClosing: states.filter((state) => !state.hasClosing).length,
    noResult: states.filter((state) => !state.hasResult).length,
  };
}

function isClvReady(state: GroupState) {
  return (
    state.bookmaker !== 'consensus' &&
    state.hasOpening &&
    state.hasClosing &&
    state.hasResult &&
    !state.missingLine &&
    !state.missingOdds
  );
}

function buildEventResultKeys(
  events: EventRow[],
  resultRows: GameResultRow[],
  participants: ParticipantRow[],
) {
  const eventById = new Map(events.map((event) => [event.id, event]));
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));
  const keys = new Set<string>();
  for (const row of resultRows) {
    const event = eventById.get(row.event_id);
    if (!event?.external_id) continue;
    const participantId =
      row.participant_id === null
        ? 'all'
        : participantById.get(row.participant_id)?.external_id ?? row.participant_id;
    keys.add([
      event.external_id,
      row.market_key,
      participantId,
    ].join('|'));
  }
  return keys;
}

async function fetchSgoOffers(
  client: Client,
  snapshotStart: string,
  snapshotEndExclusive: string,
  leagues: string[],
) {
  return fetchPaged<ProviderOfferRow>(async (from, to) => {
    const { data, error } = await client
      .from('provider_offers')
      .select('provider_event_id,provider_market_key,provider_participant_id,sport_key,line,over_odds,under_odds,is_opening,is_closing,snapshot_at,bookmaker_key')
      .eq('provider_key', 'sgo')
      .gte('snapshot_at', snapshotStart)
      .lt('snapshot_at', snapshotEndExclusive)
      .in('sport_key', leagues)
      .order('snapshot_at', { ascending: true })
      .range(from, to);
    if (error) throw error;
    return data ?? [];
  });
}

async function fetchEvents(client: Client, externalIds: string[]) {
  const chunks = chunk(externalIds, 200);
  const rows: EventRow[] = [];
  for (const ids of chunks) {
    const { data, error } = await client
      .from('events')
      .select('id,external_id,sport_id,event_date')
      .in('external_id', ids);
    if (error) throw error;
    rows.push(...((data ?? []) as EventRow[]));
  }
  return rows;
}

async function fetchGameResults(client: Client, eventIds: string[]) {
  const chunks = chunk(eventIds, 200);
  const rows: GameResultRow[] = [];
  for (const ids of chunks) {
    rows.push(
      ...(await fetchPaged<GameResultRow>(async (from, to) => {
        const { data, error } = await client
          .from('game_results')
          .select('event_id,market_key,participant_id')
          .in('event_id', ids)
          .range(from, to);
        if (error) throw error;
        return (data ?? []) as GameResultRow[];
      })),
    );
  }
  return rows;
}

async function fetchParticipants(client: Client, participantIds: string[]) {
  const chunks = chunk(participantIds, 200);
  const rows: ParticipantRow[] = [];
  for (const ids of chunks) {
    rows.push(
      ...(await fetchPaged<ParticipantRow>(async (from, to) => {
        const { data, error } = await client
          .from('participants')
          .select('id,external_id')
          .in('id', ids)
          .range(from, to);
        if (error) throw error;
        return (data ?? []) as ParticipantRow[];
      })),
    );
  }
  return rows;
}

async function fetchPaged<T>(fetchPage: (from: number, to: number) => Promise<T[]>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await fetchPage(from, from + PAGE_SIZE - 1);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function parseCliOptions(args: string[]): CliOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      values.set(key, next);
      index += 1;
    } else {
      flags.add(key);
    }
  }

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const defaultEnd = yesterday.toISOString().slice(0, 10);
  const defaultStart = addDays(defaultEnd, -2);

  const startDate = values.get('start') ?? defaultStart;
  const endDate = values.get('end') ?? defaultEnd;
  assertIsoDate(startDate, '--start');
  assertIsoDate(endDate, '--end');
  if (startDate > endDate) {
    throw new Error(`--start must be on or before --end; received ${startDate} > ${endDate}`);
  }

  const leagues = (values.get('leagues') ?? 'NBA,MLB,NHL')
    .split(',')
    .map((league) => league.trim().toUpperCase())
    .filter((league) => league.length > 0);
  if (leagues.length === 0) {
    throw new Error('--leagues must include at least one league');
  }

  return {
    startDate,
    endDate,
    leagues,
    backfill: flags.has('backfill'),
    skipResults: flags.has('skip-results'),
    outPath: values.get('out') ?? `out/sgo-historical-coverage-${startDate}-${endDate}.json`,
  };
}

function printReport(report: CoverageReport, outPath: string) {
  console.log('=== SGO Historical Coverage ===');
  console.log(`Window: ${report.window.eventStartDate} to ${report.window.eventEndDate}`);
  console.log(`Leagues: ${report.leagues.join(', ')}`);
  console.log(`Backfill attempted: ${report.backfill.attempted ? 'yes' : 'no'}`);
  console.log(`Offers: ${report.totals.offers}`);
  console.log(`Events: ${report.totals.events}`);
  console.log(`Game result rows: ${report.totals.resultRows}`);
  console.log(`Bookmaker rows: ${report.totals.bookmakerRows}`);
  console.log(`Opening rows: ${report.totals.openingRows}`);
  console.log(`Closing rows: ${report.totals.closingRows}`);
  console.log(`Paired odds rows: ${report.totals.pairedOddsRows}`);
  console.log(`CLV-ready keys: ${report.totals.clvReadyKeys}`);
  console.log('');
  console.log('Top CLV-ready slices:');
  for (const slice of report.bySportMarketBook.slice(0, 15)) {
    console.log(
      [
        slice.sport.padEnd(4),
        slice.bookmaker.padEnd(12),
        slice.market.padEnd(32),
        `ready=${slice.clvReadyKeys}`,
        `open=${slice.openingRows}`,
        `close=${slice.closingRows}`,
        `results=${slice.resultRows}`,
        `offers=${slice.offers}`,
      ].join(' | '),
    );
  }
  console.log('');
  console.log(`Wrote ${outPath}`);
}

async function writeJson(path: string, value: unknown) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function hasPairedOdds(row: ProviderOfferRow) {
  return row.over_odds !== null && row.under_odds !== null;
}

function hasAtLeastOneOddsSide(row: ProviderOfferRow) {
  return row.over_odds !== null || row.under_odds !== null;
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function normalizeLabel(value: string | null) {
  return value?.trim().toUpperCase() || 'UNKNOWN';
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function toNextIsoDate(date: string) {
  return `${addDays(date, 1)}T00:00:00.000Z`;
}

function assertIsoDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be formatted as YYYY-MM-DD`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
