/**
 * Data layer for Intelligence-zone odds pages (/intel/*).
 *
 * Reads provider_offer_current / provider_offer_history via getDataClient()
 * and groups current offers across bookmakers for the same
 * event+market+participant. Note: `identity_key` in provider_offer_current
 * INCLUDES the bookmaker suffix (e.g. "sgo:<event>:<market>:<participant>:draftkings"),
 * so cross-book grouping uses a derived key with that suffix stripped.
 *
 * Odds are AMERICAN format (verified against live rows — see src/lib/odds-math.ts).
 */
import { getDataClient } from './client';

export interface IntelOfferRow {
  id: string;
  identityKey: string;
  /** identity_key with the trailing ":<bookmaker_key>" segment removed */
  groupKey: string;
  sportKey: string | null;
  providerEventId: string;
  providerMarketKey: string;
  providerParticipantId: string | null;
  bookmakerKey: string;
  line: number | null;
  overOdds: number | null;
  underOdds: number | null;
  isOpening: boolean;
  isClosing: boolean;
  snapshotAt: string;
}

export interface IntelOfferGroup {
  groupKey: string;
  sportKey: string | null;
  providerEventId: string;
  providerMarketKey: string;
  providerParticipantId: string | null;
  /** Display name of the event, joined via events.external_id, if resolvable */
  eventName: string | null;
  eventDate: string | null;
  books: IntelOfferRow[];
}

export interface IntelOffersResult {
  groups: IntelOfferGroup[];
  totalOffersScanned: number;
  observedAt: string;
  /** Row cap applied to the underlying query — surfaced in the UI */
  rowCap: number;
}

/** Strip the trailing ":<bookmakerKey>" segment from identity_key. */
export function stripBookFromIdentity(identityKey: string, bookmakerKey: string): string {
  const suffix = `:${bookmakerKey}`;
  return identityKey.endsWith(suffix)
    ? identityKey.slice(0, identityKey.length - suffix.length)
    : identityKey;
}

/** Odds are considered stale for intel purposes after this many minutes. */
export const STALE_ODDS_THRESHOLD_MINUTES = 60;

export function isStaleOdds(snapshotAt: string | null | undefined): boolean {
  if (!snapshotAt) return true;
  const ageMs = Date.now() - new Date(snapshotAt).getTime();
  return ageMs > STALE_ODDS_THRESHOLD_MINUTES * 60_000;
}

function mapRow(row: Record<string, unknown>): IntelOfferRow | null {
  const bookmakerKey = typeof row['bookmaker_key'] === 'string' ? row['bookmaker_key'] : null;
  if (!bookmakerKey) return null; // provider-consensus rows carry null bookmaker_key — excluded
  const identityKey = String(row['identity_key'] ?? '');
  return {
    id: String(row['id'] ?? ''),
    identityKey,
    groupKey: stripBookFromIdentity(identityKey, bookmakerKey),
    sportKey: typeof row['sport_key'] === 'string' ? row['sport_key'] : null,
    providerEventId: String(row['provider_event_id'] ?? ''),
    providerMarketKey: String(row['provider_market_key'] ?? ''),
    providerParticipantId:
      typeof row['provider_participant_id'] === 'string' ? row['provider_participant_id'] : null,
    bookmakerKey,
    line: typeof row['line'] === 'number' ? row['line'] : null,
    overOdds: typeof row['over_odds'] === 'number' ? row['over_odds'] : null,
    underOdds: typeof row['under_odds'] === 'number' ? row['under_odds'] : null,
    isOpening: row['is_opening'] === true,
    isClosing: row['is_closing'] === true,
    snapshotAt: String(row['snapshot_at'] ?? ''),
  };
}

const OFFER_COLUMNS =
  'id, identity_key, sport_key, provider_event_id, provider_market_key, provider_participant_id, bookmaker_key, line, over_odds, under_odds, is_opening, is_closing, snapshot_at';

/**
 * Fetch recent current offers (bookmaker rows only) grouped across books by
 * event+market+participant. Capped at `limit` raw rows (default 500).
 */
export async function getCurrentOfferGroups(params: {
  sport?: string;
  market?: string;
  eventId?: string;
  minBooks?: number;
  limit?: number;
} = {}): Promise<IntelOffersResult | null> {
  try {
    const client = getDataClient();
    const rowCap = Math.min(params.limit ?? 500, 1000);

    let query = client
      .from('provider_offer_current')
      .select(OFFER_COLUMNS)
      .not('bookmaker_key', 'is', null);

    if (params.sport) query = query.eq('sport_key', params.sport);
    if (params.market) query = query.ilike('provider_market_key', `%${params.market}%`);
    if (params.eventId) query = query.eq('provider_event_id', params.eventId);

    query = query.order('snapshot_at', { ascending: false }).limit(rowCap);

    const { data, error } = await query;
    if (error) throw error;

    const rows = ((data ?? []) as Array<Record<string, unknown>>)
      .map(mapRow)
      .filter((r): r is IntelOfferRow => r !== null);

    const byGroup = new Map<string, IntelOfferRow[]>();
    for (const r of rows) {
      const list = byGroup.get(r.groupKey);
      if (list) list.push(r);
      else byGroup.set(r.groupKey, [r]);
    }

    const minBooks = params.minBooks ?? 1;
    const groups: IntelOfferGroup[] = [];
    for (const [groupKey, books] of byGroup) {
      const distinctBooks = new Set(books.map((b) => b.bookmakerKey));
      if (distinctBooks.size < minBooks) continue;
      const first = books[0]!;
      groups.push({
        groupKey,
        sportKey: first.sportKey,
        providerEventId: first.providerEventId,
        providerMarketKey: first.providerMarketKey,
        providerParticipantId: first.providerParticipantId,
        eventName: null,
        eventDate: null,
        books,
      });
    }

    // Join event display names via events.external_id (= provider_event_id)
    const eventIds = Array.from(new Set(groups.map((g) => g.providerEventId))).slice(0, 100);
    if (eventIds.length > 0) {
      const { data: eventRows } = await client
        .from('events')
        .select('external_id, event_name, event_date')
        .in('external_id', eventIds);
      const nameByExternalId = new Map<string, { name: string | null; date: string | null }>();
      for (const e of (eventRows ?? []) as Array<Record<string, unknown>>) {
        nameByExternalId.set(String(e['external_id'] ?? ''), {
          name: typeof e['event_name'] === 'string' ? e['event_name'] : null,
          date: typeof e['event_date'] === 'string' ? e['event_date'] : null,
        });
      }
      for (const g of groups) {
        const hit = nameByExternalId.get(g.providerEventId);
        if (hit) {
          g.eventName = hit.name;
          g.eventDate = hit.date;
        }
      }
    }

    return {
      groups,
      totalOffersScanned: rows.length,
      observedAt: new Date().toISOString(),
      rowCap,
    };
  } catch {
    return null;
  }
}

/** Distinct bookmaker keys present in provider_offer_current (small scan). */
export async function getDistinctBookmakers(): Promise<string[] | null> {
  try {
    const client = getDataClient();
    const { data, error } = await client
      .from('provider_offer_current')
      .select('bookmaker_key')
      .not('bookmaker_key', 'is', null)
      .order('snapshot_at', { ascending: false })
      .limit(1000);
    if (error) throw error;
    const keys = new Set<string>();
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      if (typeof row['bookmaker_key'] === 'string') keys.add(row['bookmaker_key']);
    }
    return Array.from(keys).sort();
  } catch {
    return null;
  }
}

export interface HistoryOfferRow {
  bookmakerKey: string | null;
  providerMarketKey: string;
  providerParticipantId: string | null;
  providerEventId: string;
  line: number | null;
  overOdds: number | null;
  underOdds: number | null;
  isOpening: boolean;
  snapshotAt: string;
}

/**
 * Fetch history rows for movement analysis. provider_offer_history has no
 * identity_key column, so callers group by event+market+participant+book.
 */
export async function getOfferHistory(params: {
  market?: string;
  eventId?: string;
  sinceIso?: string;
  limit?: number;
}): Promise<{ rows: HistoryOfferRow[]; rowCap: number } | null> {
  try {
    const client = getDataClient();
    const rowCap = Math.min(params.limit ?? 500, 1000);
    let query = client
      .from('provider_offer_history')
      .select(
        'bookmaker_key, provider_market_key, provider_participant_id, provider_event_id, line, over_odds, under_odds, is_opening, snapshot_at',
      );
    if (params.market) query = query.ilike('provider_market_key', `%${params.market}%`);
    if (params.eventId) query = query.eq('provider_event_id', params.eventId);
    if (params.sinceIso) query = query.gte('snapshot_at', params.sinceIso);
    query = query.order('snapshot_at', { ascending: false }).limit(rowCap);

    const { data, error } = await query;
    if (error) throw error;

    const rows: HistoryOfferRow[] = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      bookmakerKey: typeof row['bookmaker_key'] === 'string' ? row['bookmaker_key'] : null,
      providerMarketKey: String(row['provider_market_key'] ?? ''),
      providerParticipantId:
        typeof row['provider_participant_id'] === 'string' ? row['provider_participant_id'] : null,
      providerEventId: String(row['provider_event_id'] ?? ''),
      line: typeof row['line'] === 'number' ? row['line'] : null,
      overOdds: typeof row['over_odds'] === 'number' ? row['over_odds'] : null,
      underOdds: typeof row['under_odds'] === 'number' ? row['under_odds'] : null,
      isOpening: row['is_opening'] === true,
      snapshotAt: String(row['snapshot_at'] ?? ''),
    }));
    return { rows, rowCap };
  } catch {
    return null;
  }
}
