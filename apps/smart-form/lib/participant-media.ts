/** Optional presentation data; never used to build or validate a submission. */
export interface ParticipantMedia {
  participantId: string;
  participantType: 'player' | 'team';
  displayName: string;
  sport: string | null;
  headshotUrl: string | null;
  logoUrl: string | null;
}

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000';
const MEDIA_HOSTS = new Set([
  'cdn.nba.com', 'img.mlbstatic.com', 'a.espncdn.com',
  'cms.nhl.bamgrid.com', 'assets.nhle.com',
]);

export function approvedMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && MEDIA_HOSTS.has(url.hostname) &&
      !url.username && !url.password && !url.port && !url.hash ? url.href : null;
  } catch {
    return null;
  }
}

/** Reject mismatched identities even if a proxy or cache returns a valid shape. */
export function parseParticipantMedia(
  value: unknown,
  participantId: string,
  participantType: 'player' | 'team',
  sport: string,
): ParticipantMedia | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (data.participantId !== participantId || data.participantType !== participantType ||
      typeof data.sport !== 'string' || data.sport.toUpperCase() !== sport.toUpperCase() ||
      typeof data.displayName !== 'string') return null;
  return {
    participantId, participantType, displayName: data.displayName, sport: data.sport,
    headshotUrl: participantType === 'player' ? approvedMediaUrl(data.headshotUrl) : null,
    logoUrl: participantType === 'team' ? approvedMediaUrl(data.logoUrl) : null,
  };
}

export async function fetchParticipantMedia(
  participantId: string | null | undefined,
  participantType: 'player' | 'team',
  sport: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ParticipantMedia | null> {
  if (!participantId || !sport) return null;
  try {
    const response = await fetcher(`${API}/api/reference-data/participants/${encodeURIComponent(participantId)}/media`, { signal });
    if (!response.ok || signal.aborted) return null;
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object') return null;
    return parseParticipantMedia((payload as Record<string, unknown>).data, participantId, participantType, sport);
  } catch {
    // Artwork is optional. A missing endpoint/image never changes form validity.
    return null;
  }
}

export function participantInitials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

/** Browse teamId can be a legacy teams.id; media always uses participants.id. */
export function mediaTeamParticipantId(
  selectedTeamId: string | null,
  teams: ReadonlyArray<{ participantId: string; teamId: string | null }>,
): string | null {
  if (!selectedTeamId) return null;
  return teams.find(team => team.participantId === selectedTeamId || team.teamId === selectedTeamId)?.participantId ?? selectedTeamId;
}
