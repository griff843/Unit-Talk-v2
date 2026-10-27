import type { ParticipantRepository } from '@unit-talk/db';
import { errorResponse, successResponse, type ApiResponse } from '../http.js';

export interface ParticipantMedia {
  participantId: string;
  participantType: 'player' | 'team';
  displayName: string;
  sport: string | null;
  headshotUrl: string | null;
  logoUrl: string | null;
}

// These are the image origins used by existing player/team enrichment. This
// endpoint projects stored metadata only; it never fetches or enriches images.
const MEDIA_HOSTS = new Set([
  'cdn.nba.com',
  'img.mlbstatic.com',
  'a.espncdn.com',
  'cms.nhl.bamgrid.com',
  'assets.nhle.com',
]);

export function normalizeParticipantMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !MEDIA_HOSTS.has(url.hostname) ||
      url.username || url.password || url.port ||
      url.hash
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

export async function handleGetParticipantMedia(
  participantId: string,
  repository: Pick<ParticipantRepository, 'findById'>,
): Promise<ApiResponse<ParticipantMedia>> {
  try {
    const participant = await repository.findById(participantId);
    if (
      !participant || participant.id !== participantId ||
      (participant.participant_type !== 'player' && participant.participant_type !== 'team')
    ) {
      return errorResponse(404, 'PARTICIPANT_NOT_FOUND', 'Participant artwork is unavailable');
    }
    const metadata = participant.metadata;
    const fields = metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata
      : {};
    return successResponse(200, {
      participantId: participant.id,
      participantType: participant.participant_type,
      displayName: participant.display_name,
      sport: participant.sport,
      headshotUrl: participant.participant_type === 'player'
        ? normalizeParticipantMediaUrl(fields['headshot_url'])
        : null,
      logoUrl: participant.participant_type === 'team'
        ? normalizeParticipantMediaUrl(fields['logo_url'])
        : null,
    });
  } catch {
    return errorResponse(503, 'PARTICIPANT_MEDIA_UNAVAILABLE', 'Participant artwork is temporarily unavailable');
  }
}
