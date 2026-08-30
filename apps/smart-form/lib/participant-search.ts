/**
 * Pure helper utilities for participant autocomplete.
 * No UI dependencies - safe to import in tests and server contexts.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000';

export type ParticipantSearchType = 'player' | 'team';

interface OperatorParticipantSearchOptions {
  eventId?: string | null;
  sport?: string;
  teamId?: string | null;
}

export interface ParticipantSuggestion {
  participantId: string;
  displayName: string;
  participantType: ParticipantSearchType;
  teamId: string | null;
}

export function buildParticipantSearchEmptyMessage(
  participantType: ParticipantSearchType,
  sport: string,
  query: string,
  datasetAvailable: boolean | null,
): string {
  const noun = participantType === 'team' ? 'team' : 'player';
  if (datasetAvailable === false) {
    return `Canonical ${sport} ${noun} data is not available in this environment yet.`;
  }
  return `No canonical ${noun} found for “${query.trim()}”.`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function buildParticipantSearchUrl(
  query: string,
  participantType: ParticipantSearchType,
  sportOrOptions?: string | OperatorParticipantSearchOptions,
): string {
  const params = new URLSearchParams({ q: query.trim() });

  if (typeof sportOrOptions === 'string') {
    if (sportOrOptions.trim()) {
      params.set('sport', sportOrOptions.trim());
    }
  } else {
    if (sportOrOptions?.sport?.trim()) {
      params.set('sport', sportOrOptions.sport.trim());
    }
    if (sportOrOptions?.eventId?.trim()) {
      params.set('eventId', sportOrOptions.eventId.trim());
    }
    if (participantType === 'player' && sportOrOptions?.teamId?.trim()) {
      params.set('teamId', sportOrOptions.teamId.trim());
    }
  }

  const endpoint = participantType === 'player' ? 'players' : 'teams';
  return `${API_BASE_URL}/api/reference-data/search/${endpoint}?${params.toString()}`;
}

export function normalizeParticipantSearchResults(
  payload: unknown,
  expectedType: ParticipantSearchType,
): ParticipantSuggestion[] {
  const participants = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  const seen = new Set<string>();

  return participants
    .flatMap((row) => {
      if (!isRecord(row)) {
        return [];
      }

      const participantId = typeof row.participantId === 'string'
        ? row.participantId
        : typeof row.id === 'string'
          ? row.id
          : null;
      const displayName = typeof row.displayName === 'string'
        ? row.displayName.trim()
        : typeof row.name === 'string'
          ? row.name.trim()
          : '';
      const participantType = typeof row.participantType === 'string'
        ? row.participantType
        : typeof row.type === 'string'
          ? row.type
          : expectedType;
      const teamId = typeof row.teamId === 'string' ? row.teamId : null;

      if (!participantId || !displayName) {
        return [];
      }
      if (participantType !== expectedType) {
        return [];
      }

      const dedupeKey = displayName.toLowerCase();
      if (seen.has(dedupeKey)) {
        return [];
      }

      seen.add(dedupeKey);
      return [{ participantId, displayName, participantType: expectedType, teamId }];
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}
