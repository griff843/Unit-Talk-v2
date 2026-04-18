/**
 * Pick Asset Resolver
 *
 * Resolves a thumbnail URL for a pick by matching against enriched
 * participant data. Best-effort — returns null if no match found.
 *
 * Resolution order (per discord_embed_system_spec_addendum_assets.md):
 *   1. Player headshot_url from matching participant
 *   2. Team logo_url from matching team participant
 *   3. null (never block delivery)
 *
 * Called at submission time to stash the URL in pick metadata.
 * The embed builder reads metadata.thumbnailUrl — no DB access at delivery.
 */

import type { ParticipantRepository } from '@unit-talk/db';
import { resolveHeadshotUrl } from './player-enrichment-service.js';

/**
 * Attempts to resolve a thumbnail URL for a pick by matching the
 * pick's selection text against known participants for the sport.
 *
 * Returns the best available image URL, or null if no match.
 * Never throws — fail-open by design.
 */
export async function resolvePickThumbnailUrl(
  selection: string,
  sport: string | null | undefined,
  participants: ParticipantRepository,
): Promise<string | null> {
  if (!sport || !selection) return null;

  try {
    // Try player match first (player props, MVP bets, etc.)
    const players = await participants.listByType('player', sport);
    const playerMatch = findBestMatch(selection, players);
    if (playerMatch) {
      const meta = (playerMatch.metadata ?? {}) as Record<string, unknown>;
      const headshot = meta['headshot_url'];
      if (typeof headshot === 'string' && headshot.length > 0) {
        return headshot;
      }

      const resolvedHeadshot = await resolveHeadshotUrl(
        playerMatch.display_name,
        sport,
        typeof meta['external_id'] === 'string' ? meta['external_id'] : null,
      );
      if (resolvedHeadshot) {
        // Write back to DB so the scheduled pass doesn't need to re-resolve this player
        participants.updateMetadata(playerMatch.id, { headshot_url: resolvedHeadshot }).catch(() => {});
        return resolvedHeadshot;
      }
    }

    // Fall back to team match (moneyline, spread, total)
    const teams = await participants.listByType('team', sport);
    const teamMatch = findBestMatch(selection, teams);
    if (teamMatch) {
      const meta = (teamMatch.metadata ?? {}) as Record<string, unknown>;
      const logo = meta['logo_url'];
      if (typeof logo === 'string' && logo.length > 0) {
        return logo;
      }
    }

    return null;
  } catch {
    // Fail-open: participant lookup failure must never block submission
    return null;
  }
}

/**
 * Simple best-effort text matching: checks if the selection contains
 * the participant's display_name or abbreviation (for teams).
 *
 * Returns the first match found, or null.
 */
function findBestMatch(
  selection: string,
  participants: ReadonlyArray<{
    id: string;
    display_name: string;
    metadata: unknown;
  }>,
): { id: string; display_name: string; metadata: unknown } | null {
  const selLower = selection.toLowerCase();

  for (const p of participants) {
    const name = p.display_name.toLowerCase();

    // Exact substring match (e.g., "Chiefs" in "Chiefs -3")
    if (selLower.includes(name)) {
      return p;
    }

    // Check abbreviation for teams (e.g., "KC" in "KC -3")
    const meta = (p.metadata ?? {}) as Record<string, unknown>;
    const abbr = typeof meta['abbreviation'] === 'string' ? meta['abbreviation'].toLowerCase() : null;
    if (abbr && selLower.startsWith(abbr + ' ')) {
      return p;
    }

    // Check last name for players (e.g., "Mahomes" in "Mahomes Over 2.5 TDs")
    const nameParts = name.split(' ');
    const lastName = nameParts[nameParts.length - 1];
    if (lastName && lastName.length >= 3 && selLower.includes(lastName)) {
      return p;
    }
  }

  return null;
}
