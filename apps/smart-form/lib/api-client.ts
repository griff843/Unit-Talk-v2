import type { CatalogData } from './catalog';

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000';
const HIDDEN_SPORTSBOOK_IDS = new Set(['williamhill', 'sgo']);
const DEFAULT_OPERATOR_SPORTSBOOK = { id: 'fanatics', name: 'Fanatics' } as const;

export interface LeagueBrowseResult {
  id: string;
  sportId: string;
  displayName: string;
}

export interface MatchupBrowseTeam {
  participantId: string;
  teamId: string | null;
  displayName: string;
  role: 'home' | 'away';
}

export interface MatchupBrowseResult {
  eventId: string;
  externalId: string | null;
  eventName: string;
  eventDate: string;
  startTime?: string | null;
  status: string;
  sportId: string;
  leagueId: string | null;
  teams: MatchupBrowseTeam[];
}

export interface BrowseSearchResult {
  resultType: 'player' | 'team' | 'matchup';
  participantId: string | null;
  displayName: string;
  contextLabel: string;
  teamId: string | null;
  teamName: string | null;
  matchup: MatchupBrowseResult;
}

export interface EventParticipantBrowseResult {
  participantId: string;
  canonicalId: string | null;
  participantType: 'team' | 'player';
  displayName: string;
  role: string;
  teamId: string | null;
  teamName: string | null;
}

export interface EventOfferBrowseResult {
  sportsbookId: string | null;
  sportsbookName: string | null;
  marketTypeId: string | null;
  marketDisplayName: string;
  participantId: string | null;
  participantName: string | null;
  line: number | null;
  overOdds: number | null;
  underOdds: number | null;
  snapshotAt: string;
  providerKey: string;
  providerMarketKey: string;
  providerParticipantId: string | null;
}

export interface EventBrowseResult {
  eventId: string;
  externalId: string | null;
  eventName: string;
  eventDate: string;
  startTime?: string | null;
  status: string;
  sportId: string;
  leagueId: string | null;
  participants: EventParticipantBrowseResult[];
  offers: EventOfferBrowseResult[];
}

export interface SubmitPickPayload {
  source: string;
  submittedBy?: string;
  market: string;
  selection: string;
  line?: number;
  odds?: number;
  stakeUnits?: number;
  confidence?: number;
  eventName?: string;
  metadata?: Record<string, unknown>;
}

export interface SubmitPickResult {
  submissionId: string;
  pickId: string;
  lifecycleState: string;
}

function normalizeCatalogData(data: unknown): CatalogData {
  const catalog = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const rawCappers = Array.isArray(catalog.cappers) ? catalog.cappers : [];
  const rawSportsbooks = Array.isArray(catalog.sportsbooks) ? catalog.sportsbooks : [];

  const cappers = rawCappers.flatMap((entry) => {
      if (typeof entry === 'string') {
        const normalizedId = entry.trim();
        return normalizedId ? [{ id: normalizedId, displayName: normalizedId }] : [];
      }

      if (!entry || typeof entry !== 'object') {
        return [];
      }

      const capper = entry as { id?: unknown; displayName?: unknown };
      const normalizedId = typeof capper.id === 'string' ? capper.id.trim() : '';
      const normalizedDisplayName =
        typeof capper.displayName === 'string' ? capper.displayName.trim() : '';

      if (!normalizedId && !normalizedDisplayName) {
        return [];
      }

      return [{
        id: normalizedId || normalizedDisplayName,
        displayName: normalizedDisplayName || normalizedId,
      }];
    });

  const sportsbooks = rawSportsbooks.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const sportsbook = entry as { id?: unknown; name?: unknown; displayName?: unknown };
    const normalizedId = typeof sportsbook.id === 'string' ? sportsbook.id.trim().toLowerCase() : '';
    const normalizedName =
      typeof sportsbook.name === 'string'
        ? sportsbook.name.trim()
        : typeof sportsbook.displayName === 'string'
          ? sportsbook.displayName.trim()
          : '';

    if (!normalizedId || !normalizedName || HIDDEN_SPORTSBOOK_IDS.has(normalizedId)) {
      return [];
    }

    return [{ id: normalizedId, name: normalizedName }];
  });

  const dedupedSportsbooks = Array.from(
    new Map(
      [...sportsbooks, DEFAULT_OPERATOR_SPORTSBOOK].map((sportsbook) => [sportsbook.id, sportsbook]),
    ).values(),
  ).sort((left, right) => left.name.localeCompare(right.name));

  return {
    sports: Array.isArray(catalog.sports) ? catalog.sports : [],
    sportsbooks: dedupedSportsbooks,
    ticketTypes: Array.isArray(catalog.ticketTypes) ? catalog.ticketTypes : [],
    cappers,
  };
}

async function readJsonResponse<T>(res: Response, fallbackMessage: string): Promise<T> {
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message ?? `${fallbackMessage}: ${res.status}`);
  }
  return json.data as T;
}

export async function getCatalog(): Promise<CatalogData> {
  const res = await fetch(`${API}/api/reference-data/catalog`);
  return normalizeCatalogData(await readJsonResponse<unknown>(res, 'Reference data unavailable'));
}

export async function getLeagues(sportId: string): Promise<LeagueBrowseResult[]> {
  const res = await fetch(`${API}/api/reference-data/leagues?sport=${encodeURIComponent(sportId)}`);
  return readJsonResponse<LeagueBrowseResult[]>(res, 'Leagues unavailable');
}

export async function getMatchups(sportId: string, date: string): Promise<MatchupBrowseResult[]> {
  const params = new URLSearchParams({
    sport: sportId,
    date,
  });
  const res = await fetch(`${API}/api/reference-data/matchups?${params.toString()}`);
  return readJsonResponse<MatchupBrowseResult[]>(res, 'Matchups unavailable');
}

export async function getEventBrowse(
  eventId: string,
  options?: { recentSince?: string },
): Promise<EventBrowseResult> {
  const params = new URLSearchParams();
  if (options?.recentSince) {
    params.set('recentSince', options.recentSince);
  }

  const query = params.size > 0 ? `?${params.toString()}` : '';
  const res = await fetch(`${API}/api/reference-data/events/${encodeURIComponent(eventId)}/browse${query}`);
  return readJsonResponse<EventBrowseResult>(res, 'Event browse unavailable');
}

export async function searchBrowse(sportId: string, date: string, query: string): Promise<BrowseSearchResult[]> {
  const params = new URLSearchParams({
    sport: sportId,
    date,
    q: query.trim(),
  });
  const res = await fetch(`${API}/api/reference-data/search?${params.toString()}`);
  return readJsonResponse<BrowseSearchResult[]>(res, 'Search unavailable');
}

export async function submitPick(payload: SubmitPickPayload): Promise<SubmitPickResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // Attach capper JWT if present in localStorage (UTV2-658).
  // The API validates the token and derives capperId from the claim.
  try {
    const token = typeof window !== 'undefined' ? localStorage.getItem('ut_capper_token') : null;
    if (token) headers['Authorization'] = `Bearer ${token}`;
  } catch {
    // Ignore storage errors — request proceeds without auth header (API may 401)
  }
  const res = await fetch(`${API}/api/submissions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  return readJsonResponse<SubmitPickResult>(res, 'Submit failed');
}
