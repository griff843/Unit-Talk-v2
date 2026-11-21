/**
 * Pick Asset Resolver (WORK-2026110302)
 *
 * Resolves Discord artwork for a pick by canonical participant identity only.
 * Selection text is never used to choose a participant.
 *
 *   - Player: the stored `headshot_url` is verified only when a fresh
 *     `resolveHeadshot` for that same participant (display name, sport, team)
 *     confirms exactly the stored URL. Ambiguity, mismatch, null or the
 *     deadline yield no thumbnail.
 *   - Team: the participant's own `logo_url`, only when the identified
 *     participant is that team and the market is not a game total.
 *   - Anything else: no thumbnail. The embed keeps its text brand.
 *
 * All artwork work for one submission shares one overall deadline (5s by
 * default). The resolver never throws and never writes to the database.
 */

import { allowedMediaUrl, normalizeMarketKey } from '@unit-talk/domain';
import type { ParticipantRepository, ParticipantRow } from '@unit-talk/db';
import {
  resolveHeadshot as defaultResolveHeadshot,
  type HeadshotResolution,
  type PlayerIdentity,
} from './player-enrichment-service.js';

export const PICK_ARTWORK_DEADLINE_MS = 5_000;

export interface PickArtwork {
  url: string | null;
  verified: boolean;
}

export interface PickArtworkInput {
  /** The canonical participant ID that submission already resolved. */
  participantId: string | null | undefined;
  /** The normalized market key of the pick. */
  marketKey: string | null | undefined;
}

export interface PickArtworkOptions {
  /** Overall budget for every artwork lookup of one submission. */
  deadlineMs?: number;
  /** Injection seam for tests; defaults to the #1822 matcher. */
  resolveHeadshot?: (
    displayName: string,
    sport: string | null,
    identity?: PlayerIdentity,
  ) => Promise<HeadshotResolution>;
}

const NO_ARTWORK: PickArtwork = Object.freeze({ url: null, verified: false });

/**
 * A game-level total (both teams combined) has no single participant to depict.
 * Team totals stay eligible because they belong to one team.
 */
export function isTwoTeamMarket(marketKey: string | null | undefined): boolean {
  if (!marketKey) return false;
  const canonical = normalizeMarketKey(marketKey);
  if (canonical === 'game_total_ou') return true;
  // Canonical player props (e.g. `batting-total-bases-all-game-ou`) and team
  // totals belong to one participant even when their key says "total".
  if (canonical === 'team_total_ou' || canonical.endsWith('-all-game-ou')) return false;
  const key = canonical.toLowerCase();
  if (key.startsWith('player')) return false;
  if (/team[_\s-]?total/u.test(key)) return false;
  return /(^|[_\s-])(game[_\s-]?)?totals?($|[_\s-])/u.test(key);
}

export async function resolvePickArtwork(
  input: PickArtworkInput,
  participants: Pick<ParticipantRepository, 'findById'> | undefined,
  options: PickArtworkOptions = {},
): Promise<PickArtwork> {
  const deadlineMs = options.deadlineMs ?? PICK_ARTWORK_DEADLINE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<PickArtwork>((resolve) => {
    // Not unref'd: a short-lived caller must still see the deadline fire. The
    // timer is always cleared below, so it never holds a process open.
    timer = setTimeout(() => resolve(NO_ARTWORK), deadlineMs);
  });
  try {
    return await Promise.race([
      resolveWithinBudget(input, participants, options).catch(() => NO_ARTWORK),
      deadline,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolveWithinBudget(
  input: PickArtworkInput,
  participants: Pick<ParticipantRepository, 'findById'> | undefined,
  options: PickArtworkOptions,
): Promise<PickArtwork> {
  const participantId = input.participantId?.trim();
  if (!participants || !participantId) return NO_ARTWORK;
  if (isTwoTeamMarket(input.marketKey)) return NO_ARTWORK;

  const participant = await participants.findById(participantId);
  if (!participant || participant.id !== participantId) return NO_ARTWORK;
  const meta = readRecord(participant.metadata);

  if (participant.participant_type === 'team') {
    const logo = allowedMediaUrl(meta['logo_url']);
    return logo ? { url: logo, verified: true } : NO_ARTWORK;
  }

  if (participant.participant_type === 'player') {
    return verifyPlayerHeadshot(participant, meta, options);
  }

  return NO_ARTWORK;
}

async function verifyPlayerHeadshot(
  participant: ParticipantRow,
  meta: Record<string, unknown>,
  options: PickArtworkOptions,
): Promise<PickArtwork> {
  const stored = allowedMediaUrl(meta['headshot_url']);
  if (!stored) return NO_ARTWORK;

  const resolveHeadshot = options.resolveHeadshot ?? defaultResolveHeadshot;
  const resolution = await resolveHeadshot(
    participant.display_name,
    participant.sport ?? participant.league ?? null,
    {
      teamId: readString(meta['team_external_id']),
      teamAbbrev: readString(meta['team_abbrev']),
      league: participant.league ?? readString(meta['league']),
    },
  );
  return resolution.reason === 'confirmed' && resolution.url === stored
    ? { url: stored, verified: true }
    : NO_ARTWORK;
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
