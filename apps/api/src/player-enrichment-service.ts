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
}

/**
 * Resolves a headshot URL for a player by sport.
 * Returns null if the player cannot be found or the API is unreachable.
 */
export async function resolveHeadshotUrl(
  displayName: string,
  sport: string | null,
  _externalId: string | null,
): Promise<string | null> {
  if (!sport) return null;

  const normalized = sport.toUpperCase();

  try {
    switch (normalized) {
      case 'MLB':
      case 'BASEBALL':
        return await resolveMLBHeadshot(displayName);
      case 'NBA':
      case 'BASKETBALL':
        return await resolveNBAHeadshot(displayName);
      case 'NFL':
      case 'FOOTBALL':
        return await resolveNFLHeadshot(displayName);
      case 'NHL':
      case 'HOCKEY':
        return await resolveNHLHeadshot(displayName);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ── MLB ────────────────────────────────────────────────────────────
async function resolveMLBHeadshot(displayName: string): Promise<string | null> {
  const url = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(displayName)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;

  const data = (await res.json()) as { people?: Array<{ id: number }> };
  if (!data.people?.length) return null;

  const playerId = data.people[0]!.id;
  return `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,d_people:generic:headshot:silo:current.png,q_auto:best,f_auto/v1/people/${playerId}/headshot/67/current`;
}

// ── NBA ────────────────────────────────────────────────────────────
async function resolveNBAHeadshot(displayName: string): Promise<string | null> {
  const url = `https://stats.nba.com/stats/commonallplayers?IsOnlyCurrentSeason=1&LeagueID=00&Season=2024-25`;
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

  const nameLower = displayName.toLowerCase();
  // rowSet columns: [PERSON_ID, DISPLAY_LAST_COMMA_FIRST, ...]
  const match = rows.find((row) => {
    const fullName = String(row[1] ?? '').toLowerCase();
    // "Last, First" format — also try direct match
    return fullName.includes(nameLower) || nameLower.split(' ').every((part) => fullName.includes(part));
  });

  if (!match) return null;
  const playerId = match[0];
  return `https://cdn.nba.com/headshots/nba/latest/1040x760/${playerId}.png`;
}

// ── NFL ────────────────────────────────────────────────────────────
async function resolveNFLHeadshot(displayName: string): Promise<string | null> {
  // Use ESPN search API as NFL doesn't have a public people-search
  const url = `https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(displayName)}&limit=5&type=player&sport=football&league=nfl`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    items?: Array<{ id?: string; headshot?: string; displayName?: string }>;
  };
  if (!data.items?.length) return null;

  // ESPN items sometimes include headshot directly
  const match = data.items.find((item) =>
    item.displayName?.toLowerCase() === displayName.toLowerCase(),
  ) ?? data.items[0];

  if (match?.headshot) return match.headshot;

  // Fallback: construct ESPN headshot URL from athlete ID
  if (match?.id) {
    return `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${match.id}.png&w=350&h=254`;
  }

  return null;
}

// ── NHL ────────────────────────────────────────────────────────────
async function resolveNHLHeadshot(displayName: string): Promise<string | null> {
  const url = `https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=5&q=${encodeURIComponent(displayName)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;

  const data = (await res.json()) as Array<{ playerId?: string; name?: string }>;
  if (!Array.isArray(data) || data.length === 0) return null;

  const playerId = data[0]!.playerId;
  if (!playerId) return null;

  return `https://cms.nhl.bamgrid.com/images/headshots/current/168x168/${playerId}.jpg`;
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
  };

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
      const headshotUrl = await resolveHeadshotUrl(
        player.display_name,
        player.sport,
        player.external_id,
      );

      if (headshotUrl) {
        await deps.participants.updateMetadata(player.id, { headshot_url: headshotUrl });
        result.enriched++;
      } else {
        result.skipped++;
      }
    } catch (err) {
      result.failed++;
      result.errors.push(`${player.display_name}: ${(err as Error).message}`);
    }
  }

  // Write system_runs record
  const run = await deps.runs.startRun({
    runType: 'player.enrichment',
    actor: 'system',
    details: {},
  });
  await deps.runs.completeRun({
    runId: run.id,
    status: 'succeeded',
    details: {
      scanned: result.scanned,
      enriched: result.enriched,
      failed: result.failed,
      skipped: result.skipped,
    },
  });

  return result;
}
