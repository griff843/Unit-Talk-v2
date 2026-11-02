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
 *   NHL  — cms.nhl.bamgrid.com headshots
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
function uniqueMatch(name: string, identity: PlayerIdentity, candidates: Candidate[]): HeadshotResolution {
  const expected = normalizePlayerName(name);
  const matches = candidates.filter(candidate => expected && normalizePlayerName(candidate.name) === expected &&
    [candidate, ...(candidate.identities ?? [])].every(actual =>
      (['teamId', 'teamAbbrev', 'league'] as const).every(key =>
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
  players: Array<{ id: number; fullName: string; currentTeam?: { id?: number }; league?: string }>;
  fetchedAt: number;
}
let mlbRosterCache: MlbRosterCache | null = null;
const MLB_ROSTER_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

async function fetchMlbRoster(): Promise<Array<{ id: number; fullName: string; currentTeam?: { id?: number }; league?: string }> | null> {
  const now = Date.now();
  if (mlbRosterCache && now - mlbRosterCache.fetchedAt < MLB_ROSTER_CACHE_TTL_MS) {
    return mlbRosterCache.players;
  }

  // MLB season runs March–October; use previous year in off-season
  const season = new Date().getMonth() >= 2 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const url = `https://statsapi.mlb.com/api/v1/sports/1/players?season=${season}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;

  const data = (await res.json()) as { people?: Array<{ id: number; fullName: string; currentTeam?: { id?: number }; league?: string }> };
  const players = data.people;
  if (!players?.length) return null;

  mlbRosterCache = { players, fetchedAt: now };
  return players;
}

async function resolveMLBHeadshot(displayName: string, identity: PlayerIdentity): Promise<HeadshotResolution> {
  const players = await fetchMlbRoster();
  if (!players) return { url: null, reason: 'unresolved' };
  return uniqueMatch(displayName, identity, players.map(p => ({
    name: p.fullName, teamId: p.currentTeam?.id?.toString() ?? null, league: p.league ?? 'MLB',
    url: p.id ? `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,d_people:generic:headshot:silo:current.png,q_auto:best,f_auto/v1/people/${p.id}/headshot/67/current` : null,
  })));
}

// ── NBA ────────────────────────────────────────────────────────────
// Cache the full NBA roster for 2 hours to avoid making one HTTP call per player.
// stats.nba.com rate-limits sequential per-player requests, causing most NBA
// players to get skipped on the enrichment pass without this.
interface NbaRosterCache {
  rows: Array<Array<string | number>>;
  fetchedAt: number;
}
let nbaRosterCache: NbaRosterCache | null = null;
const NBA_ROSTER_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

async function fetchNbaRoster(): Promise<Array<Array<string | number>> | null> {
  const now = Date.now();
  if (nbaRosterCache && now - nbaRosterCache.fetchedAt < NBA_ROSTER_CACHE_TTL_MS) {
    return nbaRosterCache.rows;
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
    resultSets?: Array<{ rowSet?: Array<Array<string | number>> }>;
  };
  const rows = data.resultSets?.[0]?.rowSet;
  if (!rows) return null;

  nbaRosterCache = { rows, fetchedAt: now };
  return rows;
}

async function resolveNBAHeadshot(displayName: string, identity: PlayerIdentity): Promise<HeadshotResolution> {
  const rows = await fetchNbaRoster();
  if (!rows) return { url: null, reason: 'unresolved' };
  return uniqueMatch(displayName, identity, rows.map(row => {
    // commonallplayers: PERSON_ID, DISPLAY_LAST_COMMA_FIRST, DISPLAY_FIRST_LAST,
    // ... TEAM_ID (7), TEAM_ABBREVIATION (10). Prefer the full display name.
    const reversed = String(row[1] ?? '').split(',').map(part => part.trim());
    return { name: String(row[2] || (reversed.length === 2 ? `${reversed[1]} ${reversed[0]}` : row[1]) || ''),
      teamId: row[7] ? String(row[7]) : null, teamAbbrev: row[10] ? String(row[10]) : null, league: 'NBA',
      url: row[0] ? `https://cdn.nba.com/headshots/nba/latest/1040x760/${row[0]}.png` : null };
  }));
}

async function resolveNFLHeadshot(displayName: string, identity: PlayerIdentity): Promise<HeadshotResolution> {
  const url = `https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(displayName)}&limit=5&type=player&sport=football&league=nfl`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return { url: null, reason: 'unresolved' };
  const data = await res.json() as { items?: Array<{ id?: string; displayName?: string;
    headshot?: string | { href?: string }; team?: { id?: string; abbreviation?: string }; league?: string;
    teamRelationships?: Array<{ core?: { id?: string; abbreviation?: string } }>;
    leagueRelationships?: Array<{ core?: { abbreviation?: string; slug?: string } }> }> };
  if (!Array.isArray(data.items)) return { url: null, reason: 'unresolved' };
  return uniqueMatch(displayName, identity, data.items.map(item => ({
    name: item.displayName ?? '', teamId: item.team?.id ?? null, teamAbbrev: item.team?.abbreviation ?? null,
    league: item.league ?? 'NFL',
    identities: [
      ...(item.teamRelationships ?? []).map(rel => ({ teamId: rel.core?.id ?? null, teamAbbrev: rel.core?.abbreviation ?? null })),
      ...(item.leagueRelationships ?? []).map(rel => ({ league: rel.core?.abbreviation ?? rel.core?.slug ?? null })),
    ],
    url: (typeof item.headshot === 'string' ? item.headshot : item.headshot?.href) ??
      (item.id ? `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${item.id}.png&w=350&h=254` : null),
  })));
}

async function resolveNHLHeadshot(displayName: string, identity: PlayerIdentity): Promise<HeadshotResolution> {
  const url = `https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=5&q=${encodeURIComponent(displayName)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return { url: null, reason: 'unresolved' };
  const data = await res.json() as Array<{ playerId?: string; name?: string; teamId?: string;
    teamAbbrev?: string; league?: string }>;
  if (!Array.isArray(data)) return { url: null, reason: 'unresolved' };
  return uniqueMatch(displayName, identity, data.map(item => ({
    name: item.name ?? '', teamId: item.teamId ?? null, teamAbbrev: item.teamAbbrev ?? null, league: item.league ?? 'NHL',
    url: item.playerId ? `https://cms.nhl.bamgrid.com/images/headshots/current/168x168/${item.playerId}.jpg` : null,
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
