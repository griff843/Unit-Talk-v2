/**
 * Pure helper utilities for participant autocomplete.
 * No UI dependencies - safe to import in tests and server contexts.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000';

export type ParticipantSearchType = 'player' | 'team';

interface OperatorParticipantSearchOptions {
  eventId?: string | null;
  sport?: string;
}

export interface ParticipantSuggestion {
  participantId: string;
  displayName: string;
  participantType: ParticipantSearchType;
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
  } else if (sportOrOptions?.sport?.trim()) {
    params.set('sport', sportOrOptions.sport.trim());
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
      return [{ participantId, displayName, participantType: expectedType }];
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}
