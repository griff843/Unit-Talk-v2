import type { CatalogData } from './catalog';

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000';

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
  status: string;
  sportId: string;
  leagueId: string | null;
  teams: MatchupBrowseTeam[];
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

async function readJsonResponse<T>(res: Response, fallbackMessage: string): Promise<T> {
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message ?? `${fallbackMessage}: ${res.status}`);
  }
  return json.data as T;
}

export async function getCatalog(): Promise<CatalogData> {
  const res = await fetch(`${API}/api/reference-data/catalog`);
  return readJsonResponse<CatalogData>(res, 'Reference data unavailable');
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

export async function getEventBrowse(eventId: string): Promise<EventBrowseResult> {
  const res = await fetch(`${API}/api/reference-data/events/${encodeURIComponent(eventId)}/browse`);
  return readJsonResponse<EventBrowseResult>(res, 'Event browse unavailable');
}

export async function submitPick(payload: SubmitPickPayload): Promise<SubmitPickResult> {
  const res = await fetch(`${API}/api/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return readJsonResponse<SubmitPickResult>(res, 'Submit failed');
}
