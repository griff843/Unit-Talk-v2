/**
 * Team Logo Enrichment Service
 *
 * Enriches team participant records with logo URLs from ESPN CDN.
 * Runs as a scheduled pass — fail-open (errors are logged, never block).
 *
 * Pattern: cloned from player-enrichment-service.ts.
 *
 * Logo URL pattern (ESPN CDN, abbreviation-based):
 *   https://a.espncdn.com/i/teamlogos/{espnSport}/500/{abbreviation}.png
 *
 * Per MEDIA_ENRICHMENT_SUPPORT_PACK.md §3:
 *   - Single key: participants.metadata.logo_url
 *   - Must validate reachability before writing (404 must not be stored)
 *   - Absent = null, not stored
 */

import type { ParticipantRepository, SystemRunRepository } from '@unit-talk/db';

export interface TeamLogoEnrichmentDeps {
  participants: ParticipantRepository;
  runs: SystemRunRepository;
}

export interface LogoEnrichmentResult {
  scanned: number;
  enriched: number;
  failed: number;
  skipped: number;
  errors: string[];
}

// ── Sport → ESPN sport slug mapping ──────────────────────────────

const SPORT_TO_ESPN_SLUG: Record<string, string> = {
  NBA: 'nba',
  BASKETBALL: 'nba',
  NFL: 'nfl',
  FOOTBALL: 'nfl',
  MLB: 'mlb',
  BASEBALL: 'mlb',
  NHL: 'nhl',
  HOCKEY: 'nhl',
};

/**
 * Resolves a team logo URL from ESPN CDN using the team's abbreviation.
 * Returns null if sport is unsupported, abbreviation is missing, or URL returns 404.
 */
export async function resolveTeamLogoUrl(
  abbreviation: string | null,
  sport: string | null,
): Promise<string | null> {
  if (!abbreviation || !sport) return null;

  const espnSport = SPORT_TO_ESPN_SLUG[sport.toUpperCase()];
  if (!espnSport) return null;

  const url = `https://a.espncdn.com/i/teamlogos/${espnSport}/500/${abbreviation.toLowerCase()}.png`;

  // Validate reachability — a 404 must not be stored (per spec)
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? url : null;
  } catch {
    return null;
  }
}

/**
 * Runs one team logo enrichment pass: finds teams with null logo_url,
 * resolves logos, and updates the participant record.
 *
 * Fail-open: individual errors are logged and skipped, never thrown.
 */
export async function runTeamLogoEnrichmentPass(
  deps: TeamLogoEnrichmentDeps,
): Promise<LogoEnrichmentResult> {
  const result: LogoEnrichmentResult = {
    scanned: 0,
    enriched: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  const teams = await deps.participants.listByType('team');
  result.scanned = teams.length;

  for (const team of teams) {
    const metadata = (team.metadata ?? {}) as Record<string, unknown>;

    // Skip if already enriched
    if (metadata['logo_url'] && typeof metadata['logo_url'] === 'string') {
      result.skipped++;
      continue;
    }

    const abbreviation = typeof metadata['abbreviation'] === 'string'
      ? metadata['abbreviation']
      : null;

    try {
      const logoUrl = await resolveTeamLogoUrl(abbreviation, team.sport);

      if (logoUrl) {
        await deps.participants.updateMetadata(team.id, { logo_url: logoUrl });
        result.enriched++;
      } else {
        result.skipped++;
      }
    } catch (err) {
      result.failed++;
      result.errors.push(`${team.display_name}: ${(err as Error).message}`);
    }
  }

  // Write system_runs record
  const run = await deps.runs.startRun({
    runType: 'team.logo.enrichment',
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
