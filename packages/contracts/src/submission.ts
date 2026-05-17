export const pickSources = [
  'smart-form',
  'feed',
  'system',
  'alert-agent',
  'model-driven',
  'api',
  'discord-bot',
  'system-pick-scanner',
  'board-construction',
] as const;

export type PickSource = (typeof pickSources)[number];

export interface SubmissionPayload {
  source: PickSource;
  submittedBy?: string | undefined;
  market: string;
  selection: string;
  line?: number | undefined;
  odds?: number | undefined;
  stakeUnits?: number | undefined;
  confidence?: number | undefined;
  eventName?: string | undefined;
  thesis?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface ValidatedSubmission {
  id: string;
  receivedAt: string;
  payload: SubmissionPayload;
}

export interface SubmissionValidationResult {
  ok: boolean;
  errors: string[];
}

export type ParseSubmissionResult =
  | { ok: true; data: SubmissionPayload }
  | { ok: false; errors: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseSubmissionPayload(raw: unknown): ParseSubmissionResult {
  if (!isRecord(raw)) {
    return { ok: false, errors: ['payload must be a JSON object'] };
  }

  const errors: string[] = [];

  if (!pickSources.includes(raw['source'] as PickSource)) {
    errors.push(`source must be one of: ${pickSources.join(', ')}`);
  }

  if (typeof raw['market'] !== 'string' || !raw['market'].trim()) {
    errors.push('market is required and must be a non-empty string');
  }

  if (typeof raw['selection'] !== 'string' || !raw['selection'].trim()) {
    errors.push('selection is required and must be a non-empty string');
  }

  if (raw['submittedBy'] !== undefined && typeof raw['submittedBy'] !== 'string') {
    errors.push('submittedBy must be a string when provided');
  }

  if (raw['line'] !== undefined && typeof raw['line'] !== 'number') {
    errors.push('line must be a number when provided');
  }

  if (raw['odds'] !== undefined && typeof raw['odds'] !== 'number') {
    errors.push('odds must be a number when provided');
  }

  if (raw['stakeUnits'] !== undefined && typeof raw['stakeUnits'] !== 'number') {
    errors.push('stakeUnits must be a number when provided');
  }

  if (raw['confidence'] !== undefined) {
    if (typeof raw['confidence'] !== 'number') {
      errors.push('confidence must be a number when provided');
    } else if (raw['confidence'] < 0 || raw['confidence'] > 1) {
      errors.push('confidence must be between 0 and 1');
    }
  }

  if (raw['eventName'] !== undefined && typeof raw['eventName'] !== 'string') {
    errors.push('eventName must be a string when provided');
  }

  if (raw['thesis'] !== undefined && typeof raw['thesis'] !== 'string') {
    errors.push('thesis must be a string when provided');
  }

  if (raw['metadata'] !== undefined && !isRecord(raw['metadata'])) {
    errors.push('metadata must be a JSON object when provided');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      source: raw['source'] as PickSource,
      submittedBy: raw['submittedBy'] as string | undefined,
      market: raw['market'] as string,
      selection: raw['selection'] as string,
      line: raw['line'] as number | undefined,
      odds: raw['odds'] as number | undefined,
      stakeUnits: raw['stakeUnits'] as number | undefined,
      confidence: raw['confidence'] as number | undefined,
      eventName: raw['eventName'] as string | undefined,
      thesis: raw['thesis'] as string | undefined,
      metadata: raw['metadata'] as Record<string, unknown> | undefined,
    },
  };
}

export function validateSubmissionPayload(
  payload: SubmissionPayload,
): SubmissionValidationResult {
  const errors: string[] = [];

  if (!payload.source.trim()) {
    errors.push('source is required');
  }

  if (!payload.market.trim()) {
    errors.push('market is required');
  }

  if (!payload.selection.trim()) {
    errors.push('selection is required');
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
