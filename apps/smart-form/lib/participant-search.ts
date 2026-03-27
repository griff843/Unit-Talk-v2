/**
 * Pure helper utilities for participant autocomplete.
 * No UI dependencies — safe to import in tests and server contexts.
 */

const OPERATOR_WEB_URL = process.env.NEXT_PUBLIC_OPERATOR_WEB_URL ?? 'http://127.0.0.1:4200';
const PARTICIPANT_LIMIT = 10;

export type ParticipantSearchType = 'player' | 'team';

export interface ParticipantSuggestion {
  displayName: string;
  participantType: ParticipantSearchType;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function buildParticipantSearchUrl(
  query: string,
  participantType: ParticipantSearchType,
  sport?: string,
): string {
  const params = new URLSearchParams({
    q: query.trim(),
    type: participantType,
    limit: String(PARTICIPANT_LIMIT),
  });

  if (sport?.trim()) {
    params.set('sport', sport.trim());
  }

  return `${OPERATOR_WEB_URL}/api/operator/participants?${params.toString()}`;
}

export function normalizeParticipantSearchResults(
  payload: unknown,
  expectedType: ParticipantSearchType,
): ParticipantSuggestion[] {
  const participants = isRecord(payload) && Array.isArray(payload.participants)
    ? payload.participants
    : [];
  const seen = new Set<string>();

  return participants
    .flatMap((row) => {
      if (!isRecord(row)) {
        return [];
      }

      if (typeof row.displayName !== 'string' || row.participantType !== expectedType) {
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
      return [{ displayName, participantType: expectedType }];
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}
