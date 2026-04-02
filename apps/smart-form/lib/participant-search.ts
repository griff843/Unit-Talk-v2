/**
 * Pure helper utilities for participant autocomplete.
 * No UI dependencies — safe to import in tests and server contexts.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000';

export type ParticipantSearchType = 'player' | 'team';

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
  sport?: string,
): string {
  const params = new URLSearchParams({
    q: query.trim(),
    sport: sport?.trim() ?? '',
  });
  if (params.get('sport') === '') {
    params.delete('sport');
  }
  const endpoint = participantType === 'player' ? 'players' : 'teams';

  return `${API_BASE_URL}/api/reference-data/search/${endpoint}?${params.toString()}`;
}

export function normalizeParticipantSearchResults(
  payload: unknown,
  expectedType: ParticipantSearchType,
): ParticipantSuggestion[] {
  const participants = isRecord(payload) && Array.isArray(payload.data)
    ? payload.data
    : [];
  const seen = new Set<string>();

  return participants
    .flatMap((row) => {
      if (!isRecord(row)) {
        return [];
      }

      if (
        typeof row.participantId !== 'string' ||
        typeof row.displayName !== 'string'
      ) {
        return [];
      }

      const displayName = row.displayName.trim();
      if (!displayName) {
        return [];
      }

      const dedupeKey = displayName.toLowerCase();
      if (seen.has(dedupeKey)) {
        return [];
      }

      seen.add(dedupeKey);
      return [{ participantId: row.participantId, displayName, participantType: expectedType }];
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}
