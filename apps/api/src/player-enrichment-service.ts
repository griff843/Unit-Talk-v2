/**
 * Player Enrichment Service
 *
 * Enriches participant records with headshot URLs from sport-specific public APIs.
 * Runs as a scheduled pass — fail-open (errors are logged, never block).
 *
 * Supported sports:
 *   MLB  — statsapi.mlb.com people search
 *   NBA  — cdn.nba.com headshots
 *   NFL  — nfl.com headshots via ESPN ID
 *   NHL  — assets.nhle.com headshots
 */

import type { ParticipantRepository, SystemRunRepository } from '@unit-talk/db';

export interface PlayerEnrichmentDeps {
  participants: ParticipantRepository;
  runs: SystemRunRepository;
}

export interface EnrichmentResult {
  scanned: number;
  enriched: number;
  failed: number;
  skipped: number;
  errors: string[];
  refusals: Record<string, number>;
}

export interface PlayerIdentity {
  teamId?: string | null;
  teamAbbrev?: string | null;
  teamName?: string | null;
  teamNickname?: string | null;
  league?: string | null;
}
export type HeadshotResolution = { url: string | null; reason: 'confirmed' | 'ambiguous' | 'identity-mismatch' | 'unresolved' };
interface Candidate extends PlayerIdentity { name: string; url: string | null; identities?: PlayerIdentity[] }

/** Punctuation joins initials/apostrophes; suffixes remain part of the identity.
 * Jr/Junior and Sr/Senior are equivalent on BOTH sides. Missing/different
 * suffixes are refused rather than guessing a family member's identity. */
export function normalizePlayerName(name: string): string {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[‐‑‒–—-]/g, ' ').replace(/[.'’ʼ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim().replace(/\s+/g, ' ').replace(/\bjunior$/, 'jr').replace(/\bsenior$/, 'sr');
}
// Team identity dictionaries, verified 2026-11-02. MLB IDs/full names:
// https://statsapi.mlb.com/api/v1/teams?sportId=1 (mlb-teams-raw.json in lane proof).
// NHL abbreviations: all 32 observed in stored-provider-raw/*.txt; full names:
// https://api.nhle.com/stats/rest/en/team (UTA id 68 is Utah Mammoth).
// These are identity translations, never participant/reference-data writes.
const MLB_TEAM_NAMES: Readonly<Record<string, string>> = {
  "133": "Athletics",
  "134": "Pittsburgh Pirates",
  "135": "San Diego Padres",
  "136": "Seattle Mariners",
  "137": "San Francisco Giants",
  "138": "St. Louis Cardinals",
  "139": "Tampa Bay Rays",
  "140": "Texas Rangers",
  "141": "Toronto Blue Jays",
  "142": "Minnesota Twins",
  "143": "Philadelphia Phillies",
  "144": "Atlanta Braves",
  "145": "Chicago White Sox",
  "146": "Miami Marlins",
  "147": "New York Yankees",
  "158": "Milwaukee Brewers",
  "108": "Los Angeles Angels",
  "109": "Arizona Diamondbacks",
  "110": "Baltimore Orioles",
  "111": "Boston Red Sox",
  "112": "Chicago Cubs",
  "113": "Cincinnati Reds",
  "114": "Cleveland Guardians",
  "115": "Colorado Rockies",
  "116": "Detroit Tigers",
  "117": "Houston Astros",
  "118": "Kansas City Royals",
  "119": "Los Angeles Dodgers",
  "120": "Washington Nationals",
  "121": "New York Mets"
};
const NHL_TEAM_NAMES: Readonly<Record<string, string>> = {
  "ANA": "Anaheim Ducks",
  "BOS": "Boston Bruins",
  "BUF": "Buffalo Sabres",
  "CAR": "Carolina Hurricanes",
  "CBJ": "Columbus Blue Jackets",
  "CGY": "Calgary Flames",
  "CHI": "Chicago Blackhawks",
  "COL": "Colorado Avalanche",
  "DAL": "Dallas Stars",
  "DET": "Detroit Red Wings",
  "EDM": "Edmonton Oilers",
  "FLA": "Florida Panthers",
  "LAK": "Los Angeles Kings",
  "MIN": "Minnesota Wild",
  "MTL": "Montreal Canadiens",
  "NJD": "New Jersey Devils",
  "NSH": "Nashville Predators",
  "NYI": "New York Islanders",
  "NYR": "New York Rangers",
  "OTT": "Ottawa Senators",
  "PHI": "Philadelphia Flyers",
  "PIT": "Pittsburgh Penguins",
  "SEA": "Seattle Kraken",
  "SJS": "San Jose Sharks",
  "STL": "St. Louis Blues",
  "TBL": "Tampa Bay Lightning",
  "TOR": "Toronto Maple Leafs",
  "UTA": "Utah Mammoth",
  "VAN": "Vancouver Canucks",
  "VGK": "Vegas Golden Knights",
  "WPG": "Winnipeg Jets",
  "WSH": "Washington Capitals"
};

/** Canonical catalog keys and provider numeric IDs are separate namespaces. */
function teamAgrees(expected: PlayerIdentity, actual: PlayerIdentity): boolean {
  const actualHasTeam = Boolean(actual.teamId || actual.teamName || actual.teamNickname || actual.teamAbbrev);
  if (!expected.teamId || !actualHasTeam) return true;
  const canonical = expected.teamId.match(/^(.+)_(MLB|NBA|NFL|NHL)$/i);
  if (canonical) {
    if (actual.league && normalizePlayerName(canonical[2]!) !== normalizePlayerName(actual.league)) return false;
    const fullName = normalizePlayerName(canonical[1]!.replace(/_/g, ' '));
    const providerName = actual.teamName && normalizePlayerName(actual.teamName);
    const nickname = actual.teamNickname && normalizePlayerName(actual.teamNickname);
    if (!providerName && !nickname) return false;
    return providerName === fullName || Boolean(nickname && (fullName === nickname || fullName.endsWith(` ${nickname}`)));
  }
  if (actual.teamId && /^\d+$/.test(expected.teamId) && /^\d+$/.test(actual.teamId)) {
    return expected.teamId === actual.teamId;
  }
  // Both sides carry teams but their namespaces cannot be correlated.
  return false;
}

function uniqueMatch(name: string, identity: PlayerIdentity, candidates: Candidate[]): HeadshotResolution {
  const expected = normalizePlayerName(name);
  const matches = candidates.filter(candidate => expected && normalizePlayerName(candidate.name) === expected &&
    [candidate, ...(candidate.identities ?? [])].every(actual =>
      teamAgrees(identity, actual) && (['teamAbbrev', 'league'] as const).every(key =>
        !identity[key] || !actual[key] || normalizePlayerName(identity[key]) === normalizePlayerName(actual[key]))));
  if (matches.length > 1) return { url: null, reason: 'ambiguous' };
  if (!matches.length) return { url: null, reason: 'identity-mismatch' };
  return matches[0]!.url ? { url: matches[0]!.url, reason: 'confirmed' } : { url: null, reason: 'unresolved' };
}

export async function resolveHeadshot(
  displayName: string, sport: string | null, identity: PlayerIdentity = {},
): Promise<HeadshotResolution> {
  const league = ({ BASEBALL: 'MLB', BASKETBALL: 'NBA', FOOTBALL: 'NFL', HOCKEY: 'NHL' } as Record<string, string>)[sport?.toUpperCase() ?? ''] ?? sport?.toUpperCase();
  if (!league || !['MLB', 'NBA', 'NFL', 'NHL'].includes(league)) return { url: null, reason: 'unresolved' };
  try {
    const expected = { ...identity, league: identity.league ?? league };
    switch (league) {
      case 'MLB': return await resolveMLBHeadshot(displayName, expected);
      case 'NBA': return await resolveNBAHeadshot(displayName, expected);
      case 'NFL': return await resolveNFLHeadshot(displayName, expected);
      case 'NHL': return await resolveNHLHeadshot(displayName, expected);
    }
  } catch { /* Optional artwork: provider failure must never block intake. */ }
  return { url: null, reason: 'unresolved' };
}
export async function resolveHeadshotUrl(
  displayName: string, sport: string | null, _externalId: string | null, identity: PlayerIdentity = {},
): Promise<string | null> {
  return (await resolveHeadshot(displayName, sport, identity)).url;
}

// ── MLB ────────────────────────────────────────────────────────────
// Cache the full MLB roster for 2 hours to avoid making one HTTP call per player.
// statsapi.mlb.com rate-limits sequential per-player search requests, causing most
// MLB players to get skipped on the enrichment pass without this.
interface MlbRosterCache {
  players: Array<{ id: number; fullName: string; currentTeam?: { id?: number; name?: string; teamName?: string }; league?: string }>;
  fetchedAt: number;
}
let mlbRosterCache: MlbRosterCache | null = null;
const MLB_ROSTER_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

async function fetchMlbRoster(): Promise<Array<{ id: number; fullName: string; currentTeam?: { id?: number; name?: string; teamName?: string }; league?: string }> | null> {
  const now = Date.now();
  if (mlbRosterCache && now - mlbRosterCache.fetchedAt < MLB_ROSTER_CACHE_TTL_MS) {
    return mlbRosterCache.players;
  }

  // MLB season runs March–October; use previous year in off-season
  const season = new Date().getMonth() >= 2 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const url = `https://statsapi.mlb.com/api/v1/sports/1/players?season=${season}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;

  const data = (await res.json()) as { people?: Array<{ id: number; fullName: string; currentTeam?: { id?: number; name?: string; teamName?: string }; league?: string }> };
  const players = data.people;
  if (!players?.length) return null;

  mlbRosterCache = { players, fetchedAt: now };
  return players;
}

async function resolveMLBHeadshot(displayName: string, identity: PlayerIdentity): Promise<HeadshotResolution> {
  const players = await fetchMlbRoster();
  if (!players) return { url: null, reason: 'unresolved' };
  return uniqueMatch(displayName, identity, players.map(p => ({
    name: p.fullName, teamId: p.currentTeam?.id?.toString() ?? null,
    teamName: p.currentTeam?.name ?? (p.currentTeam?.id ? MLB_TEAM_NAMES[String(p.currentTeam.id)] : null) ?? null, teamNickname: p.currentTeam?.teamName ?? null, league: p.league ?? 'MLB',
    url: p.id ? `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,d_people:generic:headshot:silo:current.png,q_auto:best,f_auto/v1/people/${p.id}/headshot/67/current` : null,
  })));
}

// ── NBA ────────────────────────────────────────────────────────────
// Cache the full NBA roster for 2 hours to avoid making one HTTP call per player.
// stats.nba.com rate-limits sequential per-player requests, causing most NBA
// players to get skipped on the enrichment pass without this.
interface NbaRosterCache {
  rows: Array<Array<string | number>>;
  headers: string[];
  fetchedAt: number;
}
let nbaRosterCache: NbaRosterCache | null = null;
const NBA_ROSTER_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

async function fetchNbaRoster(): Promise<NbaRosterCache | null> {
  const now = Date.now();
  if (nbaRosterCache && now - nbaRosterCache.fetchedAt < NBA_ROSTER_CACHE_TTL_MS) {
    return nbaRosterCache;
  }

  const seasonStartYear = new Date().getMonth() >= 9 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const season = `${seasonStartYear}-${String(seasonStartYear + 1).slice(2)}`;
  const url = `https://stats.nba.com/stats/commonallplayers?IsOnlyCurrentSeason=1&LeagueID=00&Season=${season}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://www.nba.com/',
    },
  });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    resultSets?: Array<{ headers?: string[]; rowSet?: Array<Array<string | number>> }>;
  };
  const rows = data.resultSets?.[0]?.rowSet;
  const headers = data.resultSets?.[0]?.headers;
  if (!rows || !headers?.includes('PERSON_ID') || !headers.includes('DISPLAY_FIRST_LAST')) return null;

  nbaRosterCache = { rows, headers, fetchedAt: now };
  return nbaRosterCache;
}

async function resolveNBAHeadshot(displayName: string, identity: PlayerIdentity): Promise<HeadshotResolution> {
  const roster = await fetchNbaRoster();
  if (!roster) return { url: null, reason: 'unresolved' };
  return uniqueMatch(displayName, identity, roster.rows.map(row => {
    const column = (name: string) => row[roster.headers.indexOf(name)];
    const reversed = String(column('DISPLAY_LAST_COMMA_FIRST') ?? '').split(',').map(part => part.trim());
    const teamCity = column('TEAM_CITY');
    const teamNickname = column('TEAM_NAME');
    return { name: String(column('DISPLAY_FIRST_LAST') || (reversed.length === 2 ? `${reversed[1]} ${reversed[0]}` : '') || ''),
      teamId: column('TEAM_ID') ? String(column('TEAM_ID')) : null,
      teamName: teamCity && teamNickname ? `${teamCity} ${teamNickname}` : null,
      teamNickname: teamNickname ? String(teamNickname) : null,
      teamAbbrev: column('TEAM_ABBREVIATION') ? String(column('TEAM_ABBREVIATION')) : null, league: 'NBA',
      url: column('PERSON_ID') ? `https://cdn.nba.com/headshots/nba/latest/1040x760/${column('PERSON_ID')}.png` : null };
  }));
}

async function resolveNFLHeadshot(displayName: string, identity: PlayerIdentity): Promise<HeadshotResolution> {
  const url = `https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(displayName)}&limit=100&type=player&sport=football&league=nfl`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return { url: null, reason: 'unresolved' };
  const data = await res.json() as { items?: Array<{ id?: string; displayName?: string;
    headshot?: string | { href?: string }; team?: { id?: string; abbreviation?: string; displayName?: string; name?: string }; league?: string;
    teamRelationships?: Array<{ core?: { id?: string; abbreviation?: string; displayName?: string; name?: string } }>;
    leagueRelationships?: Array<{ core?: { abbreviation?: string; slug?: string } }> }> };
  if (!Array.isArray(data.items)) return { url: null, reason: 'unresolved' };
  // A full search window may omit another credible namesake.
  if (data.items.length >= 100) return { url: null, reason: 'ambiguous' };
  return uniqueMatch(displayName, identity, data.items.map(item => ({
    name: item.displayName ?? '', teamId: item.team?.id ?? null, teamAbbrev: item.team?.abbreviation ?? null,
    teamName: item.team?.displayName ?? null, teamNickname: item.team?.name ?? null, league: item.league ?? 'NFL',
    identities: [
      ...(item.teamRelationships ?? []).map(rel => ({ teamId: rel.core?.id ?? null, teamAbbrev: rel.core?.abbreviation ?? null, teamName: rel.core?.displayName ?? null, teamNickname: rel.core?.name ?? null })),
      ...(item.leagueRelationships ?? []).map(rel => ({ league: rel.core?.abbreviation ?? rel.core?.slug ?? null })),
    ],
    url: (typeof item.headshot === 'string' ? item.headshot : item.headshot?.href) ??
      (item.id ? `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${item.id}.png&w=350&h=254` : null),
  })));
}

async function resolveNHLHeadshot(displayName: string, identity: PlayerIdentity): Promise<HeadshotResolution> {
  const url = `https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=100&q=${encodeURIComponent(displayName)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return { url: null, reason: 'unresolved' };
  const data = await res.json() as Array<{ playerId?: string; name?: string; teamId?: string;
    teamAbbrev?: string; teamName?: string; league?: string }>;
  if (!Array.isArray(data)) return { url: null, reason: 'unresolved' };
  // A full search window cannot establish uniqueness across provider results.
  if (data.length >= 100) return { url: null, reason: 'ambiguous' };
  return uniqueMatch(displayName, identity, data.map(item => ({
    name: item.name ?? '', teamId: item.teamId ?? null, teamAbbrev: item.teamAbbrev ?? null, teamName: item.teamName ?? (item.teamAbbrev ? NHL_TEAM_NAMES[item.teamAbbrev.toUpperCase()] : null) ?? null, league: item.league ?? 'NHL',
    url: item.playerId ? `https://assets.nhle.com/mugs/nhl/latest/${item.playerId}.png` : null,
  })));
}

// ── Enrichment Pass ────────────────────────────────────────────────

/**
 * Runs one enrichment pass: finds players with null headshot_url in metadata,
 * resolves headshots, and updates the participant record.
 *
 * Fail-open: individual errors are logged and skipped, never thrown.
 */
export async function runPlayerEnrichmentPass(
  deps: PlayerEnrichmentDeps,
): Promise<EnrichmentResult> {
  const result: EnrichmentResult = {
    scanned: 0,
    enriched: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    refusals: {},
  };

  // Start run record before processing so started_at reflects actual start time
  const run = await deps.runs.startRun({
    runType: 'player.enrichment',
    actor: 'system',
    details: {},
  });

  // Get all player participants
  const players = await deps.participants.listByType('player');
  result.scanned = players.length;

  for (const player of players) {
    const metadata = (player.metadata ?? {}) as Record<string, unknown>;

    // Skip if already enriched
    if (metadata['headshot_url'] && typeof metadata['headshot_url'] === 'string') {
      result.skipped++;
      continue;
    }

    try {
      const resolution = await resolveHeadshot(player.display_name, player.sport, {
        teamId: typeof metadata['team_external_id'] === 'string' ? metadata['team_external_id'] : null,
        teamAbbrev: typeof metadata['team_abbrev'] === 'string' ? metadata['team_abbrev'] : null,
        league: typeof metadata['league'] === 'string' ? metadata['league'] : null,
      });
      const headshotUrl = resolution.url;

      if (headshotUrl) {
        await deps.participants.updateMetadata(player.id, { headshot_url: headshotUrl });
        result.enriched++;
      } else {
        result.refusals[resolution.reason] = (result.refusals[resolution.reason] ?? 0) + 1;
        result.skipped++;
      }
    } catch (err) {
      result.failed++;
      result.errors.push(`${player.display_name}: ${(err as Error).message}`);
    }
  }

  await deps.runs.completeRun({
    runId: run.id,
    status: 'succeeded',
    details: {
      scanned: result.scanned,
      enriched: result.enriched,
      failed: result.failed,
      skipped: result.skipped,
      refusals: result.refusals,
    },
  });

  return result;
}
