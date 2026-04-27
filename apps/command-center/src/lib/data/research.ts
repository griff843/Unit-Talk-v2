/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDataClient } from './client.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type Client = any;

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface PropOfferRow {
  id: string;
  sportKey: string | null;
  providerMarketKey: string;
  bookmakerKey: string | null;
  line: number | null;
  overOdds: number | null;
  underOdds: number | null;
  providerParticipantId: string | null;
  providerEventId: string;
  isOpening: boolean;
  isClosing: boolean;
  snapshotAt: string;
}

export interface PropOffersResponse {
  offers: PropOfferRow[];
  total: number;
  hasMore: boolean;
  observedAt: string;
}

export interface ResearchLinesResult {
  offers: Array<Record<string, unknown>>;
  observedAt: string;
}

export interface ResearchMatchup {
  id: string;
  eventName: string | null;
  sportId: string | null;
  eventDate: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  status: string | null;
}

export interface ResearchMatchupsResult {
  events: ResearchMatchup[];
  total: number;
}

export interface ResearchPlayer {
  id: string;
  displayName: string | null;
  participantType: string | null;
  sport: string | null;
}

export interface ResearchPlayersResult {
  participants: ResearchPlayer[];
  total: number;
}

// ── getPropOffers ─────────────────────────────────────────────────────────────

export async function getPropOffers(params: {
  sport?: string;
  market?: string;
  bookmaker?: string;
  participant?: string;
  since?: string;
  offset?: number;
  limit?: number;
}): Promise<PropOffersResponse | null> {
  try {
    const client = getDataClient();
    const limit = Math.min(params.limit ?? 50, 200);
    const offset = params.offset ?? 0;

    let query = client
      .from('provider_offers')
      .select(
        'id, sport_key, provider_market_key, bookmaker_key, line, over_odds, under_odds, provider_participant_id, provider_event_id, is_opening, is_closing, snapshot_at',
        { count: 'exact' },
      );

    if (params.sport) {
      query = query.eq('sport_key', params.sport);
    }
    if (params.market) {
      query = query.ilike('provider_market_key', `%${params.market}%`);
    }
    if (params.bookmaker) {
      query = query.eq('bookmaker_key', params.bookmaker);
    }
    if (params.participant) {
      query = query.eq('provider_participant_id', params.participant);
    }
    if (params.since) {
      query = query.gte('snapshot_at', params.since);
    }

    query = query.order('snapshot_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) throw error;

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const total = count ?? 0;
    const hasMore = total > offset + limit;

    const offers: PropOfferRow[] = rows.map((row) => ({
      id: String(row['id'] ?? ''),
      sportKey: typeof row['sport_key'] === 'string' ? row['sport_key'] : null,
      providerMarketKey: String(row['provider_market_key'] ?? ''),
      bookmakerKey: typeof row['bookmaker_key'] === 'string' ? row['bookmaker_key'] : null,
      line: typeof row['line'] === 'number' ? row['line'] : null,
      overOdds: typeof row['over_odds'] === 'number' ? row['over_odds'] : null,
      underOdds: typeof row['under_odds'] === 'number' ? row['under_odds'] : null,
      providerParticipantId: typeof row['provider_participant_id'] === 'string' ? row['provider_participant_id'] : null,
      providerEventId: String(row['provider_event_id'] ?? ''),
      isOpening: row['is_opening'] === true,
      isClosing: row['is_closing'] === true,
      snapshotAt: String(row['snapshot_at'] ?? ''),
    }));

    return { offers, total, hasMore, observedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}

// ── getResearchLines ──────────────────────────────────────────────────────────

export async function getResearchLines(params: {
  participant?: string;
  market?: string;
}): Promise<ResearchLinesResult | null> {
  try {
    const client = getDataClient();

    let query = client
      .from('provider_offers')
      .select(
        'id, sport_key, provider_market_key, bookmaker_key, line, over_odds, under_odds, provider_participant_id, provider_event_id, is_opening, is_closing, snapshot_at',
      );

    if (params.participant) {
      query = query.eq('provider_participant_id', params.participant);
    }
    if (params.market) {
      query = query.ilike('provider_market_key', `%${params.market}%`);
    }

    query = query.order('snapshot_at', { ascending: false }).limit(100);

    const { data, error } = await query;

    if (error) throw error;

    return {
      offers: (data ?? []) as Array<Record<string, unknown>>,
      observedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ── getResearchMatchups ───────────────────────────────────────────────────────

export async function getResearchMatchups(params: {
  sport?: string;
  date?: string;
  q?: string;
  eventId?: string;
}): Promise<ResearchMatchupsResult | null> {
  try {
    const client = getDataClient();

    let query = client
      .from('events')
      .select('id, event_name, sport_id, event_date, home_team, away_team, status');

    if (params.eventId) {
      query = query.eq('id', params.eventId);
    } else {
      if (params.sport) {
        query = query.ilike('sport_id', `%${params.sport}%`);
      }
      if (params.date) {
        query = query.gte('event_date', params.date).lte('event_date', `${params.date}T23:59:59`);
      }
      if (params.q) {
        query = query.ilike('event_name', `%${params.q}%`);
      }
    }

    query = query.order('event_date', { ascending: false }).limit(100);

    const { data, error } = await query;

    if (error) throw error;

    const rows = (data ?? []) as Array<Record<string, unknown>>;

    const events: ResearchMatchup[] = rows.map((row) => ({
      id: String(row['id'] ?? ''),
      eventName: typeof row['event_name'] === 'string' ? row['event_name'] : null,
      sportId: typeof row['sport_id'] === 'string' ? row['sport_id'] : null,
      eventDate: typeof row['event_date'] === 'string' ? row['event_date'] : null,
      homeTeam: typeof row['home_team'] === 'string' ? row['home_team'] : null,
      awayTeam: typeof row['away_team'] === 'string' ? row['away_team'] : null,
      status: typeof row['status'] === 'string' ? row['status'] : null,
    }));

    return { events, total: events.length };
  } catch {
    return null;
  }
}

// ── getResearchPlayers ────────────────────────────────────────────────────────

export async function getResearchPlayers(params: {
  type?: string;
  sport?: string;
  q?: string;
}): Promise<ResearchPlayersResult | null> {
  try {
    const client = getDataClient();

    let query = client
      .from('participants')
      .select('id, display_name, participant_type, sport_id');

    if (params.type) {
      query = query.eq('participant_type', params.type);
    }
    if (params.sport) {
      query = query.ilike('sport_id', `%${params.sport}%`);
    }
    if (params.q) {
      query = query.ilike('display_name', `%${params.q}%`);
    }

    query = query.order('display_name', { ascending: true }).limit(100);

    const { data, error } = await query;

    if (error) throw error;

    const rows = (data ?? []) as Array<Record<string, unknown>>;

    const participants: ResearchPlayer[] = rows.map((row) => ({
      id: String(row['id'] ?? ''),
      displayName: typeof row['display_name'] === 'string' ? row['display_name'] : null,
      participantType: typeof row['participant_type'] === 'string' ? row['participant_type'] : null,
      sport: typeof row['sport_id'] === 'string' ? row['sport_id'] : null,
    }));

    return { participants, total: participants.length };
  } catch {
    return null;
  }
}
