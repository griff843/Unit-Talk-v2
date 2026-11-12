import type { ParticipantRepository } from '@unit-talk/db';
import { errorResponse, successResponse, type ApiResponse } from '../http.js';

export type ParticipantMedia =
  | { participantId: string; participantType: 'player'; displayName: string; sport: string | null; headshotUrl: string | null }
  | { participantId: string; participantType: 'team'; displayName: string; sport: string | null; logoUrl: string | null };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEDIA_HOSTS = new Set(['cdn.nba.com', 'img.mlbstatic.com', 'a.espncdn.com', 'cms.nhl.bamgrid.com', 'assets.nhle.com']);

export function normalizeParticipantMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !MEDIA_HOSTS.has(url.hostname) || url.username || url.password || url.port || url.hash) return null;
    return url.href;
  } catch {
    return null;
  }
}

export async function handleGetParticipantMedia(
  participantId: string,
  repository: Pick<ParticipantRepository, 'findById'>,
): Promise<ApiResponse<ParticipantMedia>> {
  if (!UUID_PATTERN.test(participantId)) {
    return errorResponse(404, 'PARTICIPANT_NOT_FOUND', 'Participant artwork is unavailable');
  }
  try {
    const participant = await repository.findById(participantId);
    if (!participant || participant.id !== participantId || (participant.participant_type !== 'player' && participant.participant_type !== 'team')) {
      return errorResponse(404, 'PARTICIPANT_NOT_FOUND', 'Participant artwork is unavailable');
    }
    const metadata = participant.metadata;
    const fields = metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata as Record<string, unknown>
      : {};
    const base = {
      participantId: participant.id,
      displayName: participant.display_name,
      sport: participant.sport,
    };
    if (participant.participant_type === 'player') {
      return successResponse(200, { ...base, participantType: 'player' as const, headshotUrl: normalizeParticipantMediaUrl(fields.headshot_url) });
    }
    return successResponse(200, { ...base, participantType: 'team' as const, logoUrl: normalizeParticipantMediaUrl(fields.logo_url) });
  } catch {
    return errorResponse(503, 'PARTICIPANT_MEDIA_UNAVAILABLE', 'Participant artwork is temporarily unavailable');
  }
}
